/*
 * Conexão TV ⇄ celular sem servidor próprio, via WebRTC (PeerJS).
 *
 * - A TV é o "host": guarda o estado, aplica os comandos e envia o estado
 *   atualizado para todos os celulares conectados.
 * - O celular se conecta ao ID público da TV (derivado do código da sala),
 *   envia comandos e recebe o estado de volta.
 *
 * O servidor gratuito do PeerJS só é usado para os aparelhos se encontrarem;
 * os dados passam direto entre TV e celular (ou pelo TURN do PeerJS, se a
 * rede não permitir conexão direta).
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

  function tvPeerId(code) {
    return ID_PREFIX + code;
  }

  function randomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
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

    function peers() {
      return { tv: 1, remote: conns.length };
    }

    function message() {
      return { kind: 'state', state: state, peers: peers(), now: Date.now() };
    }

    function broadcast() {
      var msg = message();
      conns.forEach(function (c) { try { c.send(msg); } catch (e) { /* conexão caindo */ } });
      opts.onPeers(peers());
    }

    function apply(cmd) {
      state = S.applyCommand(state, cmd, Date.now());
      opts.onState(state);
      broadcast();
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
        var error = null;
        try { apply(msg.cmd); } catch (e) { error = e && e.name === 'CommandError' ? e.message : 'Erro ao aplicar comando'; }
        try { conn.send({ kind: 'ack', id: msg.id, error: error }); } catch (e) { /* conexão caindo */ }
      });
      conn.on('close', function () { removeConn(conn); });
      conn.on('error', function () { removeConn(conn); });
    }

    function open() {
      if (!takenSince) opts.onStatus('offline');
      // Sem PeerJS/WebRTC (navegador de TV antigo) a TV continua funcionando
      // sozinha, pelo controle remoto; só não aceita celulares.
      try {
        if (!root.Peer) throw new Error('PeerJS indisponível');
        peer = new root.Peer(tvPeerId(code), peerOptions);
      } catch (e) {
        peer = null;
        opts.onStatus('unsupported');
        return;
      }
      peer.on('open', function () {
        takenSince = 0;
        opts.onStatus('online');
      });
      peer.on('connection', onConnection);
      var current = peer;
      peer.on('disconnected', function () {
        if (current.destroyed) return; // destruído de propósito em restart()
        if (!takenSince) opts.onStatus('offline'); // mantém "Liberando a sala…"
        setTimeout(function () { if (!current.destroyed) current.reconnect(); }, RETRY_MS);
      });
      peer.on('error', function (err) {
        if (err.type === 'browser-incompatible') {
          // Navegador sem WebRTC: não adianta tentar de novo.
          opts.onStatus('unsupported');
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
            opts.onCode(code);
            opts.onState(state);
          }
          opts.onStatus('taken');
          restart();
        } else {
          opts.onStatus('offline');
          if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(err.type) >= 0) restart();
        }
      });
    }

    function restart() {
      if (peer) peer.destroy();
      setTimeout(open, RETRY_MS);
    }

    opts.onState(state);
    opts.onPeers(peers());
    open();

    return {
      now: function () { return Date.now(); },
      send: function (cmd, cb) {
        try { apply(cmd); if (cb) cb(null); } catch (e) { if (cb) cb(e); }
      }
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

    function status(s) { if (handlers.onStatus) handlers.onStatus(s); }

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

    function onData(msg) {
      if (!msg) return;
      if (msg.kind === 'state') {
        offset = msg.now - Date.now();
        if (handlers.onPeers) handlers.onPeers(msg.peers);
        if (msg.state.version < lastVersion) return; // chegou fora de ordem
        lastVersion = msg.state.version;
        handlers.onState(msg.state);
      } else if (msg.kind === 'ack' && pending[msg.id]) {
        var p = pending[msg.id];
        delete pending[msg.id];
        clearTimeout(p.timer);
        p.cb(msg.error ? new Error(msg.error) : null);
      }
    }

    function dial() {
      if (!peer || peer.destroyed || peer.disconnected) return;
      if (conn) { conn.removeAllListeners(); conn.close(); }
      status('connecting');
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
        if (handlers.onPeers) handlers.onPeers({ tv: 0, remote: 0 });
        failPending('Conexão com a TV perdida');
        scheduleRetry();
      });
    }

    function start() {
      peer = new root.Peer(PEER_OPTIONS);
      peer.on('open', dial);
      peer.on('disconnected', function () {
        setTimeout(function () { if (!peer.destroyed) peer.reconnect(); }, RETRY_MS);
      });
      peer.on('error', function (err) {
        if (err.type === 'peer-unavailable') {
          // A TV com esse código não está aberta (ainda).
          status('notfound');
          if (handlers.onPeers) handlers.onPeers({ tv: 0, remote: 0 });
          scheduleRetry();
        } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(err.type) >= 0) {
          status('offline');
          peer.destroy();
          setTimeout(start, RETRY_MS);
        }
      });
    }

    start();

    return {
      now: function () { return Date.now() + offset; },
      send: function (cmd, cb) {
        cb = cb || function () {};
        if (!conn || !conn.open) return cb(new Error('Sem conexão com a TV'));
        var id = ++seq;
        pending[id] = {
          cb: cb,
          timer: setTimeout(function () {
            if (pending[id]) { delete pending[id]; cb(new Error('A TV não respondeu')); }
          }, ACK_TIMEOUT_MS)
        };
        conn.send({ kind: 'cmd', id: id, cmd: cmd });
      }
    };
  }

  root.BJJSync = { host: host, connect: connect, randomCode: randomCode };
})(this);
