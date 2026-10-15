'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PRESETS = require('../public/shared/presets.js');
const { createRoomState, applyCommand, upgrade, isValidState, CommandError } = require('../public/shared/state.js');

const fixed = (x) => () => x; // "aleatório" previsível para o teste

test('sala nova já vem com a roleta padrão, sem regra em vigor', () => {
  const s = createRoomState('1234');
  assert.deepEqual(s.wheel.options, PRESETS.wheel);
  assert.equal(s.wheel.current, null);
  assert.equal(s.wheel.auto, false);
});

test('girar sorteia uma opção, registra o horário e vira a regra em vigor', () => {
  const s = applyCommand(createRoomState('1234'), { type: 'spin' }, 5000, fixed(0.5));
  const i = Math.floor(0.5 * PRESETS.wheel.length);
  assert.deepEqual(s.wheel.spin, { id: 1, index: i, option: PRESETS.wheel[i], at: 5000 });
  assert.equal(s.wheel.current, PRESETS.wheel[i]);
});

test('o giro nunca repete a opção anterior', () => {
  let s = createRoomState('1234');
  s = applyCommand(s, { type: 'setWheelOptions', options: ['A', 'B'] }, 0);
  for (let n = 0; n < 20; n++) {
    const prev = s.wheel.current;
    s = applyCommand(s, { type: 'spin' }, n, Math.random);
    assert.notEqual(s.wheel.current, prev);
  }
  assert.equal(s.wheel.spin.id, 20);
});

test('random no limite (0.9999…) continua dentro da lista', () => {
  const s = applyCommand(createRoomState('1234'), { type: 'spin' }, 0, fixed(0.999999));
  assert.ok(s.wheel.spin.index < PRESETS.wheel.length);
});

test('editar opções: limpa espaços, ignora vazias e repetidas, valida limites', () => {
  const s = applyCommand(createRoomState('1234'), { type: 'setWheelOptions', options: ['  Só   raspagem ', 'só raspagem', '', 'Costas'] }, 0);
  assert.deepEqual(s.wheel.options, ['Só raspagem', 'Costas']);
  assert.equal(s.wheel.spin, null);
  assert.throws(() => applyCommand(s, { type: 'setWheelOptions', options: ['Uma'] }, 0), CommandError);
  assert.throws(() => applyCommand(s, { type: 'setWheelOptions', options: Array.from({ length: 13 }, (_, i) => 'Op ' + i) }, 0), CommandError);
  assert.throws(() => applyCommand(s, { type: 'setWheelOptions', options: 'A,B' }, 0), CommandError);
  assert.equal(applyCommand(s, { type: 'setWheelOptions', options: ['x'.repeat(40), 'B'] }, 0).wheel.options[0].length, 28);
});

test('girar a cada round e limpar a regra', () => {
  let s = applyCommand(createRoomState('1234'), { type: 'setWheelAuto', on: true }, 0);
  assert.equal(s.wheel.auto, true);
  assert.throws(() => applyCommand(s, { type: 'setWheelAuto', on: 'sim' }, 0), CommandError);
  s = applyCommand(s, { type: 'spin' }, 0, fixed(0));
  s = applyCommand(s, { type: 'clearWheel' }, 0);
  assert.equal(s.wheel.current, null);
});

test('estado salvo antes da roleta continua válido e ganha a roleta', () => {
  const old = createRoomState('1234');
  delete old.wheel;
  assert.ok(isValidState(old));
  assert.deepEqual(upgrade(old).wheel.options, PRESETS.wheel);
  const s = applyCommand(Object.assign(createRoomState('1'), { wheel: undefined }), { type: 'spin' }, 0, fixed(0));
  assert.equal(s.wheel.spin.id, 1);
});
