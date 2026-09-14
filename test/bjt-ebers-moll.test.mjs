/**
 * FULL EBERS-MOLL FOR THE BJT — BOTH JUNCTIONS, WITH A REVERSE BETA.
 *
 * `stampNPN`'s own comment named this as the work that was actually needed, and
 * recorded the measurement that ruled out the cheap version: a single
 * exponential base-emitter junction made agreement WORSE than the piecewise
 * knee it replaced (base error 4.1 mV -> 69.6 mV), because in saturation most
 * of Ib crosses the FORWARD-BIASED BASE-COLLECTOR junction and one junction
 * cannot express that.
 *
 * THE BENCH AND THE ORACLE. 5 V through a 10 Ohm motor winding into the
 * collector, base driven from 4.898 V through 1 kOhm, 2N2222 (Bf = 200,
 * Is = 1e-14), emitter grounded. ngspice, on the deck our exporter writes for
 * that circuit:
 *
 *     V(base)        0.815259 V
 *     V(collector)   0.147347 V
 *     I(supply)      0.485270 A
 *
 * Deeply saturated: beta*Ib would demand 818 mA and the load can pass 485.
 *
 *     model        V(base)     V(collector)   what it costs
 *     piecewise    0.741564    0.067245       collector 80 mV out, Ic reads 0
 *     Ebers-Moll   0.814789    0.147254       base 0.5 mV, collector 0.1 mV
 *
 * THE DEFAULT IS UNCHANGED and the second test holds that. 2,163 corpus
 * circuits and this suite are written against the knee; Ebers-Moll is behind
 * `JUNCTION_ROUTING.mode = 'shockley'` or an explicit `params.model`, the same
 * switch the diodes use. That is why this adds a model rather than replacing
 * one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { JUNCTION_ROUTING } from '../src/mna.js';

registerAllDevices();

/** The saturated motor-driver bench, solved in one routing mode. */
function motorBench(mode, params = { part: '2N2222', beta: 200, is: 1e-14 }) {
    const prior = JUNCTION_ROUTING.mode;
    JUNCTION_ROUTING.mode = mode;
    try {
        const b = new BoardImpl(5);
        b.setNetlist([
            { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'VB', kind: 'vsource', params: { volts: 4.898 }, terminals: ['pos', 'neg'] },
            { id: 'RM', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
            { id: 'RB', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'Q1', kind: 'npn', params, terminals: ['base', 'collector', 'emitter'] },
        ], [
            { id: 'n_v', terminals: [{ part: 'VCC1', terminal: 'vcc' }, { part: 'RM', terminal: 'a' }] },
            { id: 'n_c', terminals: [{ part: 'RM', terminal: 'b' }, { part: 'Q1', terminal: 'collector' }] },
            { id: 'n_bs', terminals: [{ part: 'VB', terminal: 'pos' }, { part: 'RB', terminal: 'a' }] },
            { id: 'n_b', terminals: [{ part: 'RB', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
            { id: 'n_g', terminals: [
                { part: 'GND1', terminal: 'gnd' },
                { part: 'Q1', terminal: 'emitter' },
                { part: 'VB', terminal: 'neg' },
            ]},
        ]);
        return {
            vb: b.nodeVoltage('n_b'),
            vc: b.nodeVoltage('n_c'),
            ib: b.branchCurrent('Q1', 'base'),
            ic: b.branchCurrent('Q1', 'collector'),
            ie: b.branchCurrent('Q1', 'emitter'),
            converged: b._lastSolveConverged,
        };
    } finally {
        // Module-global. Leaking 'shockley' into a later caller would silently
        // change what THEY measure.
        JUNCTION_ROUTING.mode = prior;
    }
}

test('a saturated NPN agrees with ngspice on the exponential path', () => {
    const r = motorBench('shockley');
    assert.equal(r.converged, true, 'the solve did not converge, so nothing below is a reading');
    // ngspice's own answers for the deck our exporter writes for this bench.
    assert.ok(Math.abs(r.vb - 0.815259) < 1e-3,
        `V(base) ${r.vb} against ngspice 0.815259`);
    assert.ok(Math.abs(r.vc - 0.147347) < 1e-3,
        `V(collector) ${r.vc} against ngspice 0.147347. The piecewise knee reads 0.067 here `
        + 'because it never enters saturation at all.');
    // Ic is the LOAD's current at that collector voltage, which is the whole
    // point of saturation: (5 - Vce) / 10.
    assert.ok(Math.abs(r.ic - (5 - r.vc) / 10) < 1e-6,
        `Ic ${r.ic} must be what the 10 Ohm load passes, ${(5 - r.vc) / 10}`);
    // KCL at the device, asserted rather than read back from a recorded number.
    assert.ok(Math.abs(r.ib + r.ic + r.ie) < 1e-9,
        `Ib + Ic + Ie = ${r.ib + r.ic + r.ie}, must be zero`);
    // And it really is saturated: beta*Ib is far more than the load passes.
    assert.ok(200 * r.ib > r.ic * 1.5,
        `beta*Ib = ${200 * r.ib} is not comfortably above Ic = ${r.ic}, so this bench is not `
        + 'saturated and the test is measuring the wrong region');
});

test('the piecewise default is untouched, and the two models differ here', () => {
    // The separating state. Without the second half, a change that routed
    // EVERYTHING through Ebers-Moll would pass the test above and silently move
    // every corpus number.
    const pwl = motorBench('pwl');
    assert.ok(Math.abs(pwl.vb - 0.741564) < 1e-4,
        `piecewise V(base) ${pwl.vb}, expected 0.741564 — the default has moved`);
    assert.ok(Math.abs(pwl.vc - 0.067245) < 1e-4,
        `piecewise V(collector) ${pwl.vc}, expected 0.067245 — the default has moved`);

    const em = motorBench('shockley');
    assert.ok(Math.abs(em.vc - pwl.vc) > 0.05,
        'the two models return the same collector voltage, so the routing switch is not '
        + 'reaching the BJT and neither assertion above is about what it says it is');
});

test('auto routing leaves a BJT on the knee', () => {
    // 'auto' is what ships. For diodes it picks by headroom; a BJT has no
    // headroom argument, so it must fall to piecewise — and a bench that
    // silently switched models would be a behaviour change nobody asked for.
    const auto = motorBench('auto');
    const pwl = motorBench('pwl');
    assert.equal(auto.vc, pwl.vc);
    assert.equal(auto.vb, pwl.vb);
});

test('an explicit params.model reaches Ebers-Moll without the global switch', () => {
    // The per-part escape hatch, so a single part can be measured without
    // moving the whole bench.
    const one = motorBench('auto', { part: '2N2222', beta: 200, is: 1e-14, model: 'shockley' });
    assert.ok(Math.abs(one.vc - 0.147347) < 1e-3,
        `V(collector) ${one.vc} with params.model = 'shockley', expected ngspice's 0.147347`);
});

test('a cutoff NPN carries no current in either model', () => {
    // The other end of the range: with the base tied to the emitter, both
    // models must report an off transistor. An exponential that reported
    // microamps here would be wrong in the direction nobody checks.
    for (const mode of ['pwl', 'shockley']) {
        const prior = JUNCTION_ROUTING.mode;
        JUNCTION_ROUTING.mode = mode;
        try {
            const b = new BoardImpl(5);
            b.setNetlist([
                { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
                { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
                { id: 'RM', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
                { id: 'Q1', kind: 'npn', params: { part: '2N2222', beta: 200, is: 1e-14 },
                    terminals: ['base', 'collector', 'emitter'] },
            ], [
                { id: 'n_v', terminals: [{ part: 'VCC1', terminal: 'vcc' }, { part: 'RM', terminal: 'a' }] },
                { id: 'n_c', terminals: [{ part: 'RM', terminal: 'b' }, { part: 'Q1', terminal: 'collector' }] },
                { id: 'n_g', terminals: [
                    { part: 'GND1', terminal: 'gnd' },
                    { part: 'Q1', terminal: 'emitter' },
                    { part: 'Q1', terminal: 'base' },
                ]},
            ]);
            const ic = b.branchCurrent('Q1', 'collector');
            assert.ok(Math.abs(ic) < 1e-6, `${mode}: a cut-off NPN passes ${ic} A`);
            assert.ok(Math.abs(b.nodeVoltage('n_c') - 5) < 1e-3,
                `${mode}: collector at ${b.nodeVoltage('n_c')} V, expected the full rail`);
        } finally { JUNCTION_ROUTING.mode = prior; }
    }
});
