/*
 * Tela da TV. Três telas, todas operáveis só com o controle remoto:
 *   menu inicial → modelos de treino → cronômetro (VOLTAR retorna ao menu).
 * O celular continua podendo controlar tudo ao mesmo tempo.
 */
(function () {
  'use strict';

  var T = window.BJJTimer;
  var PRESETS = window.BJJPresets;
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------- Armazenamento ----------
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* sem storage */ }
  }

  // ---------- Sala ----------
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

  function renderQr(id, code, size) {
    var box = $(id);
    box.innerHTML = '';
    if (!window.QRCode) { box.className += ' missing'; return; }
    new window.QRCode(box, {
      text: location.origin + '/controle?sala=' + code,
      width: size,
      height: size,
      colorDark: '#0a0a0a',
      colorLight: '#f5f5f0',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }

  function showCode(code) {
    save('bjj-room', code);
    $$('.js-room').forEach(function (el) { el.textContent = code; });
    $('remoteUrl').textContent = location.host + '/controle';
    renderQr('qr', code, 320);
    renderQr('qrSmall', code, 160);
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
    online: 'Pronta para o celular',
    relay: 'Pronta para o celular · modo compatível',
    offline: 'Conectando…',
    taken: 'Liberando a sala…',
    unsupported: 'Sem conexão com o celular'
  };

  var state = null;
  var prevState = null;
  var conn = window.BJJSync.host({
    code: code,
    initialState: readSavedState(code),
    token: token,
    onState: function (s) {
      prevState = state;
      state = s;
      save('bjj-state', JSON.stringify(s));
      followRemote();
      render();
    },
    onCode: function (c) { code = c; showCode(c); },
    onPeers: function (p) {
      $$('.js-peers').forEach(function (el) {
        el.textContent = p.remote ? p.remote + (p.remote > 1 ? ' celulares' : ' celular') : '';
      });
    },
    onStatus: function (s) {
      $$('.js-dot').forEach(function (el) { el.className = 'dot js-dot' + (s === 'online' || s === 'relay' ? ' online' : ''); });
      $$('.js-conn-text').forEach(function (el) { el.textContent = CONN_TEXT[s] || ''; });
    }
  });

  function send(cmd) { conn.send(cmd); }

  // ---------- Telas ----------
  var screen = null;
  var lastFocus = {};

  function show(name) {
    if (screen && document.activeElement && document.activeElement.hasAttribute('data-nav')) {
      lastFocus[screen] = document.activeElement;
    }
    screen = name;
    ['home', 'presets', 'timer'].forEach(function (n) { $(n).hidden = n !== name; });
    document.body.setAttribute('data-screen', name);
    cancelCodeConfirm();
    if (name === 'home') updateMenu();
    if (name === 'presets') markCurrentPreset();
    render();
    if (name === 'timer') {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    } else {
      var target = lastFocus[name];
      if (name === 'presets') target = $$('.preset.current')[0] || target;
      if (!target || target.hidden || !isVisible(target)) target = navItems()[0];
      if (target) target.focus();
    }
  }

  // Entrar no cronômetro cria uma entrada no histórico: o VOLTAR do controle
  // (que em várias TVs só chega como "voltar página") retorna ao menu.
  function openTimer() {
    if (screen === 'timer') return;
    show('timer');
    try { history.pushState({ bjj: 'timer' }, ''); } catch (e) { /* sem history */ }
  }

  function goBack() {
    if (screen === 'timer') {
      if (history.state && history.state.bjj === 'timer') history.back();
      else show('home');
    } else if (screen === 'presets') {
      show('home');
    }
  }

  window.addEventListener('popstate', function () {
    if (screen === 'timer') show('home');
  });

  // O celular mudou o treino ou deu início: a TV mostra o cronômetro.
  function followRemote() {
    if (!prevState || !state || screen === null) return;
    var started = state.clock.running && !prevState.clock.running;
    var reconfigured = state.mode !== prevState.mode ||
      JSON.stringify(state.settings) !== JSON.stringify(prevState.settings);
    if (started || reconfigured) openTimer();
  }

  // ---------- Menu inicial ----------
  function describe(s) {
    var r = s.settings.rounds;
    if (s.mode === 'rounds') {
      return r.rounds + ' × ' + T.formatMs(r.work * 1000) + (r.rest ? ' · descanso ' + T.formatMs(r.rest * 1000) : '');
    }
    if (s.mode === 'match') return 'Luta · ' + T.formatMs(s.settings.match.duration * 1000);
    if (s.mode === 'countdown') return 'Timer · ' + T.formatMs(s.settings.countdown.duration * 1000);
    return 'Cronômetro livre';
  }

  var STATUS_WORD = { running: 'Em andamento', paused: 'Pausado', done: 'Encerrado' };

  function updateMenu() {
    if (!state) return;
    var view = T.computeView(state, conn.now());
    var idle = view.status === 'idle';
    setText('miTimerTitle', idle ? 'Cronômetro' : 'Voltar ao cronômetro');
    setText('miTimerDesc', idle ? describe(state) : STATUS_WORD[view.status] + ' · ' + T.formatView(view));
    $('miReset').hidden = idle;
    setText('miSoundDesc', state.sound ? 'Ligado' : 'Desligado');
    if (!codeConfirm) {
      setText('miCodeTitle', 'Novo código de sala');
      setText('miCodeDesc', 'Celular não encontra a TV? Gere outro');
    }
    // Numeração e posição na grade (2 colunas) só dos itens visíveis.
    var n = 0;
    $$('.menu-item').forEach(function (el) {
      if (el.hidden) return;
      el.setAttribute('data-col', String(n % 2));
      el.setAttribute('data-row', String(Math.floor(n / 2)));
      n += 1;
      el.querySelector('.num').textContent = (n < 10 ? '0' : '') + n;
    });
    // Item focado sumiu (ex.: "Zerar" depois de zerar): o foco volta ao primeiro.
    var active = document.activeElement;
    if (screen === 'home' && (!active || active === document.body || active.hidden)) navItems()[0].focus();
  }

  var codeConfirm = false;
  var codeConfirmTimer = null;
  function cancelCodeConfirm() {
    if (!codeConfirm) return;
    codeConfirm = false;
    clearTimeout(codeConfirmTimer);
    $('miCode').className = 'menu-item';
    updateMenu();
  }

  var ACTIONS = {
    timer: openTimer,
    presets: function () { show('presets'); },
    reset: function () { send({ type: 'reset' }); updateMenu(); },
    sound: function () { send({ type: 'setSound', on: !state.sound }); updateMenu(); },
    code: function () {
      if (!codeConfirm) {
        // Trocar o código desconecta os celulares: pede um segundo OK.
        codeConfirm = true;
        $('miCode').className = 'menu-item confirm';
        setText('miCodeTitle', 'Confirmar troca?');
        setText('miCodeDesc', 'OK confirma · os celulares entram de novo');
        clearTimeout(codeConfirmTimer);
        codeConfirmTimer = setTimeout(cancelCodeConfirm, 6000);
        return;
      }
      codeConfirm = false;
      clearTimeout(codeConfirmTimer);
      $('miCode').className = 'menu-item';
      conn.newCode();
      updateMenu();
    },
    fullscreen: function () { toggleFullscreen(); }
  };

  $$('.menu-item').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation(); // senão o clique chega ao cronômetro recém-aberto e o inicia
      unlock();
      var action = el.getAttribute('data-action');
      if (action !== 'code') cancelCodeConfirm();
      ACTIONS[action]();
    });
  });

  // ---------- Modelos ----------
  var GROUPS = [
    { mode: 'rounds', title: 'Combate e drills' },
    { mode: 'match', title: 'Luta por faixa' },
    { mode: 'countdown', title: 'Timer' }
  ];

  GROUPS.forEach(function (g, col) {
    var box = document.createElement('div');
    box.className = 'preset-col';
    var h = document.createElement('h3');
    h.textContent = g.title;
    box.appendChild(h);
    PRESETS[g.mode].forEach(function (p, row) {
      var b = document.createElement('button');
      b.className = 'preset';
      b.setAttribute('data-nav', '');
      b.setAttribute('data-col', String(col));
      b.setAttribute('data-row', String(row));
      b.textContent = p.label;
      if (p.sub) {
        var small = document.createElement('small');
        small.textContent = p.sub;
        b.appendChild(small);
      }
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        unlock();
        send({ type: 'configure', mode: g.mode, settings: p.s });
        openTimer();
      });
      b._preset = { mode: g.mode, s: p.s };
      box.appendChild(b);
    });
    $('presetCols').appendChild(box);
  });

  function markCurrentPreset() {
    $$('.preset').forEach(function (b) {
      var p = b._preset;
      var current = state && state.mode === p.mode && JSON.stringify(state.settings[p.mode]) === JSON.stringify(p.s);
      b.className = 'preset' + (current ? ' current' : '');
    });
  }

  // ---------- Navegação pelas setas ----------
  function isVisible(el) { return !!(el.offsetWidth || el.offsetHeight); }

  function navItems() {
    if (!screen || screen === 'timer') return [];
    return $$('[data-nav]', $(screen)).filter(function (el) { return !el.hidden && isVisible(el); });
  }

  function num(el, attr) { return Number(el.getAttribute(attr)) || 0; }

  function moveFocus(dx, dy) {
    var items = navItems();
    if (!items.length) return;
    var cur = document.activeElement;
    if (items.indexOf(cur) < 0) { items[0].focus(); return; }
    var col = num(cur, 'data-col'), row = num(cur, 'data-row');
    var best = null, bestDist = Infinity;
    items.forEach(function (el) {
      var c = num(el, 'data-col'), r = num(el, 'data-row');
      var dist;
      if (dy) {
        if (c !== col || (r - row) * dy <= 0) return;
        dist = Math.abs(r - row);
      } else {
        if ((c - col) * dx <= 0) return;
        dist = Math.abs(c - col) * 100 + Math.abs(r - row);
      }
      if (dist < bestDist) { bestDist = dist; best = el; }
    });
    if (best) best.focus();
  }

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
    var active = view.phase === 'work' || view.phase === 'fight';
    var final = view.status === 'running' && active && view.remainingMs <= 10000 && view.segmentDurationMs > 20000;

    var classes = 'status-' + view.status + ' phase-' + view.phase + ' mode-' + state.mode + (final ? ' final' : '');
    if (classes !== lastClasses) { document.body.className = classes; lastClasses = classes; }

    if (screen === 'timer') renderTimer(view);
    else if (screen === 'home') updateMenu();

    if (state.sound) playSounds(prevView, view);
    prevView = view;
  }

  var HINT_OK = { idle: 'iniciar', paused: 'continuar', done: 'recomeçar', running: 'pausar' };

  function renderTimer(view) {
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
    $('soundLocked').hidden = audioReady || !state.sound;
    $('connect').hidden = view.status === 'running';
    setText('hintOk', HINT_OK[view.status]);
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

  // ---------- Tela cheia, som e tela sempre ligada ----------
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

  // Navegadores só liberam som e tela cheia depois de uma interação.
  var audioReady = false;
  function unlock() {
    if (audioReady) return;
    audioReady = window.BJJSound.unlock();
    requestWakeLock();
    if (!document.fullscreenElement && !document.webkitFullscreenElement) toggleFullscreen();
    if (!audioReady) audioReady = true; // sem Web Audio: não fica pedindo de novo
  }

  // ---------- Controle remoto ----------
  // Navegadores antigos de TV não preenchem `e.key`, por isso também o keyCode.
  var KEYS = {
    ok: { keys: ['Enter', ' ', 'Spacebar', 'Select', 'Accept', 'NumpadEnter'], codes: [13, 23, 32] },
    play: { keys: ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'Play', 'Pause'], codes: [179, 415, 19, 10252] },
    // VOLTAR: Backspace/Esc, Return do Tizen (10009) e Back do webOS (461).
    back: { keys: ['Backspace', 'Escape', 'Esc', 'GoBack', 'BrowserBack', 'Back'], codes: [8, 27, 10009, 461] },
    up: { keys: ['ArrowUp', 'Up'], codes: [38] },
    down: { keys: ['ArrowDown', 'Down'], codes: [40] },
    left: { keys: ['ArrowLeft', 'Left'], codes: [37] },
    right: { keys: ['ArrowRight', 'Right'], codes: [39] }
  };

  function keyOf(e) {
    for (var name in KEYS) {
      if (KEYS[name].keys.indexOf(e.key) >= 0 || KEYS[name].codes.indexOf(e.keyCode) >= 0) return name;
    }
    return null;
  }

  // Segurar o botão gera várias teclas seguidas: só a primeira conta.
  var lastToggle = 0;
  function toggleTimer() {
    var now = Date.now();
    if (now - lastToggle < 400) return;
    lastToggle = now;
    send({ type: 'toggle' });
  }

  document.addEventListener('keydown', function (e) {
    var k = keyOf(e);
    if (!k) return;
    if (k !== 'back') unlock(); // Esc não conta como interação para liberar o áudio

    if (k === 'back') {
      if (screen === 'home') {
        // No menu, o VOLTAR só cancela a confirmação; senão o navegador decide (ex.: sair).
        if (codeConfirm) { e.preventDefault(); cancelCodeConfirm(); }
        return;
      }
      e.preventDefault();
      goBack();
      return;
    }

    e.preventDefault(); // evita rolagem e o "clique" duplicado no elemento focado
    if (e.repeat && (k === 'ok' || k === 'play')) return;

    if (screen === 'timer') {
      if (k === 'ok' || k === 'play') toggleTimer();
      return; // setas não fazem nada no cronômetro (só liberam o som)
    }

    if (k === 'play') { openTimer(); toggleTimer(); return; }
    if (k === 'ok') {
      var el = document.activeElement;
      if (navItems().indexOf(el) >= 0) el.click();
      else if (navItems()[0]) navItems()[0].focus();
      return;
    }
    if (k === 'up') moveFocus(0, -1);
    else if (k === 'down') moveFocus(0, 1);
    else if (k === 'left') moveFocus(-1, 0);
    else if (k === 'right') moveFocus(1, 0);
  });

  // Controle com ponteiro (ex.: Magic Remote da LG): o OK vira um clique.
  document.addEventListener('click', function () {
    unlock();
    if (screen === 'timer') toggleTimer();
  });

  // ---------- Início ----------
  var initial = state ? T.computeView(state, conn.now()).status : 'idle';
  if (initial === 'idle') show('home');
  else openTimer(); // treino em andamento (ex.: a página recarregou): direto para o cronômetro

  setInterval(render, 100);
})();
