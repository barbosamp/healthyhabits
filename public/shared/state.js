/*
 * Estado da sala e aplicação de comandos vindos do controle (celular/TV).
 * Roda na TV, que é a única fonte da verdade; o celular só envia comandos e
 * recebe o estado de volta. Também é carregado pelos testes em Node.
 */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('./timer.js') : root.BJJTimer);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BJJState = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  var SCORE_FIELDS = ['points', 'advantages', 'penalties'];
  var MAX_NAME = 24;

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function athlete(name) {
    return { name: name, points: 0, advantages: 0, penalties: 0 };
  }

  function createRoomState(code) {
    return {
      code: code,
      version: 0,
      mode: 'rounds',
      settings: clone(T.DEFAULT_SETTINGS),
      clock: { running: false, startedAt: 0, accumulated: 0 },
      match: { a: athlete('Atleta 1'), b: athlete('Atleta 2') },
      sound: true
    };
  }

  function CommandError(message) {
    this.name = 'CommandError';
    this.message = message;
  }
  CommandError.prototype = Object.create(Error.prototype);
  CommandError.prototype.constructor = CommandError;

  function fail(msg) {
    throw new CommandError(msg);
  }

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  function intIn(value, range, label) {
    if (!isInt(value) || value < range[0] || value > range[1]) {
      fail(label + ' deve ser um inteiro entre ' + range[0] + ' e ' + range[1]);
    }
    return value;
  }

  function resetClock(state) {
    state.clock = { running: false, startedAt: 0, accumulated: 0 };
  }

  /** Posiciona o relógio em `elapsed` ms, mantendo-o rodando se já estava. */
  function setElapsed(state, elapsed, now) {
    state.clock.accumulated = Math.max(0, elapsed);
    if (state.clock.running) state.clock.startedAt = now;
  }

  function validateSettings(mode, input) {
    if (!input || typeof input !== 'object') fail('settings é obrigatório');
    var limits = T.LIMITS[mode];
    var out = {};
    for (var key in limits) {
      if (Object.prototype.hasOwnProperty.call(limits, key)) out[key] = intIn(input[key], limits[key], key);
    }
    return out;
  }

  function start(state, now) {
    if (state.clock.running) return;
    if (T.computeView(state, now).status === 'done') resetClock(state);
    state.clock.running = true;
    state.clock.startedAt = now;
  }

  function pause(state, now) {
    if (!state.clock.running) return;
    state.clock.accumulated = T.elapsedOf(state.clock, now);
    state.clock.running = false;
    state.clock.startedAt = 0;
  }

  var handlers = {
    start: function (state, cmd, now) { start(state, now); },
    pause: function (state, cmd, now) { pause(state, now); },
    toggle: function (state, cmd, now) {
      if (state.clock.running) pause(state, now);
      else start(state, now);
    },
    reset: function (state) { resetClock(state); },

    setMode: function (state, cmd) {
      if (T.MODES.indexOf(cmd.mode) < 0) fail('modo inválido');
      state.mode = cmd.mode;
      resetClock(state);
    },

    // Define o modo e suas configurações de uma vez (ex.: um preset) e zera o relógio.
    configure: function (state, cmd) {
      if (!Object.prototype.hasOwnProperty.call(T.LIMITS, cmd.mode)) fail('modo inválido');
      state.settings[cmd.mode] = validateSettings(cmd.mode, cmd.settings);
      state.mode = cmd.mode;
      resetClock(state);
    },

    // Soma (ou subtrai) segundos ao tempo restante da fase atual.
    adjust: function (state, cmd, now) {
      var seconds = intIn(cmd.seconds, [-3600, 3600], 'seconds');
      if (state.mode === 'stopwatch') {
        // No cronômetro livre o tempo cresce: "+10s" adianta o relógio.
        setElapsed(state, T.elapsedOf(state.clock, now) + seconds * 1000, now);
        return;
      }
      var segs = T.segmentsOf(state);
      var total = T.totalOf(segs);
      var elapsed = Math.min(T.elapsedOf(state.clock, now), total);
      var view = T.computeView(state, now);
      var seg = segs[Math.min(view.segmentIndex, segs.length - 1)];
      // Nunca volta para a fase anterior nem passa do fim.
      var target = Math.min(Math.max(elapsed - seconds * 1000, seg.start), total);
      setElapsed(state, target, now);
    },

    // Pula para o fim da fase atual (ex.: encerrar o descanso antes).
    skip: function (state, cmd, now) {
      if (state.mode === 'stopwatch') return;
      var view = T.computeView(state, now);
      if (view.status === 'done') return;
      var seg = T.segmentsOf(state)[view.segmentIndex];
      setElapsed(state, seg.start + seg.duration, now);
    },

    score: function (state, cmd) {
      if (cmd.athlete !== 'a' && cmd.athlete !== 'b') fail('athlete deve ser "a" ou "b"');
      if (SCORE_FIELDS.indexOf(cmd.field) < 0) fail('field inválido');
      var delta = intIn(cmd.delta, [-4, 4], 'delta');
      var a = state.match[cmd.athlete];
      a[cmd.field] = Math.max(0, Math.min(999, a[cmd.field] + delta));
    },

    setNames: function (state, cmd) {
      ['a', 'b'].forEach(function (key) {
        if (cmd[key] === undefined) return;
        if (typeof cmd[key] !== 'string') fail('nome ' + key + ' inválido');
        var name = cmd[key].trim().slice(0, MAX_NAME);
        state.match[key].name = name || (key === 'a' ? 'Atleta 1' : 'Atleta 2');
      });
    },

    resetScore: function (state) {
      ['a', 'b'].forEach(function (key) {
        SCORE_FIELDS.forEach(function (f) { state.match[key][f] = 0; });
      });
    },

    setSound: function (state, cmd) {
      if (typeof cmd.on !== 'boolean') fail('on deve ser booleano');
      state.sound = cmd.on;
    }
  };

  /**
   * Aplica um comando e devolve um NOVO estado (o original não é alterado).
   * Lança CommandError para comandos inválidos.
   */
  function applyCommand(state, cmd, now) {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') fail('comando inválido');
    if (!Object.prototype.hasOwnProperty.call(handlers, cmd.type)) fail('comando desconhecido: ' + cmd.type);
    var next = clone(state);
    handlers[cmd.type](next, cmd, now);
    next.version = state.version + 1;
    return next;
  }

  /** Confere se um estado salvo (ex.: localStorage) tem o formato esperado. */
  function isValidState(s) {
    return !!(s && typeof s === 'object' && T.MODES.indexOf(s.mode) >= 0 && s.clock && s.settings &&
      s.settings.rounds && s.settings.match && s.settings.countdown && s.match && s.match.a && s.match.b &&
      isInt(s.version));
  }

  return {
    createRoomState: createRoomState,
    applyCommand: applyCommand,
    isValidState: isValidState,
    CommandError: CommandError
  };
});
