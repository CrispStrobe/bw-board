/**
 * Environment-stimulus extension + param catalogue tests.
 *
 * Catalogue completeness, dynamic menu population from board parts,
 * set/get stimulus end-to-end through board, range clamping,
 * graceful unknown part/param handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { STIMULUS_CATALOGUE, getStimulusParams, getStimulusKinds, getStimulusParts } from '../src/stimulus-catalogue.js';
import { StimulusExtension } from '../src/stimulus-extension.js';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

// ── Board helper: proper BoardImpl construction ───────────────────────────

function makeBoard(partDefs) {
  const board = new BoardImpl(5.0);
  const netIds = new Set();
  const parts = [];
  // VCC + GND always present
  parts.push({ id: 'VCC', kind: 'vcc', terminals: ['vcc'], params: {} });
  parts.push({ id: 'GND', kind: 'gnd', terminals: ['gnd'], params: {} });
  netIds.add('nv'); netIds.add('ng');

  // Build nets from part definitions
  const netTerminals = new Map();
  netTerminals.set('nv', [{ part: 'VCC', terminal: 'vcc' }]);
  netTerminals.set('ng', [{ part: 'GND', terminal: 'gnd' }]);

  for (const def of partDefs) {
    parts.push(def.part);
    for (const [netId, refs] of Object.entries(def.nets || {})) {
      if (!netTerminals.has(netId)) netTerminals.set(netId, []);
      for (const ref of (Array.isArray(refs) ? refs : [refs])) {
        netTerminals.get(netId).push(ref);
      }
    }
  }

  const nets = [...netTerminals.entries()].map(([id, terminals]) => ({ id, terminals }));
  board.setNetlist(parts, nets);
  return board;
}

// ─── Stimulus catalogue ───────────────────────────────────────────────────

describe('Stimulus catalogue', () => {
  it('covers DHT11 with temperature and humidity', () => {
    const params = getStimulusParams('dht11');
    assert.ok(params);
    const names = params.map(p => p.param);
    assert.ok(names.includes('temperature'));
    assert.ok(names.includes('humidity'));
    const temp = params.find(p => p.param === 'temperature');
    assert.equal(temp.min, 0);
    assert.equal(temp.max, 50);
    assert.equal(temp.unit, '°C');
  });

  it('covers hall_analog with field', () => {
    const params = getStimulusParams('hall_analog');
    assert.ok(params);
    assert.ok(params.find(p => p.param === 'field'));
    assert.equal(params.find(p => p.param === 'field').min, -1);
  });

  it('covers gas_sensor', () => {
    const params = getStimulusParams('gas_sensor');
    assert.ok(params);
    assert.ok(params.find(p => p.param === 'gas'));
  });

  it('covers basic parts: potentiometer, switch, button, ldr', () => {
    for (const kind of ['potentiometer', 'switch', 'button', 'ldr']) {
      assert.ok(getStimulusParams(kind), `missing: ${kind}`);
    }
  });

  it('potentiometer uses control mechanism', () => {
    const params = getStimulusParams('potentiometer');
    assert.equal(params[0].mechanism, 'control');
  });

  it('dht11 uses param mechanism', () => {
    const params = getStimulusParams('dht11');
    assert.equal(params[0].mechanism, 'param');
  });

  it('returns null for unknown kind', () => {
    assert.equal(getStimulusParams('banana'), null);
  });

  it('getStimulusKinds returns all catalogued kinds', () => {
    const kinds = getStimulusKinds();
    assert.ok(kinds.length > 15);
    assert.ok(kinds.includes('dht11'));
    assert.ok(kinds.includes('potentiometer'));
    assert.ok(kinds.includes('ultrasonic'));
  });

  it('every entry has required fields', () => {
    for (const [kind, params] of Object.entries(STIMULUS_CATALOGUE)) {
      for (const p of params) {
        assert.ok(typeof p.param === 'string', `${kind}: missing param`);
        assert.ok(typeof p.label === 'string', `${kind}.${p.param}: missing label`);
        assert.ok(typeof p.min === 'number', `${kind}.${p.param}: missing min`);
        assert.ok(typeof p.max === 'number', `${kind}.${p.param}: missing max`);
        assert.ok(typeof p.unit === 'string', `${kind}.${p.param}: missing unit`);
        assert.ok(p.mechanism === 'control' || p.mechanism === 'param',
          `${kind}.${p.param}: bad mechanism`);
      }
    }
  });
});

// ─── getStimulusParts with board ──────────────────────────────────────────

describe('getStimulusParts', () => {
  it('returns stimulus parts from board', () => {
    const board = makeBoard([
      {
        part: { id: 'pot1', kind: 'potentiometer', terminals: ['a', 'b', 'wiper'], params: { ohms: 10000 } },
        nets: {
          nv: { part: 'pot1', terminal: 'a' },
          n1: { part: 'pot1', terminal: 'wiper' },
          ng: { part: 'pot1', terminal: 'b' },
        },
      },
      {
        part: { id: 'r1', kind: 'resistor', terminals: ['a', 'b'], params: { ohms: 1000 } },
        nets: {
          nv: { part: 'r1', terminal: 'a' },
          n1: { part: 'r1', terminal: 'b' },
        },
      },
    ]);
    const stimParts = getStimulusParts(board);
    assert.equal(stimParts.length, 1); // only pot has stimulus params
    assert.equal(stimParts[0].partId, 'pot1');
    assert.equal(stimParts[0].kind, 'potentiometer');
  });

  it('returns sensor parts', () => {
    const board = makeBoard([
      {
        part: { id: 'dht1', kind: 'dht11', terminals: ['vcc', 'gnd', 'data'], params: {} },
        nets: {
          nv: { part: 'dht1', terminal: 'vcc' },
          ng: { part: 'dht1', terminal: 'gnd' },
          n1: { part: 'dht1', terminal: 'data' },
        },
      },
    ]);
    const stimParts = getStimulusParts(board);
    assert.equal(stimParts.length, 1);
    assert.equal(stimParts[0].kind, 'dht11');
    assert.ok(stimParts[0].params.find(p => p.param === 'temperature'));
  });
});

// ─── StimulusExtension ────────────────────────────────────────────────────

const ScratchStub = {
  BlockType: { REPORTER: 'reporter', BOOLEAN: 'Boolean', COMMAND: 'command' },
  ArgumentType: { STRING: 'string', NUMBER: 'number' },
  extensions: { register() {} },
};

describe('StimulusExtension: getInfo', () => {
  it('returns expected block opcodes', () => {
    const origScratch = globalThis.Scratch;
    globalThis.Scratch = ScratchStub;
    try {
      const ext = new StimulusExtension();
      const info = ext.getInfo();
      assert.equal(info.id, 'environment');
      const opcodes = info.blocks.filter(b => typeof b === 'object').map(b => b.opcode);
      assert.deepEqual(opcodes, ['setStimulus', 'getStimulus']);
    } finally {
      globalThis.Scratch = origScratch;
    }
  });
});

describe('StimulusExtension: dynamic menus', () => {
  it('parts menu lists stimulus parts from board', () => {
    const board = makeBoard([
      {
        part: { id: 'pot1', kind: 'potentiometer', terminals: ['a', 'b', 'wiper'], params: { ohms: 10000 } },
        nets: {
          nv: { part: 'pot1', terminal: 'a' },
          n1: { part: 'pot1', terminal: 'wiper' },
          ng: { part: 'pot1', terminal: 'b' },
        },
      },
    ]);
    const ext = new StimulusExtension();
    ext.setBoard(board);
    const menu = ext._getPartsMenu();
    assert.equal(menu.length, 1);
    assert.equal(menu[0].value, 'pot1');
  });

  it('params menu lists all params from stimulus parts', () => {
    const board = makeBoard([
      {
        part: { id: 'pot1', kind: 'potentiometer', terminals: ['a', 'b', 'wiper'], params: { ohms: 10000 } },
        nets: {
          nv: { part: 'pot1', terminal: 'a' },
          n1: { part: 'pot1', terminal: 'wiper' },
          ng: { part: 'pot1', terminal: 'b' },
        },
      },
      {
        part: { id: 'dht1', kind: 'dht11', terminals: ['vcc', 'gnd', 'data'], params: {} },
        nets: {
          nv: { part: 'dht1', terminal: 'vcc' },
          ng: { part: 'dht1', terminal: 'gnd' },
          n2: { part: 'dht1', terminal: 'data' },
        },
      },
    ]);
    const ext = new StimulusExtension();
    ext.setBoard(board);
    const menu = ext._getParamsMenu();
    const values = menu.map(m => m.value);
    assert.ok(values.includes('position'));     // from potentiometer
    assert.ok(values.includes('temperature'));  // from dht11
    assert.ok(values.includes('humidity'));     // from dht11
  });

  it('shows placeholder when no board', () => {
    const ext = new StimulusExtension();
    assert.equal(ext._getPartsMenu()[0].value, '');
    assert.equal(ext._getParamsMenu()[0].value, '');
  });
});

describe('StimulusExtension: set/get stimulus end-to-end', () => {
  it('setStimulus on potentiometer uses setControl', () => {
    const board = makeBoard([
      {
        part: { id: 'pot1', kind: 'potentiometer', terminals: ['a', 'b', 'wiper'], params: { ohms: 10000 } },
        nets: {
          nv: { part: 'pot1', terminal: 'a' },
          n1: { part: 'pot1', terminal: 'wiper' },
          ng: { part: 'pot1', terminal: 'b' },
        },
      },
    ]);
    const ext = new StimulusExtension();
    ext.setBoard(board);

    ext.setStimulus({ PARAM: 'position', PART: 'pot1', VALUE: 0.75 });
    assert.equal(board.controls.get('pot1'), 0.75);

    // Read back
    assert.equal(ext.getStimulus({ PARAM: 'position', PART: 'pot1' }), 0.75);
  });

  it('setStimulus on dht11 uses setPartParam', () => {
    const board = makeBoard([
      {
        part: { id: 'dht1', kind: 'dht11', terminals: ['vcc', 'gnd', 'data'], params: {} },
        nets: {
          nv: { part: 'dht1', terminal: 'vcc' },
          ng: { part: 'dht1', terminal: 'gnd' },
          n1: { part: 'dht1', terminal: 'data' },
        },
      },
    ]);
    const ext = new StimulusExtension();
    ext.setBoard(board);

    ext.setStimulus({ PARAM: 'temperature', PART: 'dht1', VALUE: 35 });
    assert.equal(board.getPartParam('dht1', 'temperature'), 35);

    // Read back
    assert.equal(ext.getStimulus({ PARAM: 'temperature', PART: 'dht1' }), 35);
  });

  it('clamps to valid range', () => {
    const board = makeBoard([
      {
        part: { id: 'dht1', kind: 'dht11', terminals: ['vcc', 'gnd', 'data'], params: {} },
        nets: {
          nv: { part: 'dht1', terminal: 'vcc' },
          ng: { part: 'dht1', terminal: 'gnd' },
          n1: { part: 'dht1', terminal: 'data' },
        },
      },
    ]);
    const ext = new StimulusExtension();
    ext.setBoard(board);

    // DHT11 temperature range is 0..50
    ext.setStimulus({ PARAM: 'temperature', PART: 'dht1', VALUE: 999 });
    assert.equal(ext.getStimulus({ PARAM: 'temperature', PART: 'dht1' }), 50);

    ext.setStimulus({ PARAM: 'temperature', PART: 'dht1', VALUE: -10 });
    assert.equal(ext.getStimulus({ PARAM: 'temperature', PART: 'dht1' }), 0);
  });

  it('ignores unknown part', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', terminals: ['vcc'], params: {} },
       { id: 'GND', kind: 'gnd', terminals: ['gnd'], params: {} }],
      [{ id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
       { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] }],
    );
    const ext = new StimulusExtension();
    ext.setBoard(board);
    ext.setStimulus({ PARAM: 'temperature', PART: 'nope', VALUE: 42 });
    assert.equal(ext.getStimulus({ PARAM: 'temperature', PART: 'nope' }), 0);
  });

  it('ignores unknown param for known part', () => {
    const board = makeBoard([
      {
        part: { id: 'dht1', kind: 'dht11', terminals: ['vcc', 'gnd', 'data'], params: {} },
        nets: {
          nv: { part: 'dht1', terminal: 'vcc' },
          ng: { part: 'dht1', terminal: 'gnd' },
          n1: { part: 'dht1', terminal: 'data' },
        },
      },
    ]);
    const ext = new StimulusExtension();
    ext.setBoard(board);
    ext.setStimulus({ PARAM: 'speed', PART: 'dht1', VALUE: 42 });
    assert.equal(ext.getStimulus({ PARAM: 'speed', PART: 'dht1' }), 0);
  });

  it('getStimulus returns 0 with no board', () => {
    const ext = new StimulusExtension();
    assert.equal(ext.getStimulus({ PARAM: 'temperature', PART: 'dht1' }), 0);
  });
});

describe('StimulusExtension: board setPartParam/getPartParam', () => {
  it('setPartParam creates params object if missing', () => {
    const board = makeBoard([
      {
        part: { id: 'dht1', kind: 'dht11', terminals: ['vcc', 'gnd', 'data'], params: {} },
        nets: {
          nv: { part: 'dht1', terminal: 'vcc' },
          ng: { part: 'dht1', terminal: 'gnd' },
          n1: { part: 'dht1', terminal: 'data' },
        },
      },
    ]);
    board.setPartParam('dht1', 'humidity', 60);
    assert.equal(board.getPartParam('dht1', 'humidity'), 60);
  });

  it('setPartParam is no-op for unknown part', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', terminals: ['vcc'], params: {} },
       { id: 'GND', kind: 'gnd', terminals: ['gnd'], params: {} }],
      [{ id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
       { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] }],
    );
    board.setPartParam('nope', 'x', 1);
    assert.equal(board.getPartParam('nope', 'x'), undefined);
  });

  it('setPartParam triggers _solve and notifies', () => {
    const board = makeBoard([
      {
        part: { id: 'dht1', kind: 'dht11', terminals: ['vcc', 'gnd', 'data'], params: {} },
        nets: {
          nv: { part: 'dht1', terminal: 'vcc' },
          ng: { part: 'dht1', terminal: 'gnd' },
          n1: { part: 'dht1', terminal: 'data' },
        },
      },
    ]);
    const events = [];
    board.onChange(e => events.push(e));
    board.setPartParam('dht1', 'temperature', 30);
    const paramEvent = events.find(e => e.type === 'param');
    assert.ok(paramEvent);
    assert.equal(paramEvent.detail.partId, 'dht1');
    assert.equal(paramEvent.detail.param, 'temperature');
    assert.equal(paramEvent.detail.value, 30);
  });
});
