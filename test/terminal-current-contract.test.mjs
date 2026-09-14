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
