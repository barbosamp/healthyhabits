/* Controle remoto pelo celular. */
(function () {
  'use strict';

  var T = window.BJJTimer;
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var PRESETS = window.BJJPresets;

  var STEPPERS = {
    rounds: [
      { key: 'rounds', label: 'Rounds', step: 1 },
      { key: 'work', label: 'Tempo do round', step: 15, time: true },
      { key: 'rest', label: 'Descanso', step: 15, time: true },
      { key: 'prep', label: 'Preparação', step: 5, time: true }
    ],
    match: [{ key: 'duration', label: 'Tempo de luta', step: 30, time: true }],
    countdown: [{ key: 'duration', label: 'Duração', step: 30, time: true }]
  };

  // ---------- Sala ----------
  var m = /[?&]sala=([0-9]{4,6})/.exec(location.search);
  if (!m) {
    $('join').hidden = false;
    $('joinCode').focus();
    $('joinForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = $('joinCode').value.replace(/\D/g, '');
      if (/^[0-9]{4,6}$/.test(code)) location.search = '?sala=' + code;
    });
    return;
  }
  var code = m[1];
  $('app').hidden = false;
  $('roomCode').textContent = code;

  var state = null;
  var drafts = {};      // valores em edição de cada modo
  var dirty = {};       // usuário mexeu e ainda não aplicou
  var activeTab = null;
  var lastMode = null;

  var STATUS_TEXT = {
    connecting: 'Procurando a TV…',
    online: 'TV conectada',
    offline: 'Sem conexão',
    notfound: 'TV não encontrada. Confira se a TV mostra a sala ' + code
  };
  var conn = window.BJJSync.connect(code, {
    onState: function (s) { state = s; onState(); },
    onStatus: function (s) {
      $('connDot').className = 'dot' + (s === 'online' ? ' online' : '');
      $('tvStatus').textContent = STATUS_TEXT[s] || '';
      $('tvStatus').className = 'tv-status' + (s === 'online' ? '' : ' warn');
    }
  });

  // ---------- Envio de comandos ----------
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3000);
  }

  function send(cmd) {
    if (navigator.vibrate) navigator.vibrate(15);
    conn.send(cmd, function (err) { if (err) toast(err.message); });
  }

  function confirmRestart() {
    return !state || !state.clock.running || window.confirm('O cronômetro está rodando. Reiniciar com a nova configuração?');
  }

  function configure(mode, settings) {
    if (!confirmRestart()) return;
    if (mode === 'stopwatch') send({ type: 'setMode', mode: mode });
    else send({ type: 'configure', mode: mode, settings: settings });
    dirty[mode] = false;
  }

  // ---------- Montagem dos painéis ----------
  function buildPresets(mode) {
    var box = $(mode + 'Presets');
    PRESETS[mode].forEach(function (p) {
      var b = document.createElement('button');
      b.innerHTML = p.label + (p.sub ? '<small>' + p.sub + '</small>' : '');
      b.addEventListener('click', function () {
        drafts[mode] = JSON.parse(JSON.stringify(p.s));
        renderSteppers(mode);
        configure(mode, drafts[mode]);
      });
      box.appendChild(b);
    });
  }

  function buildSteppers(mode) {
    var box = $(mode + 'Steppers');
    STEPPERS[mode].forEach(function (cfg) {
      var row = document.createElement('div');
      row.className = 'stepper';
      row.innerHTML = '<span>' + cfg.label + '</span><button aria-label="Diminuir">−</button>' +
        '<output data-key="' + cfg.key + '"></output><button aria-label="Aumentar">+</button>';
      var btns = row.getElementsByTagName('button');
      btns[0].addEventListener('click', function () { step(mode, cfg, -1); });
      btns[1].addEventListener('click', function () { step(mode, cfg, 1); });
      box.appendChild(row);
    });
  }

  function step(mode, cfg, dir) {
    var lim = T.LIMITS[mode][cfg.key];
    var d = drafts[mode];
    var v = d[cfg.key] + dir * cfg.step;
    // Abaixo de 1 minuto, tempos andam de 5 em 5 segundos.
    if (cfg.time && cfg.step > 5 && (dir < 0 ? d[cfg.key] <= 60 : d[cfg.key] < 60)) v = d[cfg.key] + dir * 5;
    d[cfg.key] = Math.max(lim[0], Math.min(lim[1], v));
    dirty[mode] = true;
    renderSteppers(mode);
  }

  function renderSteppers(mode) {
    $$('output', $(mode + 'Steppers')).forEach(function (out) {
      var key = out.getAttribute('data-key');
      var cfg = STEPPERS[mode].filter(function (c) { return c.key === key; })[0];
      var v = drafts[mode][key];
      out.textContent = cfg.time ? (v === 0 ? '—' : T.formatMs(v * 1000)) : String(v);
    });
  }

  ['rounds', 'match', 'countdown'].forEach(function (mode) {
    buildPresets(mode);
    buildSteppers(mode);
  });

  $$('[data-apply]').forEach(function (b) {
    b.addEventListener('click', function () {
      var mode = b.getAttribute('data-apply');
      configure(mode, drafts[mode]);
    });
  });

  // ---------- Abas ----------
  function showTab(tab) {
    activeTab = tab;
    $$('#tabs button').forEach(function (b) {
      b.className = b.getAttribute('data-tab') === tab ? 'active' : '';
      if (state && b.getAttribute('data-tab') === state.mode) b.className += ' live';
    });
    $$('.panel').forEach(function (p) {
      p.className = 'panel' + (p.getAttribute('data-panel') === tab ? ' active' : '');
    });
  }
  $$('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  // ---------- Controles principais ----------
  $('toggleBtn').addEventListener('click', function () { send({ type: 'toggle' }); });
  $$('[data-cmd]').forEach(function (b) {
    b.addEventListener('click', function () { send({ type: b.getAttribute('data-cmd') }); });
  });
  $$('[data-adjust]').forEach(function (b) {
    b.addEventListener('click', function () { send({ type: 'adjust', seconds: Number(b.getAttribute('data-adjust')) }); });
  });

  // ---------- Placar ----------
  $$('.score-card').forEach(function (card) {
    var athlete = card.getAttribute('data-athlete');
    $$('[data-score]', card).forEach(function (b) {
      b.addEventListener('click', function () {
        send({ type: 'score', athlete: athlete, field: b.getAttribute('data-score'), delta: Number(b.getAttribute('data-delta')) });
      });
    });
  });
  $$('.name-input').forEach(function (input) {
    input.addEventListener('change', function () {
      var cmd = { type: 'setNames' };
      cmd[input.getAttribute('data-name')] = input.value;
      send(cmd);
    });
  });
  $('resetScoreBtn').addEventListener('click', function () {
    if (window.confirm('Zerar o placar dos dois atletas?')) send({ type: 'resetScore' });
  });

  $('soundToggle').addEventListener('change', function () { send({ type: 'setSound', on: this.checked }); });
  $('leaveBtn').addEventListener('click', function () { location.search = ''; });

  // ---------- Estado recebido ----------
  function onState() {
    ['rounds', 'match', 'countdown'].forEach(function (mode) {
      if (!dirty[mode]) {
        drafts[mode] = JSON.parse(JSON.stringify(state.settings[mode]));
        renderSteppers(mode);
      }
    });
    if (state.mode !== lastMode) {
      lastMode = state.mode;
      showTab(state.mode);
    }
    $('soundToggle').checked = state.sound;
    $$('.score-card').forEach(function (card) {
      var a = state.match[card.getAttribute('data-athlete')];
      $$('[data-show]', card).forEach(function (el) { el.textContent = a[el.getAttribute('data-show')]; });
      var input = $$('.name-input', card)[0];
      if (document.activeElement !== input) input.value = a.name;
    });
    tick();
  }

  function tick() {
    if (!state) return;
    var view = T.computeView(state, conn.now());
    var label = T.phaseLabel(view);
    if (view.status === 'paused') label = 'PAUSADO';
    if (view.status === 'idle') label = 'PRONTO';

    $('preview').className = 'preview status-' + view.status + ' phase-' + view.phase;
    $('pvPhase').textContent = label;
    $('pvRound').textContent = view.totalRounds > 1 ? 'Round ' + view.round + '/' + view.totalRounds : '';
    $('pvTime').textContent = T.formatView(view);

    var isMatch = state.mode === 'match';
    $('pvScore').hidden = !isMatch;
    if (isMatch) {
      $('pvA').textContent = state.match.a.points;
      $('pvB').textContent = state.match.b.points;
    }

    var running = state.clock.running;
    var btn = $('toggleBtn');
    btn.textContent = running ? 'PAUSAR' : view.status === 'paused' ? 'CONTINUAR' : 'INICIAR';
    btn.className = 'big ' + (running ? 'pause' : 'start');
    $('skipBtn').disabled = state.mode === 'stopwatch' || view.status === 'done';
    $('adjustRow').hidden = state.mode === 'rounds';
  }

  setInterval(tick, 250);
})();
