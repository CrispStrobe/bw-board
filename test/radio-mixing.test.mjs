// Radio front end: products BETWEEN bands (src/radio.js _planProducts) and
// the double-balanced mixer IC (src/mixer-ic.js, part `sa612`).
//
// Gap (2026-11-24): the envelope bands carried every swing around its own
// resonance, and a junction swinging in two bands only compressed both; the
// products at the sum and difference frequencies, and the harmonics, were
// left out. So no superhet (station × local oscillator → IF tank), no
// transmitter heard at twice its frequency, no mixer IC. Oracles: the
// exponential law's Bessel expansion e^{x cos θ} = I0 + 2Σ I_k cos kθ; the
// Gilbert cell's tanh·tanh law; a product lands only where its frequency
// meets a tank (f_LO − f_station = f_IF, and the image f_LO + f_IF).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { besselRatio, mixerLoGain, mixerRfGain, mixerLoMean } from '../src/radio.js';
import { mixerCard, mixerCurrents } from '../src/mixer-ic.js';
import { i0e, i1e } from '../src/rf-bands.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);
const ms = (b, t) => b.advanceTo(BigInt(Math.round(t * 1e6)));
const bandAt = (b, netId, hz, tol = 0.03) => {
    const xs = b._radio.bandAmplitudes(netId).filter(x => Math.abs(x.hz / hz - 1) <= tol);
    return xs.length ? Math.max(...xs.map(x => x.volts)) : 0;
};
const MIXER_PINS = ['in_a', 'in_b', 'gnd', 'out_a', 'out_b', 'osc_b', 'osc_e', 'vcc'];

describe('mixing: the laws', () => {
    it('Bessel ratios I_k/I0 match the series and the recurrence on both sides of the switch-over', () => {
        // Direct: I_k(x) = Σ (x/2)^{2m+k}/(m!(m+k)!).
        const Ik = (k, x) => { let s = 0, f = 1; for (let m = 0; m < 40; m++) { if (m) f *= m; let g = 1; for (let i = 1; i <= m + k; i++) g *= i; s += (x / 2) ** (2 * m + k) / (f * g); } return s; };
        for (const x of [0.01, 0.3, 1, 2.99, 3.01, 5, 8]) for (const k of [1, 2, 3]) {
            // Series below x = 3 (exact to rounding); A&S fits above (2e-7 absolute, amplified ×5 at most by the recurrence).
            close(besselRatio(k, x), Ik(k, x) / Ik(0, x), x < 3 ? 1e-12 : 1e-5 * (Ik(k, x) / Ik(0, x)), `I${k}/I0 at ${x}`);
        }
        close(besselRatio(1, 5), i1e(5) / i0e(5), 1e-15, 'above x = 3: the scaled A&S ratio');
    });

    it('the mixer core: tanh·tanh, double balanced, gain → 4/π per LO volt-amplitude when switching', () => {
        const card = mixerCard({ params: {} });
        const at = (rf, lo) => { const [a, b] = mixerCurrents(card, { rf, lo, vcc: 6, outA: 5, outB: 5 }); return a - b; };
        assert.equal(at(0.05, 0), 0, 'no LO: nothing at the outputs');
        assert.equal(at(0, 0.1), 0, 'no RF: nothing at the outputs');
        assert.ok(at(0.01, 0.2) > 0 && at(-0.01, 0.2) < 0 && at(0.01, -0.2) < 0, 'the sign is the product of the signs');
        close(at(1e-4, 1), card.gm * 1e-4 * 0.99999, 1e-9, 'small RF, hard LO: gm·v_rf');
        close(mixerLoGain(0, 1) * 1, 4 / Math.PI, 0.02, 'switching LO fundamental');
        close(mixerLoGain(0, 1e-7), 1 / (2 * 0.02585), 1e-6, 'small LO: the slope 1/2Vt');
        close(mixerRfGain(8e-3, 1e-3, 1e-6), 8e-3, 1e-9, 'small RF: gm');
        close(mixerLoMean(0, 0.3), 0, 1e-12, 'a symmetric LO swing has no mean');
    });
});

/**
 * The mixer IC at DC: inputs driven from two voltage sources through 1 kΩ,
 * outputs into 1 kΩ to the supply.
 */
function dcMixer(vr, vl) {
    const b = new BoardImpl(6);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 6 }, ['pos', 'neg']),
        P('U', 'sa612', {}, MIXER_PINS),
        P('VR', 'vsource', { volts: vr }, ['pos', 'neg']), P('VL', 'vsource', { volts: vl }, ['pos', 'neg']),
        P('RR', 'resistor', { ohms: 1000 }, ['a', 'b']), P('RL', 'resistor', { ohms: 1000 }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['VS', 'neg'], ['U', 'gnd'], ['VR', 'neg'], ['VL', 'neg']),
        net('v', ['VS', 'pos'], ['U', 'vcc']),
        net('r', ['VR', 'pos'], ['RR', 'a']), net('ina', ['RR', 'b'], ['U', 'in_a']),
        net('l', ['VL', 'pos'], ['RL', 'a']), net('lo', ['RL', 'b'], ['U', 'osc_b']),
        net('oa', ['U', 'out_a']), net('ob', ['U', 'out_b'])]);
    b.setPower(true);
    ms(b, 0.5);
    return b;
}

describe('mixing: the mixer IC in the time domain', () => {
    it('steers its tail current between the outputs by the product of the input signs', () => {
        const vb = 0.23 * 6, vlo = 0.27 * 6;
        const d = (vr, vl) => { const b = dcMixer(vr, vl); return b.nodeVoltages.get('oa') - b.nodeVoltages.get('ob'); };
        const pp = d(vb + 0.2, vlo + 0.2), pm = d(vb + 0.2, vlo - 0.2), mp = d(vb - 0.2, vlo + 0.2), mm = d(vb - 0.2, vlo - 0.2);
        // i_a − i_b ≈ ±0.86 mA (RF 0.12 V through 1 kΩ / 1.5 kΩ against a
        // 125 mV linear range, LO hard): ±1.3 V across the 1.5 kΩ loads.
        assert.ok(pp < -1 && mm < -1, `same signs: out_a pulled down (${pp}, ${mm})`);
        assert.ok(pm > 1 && mp > 1, `opposite signs: out_b pulled down (${pm}, ${mp})`);
        close(pp, mm, 0.02, 'symmetric');
        const flat = d(vb, vlo + 0.2);
        close(flat, 0, 0.01, 'no RF: balanced');
        const st = dcMixer(vb + 0.2, vlo + 0.2).deviceStates?.get?.('U') ?? null;
        if (st) assert.ok(st.iTail > 0.9e-3, `tail current up at 6 V: ${st.iTail}`);
    });
});

/**
 * A Meissner transmitter (250 µH, C = 10 pF + 490 pF·0.3 → ~800 kHz) and a
 * receiving tank on a second rod 0.3 m away, tuned by `pos`.
 */
function txAndTank(pos) {
    const b = new BoardImpl(9);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']),
        P('LT', 'ferrite_coil', { rodHeightM: 0, couplingRatio: 0.05 }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('TCT', 'tuning_cap', { position: 0.3 }, ['a', 'b']), P('Q1', 'npn', {}, ['base', 'collector', 'emitter']),
        P('R1', 'resistor', { ohms: 47e3 }, ['a', 'b']), P('R2', 'resistor', { ohms: 10e3 }, ['a', 'b']),
        P('CB', 'capacitor', { farads: 10e-9 }, ['a', 'b']), P('RE', 'resistor', { ohms: 1000 }, ['a', 'b']),
        P('CE', 'capacitor', { farads: 1e-9 }, ['a', 'b']),
        P('LR', 'ferrite_coil', { rodHeightM: 0, linkTo: 'LT', distanceM: 0.3 }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('TCR', 'tuning_cap', { position: pos }, ['a', 'b'])],
    [net('v', ['VS', 'pos'], ['LT', 'a'], ['TCT', 'a'], ['R1', 'a']), net('col', ['Q1', 'collector'], ['LT', 'b'], ['TCT', 'b']),
        net('bias', ['R1', 'b'], ['R2', 'a'], ['CB', 'a'], ['LT', 'c2']), net('base', ['Q1', 'base'], ['LT', 'c1']),
        net('e', ['Q1', 'emitter'], ['RE', 'a'], ['CE', 'a']), net('rx', ['LR', 'b'], ['TCR', 'a']),
        net('g', ['G', 'gnd'], ['VS', 'neg'], ['R2', 'b'], ['CB', 'b'], ['CE', 'b'], ['RE', 'b'], ['LR', 'a'], ['TCR', 'b'])]);
    b.setBroadcast([]);
    b.setPower(true);
    return b;
}

describe('mixing: harmonics of a transmitter', () => {
    it('a tank tuned to twice or three times the carrier rings with the transistor\'s harmonic; between them, nothing', () => {
        // The transmitter alone first (the receiving tank parked low): its frequency.
        const ref = txAndTank(0.97);
        ms(ref, 0.5);
        const f0 = ref.radioReport().bands.reduce((a, x) => (Math.abs(x.hz - 800e3) < Math.abs(a.hz - 800e3) ? x : a)).hz;
        const tx = bandAt(ref, 'col', f0);
        assert.ok(tx > 1, `the transmitter oscillates: ${tx} V at ${(f0 / 1e3).toFixed(1)} kHz`);
        // Tune the receiving tank to n·f0 as a listener would: set it from
        // 1/(2π√LC), look where its resonance lands (strays, the link) and
        // correct once.
        const posFor = (f, k = 1) => { const c = k / ((2 * Math.PI * f) ** 2 * 250e-6); return (c - 10e-12) / 490e-12; };
        const tuned = (f) => {
            const probe = txAndTank(posFor(f));
            ms(probe, 0.01);
            const got = probe.radioReport().bands.reduce((a, x) => (Math.abs(x.hz - f) < Math.abs(a.hz - f) ? x : a)).hz;
            return posFor(f, (got / f) ** 2);
        };
        const at = (n) => { const b = txAndTank(tuned(n * f0)); ms(b, 1); return { v: bandAt(b, 'rx', n * f0, 0.02), rep: b.radioReport() }; };
        const h2 = at(2), h3 = at(3), mid = at(2.5);
        assert.ok(h2.rep.bands.some(x => x.products.some(p => p.startsWith('2×'))), `a 2nd-harmonic product planned: ${JSON.stringify(h2.rep.bands)}`);
        assert.ok(h3.rep.bands.some(x => x.products.some(p => p.startsWith('3×'))), '…and a 3rd at 3·f0');
        // A class-C collector current is a train of short pulses: rich in
        // harmonics (I_k/I0 → 1 for a large drive), the 3rd hardly below the 2nd.
        assert.ok(h2.v > 1e-3, `2·f0: the tank rings (${h2.v} V)`);
        assert.ok(h3.v > 1e-3, `3·f0: the tank rings (${h3.v} V)`);
        assert.ok(mid.v < Math.min(h2.v, h3.v) / 100, `2.5·f0: no product lands there (${mid.v} V)`);
    });
});

/** Tuning-capacitor position for f against coil L, less a fixed capacitance already across it. */
const posFor = (f, L, extra = 0) => { const c = 1 / ((2 * Math.PI * f) ** 2 * L) - extra; return (c - 10e-12) / 490e-12; };
const nearest = (xs, f) => xs.reduce((a, x) => (Math.abs(x - f) < Math.abs(a - f) ? x : a));

/**
 * A medium-wave superhet on the mixer IC: antenna → ferrite rod tuned to the
 * station, its coupling winding across the mixer's inputs; the chip's
 * oscillator a Colpitts (220 pF / 220 pF, 150 µH ‖ tuning capacitor through
 * 10 nF) above the station; out_a into the tap of a second rod tuned to the
 * IF (a tapped tank: the output's 1.5 kΩ would damp the whole winding).
 */
function superhet({ fRf = 612e3, fLo = 1067e3, fIf = 455e3, stations = [] } = {}) {
    const b = new BoardImpl(6);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 6 }, ['pos', 'neg']),
        P('ANT', 'antenna', {}, ['a']), P('E', 'earth', {}, ['earth']),
        P('L1', 'ferrite_coil', { couplingRatio: 0.1 }, ['a', 'tap', 'b', 'c1', 'c2']), P('TC1', 'tuning_cap', { position: posFor(fRf, 250e-6) }, ['a', 'b']),
        P('U', 'sa612', {}, MIXER_PINS),
        P('C1', 'capacitor', { farads: 220e-12 }, ['a', 'b']), P('C2', 'capacitor', { farads: 220e-12 }, ['a', 'b']),
        P('CK', 'capacitor', { farads: 10e-9 }, ['a', 'b']),
        P('L2', 'ferrite_coil', { henrys: 150e-6, rodHeightM: 0 }, ['a', 'tap', 'b', 'c1', 'c2']), P('TC2', 'tuning_cap', { position: posFor(fLo, 150e-6, 110e-12) }, ['a', 'b']),
        P('L3', 'ferrite_coil', { rodHeightM: 0 }, ['a', 'tap', 'b', 'c1', 'c2']), P('TC3', 'tuning_cap', { position: posFor(fIf, 250e-6) }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['VS', 'neg'], ['E', 'earth'], ['L1', 'a'], ['TC1', 'b'], ['U', 'gnd'], ['C2', 'b'], ['L2', 'a'], ['TC2', 'b']),
        net('v', ['VS', 'pos'], ['U', 'vcc'], ['L3', 'a'], ['TC3', 'b']),
        net('ant', ['ANT', 'a'], ['L1', 'tap']), net('rf', ['L1', 'b'], ['TC1', 'a']),
        net('ina', ['L1', 'c1'], ['U', 'in_a']), net('inb', ['L1', 'c2'], ['U', 'in_b']),
        net('ob', ['U', 'osc_b'], ['C1', 'a'], ['CK', 'a']), net('oe', ['U', 'osc_e'], ['C1', 'b'], ['C2', 'a']),
        net('lo', ['CK', 'b'], ['L2', 'b'], ['TC2', 'a']),
        net('oa', ['U', 'out_a'], ['L3', 'tap']), net('if', ['L3', 'b'], ['TC3', 'a']), net('outb', ['U', 'out_b'])]);
    b.setBroadcast(stations);
    b.setPower(true);
    return b;
}

describe('mixing: a superhet on the mixer IC', () => {
    it('station × local oscillator lands in the IF tank only when f_LO − f_station meets it; the image gets through weakened', () => {
        // Where the oscillator and the two tanks land (the chip's input load
        // and the transistor's capacitances pull them a per cent or two).
        const probe = superhet();
        ms(probe, 0.3);
        const hz = probe.radioReport().bands.map(x => x.hz);
        const fLo = nearest(hz, 1067e3), fIf = nearest(hz, 455e3), fTank = nearest(hz, 612e3);
        assert.ok(bandAt(probe, 'lo', fLo, 0.001) > 1, 'the chip\'s oscillator runs');
        // The station where the IF wants it, the aerial tank retuned onto it.
        const fs = fLo - fIf;
        const run = (hz) => {
            const b = superhet({ fRf: 612e3 * fs / fTank, stations: [{ id: 's', hz, fieldVPerM: 0.01, depth: 0.5, audio: { type: 'tone', hz: 1000 } }] });
            ms(b, 1);
            return b;
        };
        const on = run(fs), off = run(fs + 20e3), image = run(fLo + fIf);
        const vOn = bandAt(on, 'if', fIf, 0.001), vOff = bandAt(off, 'if', fIf, 0.001), vImg = bandAt(image, 'if', fIf, 0.001);
        assert.ok(on.radioReport().bands.find(x => Math.abs(x.hz - fIf) < 1).products.length > 0, 'products planned into the IF band');
        // MEASURED 2026-11-24 (macOS): on 0.48 V, 20 kHz off 7.9e-6 V (noise), image 7.9e-3 V.
        assert.ok(vOn > 0.1, `aligned: the IF tank carries the station (${vOn} V)`);
        assert.ok(vOff < vOn / 1000, `20 kHz off: outside the IF tank (${vOff} V)`);
        assert.ok(vImg > 100 * vOff && vImg < vOn / 10, `the image (f_LO + f_IF) mixes into the IF too, weakened by the aerial tank (${vImg} V)`);
    });
});

/**
 * Direct conversion: an untuned wire into in_a (100 pF), in_b bypassed, the
 * chip's Colpitts oscillator near the station; out_a through its 1.5 kΩ into
 * 22 nF (the audio).
 */
function directConversion(stations) {
    const b = new BoardImpl(6);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 6 }, ['pos', 'neg']),
        P('ANT', 'antenna', {}, ['a']), P('E', 'earth', {}, ['earth']), P('CA', 'capacitor', { farads: 100e-12 }, ['a', 'b']),
        P('U', 'sa612', {}, MIXER_PINS), P('CB', 'capacitor', { farads: 100e-9 }, ['a', 'b']),
        P('C1', 'capacitor', { farads: 220e-12 }, ['a', 'b']), P('C2', 'capacitor', { farads: 220e-12 }, ['a', 'b']),
        P('CK', 'capacitor', { farads: 10e-9 }, ['a', 'b']),
        P('L2', 'ferrite_coil', { henrys: 150e-6, rodHeightM: 0 }, ['a', 'tap', 'b', 'c1', 'c2']), P('TC2', 'tuning_cap', { position: 0.1 }, ['a', 'b']),
        P('CO', 'capacitor', { farads: 22e-9 }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['VS', 'neg'], ['E', 'earth'], ['U', 'gnd'], ['C2', 'b'], ['L2', 'a'], ['TC2', 'b'], ['CB', 'b'], ['CO', 'b']),
        net('v', ['VS', 'pos'], ['U', 'vcc']),
        net('ant', ['ANT', 'a'], ['CA', 'a']), net('ina', ['CA', 'b'], ['U', 'in_a']), net('inb', ['U', 'in_b'], ['CB', 'a']),
        net('ob', ['U', 'osc_b'], ['C1', 'a'], ['CK', 'a']), net('oe', ['U', 'osc_e'], ['C1', 'b'], ['C2', 'a']),
        net('lo', ['CK', 'b'], ['L2', 'b'], ['TC2', 'a']),
        net('oa', ['U', 'out_a'], ['CO', 'a']), net('outb', ['U', 'out_b'])]);
    b.setBroadcast(stations);
    b.setPower(true);
    return b;
}

describe('mixing: the mixer IC as a direct-conversion receiver', () => {
    it('a carrier near its oscillator comes out as their difference tone; no carrier, no tone', () => {
        const swing = (stations) => {
            const b = directConversion(stations);
            ms(b, 1);
            const xs = [], ph = [];
            const node = b._radio._sys.builder.nodeIndex.get('lo');
            for (let i = 0; i <= 500; i++) {
                ms(b, 1 + i * 0.002);
                xs.push(b.nodeVoltages.get('oa'));
                const X = b._radio._bands[0].X;
                ph.push(Math.atan2(X.im[node], X.re[node]));
            }
            const mid = xs.reduce((a, x) => a + x, 0) / xs.length;
            let zc = 0;
            for (let i = 1; i < xs.length; i++) if ((xs[i - 1] - mid) * (xs[i] - mid) < 0) zc++;
            // The oscillation's rotation in the band's frame (centred on the
            // carrier when there is one): unwrapped phase over the millisecond.
            let turn = 0;
            for (let i = 1; i < ph.length; i++) { let d = ph[i] - ph[i - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn += d; }
            return { pp: Math.max(...xs) - Math.min(...xs), hz: zc / 2 / 1e-3, osc: Math.abs(turn) / (2 * Math.PI) / 1e-3 };
        };
        // The oscillator runs ~1001 kHz (its tank's 989 kHz pulled up by the
        // transistor): a carrier 1.5 kHz above it.
        const quiet = swing([]);
        const tone = swing([{ id: 'c', hz: 1002.5e3, fieldVPerM: 0.005, depth: 0, audio: { type: 'none' } }]);
        assert.ok(tone.osc > 500 && tone.osc < 3000, `the oscillation sits ${tone.osc} Hz from the carrier`);
        // MEASURED 2026-11-24 (macOS, 47 nF probe): ±50 mV at 1.33 kHz with the carrier.
        assert.ok(tone.pp > 0.03, `the beat at out_a: ${tone.pp} V peak-to-peak`);
        assert.ok(quiet.pp < tone.pp / 5, `no carrier: no tone (${quiet.pp} V)`);
        close(tone.hz, tone.osc, 0.15 * tone.osc, 'the tone is the difference frequency');
    });
});
