// Radio front end, round 7 (src/radio.js, src/fm-if-ic.js): the VHF
// receiver's IF chain (ceramic filter, FM IF IC), a half-wave dipole, a
// winding slid along the rod, links between any two RF coils, and the RF a
// coil radiates when its current is switched (impulse radiation).
//
// Gap (2026-11-24): no part could carry a 10.7 MHz IF (no ceramic filter, no
// limiter / quadrature detector), the only directional antenna was the
// ferrite rod, only two rods could be linked, and a coil's switched current
// radiated nothing (no spark transmitter). Oracles: the two-pole Butterworth
// band-pass (−3 dB at ±B/2); the quadrature detector's atan(2QΔf/f0); a
// dipole's cos(turn − bearing); L = L1 + L2 ± 2M for series windings; the
// near field's 1/d³; a step's flat spectrum (it rings every tuning).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { fmDetector, fmIfCard } from '../src/fm-if-ic.js';
import { slideFactors } from '../src/radio.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);
const ms = (b, t) => b.advanceTo(BigInt(Math.round(t * 1e6)));
const now = (b) => Number(b.timeNs) / 1e9;
const peak = (b, netId) => Math.max(0, ...b._radio.bandAmplitudes(netId, now(b)).map(x => x.volts));

/** A 330 Ω source (antenna) into the ceramic filter, its output into the FM IF IC; audio out into 10 nF. */
function ifStrip(stations, quad) {
    const b = new BoardImpl(6);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 6 }, ['pos', 'neg']),
        P('ANT', 'antenna', { heightM: 0.01, ohms: 330, farads: 1e-9 }, ['a']), P('E', 'earth', {}, ['earth']),
        P('F', 'ceramic_filter', {}, ['in', 'gnd', 'out']), P('U', 'fm_if', {}, ['in', 'gnd', 'vcc', 'out']),
        P('CO', 'capacitor', { farads: 10e-9 }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['VS', 'neg'], ['E', 'earth'], ['F', 'gnd'], ['U', 'gnd'], ['CO', 'b']), net('v', ['VS', 'pos'], ['U', 'vcc']),
        net('ant', ['ANT', 'a'], ['F', 'in']), net('fo', ['F', 'out'], ['U', 'in']), net('aud', ['U', 'out'], ['CO', 'a'])]);
    if (quad !== undefined) b.setControl('U', quad);
    b.setBroadcast(stations);
    b.setPower(true);
    return b;
}

describe('VHF IF: the ceramic filter', () => {
    it('passes ±100 kHz around 10.7 MHz, is down 3 dB near ±140 kHz and ~25 dB at ±600 kHz', () => {
        const offs = [-600e3, -100e3, 0, 100e3, 600e3];
        const b = ifStrip(offs.map((o, i) => ({ id: `s${i}`, hz: 10.7e6 + o, fieldVPerM: 0.01, depth: 0, audio: { type: 'none' } })));
        ms(b, 0.05);
        const v = b.rfVoltage('fo').map(x => x.volts);
        const c = v[2];
        // MEASURED 2026-11-24: 0.06, 0.83, 1, 0.92, 0.06 of the centre (the
        // design is a Butterworth pair: 0.89 at ±100 kHz, 0.054 at ±600 kHz).
        assert.ok(v[1] / c > 0.75 && v[3] / c > 0.75, `±100 kHz in the passband: ${v[1] / c}, ${v[3] / c}`);
        assert.ok(v[0] / c < 0.1 && v[4] / c < 0.1, `±600 kHz stopped: ${v[0] / c}, ${v[4] / c}`);
        assert.ok(b.radioReport().bands.some(x => Math.abs(x.hz - 10.7e6) < 200e3), 'its passband is a band of the envelope solver');
    });
});

describe('VHF IF: the FM IF IC', () => {
    it('limits and detects: an FM station\'s tone at the output, silence without; the detector law', () => {
        const card = fmIfCard({ params: {} });
        close(fmDetector(card, 10.7e6, 10.7e6 + 75e3, 1), Math.atan(2 * 20 * 75e3 / 10.7e6), 1e-6, 'atan(2QΔf/f0) above the limiting threshold');
        close(fmDetector(card, 10.7e6, 10.7e6 + 75e3, 30e-6) / fmDetector(card, 10.7e6, 10.7e6 + 75e3, 1), 0.5, 1e-6, 'half at the threshold');
        const audio = (stations, quad) => {
            const b = ifStrip(stations, quad);
            ms(b, 1);
            const xs = [];
            for (let i = 0; i <= 100; i++) { ms(b, 1 + i * 0.01); xs.push(b.nodeVoltages.get('aud')); }
            return { pp: Math.max(...xs) - Math.min(...xs), mean: xs.reduce((a, x) => a + x, 0) / xs.length };
        };
        const fm = audio([{ id: 'fm', hz: 10.7e6, mod: 'fm', deviationHz: 75e3, fieldVPerM: 0.01, audio: { type: 'tone', hz: 1000 } }]);
        const none = audio([]);
        // MEASURED 2026-11-24: 0.354 V peak-to-peak (±0.27 rad, the 5 kΩ / 10 nF output filter), nothing without.
        assert.ok(fm.pp > 0.25, `75 kHz deviation: ${fm.pp} V peak-to-peak`);
        assert.ok(none.pp < 0.01, `no station: ${none.pp} V`);
        close(none.mean, 3, 0.01, 'the output rests at half the supply');
        // The quadrature tank 75 kHz high (knob 0.75): an unmodulated carrier
        // on the IF now reads −atan(2Q·75k/10.775M) = −0.27 V.
        // A strong carrier (0.5 mV at the chip, past the limiting threshold).
        const carrier = [{ id: 'c', hz: 10.7e6, fieldVPerM: 0.1, depth: 0, audio: { type: 'none' } }];
        const mis = audio(carrier, 0.75), ali = audio(carrier, 0.5);
        close(ali.mean, 3, 0.02, 'aligned: the carrier reads zero');
        close(mis.mean - ali.mean, -Math.atan(2 * 20 * 75e3 / 10.775e6), 0.03, 'mis-aligned quadrature tank: the S-curve\'s offset');
    });
});

describe('a half-wave dipole', () => {
    it('picks a station up with cos(turn − bearing): broadside full, end-on nothing, both sides alike', () => {
        const at = (turn) => {
            const b = new BoardImpl(5);
            b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('D', 'dipole', {}, ['a', 'b']), P('R', 'resistor', { ohms: 300 }, ['a', 'b'])],
                [net('a', ['D', 'a'], ['R', 'a']), net('g', ['G', 'gnd'], ['D', 'b'], ['R', 'b'])]);
            b.setControl('D', turn);
            b.setBroadcast([{ id: 'fm', hz: 98e6, fieldVPerM: 0.01, bearingDeg: 0, depth: 0, audio: { type: 'none' } }]);
            b.setPower(true);
            ms(b, 0.01);
            return b.rfVoltage('a')[0].volts;
        };
        const v0 = at(0), v90 = at(0.25), v180 = at(0.5), v60 = at(60 / 360);
        close(v0, 0.01 * 0.95 / 2, 1e-6, 'broadside: E·h/2 into a matched 300 Ω');
        assert.ok(v90 < v0 * 1e-6, `end-on: a null (${v90})`);
        close(v180, v0, 1e-9, 'turned half round: the same (two-sided)');
        close(v60 / v0, 0.5, 1e-6, 'cos 60°');
    });
});

/** A rod with its two windings in series (b to c1 or to c2) tuned by 200 pF; `slide` the small winding's position. */
function seriesWindings(join, slide = 0) {
    const b = new BoardImpl(5);
    const other = join === 'c1' ? 'c2' : 'c1';
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('L', 'ferrite_coil', { rodHeightM: 0, couplingRatio: 0.3, slideWinding: true }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('C', 'capacitor', { farads: 200e-12 }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['L', 'a'], ['C', 'b']), net('j', ['L', 'b'], ['L', join]), net('top', ['L', other], ['C', 'a'])]);
    b.setControl('L', slide);
    b.setBroadcast([]);
    b.setPower(true);
    ms(b, 0.01);
    return b.radioReport().bands.map(x => x.hz);
}

describe('the ferrite rod: windings in series and a sliding winding', () => {
    it('series aiding / opposing: L = L1 + L2 ± 2M; sliding the small winding to the end lowers it', () => {
        const fAid = seriesWindings('c1')[0], fOpp = seriesWindings('c2')[0];
        // L1 = 250 µH, L2 = 0.09·L1, M = 0.9·0.3·L1: 1.63·L1 against 0.55·L1.
        close(fOpp / fAid, Math.sqrt((1 + 0.09 + 0.54) / (1 + 0.09 - 0.54)), 0.02, 'resonance ratio opposing / aiding');
        const fEnd = seriesWindings('c1', 1)[0];
        const sf = slideFactors(1);
        const lEnd = 1 + 0.09 * sf.self + 2 * 0.9 * sf.coupling * Math.sqrt(0.09 * sf.self);
        close(fEnd / fAid, Math.sqrt((1 + 0.09 + 0.54) / lEnd), 0.02, 'slid to the end: less inductance, a higher resonance');
    });
});

/** A station received by a VHF tank, and a second VHF tank linked to the first at d metres. */
function vhfPair(d) {
    const b = new BoardImpl(5);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('ANT', 'antenna', { heightM: 0.5, farads: 2e-12 }, ['a']), P('E', 'earth', {}, ['earth']),
        P('L1', 'vhf_coil', {}, ['a', 'b']), P('C1', 'capacitor', { farads: 17.6e-12 }, ['a', 'b']),
        P('L2', 'vhf_coil', { linkTo: 'L1', distanceM: d }, ['a', 'b']), P('C2', 'capacitor', { farads: 17.6e-12 }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['E', 'earth'], ['L1', 'a'], ['C1', 'b'], ['L2', 'a'], ['C2', 'b']),
        net('t1', ['ANT', 'a'], ['L1', 'b'], ['C1', 'a']), net('t2', ['L2', 'b'], ['C2', 'a'])]);
    b.setBroadcast([{ id: 'fm', hz: 98e6, fieldVPerM: 0.05, depth: 0, audio: { type: 'none' } }]);
    b.setPower(true);
    ms(b, 0.05);
    return b.rfVoltage('t2')[0].volts / b.rfVoltage('t1')[0].volts;
}

describe('links between any two RF coils', () => {
    it('two VHF coils couple in the near field: twice as far, an eighth', () => {
        const near = vhfPair(0.1), far = vhfPair(0.2);
        assert.ok(near > 0, 'the second tank receives through the first');
        close(near / far, 8, 0.4, 'near field ∝ 1/d³');
    });
});

/**
 * A switched coil: 9 V through 47 Ω and an untuned rod, broken by a switch
 * (the current's collapse is the spark); a crystal set on a second rod `d`
 * metres away, tuned by `pos` (a bare tank: linear, so the near field's
 * law shows undistorted by a detector's loading).
 */
function sparkPair(pos, d = 0.3) {
    const b = new BoardImpl(9);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']), P('RS', 'resistor', { ohms: 47 }, ['a', 'b']),
        P('S', 'switch', {}, ['a', 'b']), P('LT', 'ferrite_coil', { rodHeightM: 0 }, ['a', 'tap', 'b', 'c1', 'c2']),
        P('LR', 'ferrite_coil', { rodHeightM: 0, linkTo: 'LT', distanceM: d }, ['a', 'tap', 'b', 'c1', 'c2']), P('TC', 'tuning_cap', { position: pos }, ['a', 'b'])],
    [net('v', ['VS', 'pos'], ['RS', 'a']), net('c', ['RS', 'b'], ['S', 'a']), net('s', ['S', 'b'], ['LT', 'b']),
        net('rx', ['LR', 'b'], ['TC', 'a']), net('g', ['G', 'gnd'], ['VS', 'neg'], ['LT', 'a'], ['LR', 'a'], ['TC', 'b'])]);
    b.setControl('S', 1);
    b.setBroadcast([]);
    b.setPower(true);
    return b;
}

describe('impulse radiation: a switched coil current rings every tuned receiver', () => {
    it('breaking the current rings the receiving tank at any tuning; the near field falls with distance', () => {
        const ring = (pos, d) => {
            const b = sparkPair(pos, d);
            // The switch-on ring (closed from the start) has died away by 0.8 ms.
            ms(b, 0.8);
            const before = peak(b, 'rx');
            b.setControl('S', 0);
            let m = 0;
            for (let i = 1; i <= 40; i++) { ms(b, 0.8 + i * 0.001); m = Math.max(m, peak(b, 'rx')); }
            return { before, m };
        };
        const lo = ring(0.6, 0.3), hi = ring(0.1, 0.3), far = ring(0.6, 0.6);
        assert.ok(lo.before < 1e-3, `steady current: nothing (${lo.before} V)`);
        assert.ok(lo.m > 1000 * lo.before && hi.m > 1000 * hi.before, `both tunings ring: ${lo.m} V, ${hi.m} V`);
        close(lo.m / far.m, 8, 0.8, 'twice as far: an eighth (near field)');
    });
});

describe('an LM386 on a bench with RF bands', () => {
    it('assembling the RF matrix reads its input\'s last RF drive and never steps a band (that recursed)', () => {
        // Gap (2026-11-25, found building a remote-control receiver): the
        // matrix assembly stamps the LM386's small-signal view, which reads
        // its input junction's RF drive; that advanced the bands, whose step
        // control re-assembles the matrix: advanceTo → _kForBias → _modes →
        // _Y → lm386 stamp → junctionDrive → advanceTo … → stack overflow, at
        // the first knob move or on any oscillating band.
        const b = new BoardImpl(9);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']),
            P('L1', 'ferrite_coil', { rodHeightM: 0, couplingRatio: 0.05 }, ['a', 'tap', 'b', 'c1', 'c2']),
            P('TC', 'tuning_cap', { position: 0.3 }, ['a', 'b']), P('Q1', 'npn', {}, ['base', 'collector', 'emitter']),
            P('R1', 'resistor', { ohms: 47e3 }, ['a', 'b']), P('R2', 'resistor', { ohms: 10e3 }, ['a', 'b']),
            P('CB', 'capacitor', { farads: 10e-9 }, ['a', 'b']), P('RE', 'resistor', { ohms: 1000 }, ['a', 'b']), P('CE', 'capacitor', { farads: 1e-9 }, ['a', 'b']),
            P('CI', 'capacitor', { farads: 1e-9 }, ['a', 'b']), P('A', 'lm386', {}, ['gain1', 'inn', 'inp', 'gnd', 'vout', 'vs', 'bypass', 'gain8']),
            P('RS', 'resistor', { ohms: 8 }, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['VS', 'neg'], ['R2', 'b'], ['CB', 'b'], ['RE', 'b'], ['CE', 'b'], ['A', 'gnd'], ['A', 'inn'], ['RS', 'b']),
            net('v', ['VS', 'pos'], ['L1', 'a'], ['TC', 'a'], ['R1', 'a'], ['A', 'vs']), net('col', ['Q1', 'collector'], ['L1', 'b'], ['TC', 'b'], ['CI', 'a']),
            net('bias', ['R1', 'b'], ['R2', 'a'], ['CB', 'a'], ['L1', 'c2']), net('base', ['Q1', 'base'], ['L1', 'c1']), net('e', ['Q1', 'emitter'], ['RE', 'a'], ['CE', 'a']),
            net('in', ['CI', 'b'], ['A', 'inp']), net('o', ['A', 'vout'], ['RS', 'a'])]);
        b.setBroadcast([]);
        b.setPower(true);
        ms(b, 0.05);
        const r = b._radio, band = r._bands[0];
        assert.ok(band, 'a band at the tank');
        const t = band.t;
        assert.doesNotThrow(() => r._modes(band.omega, band.portVoltages(), r._otherAmplitudes(band)));
        assert.equal(band.t, t, 'the band did not move while the matrix was assembled');
    });
});
