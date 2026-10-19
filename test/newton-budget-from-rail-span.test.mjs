/**
 * THE ITERATION BUDGET IS A CONSEQUENCE OF THE STEP CLAMP, NOT A ROUND NUMBER.
 *
 * Junction limiting moves each junction at most NR_MAX_STEP = 0.5 V per
 * iteration. A node that starts one rail away and must settle at the other
 * therefore CANNOT arrive in fewer than span/0.5 iterations however well
 * conditioned the circuit is. On +/-15 V rails that is 60, and the loop gave up
 * at 50.
 *
 * HOW IT PRESENTED, because this is the part worth remembering: not an
 * oscillation, a STEADY WALK. Instrumenting ADI2005 v3 row 526, a two-stage
 * Miller-compensated op-amp, the residual fell by exactly 0.5 V per iteration
 * -- 2.67, 2.17, 1.67, 1.17, 0.673, 0.173 -- and the budget ran out two
 * iterations short. The reason string said `engine-non-convergence: bias
 * point`, which sends a reader to look for a model defect or a continuation
 * defect. Neither was there: two denser source-stepping ladders were measured
 * and changed nothing.
 *
 * Measured over the whole 12,471-deck corpus, deriving the budget instead:
 *
 *   our non-convergences        66 -> 6
 *   agreeing decks          10,425 -> 10,485      (+60, zero regressions)
 *   agreement where both engines answer   98.27 % -> 98.83 %
 *
 * Sixty of the 66 were that one topology on +/-15 V rails.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';

/**
 * THE FIXTURE IS THE TOPOLOGY THAT FAILED, AND TWO SIMPLER ONES WOULD NOT DO.
 *
 * A diode chain between wide rails converges in a couple of iterations: the
 * clamp limits a junction, and a junction only ever has to reach ~0.7 V however
 * wide the rails are. A single MOSFET on +/-100 V converges too, because its
 * `vds` is set by the linear solve rather than walked. BOTH survived every
 * mutation, including reverting to the fixed budget -- tests that would have
 * shipped believing they held a claim they never touched.
 *
 * The long walk needs the FEEDBACK: a two-stage amplifier's high-impedance
 * node moves the full clamped step every iteration, so the state really does
 * traverse the rail span. So this is ADI2005 v3 row 526's topology, transcribed
 * -- a two-stage Miller-compensated op-amp, +/-15 V, and the numbers are from
 * the deck rather than chosen here.
 *
 * `k` is KP/2 * W/L, the same lumping `mosK` does: NMOS 1e-4/2 * 20 = 1e-3,
 * PMOS 5e-5/2 * 40 = 1e-3, second-stage PMOS 5e-5/2 * 80 = 2e-3, and the
 * bias/tail NMOS 1e-4/2 * 10 = 5e-4.
 */
const twoStageOpAmp = () => {
  const b = new NetlistBuilder()
    .vsource('VDD', 15).vsource('VSS', -15).vsource('VBIAS', -13.5)
    .vsource('VINP', 0).vsource('VINN', 0)
    .gnd('GND')
    .resistor('RBIAS', 13000)
    .nmos('M1', 1.0, 1e-3).nmos('M2', 1.0, 1e-3)
    .pmos('M3', -1.0, 1e-3).pmos('M4', -1.0, 1e-3)
    .nmos('M5', 1.0, 5e-4).nmos('MBIAS', 1.0, 5e-4)
    .pmos('M6', -1.0, 2e-3).nmos('M7', 1.0, 1e-3)
    .capacitor('CC', 3e-12)
    // rails and references
    .wire('VDD.neg', 'GND.gnd').wire('VSS.neg', 'GND.gnd')
    .wire('VBIAS.neg', 'GND.gnd').wire('VINP.neg', 'GND.gnd').wire('VINN.neg', 'GND.gnd')
    // input pair on the tail
    .wire('M1.gate', 'VINP.pos').wire('M2.gate', 'VINN.pos')
    .wire('M1.source', 'M2.source').wire('M1.source', 'M5.drain')
    // active load, diode-connected M3 mirroring into M4
    .wire('M1.drain', 'M3.drain').wire('M3.gate', 'M3.drain').wire('M4.gate', 'M3.drain')
    .wire('M2.drain', 'M4.drain')
    .wire('M3.source', 'VDD.pos').wire('M4.source', 'VDD.pos')
    // tail and bias mirror
    .wire('M5.gate', 'VBIAS.pos').wire('M5.source', 'VSS.pos')
    .wire('MBIAS.gate', 'VBIAS.pos').wire('MBIAS.drain', 'VBIAS.pos')
    .wire('MBIAS.source', 'VSS.pos')
    .wire('RBIAS.a', 'VDD.pos').wire('RBIAS.b', 'VBIAS.pos')
    // second stage, Miller capacitor across it
    .wire('M6.gate', 'M2.drain').wire('M6.source', 'VDD.pos')
    .wire('M7.gate', 'VBIAS.pos').wire('M7.source', 'VSS.pos')
    .wire('M6.drain', 'M7.drain')
    .wire('CC.a', 'M2.drain').wire('CC.b', 'M6.drain');
  const { parts, nets } = b.build();
  for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'MBIAS', 'M6', 'M7']) {
    parts.find((p) => p.id === id).params.lambda = 0.01;
  }
  const board = new BoardImpl(15);
  board.setNetlist(parts, nets);
  const netOf = (part, terminal) => nets.find((n) =>
    n.terminals.some((t) => t.part === part && t.terminal === terminal));
  const { converged, nodeVoltages } = board.biasPointVoltages();
  return { converged, out: nodeVoltages.get(netOf('M6', 'drain').id),
    tail: nodeVoltages.get(netOf('M5', 'drain').id) };
};

describe('the Newton budget scales with the rails it has to cross', () => {
  it('converges the two-stage op-amp that a 50-iteration budget abandoned', () => {
    // 30 V of rail span at a 0.5 V clamp is 60 steps; the budget was 50, and
    // the residual was still falling by exactly 0.5 V per iteration when it
    // ran out. Sixty decks of ADI2005 v3 are this topology.
    const { converged, out, tail } = twoStageOpAmp();
    assert.equal(converged, true,
      'the bias point must converge, not report itself unconverged two steps short');
    assert.ok(Number.isFinite(out) && Number.isFinite(tail),
      `got out ${out} tail ${tail}`);
    // Inside the rails, which is the weakest true statement about the answer --
    // this test is about arriving, and the corpus sweep is what checks the value
    // against ngspice.
    for (const [name, v] of [['out', out], ['tail', tail]]) {
      assert.ok(v >= -15.001 && v <= 15.001, `${name} left the rails at ${v} V`);
    }
  });

  it('a linear circuit is unaffected, so the budget costs nothing to pay', () => {
    // A resistive divider converges on the first iteration whatever the budget
    // is; raising the ceiling must not change any answer.
    const { parts, nets } = new NetlistBuilder()
      .vsource('V1', 5).gnd('GND').resistor('R1', 1000).resistor('R2', 3000)
      .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
      .wire('R1.b', 'R2.a').wire('R2.b', 'GND.gnd')
      .build();
    const board = new BoardImpl(5);
    board.setNetlist(parts, nets);
    const mid = nets.find((n) => n.terminals.some((t) => t.part === 'R1' && t.terminal === 'b'));
    assert.equal(board.nodeVoltage(mid.id), 3.75);
  });
});
