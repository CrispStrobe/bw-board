// params.inputs widens a logic gate. The device honoured it in init/stamp/
// update from the start, but registration overwrote the model's per-part
// terminal list with the 2-input default, so validateNetlist rejected `in2`
// and no netlist using a wide gate could ever load. These tests cover the
// feature AND the guard, because a fix that simply stopped validating gate
// terminals would pass the first half and quietly lose the second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const HI = 'net_vcc';
const LO = 'net_gnd';

/** Build a single gate with `n` inputs driven by the given rail names. */
function gateBoard(kind, drivers, params = {}) {
  const n = drivers.length;
  const terminals = [];
  for (let i = 0; i < n; i++) terminals.push(`in${i}`);
  terminals.push('out');

  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'G', kind, params: { inputs: n, ...params }, terminals },
  ];
  const nets = [
    { id: HI, terminals: [{ part: 'VCC', terminal: 'vcc' }] },
    { id: LO, terminals: [{ part: 'GND', terminal: 'gnd' }] },
    { id: 'out', terminals: [{ part: 'G', terminal: 'out' }] },
  ];
  drivers.forEach((rail, i) => {
    nets.find((x) => x.id === rail).terminals.push({ part: 'G', terminal: `in${i}` });
  });

  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  // settle twice: one hop leaves a freshly-scheduled level unread
  b.advanceTo(1_000_000n);
  b.advanceTo(2_000_000n);
  return b.nodeVoltage('out') > 2.5 ? 1 : 0;
}

test('a 5-input AND loads and needs all five inputs high', () => {
  assert.equal(gateBoard('gate_and', [HI, HI, HI, HI, HI]), 1, 'all high -> high');
  for (let low = 0; low < 5; low++) {
    const drivers = [HI, HI, HI, HI, HI];
    drivers[low] = LO;
    assert.equal(gateBoard('gate_and', drivers), 0, `input ${low} low -> low`);
  }
});

test('a 5-input OR needs only one input high', () => {
  assert.equal(gateBoard('gate_or', [LO, LO, LO, LO, LO]), 0, 'all low -> low');
  for (let hi = 0; hi < 5; hi++) {
    const drivers = [LO, LO, LO, LO, LO];
    drivers[hi] = HI;
    assert.equal(gateBoard('gate_or', drivers), 1, `input ${hi} high -> high`);
  }
});

test('the default width is unchanged when params.inputs is absent', () => {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'G', kind: 'gate_and', params: {}, terminals: ['in0', 'in1', 'out'] },
  ];
  const nets = [
    { id: HI, terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'G', terminal: 'in0' }, { part: 'G', terminal: 'in1' }] },
    { id: LO, terminals: [{ part: 'GND', terminal: 'gnd' }] },
    { id: 'out', terminals: [{ part: 'G', terminal: 'out' }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.advanceTo(1_000_000n);
  b.advanceTo(2_000_000n);
  assert.ok(b.nodeVoltage('out') > 2.5);
});

// The guard. Widening must not become "gates accept any terminal name".
test('a terminal beyond the declared width is still rejected', () => {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    // three inputs declared, but in3 is wired
    { id: 'G', kind: 'gate_and', params: { inputs: 3 }, terminals: ['in0', 'in1', 'in2', 'in3', 'out'] },
  ];
  const nets = [
    { id: HI, terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'G', terminal: 'in0' }, { part: 'G', terminal: 'in1' }, { part: 'G', terminal: 'in2' }, { part: 'G', terminal: 'in3' }] },
    { id: LO, terminals: [{ part: 'GND', terminal: 'gnd' }] },
    { id: 'out', terminals: [{ part: 'G', terminal: 'out' }] },
  ];
  assert.throws(
    () => new BoardImpl(5.0).setNetlist(parts, nets),
    /unknown terminal "in3"/,
    'a wide gate still has a width'
  );
});

test('a misspelled terminal on a default gate is still rejected', () => {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'G', kind: 'gate_and', params: {}, terminals: ['in0', 'inn1', 'out'] },
  ];
  const nets = [
    { id: HI, terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'G', terminal: 'in0' }, { part: 'G', terminal: 'inn1' }] },
    { id: LO, terminals: [{ part: 'GND', terminal: 'gnd' }] },
    { id: 'out', terminals: [{ part: 'G', terminal: 'out' }] },
  ];
  assert.throws(() => new BoardImpl(5.0).setNetlist(parts, nets), /unknown terminal "inn1"/);
});
