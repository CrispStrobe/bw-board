import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';

function assertNetKcl(board, nets) {
  for (const net of nets) {
    if (net.terminals.some(t => t.part === 'GND')) continue;
    const currents = net.terminals.map(t => board.branchCurrent(t.part, t.terminal));
    assert.ok(currents.every(Number.isFinite));
    const residual = currents.reduce((a, b) => a + b, 0);
    // Account for numerical shunts without allowing a whole-device sign flip.
    const budget = 1e-9 + currents.reduce((a, b) => a + Math.abs(b), 0) * 1e-6;
    assert.ok(Math.abs(residual) < budget,
      `${net.id}: signed terminal sum ${residual} exceeds ${budget}: ${currents}`);
  }
}

test('OP/live conversion covers every supported kind, not a four-kind reverse list', () => {
  const parts = [];
  const add = (id, kind, params, terminals) => parts.push({ id, kind, params, terminals });
  add('GND', 'gnd', {}, ['gnd']);
  add('V', 'vsource', { volts: 2 }, ['pos', 'neg']);
  add('RAIL', 'vcc', {}, ['vcc']);
  add('D', 'diode', { model: 'shockley', is: 1e-14, n: 1, rs: 0 }, ['anode', 'cathode']);
  add('Z', 'zener', { model: 'shockley', is: 1e-14, n: 1, rs: 0, vz: 8.2, ibv: 1e-3 }, ['anode', 'cathode']);
  add('L', 'inductor', { henrys: 1e-3 }, ['a', 'b']);
  add('C', 'capacitor', { farads: 1e-6 }, ['a', 'b']);
  add('I', 'isource', { amps: 1e-3 }, ['pos', 'neg']);
  add('E', 'vcvs', { gain: 2 }, ['outp', 'outn', 'inp', 'inn']);
  add('G', 'vccs', { gm: 1e-3 }, ['outp', 'outn', 'inp', 'inn']);
  for (const id of ['RD', 'RZ', 'RL', 'RC', 'RI', 'RE', 'RG', 'RV']) {
    add(id, 'resistor', { ohms: 1000 }, ['a', 'b']);
  }
  const net = (id, refs) => ({ id, terminals: refs.map(ref => {
    const [part, terminal] = ref.split('.'); return { part, terminal };
  }) });
  const nets = [
    net('in', ['V.pos', 'RD.a', 'RZ.a', 'RL.a', 'RC.a', 'E.inp', 'G.inp']),
    net('diode', ['RD.b', 'D.anode']), net('zener', ['RZ.b', 'Z.anode']),
    net('coil', ['RL.b', 'L.a']),
    net('cap', ['RC.b', 'C.a']), net('isource', ['I.pos', 'RI.a']),
    net('vcvs', ['E.outp', 'RE.a']), net('vccs', ['G.outp', 'RG.a']),
    net('rail', ['RAIL.vcc', 'RV.a']),
    net('ground', ['GND.gnd', 'V.neg', 'D.cathode', 'Z.cathode', 'L.b', 'C.b', 'I.neg',
      'RI.b', 'RE.b', 'RG.b', 'RV.b', 'E.outn', 'E.inn', 'G.outn', 'G.inn']),
  ];
  const board = new BoardImpl(5);
  board.setNetlist(parts, nets);
  const op = board.operatingPoint();
  assert.deepEqual([...new Set(parts.map(p => p.kind))].sort(), op.analysis.supportedKinds.slice().sort(),
    'expanding the OP envelope requires expanding this boundary proof');
  board.initializeTransientFromOperatingPoint();
  for (const phase of ['initialized', 'first-step']) {
    if (phase === 'first-step') board.advanceTo(1n);
    assertNetKcl(board, nets);
    for (const part of parts) for (const terminal of part.terminals) {
      const into = op.branchCurrents.get(part.id)?.get(terminal) ?? 0;
      const out = board.branchCurrent(part.id, terminal);
      assert.ok(Math.abs(into + out) < 1e-8, `${phase}: ${part.kind} ${part.id}.${terminal}`);
    }
    // The capacitor and its series resistor are DC-open by definition.
    for (const part of parts.filter(p => !['gnd', 'capacitor'].includes(p.kind) && p.id !== 'RC')) {
      assert.ok(part.terminals.some(t => Math.abs(board.branchCurrent(part.id, t)) > 1e-7),
        `${part.id}: boundary sign proof needs driven current`);
    }
  }
});

for (const volts of [-5, 5]) {
  test(`shared-net KCL and OP/live cache continuity, diode at ${volts} V`, () => {
    const builder = new NetlistBuilder().gnd('GND').vsource('V1', volts)
      .resistor('R1', 1000).diode('D1').resistor('R2', 1000)
      .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
      .wire('R1.b', volts > 0 ? 'D1.anode' : 'D1.cathode')
      .wire(volts > 0 ? 'D1.cathode' : 'D1.anode', 'R2.a')
      .wire('R2.b', 'GND.gnd');
    const { parts, nets } = builder.build();
    parts.find(p => p.id === 'D1').params = { model: 'shockley', is: 1e-14, n: 1, rs: 0 };
    const board = new BoardImpl(5);
    board.setNetlist(parts, nets);
    assertNetKcl(board, nets);
    const before = new Map(parts.map(p => [p.id,
      new Map(p.terminals.map(t => [t, board.branchCurrent(p.id, t)]))]));
    assert.ok(Math.abs(before.get('R1').get('b')) > 1e-3, 'non-vacuous driven loop');
    const op = board.operatingPoint();
    assert.equal(op.analysis.currentConvention, 'positive-into-part-terminal');
    board.initializeTransientFromOperatingPoint();
    for (const phase of ['initialized', 'first-step']) {
      if (phase === 'first-step') board.advanceTo(1n);
      assertNetKcl(board, nets);
      for (const part of parts.filter(p => p.id !== 'GND')) {
        for (const terminal of part.terminals) {
          const live = board.branchCurrent(part.id, terminal);
          assert.ok(Math.abs(live - before.get(part.id).get(terminal)) < 1e-8,
            `${phase} ${part.id}.${terminal}: public sign/magnitude changed`);
          assert.ok(Math.abs(live + op.branchCurrents.get(part.id).get(terminal)) < 1e-8,
            `${phase} ${part.id}.${terminal}: OP/live conversion`);
        }
      }
    }
  });
}

test('LED forward brightness and delivered source current survive raw convention', () => {
  const { parts, nets } = new NetlistBuilder().gnd('GND').vsource('V1', 5)
    .resistor('R1', 100).led('D1')
    .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
    .wire('R1.b', 'D1.anode').wire('D1.cathode', 'GND.gnd').build();
  const board = new BoardImpl(5);
  board.setNetlist(parts, nets);
  assertNetKcl(board, nets);
  assert.ok(board.branchCurrent('D1', 'anode') < -0.025);
  assert.ok(board.branchCurrent('V1', 'pos') > 0.025);
  assert.ok(board.ledCurrents.get('D1') > 0.025, 'forward display current stays positive');
  board.ledCurrents.set('D1', 0); // Exercise DRC's raw-current fallback, not its cache.
  assert.ok(board.getWarnings().some(w => w.partId === 'D1' && w.severity === 'danger'),
    'forward overcurrent must not disappear when the raw anode sign changes');
});
