/**
 * A terminal on NO net is not a terminal on ground.
 *
 * The ground net has no row in the MNA matrix — it is the reference — so
 * `nodeIndex.get(groundNet)` is `undefined`. A terminal that is on no net at
 * all also produces `undefined`. The two states were indistinguishable, and
 * every two-terminal stamp added its self-conductance in both cases, which is
 * right for ground and wrong for air: a resistor with one leg unconnected was
 * stamped as a resistor TO GROUND, silently loading whatever it touched.
 *
 * Imported schematics are full of unconnected pins — no-fit parts, spare
 * gates, test points, an IC whose signal pins nothing has wired yet — and
 * every one of them was a phantom load on its net.
 *
 * Found by an independent solver: an Adafruit MAX4466 board read 2.5 V on its
 * bias node where lcapy said 5 V, because a 1 k with one leg in the air was
 * acting as the lower half of a divider.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { solveMNA } from '../src/mna.js';

const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const VCC = { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] };
const GND = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };

/** 5 V --R1-- mid --Rx-- (wherever `tail` says). */
function solve(tail) {
  const parts = [VCC, GND, R('R1', 1000), R('Rx', 1000)];
  const nets = [
    { id: 'sup', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'Rx', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, ...tail] },
  ];
  return solveMNA(parts, nets, new Map(), new Map(), 5);
}

describe('a dangling terminal is not a grounded one', () => {
    test('a resistor with one leg in the air carries no current', () => {
        const v = solve([]).nodeVoltages.get('mid');
        assert.ok(Math.abs(v - 5) < 1e-5,
            `mid should sit at the rail (5 V) because Rx conducts nowhere; got ${v}. `
            + '2.5 V means the loose leg was treated as ground.');
    });

    test('the SAME resistor wired to ground still divides', () => {
        // The other half of the contract. Without this, "skip anything with a
        // missing index" would also silently delete every real connection to
        // ground, since ground has no index either — and the first test alone
        // would still pass.
        const v = solve([{ part: 'Rx', terminal: 'b' }]).nodeVoltages.get('mid');
        assert.ok(Math.abs(v - 2.5) < 1e-4,
            `a 1k/1k divider to ground must read 2.5 V, got ${v}`);
    });

    test('an IC with unwired signal pins does not load its supply', () => {
        // The shape that found this: a 555 whose six signal terminals are on
        // no net, which used to sink current out of pins attached to nothing.
        const parts = [VCC, GND, R('R1', 1000),
            { id: 'T1', kind: '555', params: {},
              terminals: ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc'] }];
        const nets = [
            { id: 'sup', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
            { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'T1', terminal: 'vcc' }] },
            { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'T1', terminal: 'gnd' }] },
        ];
        const res = solveMNA(parts, nets, new Map(), new Map(), 5);
        assert.equal(res.converged, true);
        const v = res.nodeVoltages.get('mid');
        // Not asserting an exact value — a 555 draws real quiescent supply
        // current, which is legitimate. Asserting it is not pulled most of the
        // way to ground by pins that are not connected to anything.
        assert.ok(v > 4, `an unwired 555 should not drag its supply to ${v} V through R1`);
    });
});
