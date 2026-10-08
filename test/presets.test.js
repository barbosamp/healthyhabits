'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PRESETS = require('../public/shared/presets.js');
const { createRoomState, applyCommand } = require('../public/shared/state.js');

test('todos os modelos prontos são aceitos pela TV', () => {
  for (const mode of ['rounds', 'match', 'countdown']) {
    assert.ok(PRESETS[mode].length > 0, mode);
    for (const p of PRESETS[mode]) {
      const s = applyCommand(createRoomState('1234'), { type: 'configure', mode, settings: p.s }, 0);
      assert.equal(s.mode, mode, p.label);
      assert.deepEqual(s.settings[mode], p.s, p.label);
    }
  }
});
