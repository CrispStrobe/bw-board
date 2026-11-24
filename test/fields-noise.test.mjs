// Room fields and junction noise (src/fields.js).
//
// Gap (2026-11-23, round 4): a bare wire on a high-gain input could not hum
// near a mains cable, a charged ruler could not light a Darlington's LED or
// hold a MOSFET gate, a finger could not inject hum, and a transistor's
// base-emitter junction had no reverse breakdown, so the classic "steam
// train" noise source was silent. Oracles: the capacitive divider and
// charge conservation for the probes, the breakdown law and the shot-noise
// formula S_i = 2·q·I·F for the junction.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { expandFields, bandNoise, breakdownCard, noiseRms, Q_E } from '../src/fields.js';

registerAllDevices();
const VT = 0.02585;
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);

/** Netlist from {id: [kind, params]} and [['id.term', …], …]. */
function board(parts, nets, vcc = 9) {
    const P = Object.entries(parts).map(([id, [kind, params]]) => ({ id, kind, params: params ?? {}, terminals: [] }));
    const N = nets.map((n, i) => ({ id: `n${i}`, terminals: n.map(s => { const [part, terminal] = s.split('.'); return { part, terminal }; }) }));
    for (const p of P) for (const n of N) for (const t of n.terminals) if (t.part === p.id && !p.terminals.includes(t.terminal)) p.terminals.push(t.terminal);
    const b = new BoardImpl(vcc);
    b.setNetlist(P, N);
    b.setPower(true);
    let tMs = 0;
    const netOf = (s) => { const [part, terminal] = s.split('.'); return b.getNets().find(n => n.terminals.some(x => x.part === part && x.terminal === terminal)).id; };
    return {
        b,
        v: (s) => b.nodeVoltages.get(netOf(s)) ?? 0,
        run(ms) {
            tMs += ms;
            b.advanceTo(BigInt(Math.round(tMs * 1e6)));
            assert.equal(b.transientAnalysisStatus().failure, null, `solver failed by ${tMs} ms`);
        },
        trace(ms, stepMs, fn) {
            const out = [];
            const end = tMs + ms;
            while (tMs < end - 1e-9) { this.run(stepMs); out.push([tMs, fn()]); }
            return out;
        },
    };
}
const rms = (tr) => {
    const m = tr.reduce((a, [, v]) => a + v, 0) / tr.length;
    return Math.sqrt(tr.reduce((a, [, v]) => a + (v - m) ** 2, 0) / tr.length);
};
/** Amplitude of the `hz` component of a [[tMs, v], …] trace (one-bin DFT). */
const amplitude = (tr, hz) => {
    let re = 0, im = 0;
    for (const [t, v] of tr) { re += v * Math.cos(2 * Math.PI * hz * t / 1000); im += v * Math.sin(2 * Math.PI * hz * t / 1000); }
    return 2 * Math.hypot(re, im) / tr.length;
};

describe('fields: untouched circuits', () => {
    it('a circuit without probes or breakdown params passes through unchanged', () => {
        const parts = [{ id: 'Q', kind: 'npn', params: { beta: 100 }, terminals: ['base', 'collector', 'emitter'] }];
        const nets = [{ id: 'a', terminals: [{ part: 'Q', terminal: 'base' }] }];
        const out = expandFields(parts, nets);
        assert.equal(out.parts, parts);
        assert.equal(out.nets, nets);
        assert.equal(out.fields, null);
        const x = board({ bat: ['battery', { volts: 9 }], g: ['gnd'], r: ['resistor', { ohms: 1000 }] },
            [['bat.pos', 'r.a'], ['bat.neg', 'g.gnd', 'r.b']]);
        assert.equal(x.b.fieldReport(), null);
    });
});

describe('fields: band-limited noise', () => {
    it('is deterministic, unit variance, and decorrelated beyond one sample', () => {
        const rate = 1000;
        let s2 = 0, lag = 0, n = 0;
        for (let t = 0; t < 20; t += 1e-4) {
            const v = bandNoise(42, t, rate);
            s2 += v * v; lag += v * bandNoise(42, t + 3 / rate, rate); n++;
        }
        close(Math.sqrt(s2 / n), 1, 0.03, 'rms of unit noise');
        assert.ok(Math.abs(lag / s2) < 0.03, `correlation three samples apart: ${lag / s2}`);
        assert.equal(bandNoise(42, 0.123, rate), bandNoise(42, 0.123, rate));
        assert.notEqual(bandNoise(42, 0.123, rate), bandNoise(43, 0.123, rate));
    });
});

describe('fields: base-emitter junction in reverse breakdown', () => {
    const noiseBench = (qParams) => board(
        { bat: ['battery', { volts: 9, rInternal: 0 }], g: ['gnd'], r: ['resistor', { ohms: 47000 }], q: ['npn', { beta: 200, ...qParams }] },
        [['bat.pos', 'r.a'], ['r.b', 'q.emitter'], ['bat.neg', 'g.gnd', 'q.base']]);

    it('breaks down at bvEbo: the breakdown law against the supply resistor', () => {
        const x = noiseBench({ bvEbo: 7.5, noise: false });
        x.run(2);
        const ve = x.v('q.emitter');
        const i = (9 - ve) / 47000;
        // I = ibv·e^{(vr − bv)/Vt}, ibv = 10 µA: solve the two together.
        close(ve, 7.5 + VT * Math.log(i / 10e-6), 1e-3, 'emitter voltage on the breakdown law');
        close(i * 1e6, 31.3, 0.5, 'breakdown current (µA)');
        // Without bvEbo the junction blocks and the emitter sits at the supply.
        const y = noiseBench({});
        y.run(2);
        assert.ok(y.v('q.emitter') > 8.99, `no breakdown without bvEbo: ${y.v('q.emitter')}`);
    });

    it('carries shot noise times F: σv = √(2qIF·B)·(Vt/I ‖ R)', () => {
        const x = noiseBench({ bvEbo: 7.5 });
        x.run(5);
        const tr = x.trace(40, 0.05, () => x.v('q.emitter'));
        const rep = x.b.fieldReport().junctions[0];
        const card = breakdownCard({ id: 'q', kind: 'npn', params: { bvEbo: 7.5 } });
        const I = rep.amps;
        close(I * 1e6, 31.3, 0.5, 'smoothed breakdown current (µA)');
        close(rep.noiseAmpsRms, noiseRms(card, I), 1e-12, 'reported noise current');
        close(noiseRms(card, I), Math.sqrt(2 * Q_E * I * 1e7 * 2500), 1e-12, 'S_i = 2qIF over 2.5 kHz');
        const rd = VT / I;
        const expect = noiseRms(card, I) * rd * 47000 / (rd + 47000);
        const got = rms(tr);
        assert.ok(got > 0.75 * expect && got < 1.25 * expect, `noise at the emitter: ${(got * 1e3).toFixed(3)} mV rms, expected ${(expect * 1e3).toFixed(3)} mV`);
        assert.ok(x.b.transientAnalysisStatus().stepBound.basis.includes('field-noise-fidelity'));
    });

    it('reproduces exactly, follows the seed, and is gone with noise: false', () => {
        const run = (p) => { const x = noiseBench({ bvEbo: 7.5, ...p }); x.run(2); return x.trace(5, 0.1, () => x.v('q.emitter')).map(([, v]) => v); };
        const a = run({}), b = run({});
        assert.deepEqual(a, b, 'same seed, same noise');
        const c = run({ noiseSeed: 12345 });
        assert.notDeepEqual(a, c, 'another seed, other noise');
        const quiet = run({ noise: false });
        const spread = Math.max(...quiet) - Math.min(...quiet);
        assert.ok(spread < 1e-6, `noise: false is quiet: ${spread} V`);
    });

    it('a diode with bv breaks down cathode-positive the same way', () => {
        const x = board({ bat: ['battery', { volts: 9, rInternal: 0 }], g: ['gnd'], r: ['resistor', { ohms: 47000 }], d: ['diode', { bv: 6, noise: false }] },
            [['bat.pos', 'r.a'], ['r.b', 'd.cathode'], ['bat.neg', 'g.gnd', 'd.anode']]);
        x.run(2);
        const v = x.v('d.cathode');
        close(v, 6 + VT * Math.log(((9 - v) / 47000) / 10e-6), 1e-3, 'cathode on the breakdown law');
    });
});

describe('fields: mains hum on a bare wire', () => {
    const humBench = (position, extra = {}) => board(
        { bat: ['battery', { volts: 9 }], g: ['gnd'], r: ['resistor', { ohms: 1e6 }], pr: ['field_probe', { source: 'mains', position, ...extra }] },
        [['pr.a', 'r.a'], ['bat.neg', 'g.gnd', 'r.b'], ['bat.pos']]);
    // The divider, with the room's earth as reference: the mains at e
    // through the coupling x·2 pF into the probe; from the probe the stray
    // 5 pF back to earth, in parallel with 1 MΩ to the circuit common and the
    // common's 50 pF to earth. Complex impedances at f.
    const expectHum = (x, volts = 230, hz = 50) => {
        const w = 2 * Math.PI * hz;
        const zc = (c) => [0, -1 / (w * c)];
        const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
        const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
        const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
        const par = (a, b) => div(mul(a, b), add(a, b));
        const zr = add([1e6, 0], zc(50e-12));
        const zp = par(zc(5e-12), zr);
        const i = div([volts * Math.SQRT2, 0], add(zc(x * 2e-12), zp));
        const ir = div(mul(i, zp), zr);
        return Math.hypot(...ir) * 1e6;
    };
    it('hums at 50 Hz in proportion to how close the cable is', () => {
        for (const pos of [0.25, 1]) {
            const x = humBench(pos);
            x.run(40);
            const a = amplitude(x.trace(40, 0.1, () => x.v('pr.a')), 50);
            close(a / expectHum(pos), 1, 0.02, `hum at position ${pos} against the divider`);
        }
        const far = humBench(0);
        far.run(20);
        assert.ok(amplitude(far.trace(20, 0.1, () => far.v('pr.a')), 50) < 1e-6, 'far from the cable: no hum');
    });

    it('a 60 Hz, 120 V supply hums at 60 Hz, scaled', () => {
        const x = humBench(1, { mainsVolts: 120, mainsHz: 60 });
        x.run(40);
        const tr = x.trace(50, 0.1, () => x.v('pr.a'));
        close(amplitude(tr, 60) / expectHum(1, 120, 60), 1, 0.02, '60 Hz hum against its divider');
    });

    it('the knob is a control; moving it takes the hand its time', () => {
        const x = humBench(0);
        assert.ok(x.b.getControls().some(c => c.id === 'pr' && c.kind === 'field_probe' && c.value === 0));
        x.run(5);
        x.b.setControl('pr', 1);
        x.run(100);
        close(x.b.fieldReport().probes[0].position, 0.5, 0.01, 'halfway at half of 0.2 s');
        x.run(150);
        assert.equal(x.b.fieldReport().probes[0].position, 1);
    });
});

describe('fields: a charged ruler', () => {
    // commonFarads 1 µF: the circuit's common as good as earthed, so the
    // textbook divider holds (a floating gadget shifts as a whole: below).
    it('induces the charge C·V on a capacitor and keeps it while the ruler is held still', () => {
        const x = board({ bat: ['battery', { volts: 9 }], g: ['gnd'], c: ['capacitor', { farads: 1e-9 }], pr: ['field_probe', { source: 'charge', commonFarads: 1e-6 }] },
            [['pr.a', 'c.a'], ['bat.neg', 'g.gnd', 'c.b'], ['bat.pos']]);
        x.run(10);
        close(x.v('pr.a'), 0, 1e-5, 'no ruler, no charge');
        x.b.setControl('pr', 1);
        x.run(100);
        const mid = x.v('pr.a');
        x.run(300);
        // 0.1 pF at 10 kV is 1 nC, on 1 nF plus the probe's stray 5 pF and
        // the coupling itself.
        const expect = 10000 * 0.1e-12 / (1e-9 + 0.1e-12 + 5e-12);
        close(x.v('pr.a'), expect, 0.01 * expect, 'induced voltage, ruler close');
        assert.ok(mid > 0.4 * expect && mid < 0.6 * expect, `halfway there while the hand moves: ${mid}`);
        x.run(500);
        close(x.v('pr.a'), expect, 0.01 * expect, 'held still: the charge stays');
        x.b.setControl('pr', 0);
        x.run(400);
        close(x.v('pr.a'), 0, 0.01 * expect, 'ruler taken away: the charge goes with it');
    });

    it('a floating gadget shifts as a whole against the room: less of the charge shows', () => {
        const x = board({ bat: ['battery', { volts: 9 }], g: ['gnd'], c: ['capacitor', { farads: 1e-9 }], pr: ['field_probe', { source: 'charge' }] },
            [['pr.a', 'c.a'], ['bat.neg', 'g.gnd', 'c.b'], ['bat.pos']]);
        x.run(10);
        x.b.setControl('pr', 1);
        x.run(250);
        // Charge balance with the room's earth as reference: probe a and
        // common g, coupling Cr to the ruler at e, stray Cs (a–earth), C1
        // (a–g), the common's Cc (g–earth): v(a) − v(g) = a·Cc/(C1 + Cc).
        const [Cr, Cs, C1, Cc, e] = [0.1e-12, 5e-12, 1e-9, 50e-12, 10000];
        const a = Cr * e / (Cr + Cs + C1 - C1 * C1 / (C1 + Cc));
        const expect = a * Cc / (C1 + Cc);
        // The common's 1 TΩ leak to the room relaxes the shift only over
        // tens of seconds.
        close(x.v('pr.a'), expect, 0.01 * expect, 'floating gadget');
    });

    it('a moving ruler drives a current pulse; a negative one the other way', () => {
        for (const rodVolts of [10000, -10000]) {
            const x = board({ bat: ['battery', { volts: 9 }], g: ['gnd'], r: ['resistor', { ohms: 1e6 }], pr: ['field_probe', { source: 'charge', rodVolts, commonFarads: 1e-6 }] },
                [['pr.a', 'r.a'], ['bat.neg', 'g.gnd', 'r.b'], ['bat.pos']]);
            x.run(10);
            x.b.setControl('pr', 1);
            const tr = x.trace(300, 2, () => x.v('pr.a') / 1e6);
            // ∫i dt = the charge the ruler induced, 0.1 pF · 10 kV = 1 nC.
            let q = 0;
            for (let k = 1; k < tr.length; k++) q += 0.5 * (tr[k][1] + tr[k - 1][1]) * (tr[k][0] - tr[k - 1][0]) / 1000;
            close(q * 1e9, Math.sign(rodVolts) * 1, 0.03, `charge through 1 MΩ (nC), rod ${rodVolts} V`);
            const peak = Math.max(...tr.map(([, i]) => Math.abs(i)));
            // Raised-cosine path over 0.2 s: peak current = π/2 · Q / T.
            close(peak * 1e9, Math.PI / 2 * 1 / 0.2, 0.3, 'peak current (nA)');
        }
    });
});

describe('fields: a finger', () => {
    const fingerBench = (extra) => board(
        { bat: ['battery', { volts: 9 }], g: ['gnd'], r: ['resistor', { ohms: 1e6 }], pr: ['field_probe', { source: 'body', position: 1, ...extra }] },
        [['pr.a', 'r.a'], ['bat.neg', 'g.gnd', 'r.b'], ['bat.pos']]);

    it('touching injects the body\'s hum; a mains adaptor makes the common swing and it grows', () => {
        const hum = (extra) => { const x = fingerBench(extra); x.run(60); return amplitude(x.trace(40, 0.1, () => x.v('pr.a')), 50); };
        const w = 2 * Math.PI * 50;
        // Body EMF 325·3/153 V behind 153 pF, the common's 50 pF return in
        // series; skin 1 MΩ and the 1 MΩ load are small beside them.
        const battery = hum({});
        const expect = 325.27 * 3 / 153 / (1 / (w * 153e-12) + 1 / (w * 50e-12)) * 1e6;
        close(battery / expect, 1, 0.05, `battery-powered: ${battery.toFixed(4)} V against ${expect.toFixed(4)} V`);
        const adaptor = hum({ adaptorFarads: 1e-9 });
        assert.ok(adaptor > 20 * battery, `with a mains adaptor: ${adaptor.toFixed(3)} V against ${battery.toFixed(4)} V`);
        const off = hum({ position: 0 });
        assert.ok(off < 0.01 * battery, `not touching: ${off}`);
    });

    it('through paper the coupling is a capacitance that follows the press', () => {
        const hum = (position) => { const x = fingerBench({ contact: 'paper', adaptorFarads: 1e-9, position }); x.run(60); return amplitude(x.trace(40, 0.1, () => x.v('pr.a')), 50); };
        const full = hum(1), half = hum(0.5), off = hum(0);
        assert.ok(full > 0.05, `pressing on the paper: ${full} V`);
        // Half the paper's capacitance; in series with the body's own the
        // coupling falls by less than half.
        assert.ok(half > 0.5 * full && half < 0.8 * full, `half the press: ${half} V against ${full} V`);
        // Lifted, the input still hums a little: with the adaptor the whole
        // circuit swings against earth, through the probe's own stray 5 pF.
        assert.ok(off < full / 3, `finger lifted: ${off} V against ${full} V`);
    });
});

describe('fields: noise in a loudspeaker is reported as noise', () => {
    it('an amplified breakdown junction is irregular; a sine is not', () => {
        const amp = (src) => board({
            bat: ['battery', { volts: 9 }], g: ['gnd'], ...src.parts,
            c1: ['capacitor', { farads: 100e-9 }], q2: ['npn', { beta: 200 }], rb: ['resistor', { ohms: 1e6 }], rc: ['resistor', { ohms: 4700 }],
            c2: ['capacitor', { farads: 10e-6 }], ep: ['earphone', { type: 'magnetic' }],
        }, [...src.nets, ['bat.pos', 'rc.a'], ['c1.b', 'q2.base', 'rb.b'], ['q2.collector', 'rb.a', 'rc.b', 'c2.a'], ['c2.b', 'ep.a'],
            ['bat.neg', 'g.gnd', 'q2.emitter', 'ep.b']]);
        const noisy = amp({ parts: { r1: ['resistor', { ohms: 47000 }], qn: ['npn', { beta: 200, bvEbo: 7.5 }] },
            nets: [['bat.pos', 'r1.a'], ['r1.b', 'qn.emitter', 'c1.a'], ['g.gnd', 'qn.base']] });
        noisy.run(40);
        const t = noisy.b.buzzerTone('ep');
        assert.ok(t.on && t.noise && t.irregularity > 0.25, `noise: ${JSON.stringify(t)}`);
        const tone = amp({ parts: { s: ['vsource', { wave: 'sine', freq: 400, amplitude: 0.002, offset: 0 }] },
            nets: [['s.pos', 'c1.a'], ['s.neg', 'g.gnd']] });
        tone.run(60);
        const u = tone.b.buzzerTone('ep');
        assert.ok(u.on && !u.noise && u.irregularity < 0.05, `a tone: ${JSON.stringify(u)}`);
    });
});
