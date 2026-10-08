'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../public/shared/timer.js');
const { createRoomState, applyCommand, CommandError } = require('../lib/state');

function roundsState(settings) {
  const s = createRoomState('1234');
  s.mode = 'rounds';
  s.settings.rounds = Object.assign({ work: 60, rest: 20, rounds: 3, prep: 10 }, settings);
  return s;
}

function run(state, startAt) {
  return Object.assign({}, state, { clock: { running: true, startedAt: startAt, accumulated: 0 } });
}

test('formatMs arredonda contagem regressiva para cima e mostra horas', () => {
  assert.equal(T.formatMs(300000, true), '5:00');
  assert.equal(T.formatMs(299001, true), '5:00');
  assert.equal(T.formatMs(299001, false), '4:59');
  assert.equal(T.formatMs(9000, true), '0:09');
  assert.equal(T.formatMs(3723000, false), '1:02:03');
  assert.equal(T.formatMs(-5, true), '0:00');
});

test('parado no zero mostra o primeiro round, sem a preparação', () => {
  const v = T.computeView(roundsState(), 1000);
  assert.equal(v.status, 'idle');
  assert.equal(v.phase, 'work');
  assert.equal(v.round, 1);
  assert.equal(v.displayMs, 60000);
});

test('linha do tempo: preparação → round → descanso → ... → fim', () => {
  const s = run(roundsState(), 0);
  const at = (ms) => T.computeView(s, ms);

  assert.equal(at(0).phase, 'prep');
  assert.equal(at(9999).phase, 'prep');
  assert.equal(at(10000).phase, 'work');
  assert.equal(at(10000).round, 1);
  assert.equal(at(69999).phase, 'work');
  assert.equal(at(70000).phase, 'rest');
  assert.equal(at(70000).round, 2, 'descanso já anuncia o próximo round');
  assert.equal(at(90000).phase, 'work');
  assert.equal(at(90000).round, 2);
  // Último round não tem descanso depois.
  const total = 10000 + 3 * 60000 + 2 * 20000;
  assert.equal(at(total - 1).phase, 'work');
  assert.equal(at(total - 1).round, 3);
  assert.equal(at(total).status, 'done');
  assert.equal(at(total + 99999).displayMs, 0);
});

test('próxima fase é informada', () => {
  const v = T.computeView(run(roundsState(), 0), 15000);
  assert.deepEqual(v.next, { phase: 'rest', durationMs: 20000, round: 2 });
});

test('sem descanso e sem preparação os rounds são contínuos', () => {
  const s = run(roundsState({ rest: 0, prep: 0 }), 0);
  assert.equal(T.segmentsOf(s).length, 3);
  assert.equal(T.computeView(s, 60000).round, 2);
});

test('cronômetro livre conta para cima', () => {
  const s = createRoomState('1234');
  s.mode = 'stopwatch';
  s.clock = { running: true, startedAt: 1000, accumulated: 5000 };
  const v = T.computeView(s, 4000);
  assert.equal(v.elapsedMs, 8000);
  assert.equal(T.formatView(v), '0:08');
});

test('líder da luta: pontos > vantagens > menos punições', () => {
  const a = (p, v, pen) => ({ points: p, advantages: v, penalties: pen });
  assert.equal(T.matchLeader({ a: a(2, 0, 0), b: a(0, 5, 0) }), 'a');
  assert.equal(T.matchLeader({ a: a(2, 0, 0), b: a(2, 1, 0) }), 'b');
  assert.equal(T.matchLeader({ a: a(2, 1, 2), b: a(2, 1, 1) }), 'b');
  assert.equal(T.matchLeader({ a: a(0, 0, 0), b: a(0, 0, 0) }), null);
});

test('start/pause/start acumula o tempo corretamente', () => {
  let s = createRoomState('1234');
  s = applyCommand(s, { type: 'configure', mode: 'countdown', settings: { duration: 60 } }, 0);
  s = applyCommand(s, { type: 'start' }, 1000);
  s = applyCommand(s, { type: 'pause' }, 11000);
  assert.equal(s.clock.accumulated, 10000);
  assert.equal(T.computeView(s, 999999).displayMs, 50000, 'pausado não anda');
  s = applyCommand(s, { type: 'toggle' }, 20000);
  assert.equal(T.computeView(s, 25000).displayMs, 45000);
});

test('start depois do fim reinicia do zero', () => {
  let s = createRoomState('1234');
  s = applyCommand(s, { type: 'configure', mode: 'match', settings: { duration: 60 } }, 0);
  s = applyCommand(s, { type: 'start' }, 0);
  s = applyCommand(s, { type: 'pause' }, 70000);
  assert.equal(T.computeView(s, 70000).status, 'done');
  s = applyCommand(s, { type: 'start' }, 80000);
  assert.equal(T.computeView(s, 80000).displayMs, 60000);
});

test('adjust soma tempo sem passar dos limites da fase', () => {
  let s = createRoomState('1234');
  s = applyCommand(s, { type: 'configure', mode: 'match', settings: { duration: 300 } }, 0);
  s = applyCommand(s, { type: 'start' }, 0);
  s = applyCommand(s, { type: 'adjust', seconds: 60 }, 30000);
  // Luta mais longa que a duração original não volta para "antes do início".
  assert.equal(T.computeView(s, 30000).displayMs, 300000);
  s = applyCommand(s, { type: 'adjust', seconds: -10 }, 30000);
  assert.equal(T.computeView(s, 30000).displayMs, 290000);
  s = applyCommand(s, { type: 'adjust', seconds: -3600 }, 30000);
  assert.equal(T.computeView(s, 30000).status, 'done');
  s = applyCommand(s, { type: 'adjust', seconds: 30 }, 40000);
  assert.equal(T.computeView(s, 40000).displayMs, 30000, 'dá para devolver tempo depois do fim');
});

test('skip pula o descanso e mantém o relógio rodando', () => {
  let s = createRoomState('1234');
  s = applyCommand(s, { type: 'configure', mode: 'rounds', settings: { work: 60, rest: 30, rounds: 2, prep: 0 } }, 0);
  s = applyCommand(s, { type: 'start' }, 0);
  assert.equal(T.computeView(s, 65000).phase, 'rest');
  s = applyCommand(s, { type: 'skip' }, 65000);
  const v = T.computeView(s, 66000);
  assert.equal(v.phase, 'work');
  assert.equal(v.round, 2);
  assert.equal(v.displayMs, 59000);
});

test('placar não fica negativo e nomes são limitados', () => {
  let s = createRoomState('1234');
  s = applyCommand(s, { type: 'score', athlete: 'a', field: 'points', delta: 3 }, 0);
  s = applyCommand(s, { type: 'score', athlete: 'a', field: 'points', delta: -4 }, 0);
  assert.equal(s.match.a.points, 0);
  s = applyCommand(s, { type: 'score', athlete: 'b', field: 'advantages', delta: 1 }, 0);
  assert.equal(s.match.b.advantages, 1);
  s = applyCommand(s, { type: 'setNames', a: '  João da Silva Pereira Santos Oliveira ', b: '' }, 0);
  assert.equal(s.match.a.name.length, 24);
  assert.equal(s.match.b.name, 'Atleta 2');
  s = applyCommand(s, { type: 'resetScore' }, 0);
  assert.equal(s.match.b.advantages, 0);
});

test('applyCommand não altera o estado original e incrementa a versão', () => {
  const s = createRoomState('1234');
  const next = applyCommand(s, { type: 'start' }, 5);
  assert.equal(s.clock.running, false);
  assert.equal(next.clock.running, true);
  assert.equal(next.version, s.version + 1);
});

test('comandos inválidos são rejeitados', () => {
  const s = createRoomState('1234');
  const bad = [
    null,
    { type: 'hack' },
    { type: '__proto__' },
    { type: 'setMode', mode: 'x' },
    { type: 'configure', mode: 'rounds', settings: { work: 1, rest: 0, rounds: 1, prep: 0 } },
    { type: 'configure', mode: 'match', settings: { duration: '300' } },
    { type: 'score', athlete: 'c', field: 'points', delta: 1 },
    { type: 'score', athlete: 'a', field: 'name', delta: 1 },
    { type: 'score', athlete: 'a', field: 'points', delta: 50 },
    { type: 'adjust', seconds: 1.5 },
    { type: 'setSound', on: 'sim' }
  ];
  for (const cmd of bad) {
    assert.throws(() => applyCommand(s, cmd, 0), CommandError, JSON.stringify(cmd));
  }
});
