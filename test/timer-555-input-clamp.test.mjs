// A 555's inputs are clamped to its rails.
//
// Gap (2026-11-25, r12): the 555's trigger, threshold and reset inputs drew
// nothing at any voltage, so an unguarded trigger lead hanging on 22 MOhm
// beside a mains cable swung from about -8 V to +26 V on a 9 V supply. A real
// 555 cannot do that: the bipolar NE555's input transistors and the die's
// substrate junction (and a CMOS 555's ESD diodes) conduct as soon as a pin
// goes a diode drop beyond a rail. The model now carries those junctions as a
// diode from each input up to VCC and one from GND up to each input
// (`params.inputClamps: false` removes them).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

function board(parts, nets, vcc = 9) {
    const P = Object.entries(parts).map(([id, [kind, params]]) => ({ id, kind, params: params ?? {}, terminals: [] }));
    const N = nets.map((n, i) => ({ id: `n${i}`, terminals: n.map(s => { const [part, terminal] = s.split('.'); return { part, terminal }; }) }));
    for (const p of P) for (const n of N) for (const t of n.terminals) if (t.part === p.id && !p.terminals.includes(t.terminal)) p.terminals.push(t.terminal);
    const b = new BoardImpl(vcc);
    b.setNetlist(P, N);
    b.setPower(true);
    let tMs = 0;
    const netOf = (s) => { const [part, terminal] = s.split('.'); return b.getNets().find(n => n.terminals.some(x => x.part === part && x.terminal === terminal)).id; };
    const api = {
        b,
        v: (s) => b.nodeVoltages.get(netOf(s)) ?? 0,
        run(ms) {
            tMs += ms;
            b.advanceTo(BigInt(Math.round(tMs * 1e6)));
            assert.equal(b.transientAnalysisStatus().failure, null, `solver failed by ${tMs} ms`);
        },
        span(s, ms, stepMs) {
            let lo = Infinity, hi = -Infinity;
            const end = tMs + ms;
            while (tMs < end - 1e-9) { api.run(stepMs); const v = api.v(s); lo = Math.min(lo, v); hi = Math.max(hi, v); }
            return { lo, hi };
        },
    };
    return api;
}

/** A 555 monostable (100 k, 22 uF) whose trigger hangs on 22 MOhm beside a mains cable. */
const touchTimer = (u = {}) => board({
    bat: ['vsource', { volts: 9 }], g: ['gnd'], u: ['timer_555', u], rt: ['resistor', { ohms: 100000 }],
    ct: ['capacitor', { farads: 22e-6 }], cv: ['capacitor', { farads: 10e-9 }], rpu: ['resistor', { ohms: 22e6 }],
    pr: ['field_probe', { source: 'mains', position: 1, maxFarads: 10e-12 }], rl: ['resistor', { ohms: 1000 }],
}, [
    ['bat.pos', 'u.vcc', 'u.reset', 'rt.a', 'rpu.a'], ['rt.b', 'u.threshold', 'u.discharge', 'ct.a'], ['u.control', 'cv.a'],
    ['u.trigger', 'rpu.b', 'pr.a'], ['u.output', 'rl.a'],
    ['bat.neg', 'g.gnd', 'u.gnd', 'ct.b', 'cv.b', 'rl.b'],
]);

/** A 555 input driven through 10 kOhm from a source of `volts`. */
const driven = (pin, volts, u = {}) => board({
    bat: ['vsource', { volts: 9 }], g: ['gnd'], u: ['timer_555', u], src: ['vsource', { volts }], r: ['resistor', { ohms: 10000 }],
    ra: ['resistor', { ohms: 10000 }], c: ['capacitor', { farads: 100e-9 }],
}, [
    ['bat.pos', 'u.vcc', 'ra.a', ...(pin === 'reset' ? [] : ['u.reset'])], ['src.pos', 'r.a'], ['r.b', `u.${pin}`],
    ...(pin === 'trigger' ? [['ra.b', 'u.threshold', 'u.discharge', 'c.a']] : pin === 'threshold'
        ? [['ra.b', 'u.trigger', 'u.discharge', 'c.a']] : [['ra.b', 'u.threshold', 'u.trigger', 'u.discharge', 'c.a']]),
    ['bat.neg', 'g.gnd', 'u.gnd', 'src.neg', 'c.b'],
]);

describe('555: input clamps', () => {
    it('an unguarded trigger beside a mains cable stays within a diode drop of the rails', () => {
        const x = touchTimer();
        x.run(20);
        const s = x.span('u.trigger', 100, 0.25);
        assert.ok(s.lo > -0.9 && s.lo < -0.2, `trigger bottom clamped near -0.5 V: ${s.lo}`);
        assert.ok(s.hi < 9.9 && s.hi > 9.2, `trigger top clamped near 9.5 V: ${s.hi}`);
    });

    it('the hum still swings it below a third of the supply: the timer fires on its own', () => {
        const x = touchTimer();
        x.run(20);
        let fired = false;
        for (let i = 0; i < 400 && !fired; i++) { x.run(0.25); fired = x.v('u.output') > 4.5; }
        assert.ok(fired, 'the hum triggers the monostable');
    });

    it('inputClamps: false keeps the bare, unclamped input', () => {
        const x = touchTimer({ inputClamps: false });
        x.run(20);
        const s = x.span('u.trigger', 60, 0.25);
        assert.ok(s.lo < -3 && s.hi > 12, `unclamped: ${s.lo} .. ${s.hi}`);
    });

    for (const pin of ['trigger', 'threshold', 'reset']) {
        it(`${pin}: pulled 5 V below ground through 10 kOhm it stops a diode drop down, and inside the rails it draws nothing`, () => {
            const lo = driven(pin, -5);
            lo.run(1);
            const v = lo.v(`u.${pin}`);
            assert.ok(v > -0.8 && v < -0.4, `${pin} clamped at ${v}`);
            const hi = driven(pin, 15);
            hi.run(1);
            const vh = hi.v(`u.${pin}`);
            assert.ok(vh > 9.4 && vh < 9.8, `${pin} clamped above VCC at ${vh}`);
            const mid = driven(pin, 4);
            mid.run(1);
            assert.ok(Math.abs(mid.v(`u.${pin}`) - 4) < 1e-4, `${pin} at 4 V draws nothing: ${mid.v(`u.${pin}`)}`);
        });
    }
});
