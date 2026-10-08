/* Tela da TV: só exibe. Quem manda é o celular (ou o controle remoto da TV). */
(function () {
  'use strict';

  var T = window.BJJTimer;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Sala ----------
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* sem storage */ }
  }

  function readRoomCode() {
    var m = /[?&]sala=([0-9]{4,6})/.exec(location.search);
    if (m) return m[1];
    var saved = load('bjj-room');
    if (saved && /^[0-9]{4,6}$/.test(saved)) return saved;
    return window.BJJSync.randomCode();
  }

  // O estado fica salvo na TV: recarregar a página não perde placar nem tempo.
  function readSavedState(code) {
    var s = null;
    try { s = JSON.parse(load('bjj-state')); } catch (e) { /* estado corrompido */ }
    return window.BJJState.isValidState(s) && s.code === code ? s : null;
  }

  function showCode(code) {
    save('bjj-room', code);
    $('roomCode').textContent = code;
    $('roomCode2').textContent = code;
    $('remoteUrl').textContent = location.host + '/controle';
    var qr = $('qr');
    qr.innerHTML = '';
    if (window.QRCode) {
      new window.QRCode(qr, {
        text: location.origin + '/controle?sala=' + code,
        width: 256,
        height: 256,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } else {
      qr.className += ' missing';
    }
  }

  var code = readRoomCode();
  showCode(code);

  // Identifica esta TV no servidor do PeerJS (ver sync.js).
  var token = load('bjj-token');
  if (!token || !/^[a-z0-9]{8,}$/.test(token)) {
    token = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 16);
    save('bjj-token', token);
  }

  // ---------- Conexão ----------
  // Mostrado na TV enquanto os celulares ainda não conseguem achá-la.
  var CONN_TEXT = {
    online: '',
    offline: 'Conectando…',
    taken: 'Liberando a sala…',
    unsupported: 'Navegador sem suporte ao celular'
  };
  var state = null;
  var conn = window.BJJSync.host({
    code: code,
    initialState: readSavedState(code),
    token: token,
    onState: function (s) {
      state = s;
      save('bjj-state', JSON.stringify(s));
      render();
    },
    onCode: showCode,
    onPeers: function (p) {
      $('peers').textContent = p.remote ? '📱 ' + p.remote : '📱 nenhum';
    },
    onStatus: function (s) {
      $('connDot').className = 'dot' + (s === 'online' ? ' online' : '');
      $('connText').textContent = CONN_TEXT[s] || '';
    }
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
    if (!state || !conn) return; // conn ainda não existe na primeira chamada do host
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

  var unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    $('unlock').hidden = true;
    // O botão escondido não pode continuar com o foco (o OK seguinte iria para ele).
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.BJJSound.unlock();
    requestWakeLock();
    if (!document.fullscreenElement && !document.webkitFullscreenElement) toggleFullscreen();
  }

  function toggleTimer() {
    conn.send({ type: 'toggle' });
  }

  $('unlockBtn').addEventListener('click', function (e) { e.stopPropagation(); unlock(); });
  $('unlock').addEventListener('click', function (e) { e.stopPropagation(); unlock(); });
  $('fullscreenBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleFullscreen(); });

  // Controle com ponteiro (ex.: Magic Remote da LG): o OK vira um clique na tela.
  document.addEventListener('click', function () {
    if (unlocked) toggleTimer();
  });

  // Teclas que os controles de TV enviam para OK e Play/Pause.
  // Navegadores antigos de TV não preenchem `e.key`, por isso também o keyCode.
  var OK_KEYS = { 'Enter': 1, ' ': 1, 'Spacebar': 1, 'Select': 1, 'Accept': 1, 'NumpadEnter': 1 };
  var PLAY_KEYS = { 'MediaPlayPause': 1, 'MediaPlay': 1, 'MediaPause': 1, 'Play': 1, 'Pause': 1 };
  var OK_CODES = { 13: 1, 23: 1, 32: 1 };   // Enter, DPAD_CENTER (Android TV), Espaço
  var PLAY_CODES = { 179: 1, 415: 1, 19: 1, 10252: 1 }; // Play/Pause, Play (webOS/HbbTV), Pause, Tizen

  function isOk(e) { return OK_KEYS[e.key] === 1 || OK_CODES[e.keyCode] === 1; }
  function isPlay(e) { return PLAY_KEYS[e.key] === 1 || PLAY_CODES[e.keyCode] === 1; }

  // Segurar o botão gera várias teclas seguidas: só a primeira conta.
  var lastToggle = 0;
  document.addEventListener('keydown', function (e) {
    if (!isOk(e) && !isPlay(e)) return;
    e.preventDefault(); // evita o "clique" duplicado no elemento focado
    if (e.repeat) return;
    if (!unlocked) { unlock(); return; }
    var now = Date.now();
    if (now - lastToggle < 400) return;
    lastToggle = now;
    toggleTimer();
  });
})();
