/*
 * Conexão TV ⇄ celular sem servidor próprio.
 *
 * - A TV é o "host": guarda o estado, aplica os comandos e envia o estado
 *   atualizado para todos os celulares conectados.
 * - O celular envia comandos e recebe o estado de volta.
 *
 * Dois caminhos:
 * 1. WebRTC (PeerJS) — o principal. O servidor gratuito do PeerJS só ajuda os
 *    aparelhos a se encontrarem; os dados passam direto entre TV e celular.
 * 2. Modo compatível (relay HTTP pelo ntfy.sh) — para navegadores de TV sem
 *    WebRTC (ex.: navegador da LG) ou redes que bloqueiam a conexão direta.
 *    Funciona com EventSource + XMLHttpRequest, que qualquer TV tem. O ntfy.sh
 *    público aceita 250 mensagens/dia por IP, então só é usado quando preciso.
 */
(function (root) {
  'use strict';

  var ID_PREFIX = 'bjj-cronometro-tv-';
  var RETRY_MS = 3000;
  var CONNECT_TIMEOUT_MS = 10000;
  var ACK_TIMEOUT_MS = 6000;
  // Quanto tempo a TV insiste no próprio código quando o servidor diz que ele
  // está em uso por outro token. A mesma TV retoma o código na hora (token
  // salvo); esta espera só vale para outro aparelho ou sessão sem o token.
  // Antes a troca acontecia em ~12 s e os celulares ficavam procurando um
  // código que a TV não usava mais.
  var TAKEN_GIVE_UP_MS = 90000;
  // Por padrão usa o servidor público gratuito do PeerJS. Para usar um servidor
  // PeerJS próprio, defina window.BJJ_PEER_OPTIONS (ex.: {host, port, path, secure}).
  var PEER_OPTIONS = root.BJJ_PEER_OPTIONS || { debug: 0 };

  // Modo compatível. Para um servidor ntfy próprio, defina window.BJJ_RELAY_URL.
  var RELAY_URL = root.BJJ_RELAY_URL || 'https://ntfy.sh/';
  var RELAY_PREFIX = 'bbx-cronometro-';
  // Celular: quanto esperar pelo WebRTC antes de tentar o modo compatível.
  var RELAY_FALLBACK_MS = 6000;
  // Várias mudanças seguidas (ex.: +2 +2 no placar) viram uma mensagem só.
  var RELAY_DEBOUNCE_MS = 250;
  var RELAY_ACK_TIMEOUT_MS = 10000;

  function tvPeerId(code) {
    return ID_PREFIX + code;
  }

  function randomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  // ------------------------------------------------------------ Relay (ntfy)
  function relayTopic(code, kind) {
    return RELAY_PREFIX + code + '-' + kind; // kind: 'cmd' (celular → TV) | 'state' (TV → celular)
  }

  function relayPublish(topic, obj, cb) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', RELAY_URL + topic, true);
      xhr.onload = function () {
        if (cb) cb(xhr.status >= 200 && xhr.status < 300 ? null : new Error('Modo compatível: erro ' + xhr.status));
      };
      xhr.onerror = function () { if (cb) cb(new Error('Modo compatível sem rede')); };
      xhr.send(JSON.stringify(obj));
    } catch (e) {
      if (cb) cb(e);
    }
  }

  /** Assina um tópico. Retorna {close()} ou null se o navegador não tiver EventSource. */
  function relaySubscribe(topic, handlers) {
    if (!root.EventSource) return null;
    var seen = {}; // a reconexão automática do EventSource pode repetir mensagens
    var es = new root.EventSource(RELAY_URL + topic + '/sse');
    es.onopen = function () { if (handlers.onOpen) handlers.onOpen(); };
    es.onerror = function () { if (handlers.onError) handlers.onError(); };
    es.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (!m || m.event !== 'message' || seen[m.id]) return;
      seen[m.id] = 1;
      var body;
      try { body = JSON.parse(m.message); } catch (err) { return; }
      handlers.onMessage(body);
    };
    return { close: function () { es.close(); } };
  }

  // ---------------------------------------------------------------- TV (host)
  function host(opts) {
    var S = root.BJJState;
    var code = opts.code;
    var state = opts.initialState || S.createRoomState(code);
    var conns = [];
    var peer = null;
    var takenSince = 0;
    // Token fixo da TV: com ele o servidor do PeerJS devolve o código para a
    // mesma TV na hora, mesmo que a sessão antiga ainda não tenha expirado.
    var peerOptions = {};
    for (var k in PEER_OPTIONS) {
      if (Object.prototype.hasOwnProperty.call(PEER_OPTIONS, k)) peerOptions[k] = PEER_OPTIONS[k];
    }
    if (opts.token) peerOptions.token = opts.token;

    // Status mostrado na TV: WebRTC + modo compatível.
    var peerStatus = 'offline';
    var relayOpen = false;
    var relayRemotes = {}; // celulares vistos pelo modo compatível

    function emitStatus() {
      var s = peerStatus;
      if (peerStatus !== 'online' && relayOpen) s = 'relay';
      opts.onStatus(s);
    }
    function setPeerStatus(s) { peerStatus = s; emitStatus(); }

    function relayCount() {
      var n = 0;
      for (var id in relayRemotes) if (Object.prototype.hasOwnProperty.call(relayRemotes, id)) n += 1;
      return n;
    }

    function peers() {
      return { tv: 1, remote: conns.length + relayCount() };
    }

    function message() {
      return { kind: 'state', state: state, peers: peers(), now: Date.now() };
    }

    function broadcast() {
      var msg = message();
      conns.forEach(function (c) { try { c.send(msg); } catch (e) { /* conexão caindo */ } });
      opts.onPeers(peers());
      if (relayCount()) queueRelayState();
    }

    function apply(cmd) {
      state = S.applyCommand(state, cmd, Date.now());
      opts.onState(state);
      broadcast();
    }

    function applySafely(cmd) {
      try { apply(cmd); return null; } catch (e) {
        return e && e.name === 'CommandError' ? e.message : 'Erro ao aplicar comando';
      }
    }

    function removeConn(conn) {
      var i = conns.indexOf(conn);
      if (i >= 0) { conns.splice(i, 1); broadcast(); }
    }

    function onConnection(conn) {
      conn.on('open', function () {
        conns.push(conn);
        conn.send(message());
        broadcast();
      });
      conn.on('data', function (msg) {
        if (!msg || msg.kind !== 'cmd') return;
        var error = applySafely(msg.cmd);
        try { conn.send({ kind: 'ack', id: msg.id, error: error }); } catch (e) { /* conexão caindo */ }
      });
      conn.on('close', function () { removeConn(conn); });
      conn.on('error', function () { removeConn(conn); });
    }

    // --- Modo compatível ---
    var relaySub = null;
    var relayAcks = [];
    var relayTimer = null;

    function queueRelayState() {
      if (relayTimer) return;
      relayTimer = setTimeout(function () {
        relayTimer = null;
        var msg = message();
        msg.acks = relayAcks;
        relayAcks = [];
        relayPublish(relayTopic(code, 'state'), msg);
      }, RELAY_DEBOUNCE_MS);
    }

    function onRelayMessage(msg) {
      if (!msg || !msg.from) return;
      if (!relayRemotes[msg.from]) { relayRemotes[msg.from] = 1; opts.onPeers(peers()); }
      if (msg.kind === 'cmd') {
        relayAcks.push({ to: msg.from, id: msg.id, error: applySafely(msg.cmd) });
      }
      queueRelayState(); // 'hello' e comandos respondem com o estado atual
    }

    function openRelay() {
      if (relaySub) relaySub.close();
      relayOpen = false;
      relaySub = relaySubscribe(relayTopic(code, 'cmd'), {
        onOpen: function () { relayOpen = true; emitStatus(); },
        onError: function () { relayOpen = false; emitStatus(); },
        onMessage: onRelayMessage
      });
    }

    // --- WebRTC ---
    function open() {
      if (!takenSince) setPeerStatus('offline');
      // Sem PeerJS/WebRTC (ex.: navegador da LG) a TV segue pelo modo compatível.
      try {
        if (!root.Peer) throw new Error('PeerJS indisponível');
        peer = new root.Peer(tvPeerId(code), peerOptions);
      } catch (e) {
        peer = null;
        setPeerStatus('unsupported');
        return;
      }
      peer.on('open', function () {
        takenSince = 0;
        setPeerStatus('online');
      });
      peer.on('connection', onConnection);
      var current = peer;
      peer.on('disconnected', function () {
        if (current.destroyed) return; // destruído de propósito em restart()
        if (!takenSince) setPeerStatus('offline'); // mantém "Liberando a sala…"
        setTimeout(function () { if (!current.destroyed) current.reconnect(); }, RETRY_MS);
      });
      peer.on('error', function (err) {
        if (err.type === 'browser-incompatible') {
          // Navegador sem WebRTC: não adianta tentar de novo.
          setPeerStatus('unsupported');
          if (peer) peer.destroy();
          return;
        }
        if (err.type === 'unavailable-id') {
          // Código preso por uma sessão anterior desta TV (sem o token salvo)
          // ou usado por outra TV. Insiste até a sessão antiga expirar e só
          // depois troca de código.
          var now = Date.now();
          if (!takenSince) takenSince = now;
          if (now - takenSince > TAKEN_GIVE_UP_MS) {
            takenSince = 0;
            code = randomCode();
            state = S.createRoomState(code);
            relayRemotes = {};
            openRelay();
            opts.onCode(code);
            opts.onState(state);
          }
          setPeerStatus('taken');
          restart();
        } else {
          setPeerStatus('offline');
          if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(err.type) >= 0) restart();
        }
      });
    }

    var restartTimer = null;
    function restart(delay) {
      if (peer) peer.destroy();
      clearTimeout(restartTimer); // nunca duas tentativas em paralelo
      restartTimer = setTimeout(open, delay === undefined ? RETRY_MS : delay);
    }

    // Gera outro código de sala (menu da TV). Placar e configurações ficam;
    // os celulares conectados precisam entrar de novo com o código novo.
    function newCode() {
      var previous = code;
      do { code = randomCode(); } while (code === previous);
      takenSince = 0;
      var next = JSON.parse(JSON.stringify(state));
      next.code = code;
      state = next;
      conns.slice().forEach(function (c) { try { c.close(); } catch (e) { /* já fechada */ } });
      conns = [];
      relayRemotes = {};
      openRelay();
      opts.onCode(code);
      opts.onState(state);
      opts.onPeers(peers());
      restart(0);
    }

    opts.onState(state);
    opts.onPeers(peers());
    openRelay();
    open();

    return {
      now: function () { return Date.now(); },
      send: function (cmd, cb) {
        var error = applySafely(cmd);
        if (cb) cb(error ? new Error(error) : null);
      },
      newCode: newCode
    };
  }

  // ------------------------------------------------------------ Celular
  function connect(code, handlers) {
    var offset = 0; // relógio da TV - relógio do celular
    var lastVersion = -1;
    var peer = null;
    var conn = null;
    var pending = {};
    var seq = 0;
    var retryTimer = null;

    // Modo compatível
    var clientId = randomId();
    var relaySub = null;
    var relayReady = false; // a TV já respondeu pelo modo compatível
    var relayTimer = null;

    function p2pOpen() { return !!(conn && conn.open); }

    function status(s) {
      // Pelo modo compatível a TV continua acessível mesmo com o WebRTC falhando.
      if (s !== 'online' && relayReady) s = 'relay';
      if (handlers.onStatus) handlers.onStatus(s);
    }

    function scheduleRetry() {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(dial, RETRY_MS);
    }

    function failPending(msg) {
      for (var id in pending) {
        if (Object.prototype.hasOwnProperty.call(pending, id)) {
          clearTimeout(pending[id].timer);
          pending[id].cb(new Error(msg));
        }
      }
      pending = {};
    }

    function resolveAck(id, error) {
      var p = pending[id];
      if (!p) return;
      delete pending[id];
      clearTimeout(p.timer);
      p.cb(error ? new Error(error) : null);
    }

    function onState(msg) {
      offset = msg.now - Date.now();
      if (handlers.onPeers) handlers.onPeers(msg.peers);
      if (msg.state.version < lastVersion) return; // chegou fora de ordem
      lastVersion = msg.state.version;
      handlers.onState(msg.state);
    }

    function onData(msg) {
      if (!msg) return;
      if (msg.kind === 'state') onState(msg);
      else if (msg.kind === 'ack') resolveAck(msg.id, msg.error);
    }

    // --- Modo compatível ---
    function startRelay() {
      if (relaySub) return;
      relaySub = relaySubscribe(relayTopic(code, 'state'), {
        onOpen: function () {
          // Pede o estado atual para a TV.
          relayPublish(relayTopic(code, 'cmd'), { kind: 'hello', from: clientId });
        },
        onMessage: function (msg) {
          if (!msg || msg.kind !== 'state') return;
          var acks = msg.acks || [];
          for (var i = 0; i < acks.length; i++) {
            if (acks[i].to === clientId) resolveAck(acks[i].id, acks[i].error);
          }
          if (!relayReady) { relayReady = true; if (!p2pOpen()) status('relay'); }
          if (!p2pOpen()) onState(msg);
        }
      });
    }

    function scheduleRelayFallback() {
      clearTimeout(relayTimer);
      relayTimer = setTimeout(function () { if (!p2pOpen()) startRelay(); }, RELAY_FALLBACK_MS);
    }

    // --- WebRTC ---
    function dial() {
      if (!peer || peer.destroyed || peer.disconnected) return;
      if (conn) { conn.removeAllListeners(); conn.close(); }
      if (!relayReady) status('connecting');
      var c = peer.connect(tvPeerId(code), { reliable: true, serialization: 'json' });
      conn = c;
      var timeout = setTimeout(function () { if (!c.open) { c.close(); scheduleRetry(); } }, CONNECT_TIMEOUT_MS);
      c.on('open', function () {
        clearTimeout(timeout);
        lastVersion = -1; // a TV pode ter sido reiniciada
        status('online');
      });
      c.on('data', onData);
      c.on('close', function () {
        clearTimeout(timeout);
        if (conn !== c) return;
        status('offline');
        if (handlers.onPeers && !relayReady) handlers.onPeers({ tv: 0, remote: 0 });
        failPending('Conexão com a TV perdida');
        scheduleRetry();
        scheduleRelayFallback();
      });
    }

    function start() {
      try {
        if (!root.Peer) throw new Error('PeerJS indisponível');
        peer = new root.Peer(PEER_OPTIONS);
      } catch (e) {
        startRelay();
        return;
      }
      peer.on('open', dial);
      peer.on('disconnected', function () {
        setTimeout(function () { if (!peer.destroyed) peer.reconnect(); }, RETRY_MS);
      });
      peer.on('error', function (err) {
        if (err.type === 'peer-unavailable') {
          // A TV não está no WebRTC (fechada ou sem suporte): tenta o modo compatível.
          status('notfound');
          if (handlers.onPeers && !relayReady) handlers.onPeers({ tv: 0, remote: 0 });
          startRelay();
          scheduleRetry();
        } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].indexOf(err.type) >= 0) {
          status('offline');
          startRelay();
          peer.destroy();
          setTimeout(start, RETRY_MS);
        }
      });
    }

    start();
    scheduleRelayFallback();

    return {
      now: function () { return Date.now() + offset; },
      send: function (cmd, cb) {
        cb = cb || function () {};
        var viaRelay = !p2pOpen();
        if (viaRelay && !relayReady) return cb(new Error('Sem conexão com a TV'));
        var id = ++seq;
        pending[id] = {
          cb: cb,
          timer: setTimeout(function () {
            if (pending[id]) { delete pending[id]; cb(new Error('A TV não respondeu')); }
          }, viaRelay ? RELAY_ACK_TIMEOUT_MS : ACK_TIMEOUT_MS)
        };
        if (!viaRelay) {
          conn.send({ kind: 'cmd', id: id, cmd: cmd });
        } else {
          relayPublish(relayTopic(code, 'cmd'), { kind: 'cmd', from: clientId, id: id, cmd: cmd }, function (err) {
            if (err) resolveAck(id, err.message);
          });
        }
      }
    };
  }

  root.BJJSync = { host: host, connect: connect, randomCode: randomCode };
})(this);
