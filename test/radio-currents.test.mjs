// Radio front end: the currents of the parts it replaces in the solve
// (src/radio.js expandRadio, src/board.js branchCurrent). Gap (2026-11-26):
// a ferrite rod's windings are solved as their copper (the coil itself lives
// in the RF bands), and a transistor's rectified current flows in a hidden
// rf_detect companion; branchCurrent read neither, so a rod carrying a
// transistor's collector current reported none, and the currents into a
// net did not add up. Oracle: Kirchhoff's current law at every net.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });

/** A Meissner oscillator on a ferrite rod (tank in the collector, coupling winding in the base). */
function meissner() {
    const b = new BoardImpl(9);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']),
        P('L1', 'ferrite_coil', { rodHeightM: 0, couplingRatio: 0.05 }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('TC', 'tuning_cap', { position: 0.3 }, ['a', 'b']), P('Q1', 'npn', {}, ['base', 'collector', 'emitter']),
        P('R1', 'resistor', { ohms: 47e3 }, ['a', 'b']), P('R2', 'resistor', { ohms: 10e3 }, ['a', 'b']),
        P('CB', 'capacitor', { farads: 10e-9 }, ['a', 'b']), P('RE', 'resistor', { ohms: 1000 }, ['a', 'b']), P('CE', 'capacitor', { farads: 1e-9 }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['VS', 'neg'], ['R2', 'b'], ['CB', 'b'], ['RE', 'b'], ['CE', 'b']), net('v', ['VS', 'pos'], ['L1', 'a'], ['TC', 'a'], ['R1', 'a']),
        net('col', ['Q1', 'collector'], ['L1', 'b'], ['TC', 'b']), net('bias', ['R1', 'b'], ['R2', 'a'], ['CB', 'a'], ['L1', 'c2']),
        net('base', ['Q1', 'base'], ['L1', 'c1']), net('e', ['Q1', 'emitter'], ['RE', 'a'], ['CE', 'a'])]);
    b.setBroadcast([]);
    b.setPower(true);
    return b;
}

describe('radio front end: currents of the parts it replaces', () => {
    it('a ferrite rod carries the collector current; Kirchhoff holds at every net while it oscillates', () => {
        const b = meissner();
        b.advanceTo(1_000_000n);
        assert.ok(Math.max(0, ...b._radio.bandAmplitudes('col').map(x => x.volts)) > 1, 'oscillating');
        const ic = b.branchCurrent('Q1', 'collector');
        assert.ok(Math.abs(ic) > 1e-5, `the transistor carries a collector current (${ic} A)`);
        // Currents leave each part into its net: they sum to zero there.
        const sum = (terms) => terms.reduce((a, [p, t]) => a + b.branchCurrent(p, t), 0);
        const scale = Math.abs(ic);
        for (const [n, terms] of Object.entries({
            col: [['Q1', 'collector'], ['L1', 'b'], ['TC', 'b']],
            base: [['Q1', 'base'], ['L1', 'c1']],
            e: [['Q1', 'emitter'], ['RE', 'a'], ['CE', 'a']],
            bias: [['R1', 'b'], ['R2', 'a'], ['CB', 'a'], ['L1', 'c2']],
        })) assert.ok(Math.abs(sum(terms)) < 1e-4 * scale + 1e-9, `KCL at ${n}: ${terms.map(([p, t]) => `${p}.${t} ${b.branchCurrent(p, t).toExponential(3)}`).join(', ')}`);
        assert.ok(Math.abs(b.branchCurrent('L1', 'b') + ic) < 1e-3 * Math.abs(ic) + 1e-9, `the rod's main winding carries it: ${b.branchCurrent('L1', 'b')} A`);
    });
});
