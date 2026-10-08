/* Tela da TV: só exibe. Quem manda é o celular (ou o controle remoto da TV). */
(function () {
  'use strict';

  var T = window.BJJTimer;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Sala ----------
  function readRoomCode() {
    var m = /[?&]sala=([0-9]{4,6})/.exec(location.search);
    if (m) return m[1];
    var saved = null;
    try { saved = localStorage.getItem('bjj-room'); } catch (e) { /* sem storage */ }
    if (saved && /^[0-9]{4}$/.test(saved)) return saved;
    return String(Math.floor(1000 + Math.random() * 9000));
  }
  var code = readRoomCode();
  try { localStorage.setItem('bjj-room', code); } catch (e) { /* sem storage */ }

  var remoteUrl = location.origin + '/controle?sala=' + code;
  $('roomCode').textContent = code;
  $('roomCode2').textContent = code;
  $('remoteUrl').textContent = location.host + '/controle';

  if (window.QRCode) {
    new window.QRCode($('qr'), {
      text: remoteUrl,
      width: 256,
      height: 256,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } else {
    $('qr').className += ' missing';
  }

  // ---------- Conexão ----------
  var state = null;
  var conn = window.BJJSync.connect(code, 'tv', {
    onState: function (s) { state = s; render(); },
    onPeers: function (p) {
      $('peers').textContent = p.remote ? '📱 ' + p.remote : '📱 nenhum';
    },
    onStatus: function (s) { $('connDot').className = 'dot' + (s === 'online' ? ' online' : ''); }
  });

  // ---------- Renderização ----------
  var NEXT_LABELS = { prep: 'Preparar', work: 'Round', rest: 'Descanso', fight: 'Luta' };
  var prevView = null;
  var lastClasses = '';

  function setText(id, text) {
    var el = $(id);
    if (el.textContent !== text) el.textContent = text;
  }

  function render() {
    if (!state) return;
    var view = T.computeView(state, conn.now());

    var classes = 'status-' + view.status + ' phase-' + view.phase + ' mode-' + state.mode;
    if (classes !== lastClasses) { document.body.className = classes; lastClasses = classes; }

    var isMatch = state.mode === 'match';
    $('timerView').hidden = isMatch;
    $('matchView').hidden = !isMatch;

    var timeText = T.formatView(view);
    var label = T.phaseLabel(view);
    if (view.status === 'paused') label = 'PAUSADO';

    if (isMatch) {
      renderMatch(view, timeText, label);
      setText('roundLabel', '');
    } else {
      setText('phaseLabel', view.status === 'idle' && state.mode !== 'stopwatch' ? 'PRONTO' : label);
      setText('time', timeText);
      setText('roundLabel', view.totalRounds > 1 ? 'ROUND ' + view.round + ' / ' + view.totalRounds : '');
      var next = '';
      if (view.next && view.status !== 'idle') {
        next = 'Próximo: ' + NEXT_LABELS[view.next.phase] +
          (view.next.phase === 'work' ? ' ' + view.next.round : '') +
          ' · ' + T.formatMs(view.next.durationMs, true);
      }
      setText('nextLabel', next);
      $('bar').style.width = (view.progress * 100).toFixed(2) + '%';
    }

    $('soundOff').hidden = state.sound;
    var connectBox = $('connect');
    connectBox.hidden = view.status === 'running';
    connectBox.className = 'connect' + (view.status === 'idle' ? '' : ' compact');

    if (state.sound) playSounds(prevView, view);
    prevView = view;
  }

  function renderMatch(view, timeText, label) {
    var m = state.match;
    setText('nameA', m.a.name); setText('nameB', m.b.name);
    setText('ptsA', String(m.a.points)); setText('ptsB', String(m.b.points));
    setText('advA', String(m.a.advantages)); setText('advB', String(m.b.advantages));
    setText('penA', String(m.a.penalties)); setText('penB', String(m.b.penalties));
    setText('matchTime', timeText);
    setText('matchPhase', view.status === 'idle' ? 'PRONTO' : label);
    var leader = view.status === 'done' ? T.matchLeader(m) : null;
    $('rowA').className = 'athlete athlete-a' + (leader === 'a' ? ' winner' : '');
    $('rowB').className = 'athlete athlete-b' + (leader === 'b' ? ' winner' : '');
  }

  // ---------- Sons ----------
  function playSounds(prev, view) {
    if (!prev || prev.mode !== view.mode) return;
    var S = window.BJJSound;
    var active = view.phase === 'work' || view.phase === 'fight';

    // Saiu do zero direto para um round/luta (sem preparação).
    if (prev.status === 'idle' && view.status === 'running') {
      if (active) S.play('start');
      return;
    }
    if (view.status !== 'running' && view.status !== 'done') return;

    // Mudou de fase (andando para frente na linha do tempo).
    if (view.segmentIndex > prev.segmentIndex && prev.status !== 'idle') {
      if (view.phase === 'done') S.play('end');
      else if (view.phase === 'rest') S.play('rest');
      else if (active) S.play('start');
      return;
    }
    if (view.status !== 'running' || view.segmentIndex !== prev.segmentIndex) return;

    var secs = Math.ceil(view.remainingMs / 1000);
    var prevSecs = Math.ceil(prev.remainingMs / 1000);
    if (secs === prevSecs) return;
    if ((view.phase === 'prep' || view.phase === 'rest') && secs >= 1 && secs <= 3) S.play('tick');
    else if (active && secs === 10 && view.segmentDurationMs > 20000) S.play('warn');
  }

  setInterval(render, 100);

  // ---------- Interação na TV ----------
  function requestWakeLock() {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').catch(function () { /* não suportado */ });
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  function toggleFullscreen() {
    var el = document.documentElement;
    var fn = document.fullscreenElement || document.webkitFullscreenElement
      ? { target: document, call: document.exitFullscreen || document.webkitExitFullscreen }
      : { target: el, call: el.requestFullscreen || el.webkitRequestFullscreen };
    if (!fn.call) return;
    try {
      var p = fn.call.call(fn.target);
      if (p && p.catch) p.catch(function () { /* bloqueado pelo navegador */ });
    } catch (e) { /* bloqueado pelo navegador */ }
  }

  function unlock() {
    window.BJJSound.unlock();
    requestWakeLock();
    if (!document.fullscreenElement && !document.webkitFullscreenElement) toggleFullscreen();
    $('unlock').hidden = true;
  }

  $('unlockBtn').addEventListener('click', unlock);
  $('unlock').addEventListener('click', unlock);
  $('fullscreenBtn').addEventListener('click', toggleFullscreen);

  // Controle remoto da TV: OK/Enter/Espaço/Play inicia e pausa.
  document.addEventListener('keydown', function (e) {
    if (!$('unlock').hidden) return;
    var k = e.key;
    if (k === 'Enter' || k === ' ' || k === 'MediaPlayPause' || e.keyCode === 179 || e.keyCode === 415 || e.keyCode === 19) {
      e.preventDefault();
      conn.send({ type: 'toggle' });
    }
  });
})();
