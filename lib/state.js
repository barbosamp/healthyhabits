'use strict';

/*
 * Estado de uma sala e aplicação de comandos vindos do controle (celular/TV).
 * O servidor é a única fonte da verdade; os clientes só recebem o estado e
 * calculam a exibição localmente com `computeView`.
 */
const T = require('../public/shared/timer.js');

const SCORE_FIELDS = ['points', 'advantages', 'penalties'];
const MAX_NAME = 24;

function athlete(name) {
  return { name: name, points: 0, advantages: 0, penalties: 0 };
}

function createRoomState(code) {
  return {
    code: code,
    version: 0,
    mode: 'rounds',
    settings: JSON.parse(JSON.stringify(T.DEFAULT_SETTINGS)),
    clock: { running: false, startedAt: 0, accumulated: 0 },
    match: { a: athlete('Atleta 1'), b: athlete('Atleta 2') },
    sound: true
  };
}

class CommandError extends Error {}

function fail(msg) {
  throw new CommandError(msg);
}

function intIn(value, [min, max], label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${label} deve ser um inteiro entre ${min} e ${max}`);
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
  const limits = T.LIMITS[mode];
  if (!limits) fail(`o modo ${mode} não tem configurações`);
  const out = {};
  for (const key of Object.keys(limits)) {
    out[key] = intIn(input[key], limits[key], key);
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

const handlers = {
  start: (state, cmd, now) => start(state, now),
  pause: (state, cmd, now) => pause(state, now),
  toggle: (state, cmd, now) => (state.clock.running ? pause(state, now) : start(state, now)),
  reset: (state) => resetClock(state),

  setMode(state, cmd) {
    if (!T.MODES.includes(cmd.mode)) fail('modo inválido');
    state.mode = cmd.mode;
    resetClock(state);
  },

  // Define o modo e suas configurações de uma vez (ex.: um preset) e zera o relógio.
  configure(state, cmd) {
    if (!T.LIMITS[cmd.mode]) fail('modo inválido');
    state.settings[cmd.mode] = validateSettings(cmd.mode, cmd.settings);
    state.mode = cmd.mode;
    resetClock(state);
  },

  // Soma (ou subtrai) segundos ao tempo restante da fase atual.
  adjust(state, cmd, now) {
    const seconds = intIn(cmd.seconds, [-3600, 3600], 'seconds');
    if (state.mode === 'stopwatch') {
      // No cronômetro livre o tempo cresce: "+10s" adianta o relógio.
      setElapsed(state, T.elapsedOf(state.clock, now) + seconds * 1000, now);
      return;
    }
    const segs = T.segmentsOf(state);
    const total = T.totalOf(segs);
    const elapsed = Math.min(T.elapsedOf(state.clock, now), total);
    const view = T.computeView(state, now);
    const seg = segs[Math.min(view.segmentIndex, segs.length - 1)];
    // Nunca volta para a fase anterior nem passa do fim.
    const target = Math.min(Math.max(elapsed - seconds * 1000, seg.start), total);
    setElapsed(state, target, now);
  },

  // Pula para o fim da fase atual (ex.: encerrar o descanso antes).
  skip(state, cmd, now) {
    if (state.mode === 'stopwatch') return;
    const segs = T.segmentsOf(state);
    const view = T.computeView(state, now);
    if (view.status === 'done') return;
    const seg = segs[view.segmentIndex];
    setElapsed(state, seg.start + seg.duration, now);
  },

  score(state, cmd) {
    if (cmd.athlete !== 'a' && cmd.athlete !== 'b') fail('athlete deve ser "a" ou "b"');
    if (!SCORE_FIELDS.includes(cmd.field)) fail('field inválido');
    const delta = intIn(cmd.delta, [-4, 4], 'delta');
    const a = state.match[cmd.athlete];
    a[cmd.field] = Math.max(0, Math.min(999, a[cmd.field] + delta));
  },

  setNames(state, cmd) {
    for (const key of ['a', 'b']) {
      if (cmd[key] === undefined) continue;
      if (typeof cmd[key] !== 'string') fail(`nome ${key} inválido`);
      const name = cmd[key].trim().slice(0, MAX_NAME);
      state.match[key].name = name || (key === 'a' ? 'Atleta 1' : 'Atleta 2');
    }
  },

  resetScore(state) {
    for (const key of ['a', 'b']) {
      for (const f of SCORE_FIELDS) state.match[key][f] = 0;
    }
  },

  setSound(state, cmd) {
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
  const handler = Object.prototype.hasOwnProperty.call(handlers, cmd.type) ? handlers[cmd.type] : null;
  if (!handler) fail(`comando desconhecido: ${cmd.type}`);
  const next = JSON.parse(JSON.stringify(state));
  handler(next, cmd, now);
  next.version = state.version + 1;
  return next;
}

module.exports = { createRoomState, applyCommand, CommandError };
