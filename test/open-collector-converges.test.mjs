// A transistor lead that leads nowhere does not break the transient.
//
// Gap (2026-11-25, r12): a 555 astable whose output drives a transistor's
// base through a resistor, with the collector connected to nothing (an empty
// breadboard strip, or a resistor / LED whose far end hangs in the air),
// failed `transient-solve-not-converged` within milliseconds. The collector
// net was a node held only by the collector-base junction; the default BJT
// carries no base-collector charge, so at each base edge that node had to
// jump by volts within one time point, further than Newton's junction limit
// goes, and no smaller step helped. The same transistor with its collector on
// no net at all solved. Such a net carries no current, so the solver view now
// treats the lead as the open lead it is (BoardImpl._openLoneTransistorLeads).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const T = (part, terminal) => ({ part, terminal });

/** 555 astable (1 k, 1 k, 100 nF: ~4.8 kHz) driving Q's base through `rbase`. */
function bench({ q = 'pnp', rbase = 47000, collector = 'lone', emitterR = 0 } = {}) {
    const parts = [P('B', 'vsource', { volts: 9 }, ['pos', 'neg']), P('G', 'gnd', {}, ['gnd']),
        P('U', 'timer_555', {}, ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset']),
        P('RA', 'resistor', { ohms: 1000 }, ['a', 'b']), P('RB', 'resistor', { ohms: 1000 }, ['a', 'b']),
        P('C', 'capacitor', { farads: 100e-9 }, ['a', 'b']), P('CV', 'capacitor', { farads: 10e-9 }, ['a', 'b']),
        P('RBASE', 'resistor', { ohms: rbase }, ['a', 'b']), P('Q', q, { beta: 100 }, ['collector', 'base', 'emitter'])];
    const gnd = [T('B', 'neg'), T('G', 'gnd'), T('U', 'gnd'), T('C', 'b'), T('CV', 'b')];
    const nets = [
        { id: 'vcc', terminals: [T('B', 'pos'), T('U', 'vcc'), T('U', 'reset'), T('RA', 'a')] },
        { id: 'dis', terminals: [T('RA', 'b'), T('RB', 'a'), T('U', 'discharge')] },
        { id: 'cap', terminals: [T('RB', 'b'), T('C', 'a'), T('U', 'threshold'), T('U', 'trigger')] },
        { id: 'cv', terminals: [T('U', 'control'), T('CV', 'a')] },
        { id: 'out', terminals: [T('U', 'output'), T('RBASE', 'a')] },
        { id: 'base', terminals: [T('RBASE', 'b'), T('Q', 'base')] },
    ];
    if (emitterR) {
        parts.push(P('RE', 'resistor', { ohms: emitterR }, ['a', 'b']));
        nets.push({ id: 'em', terminals: [T('Q', 'emitter'), T('RE', 'a')] });
        gnd.push(T('RE', 'b'));
    } else gnd.push(T('Q', 'emitter'));
    if (collector === 'lone') nets.push({ id: 'col', terminals: [T('Q', 'collector')] });
    if (collector === 'resistor' || collector === 'led') {
        parts.push(collector === 'led' ? P('X', 'led', { color: 'red' }, ['anode', 'cathode']) : P('X', 'resistor', { ohms: 1000 }, ['a', 'b']));
        nets.push({ id: 'col', terminals: [T('Q', 'collector'), T('X', collector === 'led' ? 'cathode' : 'a')] });
    }
    if (collector === 'load') {
        parts.push(P('RL', 'resistor', { ohms: 1000 }, ['a', 'b']));
        nets.push({ id: 'col', terminals: [T('Q', 'collector'), T('RL', 'a')] });
        nets[0].terminals.push(T('RL', 'b'));
    }
    nets.push({ id: 'gnd', terminals: gnd });
    const b = new BoardImpl(9);
    b.setNetlist(parts, nets);
    return b;
}

function run(b, ms) {
    let flips = 0, last = b.nodeVoltage('out') > 4.5;
    for (let us = 50; us <= ms * 1000; us += 50) {
        b.advanceTo(BigInt(us * 1000));
        assert.equal(b.transientAnalysisStatus().failure, null, `solver failed by ${us} us`);
        const h = b.nodeVoltage('out') > 4.5;
        if (h !== last) flips++;
        last = h;
    }
    return flips;
}

describe('a transistor with an open collector', () => {
    for (const [name, opts] of [
        ['PNP, collector on an empty net', { q: 'pnp', collector: 'lone' }],
        ['PNP, collector on a resistor whose far end hangs in the air', { q: 'pnp', collector: 'resistor' }],
        ['PNP, collector on an LED whose far end hangs in the air', { q: 'pnp', collector: 'led' }],
        ['PNP with an emitter resistor, collector on an empty net', { q: 'pnp', rbase: 4700, emitterR: 1000, collector: 'lone' }],
        ['NPN, collector on an empty net', { q: 'npn', rbase: 10000, collector: 'lone' }],
    ]) {
        it(`${name}: the astable runs on, 20 ms`, () => {
            const flips = run(bench(opts), 20);
            assert.ok(flips > 100, `the 555 keeps oscillating (${flips} output edges)`);
        });
    }

    it('the base still conducts: an NPN with an open collector is its base-emitter diode', () => {
        const b = bench({ q: 'npn', rbase: 10000, collector: 'lone' });
        let hi = 0;
        for (let us = 50; us <= 2000; us += 50) { b.advanceTo(BigInt(us * 1000)); hi = Math.max(hi, b.nodeVoltage('base')); }
        assert.ok(hi > 0.5 && hi < 0.9, `base clamped at a diode drop while driven: ${hi}`);
    });

    it('a collector with a real load is untouched: it still switches its load', () => {
        const b = bench({ q: 'npn', rbase: 10000, collector: 'load' });
        let lo = Infinity, hi = -Infinity;
        for (let us = 50; us <= 2000; us += 50) {
            b.advanceTo(BigInt(us * 1000));
            const v = b.nodeVoltage('col'); lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
        assert.ok(lo < 0.3 && hi > 8.9, `collector swings ${lo} .. ${hi}`);
    });
});
