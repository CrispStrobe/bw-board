/**
 * Contact bounce (params.bounceMs on a button or switch). A real contact
 * does not close once: its spring makes it hit, rebound and hit again
 * several times within a few milliseconds before it rests. A counter clocked
 * straight from a button therefore counts several steps per press.
 *
 * With bounceMs > 0 every change of a contact's control is followed by
 * `bounces` (default 4) open-close rebounds inside bounceMs (half as many on
 * release), timed by a seeded PRNG (params.bounceSeed, else a hash of the
 * part id, advanced per change), so a run reproduces exactly. Without
 * bounceMs a contact switches once, as before.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const t = (part, terminal) => ({ part, terminal });

/** 5 V -> button -> node 'k' -> 10 k to ground, plus a 1 nF so the node is reactive. */
function bench(params) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'S', kind: 'button', params, terminals: ['a', 'b'] },
    { id: 'R', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ], [
    { id: 'top', terminals: [t('V', 'vcc'), t('S', 'a')] },
    { id: 'k', terminals: [t('S', 'b'), t('R', 'a')] },
    { id: 'gnd', terminals: [t('G', 'gnd'), t('R', 'b')] },
  ]);
  b.setPower(true);
  return b;
}

/** Edges seen on node k sampled every 20 us for `ms`. */
function edges(b, ms) {
  const out = [];
  let last = (b.nodeVoltages.get('k') ?? 0) > 2.5;
  const t0 = b.timeNs;
  for (let i = 1; i <= ms * 50; i++) {
    b.advanceTo(t0 + BigInt(i * 20000));
    const hi = (b.nodeVoltages.get('k') ?? 0) > 2.5;
    if (hi !== last) out.push({ tMs: i * 0.02, rising: hi });
    last = hi;
  }
  return out;
}

describe('contact bounce', () => {
  it('without bounceMs a press is one clean edge', () => {
    const b = bench({});
    b.advanceTo(1_000_000n);
    b.setControl('S', 1);
    const e = edges(b, 10);
    assert.equal(e.length, 0, 'already closed at the press instant, no later edges');
    assert.ok(b.nodeVoltages.get('k') > 4.9);
  });

  it('a press with bounceMs 3 rebounds 4 times inside 3 ms and ends closed', () => {
    const b = bench({ bounceMs: 3 });
    b.advanceTo(1_000_000n);
    b.setControl('S', 1);
    assert.ok(b.nodeVoltages.get('k') > 4.9, 'first contact at the press');
    const e = edges(b, 10);
    assert.equal(e.filter((x) => !x.rising).length, 4, 'four rebounds open the contact');
    assert.equal(e.filter((x) => x.rising).length, 4, 'and it closes again after each');
    assert.ok(e.every((x) => x.tMs <= 3.02), `all inside 3 ms: ${e.map((x) => x.tMs).join(', ')}`);
    assert.ok(b.nodeVoltages.get('k') > 4.9, 'rests closed');
  });

  it('release bounces half as often and rests open', () => {
    const b = bench({ bounceMs: 3 });
    b.advanceTo(1_000_000n);
    b.setControl('S', 1);
    edges(b, 10);
    b.setControl('S', 0);
    const e = edges(b, 10);
    assert.equal(e.filter((x) => x.rising).length, 2, 'two rebounds close it again briefly');
    assert.ok(b.nodeVoltages.get('k') < 0.1, 'rests open');
  });

  it('the bounce pattern reproduces with the same seed and differs between presses', () => {
    const pattern = () => {
      const b = bench({ bounceMs: 3, bounceSeed: 7 });
      b.advanceTo(1_000_000n);
      b.setControl('S', 1);
      const first = edges(b, 5).map((x) => x.tMs);
      b.setControl('S', 0); edges(b, 5);
      b.setControl('S', 1);
      const second = edges(b, 5).map((x) => x.tMs);
      return { first, second };
    };
    const a = pattern();
    const b = pattern();
    assert.deepEqual(a, b, 'same seed, same run');
    assert.notDeepEqual(a.first, a.second, 'each press bounces differently');
  });

  it('bounces sets the number of rebounds', () => {
    const b = bench({ bounceMs: 2, bounces: 2 });
    b.advanceTo(1_000_000n);
    b.setControl('S', 1);
    const e = edges(b, 5);
    assert.equal(e.filter((x) => !x.rising).length, 2);
  });
});
