/*
 * Conexão com a sala: recebe o estado em tempo real (SSE, com polling como
 * alternativa para navegadores antigos de TV) e envia comandos.
 */
(function (root) {
  'use strict';

  function connect(code, role, handlers) {
    var base = '/api/rooms/' + encodeURIComponent(code);
    var offset = 0; // serverNow - Date.now()
    var lastVersion = -1;
    var source = null;
    var pollTimer = null;
    var closed = false;

    function receive(data) {
      offset = data.serverNow - Date.now();
      if (handlers.onPeers) handlers.onPeers(data.peers);
      // Ignora estados antigos que chegaram fora de ordem.
      if (data.state.version < lastVersion) return;
      lastVersion = data.state.version;
      handlers.onState(data.state);
    }

    function status(s) {
      if (handlers.onStatus) handlers.onStatus(s);
    }

    function poll() {
      if (closed) return;
      request('GET', base + '/state', null, function (err, data) {
        status(err ? 'offline' : 'online');
        if (!err) receive(data);
        pollTimer = setTimeout(poll, 1000);
      });
    }

    if (typeof EventSource !== 'undefined') {
      source = new EventSource(base + '/events?role=' + role);
      source.onopen = function () { status('online'); };
      source.onerror = function () { status('offline'); };
      source.onmessage = function (e) {
        status('online');
        try { receive(JSON.parse(e.data)); } catch (err) { /* mensagem inválida */ }
      };
    } else {
      poll();
    }

    return {
      now: function () { return Date.now() + offset; },
      send: function (cmd, cb) {
        request('POST', base + '/command', cmd, function (err, data) {
          if (!err) receive(data);
          if (cb) cb(err, data);
        });
      },
      close: function () {
        closed = true;
        if (source) source.close();
        if (pollTimer) clearTimeout(pollTimer);
      }
    };
  }

  // XMLHttpRequest em vez de fetch para funcionar em navegadores de TV mais antigos.
  function request(method, url, body, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 8000;
    if (body) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* sem corpo */ }
      if (xhr.status >= 200 && xhr.status < 300) cb(null, data);
      else cb(new Error((data && data.error) || 'Erro ' + xhr.status), data);
    };
    xhr.onerror = xhr.ontimeout = function () { cb(new Error('Sem conexão com o servidor')); };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  root.BJJSync = { connect: connect };
})(this);
