// Edge detectors of clocked logic: what a counter remembers about its clock.
//
// Two defects (2026-11-25), both in the "previous level" an edge is measured
// against:
//
//  1. PHANTOM COUNT AFTER RESET. The 74HC93's master reset returned before
//     the clock inputs were sampled, so while reset was held the remembered
//     CKB level froze at whatever QA was when reset came. Reset clears QA, and
//     in the 4-bit chain QA is CKB: on release the stale "CKB was high" met
//     "CKB is low" and the counter took a falling edge that never happened
//     (count 1 -> reset -> 2). A real '93's reset is asynchronous; releasing
//     it clocks nothing.
//
//  2. POWER-ON COUNT. Every edge detector started from a hard-coded previous
//     level (false; true for the 74LS107), so a counter whose clock settles at
//     the other level at power-on counted once at t = 0: a rising-edge part
//     with its clock held high, or a falling-edge part whose clock is driven
//     by a gate that starts high and settles low. A real counter powered up
//     under a steady clock level does not count. The previous level now comes
//     from the first SETTLED input level (src/devices/edge-detect.js; the
//     board primes edge detectors through the power-on device fixpoint).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, terminals, params = {}) => ({ id, kind, params, terminals });
const RAILS = [P('V', 'vcc', ['vcc']), P('G', 'gnd', ['gnd'])];
const T93 = ['clk_a', 'nc1', 'nc2', 'nc3', 'vcc', 'r0_1', 'r0_2', 'qd', 'qc', 'gnd', 'qb', 'qa', 'nc4', 'clk_b'];
const high = (b, n) => b.nodeVoltage(n) > 2.5;
const word = (b, nets) => nets.reduce((a, n, i) => a | ((high(b, n) ? 1 : 0) << i), 0);

/** A 74HC93 wired as a 4-bit counter (QA -> CKB), clock and reset from sources. */
function counter93() {
  const b = new BoardImpl(5);
  b.setNetlist([...RAILS, P('U', '74hc93', T93),
    P('CLK', 'vsource', ['pos', 'neg'], { volts: 0 }), P('MR', 'vsource', ['pos', 'neg'], { volts: 0 })],
  [net('vcc', ['V', 'vcc'], ['U', 'vcc']), net('gnd', ['G', 'gnd'], ['U', 'gnd'], ['CLK', 'neg'], ['MR', 'neg']),
    net('clk', ['CLK', 'pos'], ['U', 'clk_a']), net('mr', ['MR', 'pos'], ['U', 'r0_1'], ['U', 'r0_2']),
    net('qa', ['U', 'qa'], ['U', 'clk_b']), net('qb', ['U', 'qb']), net('qc', ['U', 'qc']), net('qd', ['U', 'qd'])]);
  b.setPower(true);
  const count = () => word(b, ['qa', 'qb', 'qc', 'qd']);
  const pulse = () => { b.setControl('CLK', 5); b.setControl('CLK', 0); };
  return { b, count, pulse };
}

describe('74HC93 master reset is asynchronous and releasing it clocks nothing', () => {
  it('reset taken while QA is high, then released: the count is 0, not 2', () => {
    const { b, count, pulse } = counter93();
    pulse();
    assert.equal(count(), 1, 'one falling edge on CKA');
    b.setControl('MR', 5);
    assert.equal(count(), 0, 'reset clears every stage at once');
    b.setControl('MR', 0);
    assert.equal(count(), 0, 'release must not clock CKB');
    pulse();
    assert.equal(count(), 1, 'and the next clock counts from 0');
  });

  it('every odd count is cleared cleanly (QA high each time)', () => {
    for (const n of [1, 3, 5, 7, 9, 15]) {
      const { b, count, pulse } = counter93();
      for (let i = 0; i < n; i++) pulse();
      assert.equal(count(), n);
      b.setControl('MR', 5); b.setControl('MR', 0);
      assert.equal(count(), 0, `cleared from ${n}`);
    }
  });

  it('a CKA edge while reset is held is not stored and replayed on release', () => {
    const { b, count } = counter93();
    b.setControl('CLK', 5);
    b.setControl('MR', 5);
    b.setControl('CLK', 0);          // falling edge DURING reset: ignored
    b.setControl('MR', 0);
    assert.equal(count(), 0);
  });
});

/** Powers a single device with `clkLevel` held on its clock and returns the board. */
function powerOn(kind, terms, clkPin, clkLevel, ties, outs) {
  const b = new BoardImpl(5);
  const toVcc = ties.filter(([, l]) => l).map(([t]) => ['U', t]);
  const toGnd = ties.filter(([, l]) => !l).map(([t]) => ['U', t]);
  const pwr = terms.includes('vcc') ? [['U', 'vcc']] : [];
  const gnd = terms.includes('gnd') ? [['U', 'gnd']] : [];
  b.setNetlist([...RAILS, P('U', kind, terms), P('R', 'resistor', ['a', 'b'], { ohms: 10000 })],
    [net('vcc', ['V', 'vcc'], ...pwr, ...toVcc, ...(clkLevel ? [['R', 'a']] : [])),
      net('gnd', ['G', 'gnd'], ...gnd, ...toGnd, ...(clkLevel ? [] : [['R', 'a']])),
      net('clk', ['R', 'b'], ['U', clkPin]), ...outs.map((o) => net(o, ['U', o]))]);
  b.setPower(true);
  b.advanceTo(1_000_000n);
  return b;
}

describe('power-on under a steady clock level counts nothing', () => {
  it('CD4017 (rising edge) with its clock held high stays at Q0', () => {
    const b = powerOn('decade_counter', ['clk', 'rst', 'en', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'co'],
      'clk', 1, [['rst', 0], ['en', 0]], ['q0', 'q1']);
    assert.deepEqual([high(b, 'q0'), high(b, 'q1')], [true, false]);
  });

  it('74LS161 (rising edge, counting enabled) with its clock held high stays at 0', () => {
    const b = powerOn('74ls161', ['d0', 'd1', 'd2', 'd3', 'q0', 'q1', 'q2', 'q3', 'clk', 'clrb', 'loadb', 'enp', 'ent', 'rco', 'vcc', 'gnd'],
      'clk', 1, [['clrb', 1], ['loadb', 1], ['enp', 1], ['ent', 1]], ['q0', 'q1']);
    assert.equal(word(b, ['q0', 'q1']), 0);
  });

  it('D and JK flip-flops (dff, jkff, 74HC74) with their clocks held high keep Q = 0', () => {
    assert.equal(high(powerOn('dff', ['d', 'clk', 'set', 'rst', 'q', 'q_bar'], 'clk', 1,
      [['d', 1], ['set', 0], ['rst', 0]], ['q']), 'q'), false, 'dff');
    assert.equal(high(powerOn('jkff', ['j', 'k', 'clk', 'set', 'rst', 'q', 'q_bar'], 'clk', 1,
      [['j', 1], ['k', 1], ['set', 0], ['rst', 0]], ['q']), 'q'), false, 'jkff');
    assert.equal(high(powerOn('74hc74', ['1clr', '1d', '1clk', '1pre', '1q', '1q_bar', 'gnd', '2q_bar', '2q', '2pre', '2clk', '2d', '2clr', 'vcc'],
      '1clk', 1, [['1clr', 1], ['1d', 1], ['1pre', 1]], ['1q']), '1q'), false, '74hc74');
  });

  it('74LS107 (falling edge) with its clock held low does not toggle', () => {
    const b = powerOn('74ls107', ['1j', '1k', '1clk', '1clrb', '1q', '1qb', '2j', '2k', '2clk', '2clrb', '2q', '2qb', 'vcc', 'gnd'],
      '1clk', 0, [['1j', 1], ['1k', 1], ['1clrb', 1]], ['1q']);
    assert.equal(high(b, '1q'), false);
  });

  it('a 74HC93 clocked by a gate that settles LOW at power-on does not count', () => {
    // A D flip-flop held SET drives Q-bar low from the moment it has power.
    // The solver meets it at its init level (high) and the flip-flop then
    // settles low inside the power-on fixpoint: that is not a clock edge.
    const b = new BoardImpl(5);
    b.setNetlist([...RAILS, P('F', 'dff', ['d', 'clk', 'set', 'rst', 'q', 'q_bar']), P('U', '74hc93', T93)],
      [net('vcc', ['V', 'vcc'], ['U', 'vcc'], ['F', 'set']),
        net('gnd', ['G', 'gnd'], ['U', 'gnd'], ['U', 'r0_1'], ['U', 'r0_2'], ['F', 'd'], ['F', 'clk'], ['F', 'rst']),
        net('qbar', ['F', 'q_bar'], ['U', 'clk_a']), net('qa', ['U', 'qa'], ['U', 'clk_b']), net('qb', ['U', 'qb'])]);
    b.setPower(true);
    assert.equal(high(b, 'qbar'), false, 'the clock settled low');
    assert.equal(word(b, ['qa', 'qb']), 0, 'and nothing was counted');
  });

  it('the first edge after power-on still counts', () => {
    const b = new BoardImpl(5);
    const T = ['d0', 'd1', 'd2', 'd3', 'q0', 'q1', 'q2', 'q3', 'clk', 'clrb', 'loadb', 'enp', 'ent', 'rco', 'vcc', 'gnd'];
    b.setNetlist([...RAILS, P('U', '74ls161', T), P('CLK', 'vsource', ['pos', 'neg'], { volts: 5 })],
      [net('vcc', ['V', 'vcc'], ['U', 'vcc'], ['U', 'clrb'], ['U', 'loadb'], ['U', 'enp'], ['U', 'ent']),
        net('gnd', ['G', 'gnd'], ['U', 'gnd'], ['CLK', 'neg']), net('clk', ['CLK', 'pos'], ['U', 'clk']),
        net('q0', ['U', 'q0']), net('q1', ['U', 'q1'])]);
    b.setPower(true);
    assert.equal(word(b, ['q0', 'q1']), 0, 'clock high at power-on: no count');
    b.setControl('CLK', 0); b.setControl('CLK', 5);
    assert.equal(word(b, ['q0', 'q1']), 1, 'one real rising edge: one count');
  });

  it('a power cycle re-primes: switching on again under a steady high clock counts nothing', () => {
    const T = ['clk', 'rst', 'en', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'co'];
    const b = new BoardImpl(5);
    b.setNetlist([...RAILS, P('U', 'decade_counter', T), P('CLK', 'vsource', ['pos', 'neg'], { volts: 0 })],
      [net('gnd', ['G', 'gnd'], ['U', 'rst'], ['U', 'en'], ['CLK', 'neg']), net('clk', ['CLK', 'pos'], ['U', 'clk']),
        net('q0', ['U', 'q0']), net('q1', ['U', 'q1']), net('q2', ['U', 'q2']), net('vcc', ['V', 'vcc'])]);
    b.setPower(false);
    b.setControl('CLK', 5);
    b.setPower(true);
    assert.equal(high(b, 'q0'), true, 'still at Q0 after switching on under a high clock');
  });
});
