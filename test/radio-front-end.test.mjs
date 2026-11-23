// Radio front end (src/radio.js): antenna, earth, tuning capacitor,
// ferrite-rod medium-wave coil, a broadcast of AM stations, envelope
// detection in diode and transistor junctions.
//
// Gap (2026-11-23, round 3): the kits' radio experiments (crystal set,
// single-transistor and reflex receivers, AM test transmitter) had no RF
// source, antenna, tuning capacitor or MW coil. The carrier is solved as
// phasors (no 1 MHz transient), detection as the cycle-averaged junction
// law. Oracles: LC resonance f = 1/(2π√(LC)); detected audio = the station's
// programme; an ideal envelope detector's output follows the modulation
// depth; two carriers Δf apart beat at Δf.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { lnI0, besselGain, rectificationCurrent, programmeValue, normalizeStations } from '../src/radio.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);
const ms = (b, t) => b.advanceTo(BigInt(Math.round(t * 1e6)));
const L_COIL = 250e-6;

/**
 * Crystal set: antenna on the coil's tap, earth and circuit ground at the
 * coil's cold end, the tuning capacitor across the whole coil, a detector
 * diode from the hot end into a crystal earphone with 47 kΩ ‖ 2.2 nF.
 */
function crystalSet({ pos = 0.5, diode = { part: '1N34A' }, earphone = { type: 'crystal' }, antennaAt = 'tap',
    coil = {}, stations = null, earth = true } = {}) {
    const b = new BoardImpl(5);
    const parts = [P('G', 'gnd', {}, ['gnd']), P('ANT', 'antenna', {}, ['a']),
        P('L1', 'ferrite_coil', coil, ['a', 'tap', 'b', 'c1', 'c2']), P('TC', 'tuning_cap', { position: pos }, ['a', 'b']),
        P('D1', 'diode', diode, ['anode', 'cathode']), P('C1', 'capacitor', { farads: 2.2e-9 }, ['a', 'b']),
        P('R1', 'resistor', { ohms: 47e3 }, ['a', 'b']), P('EP', 'earphone', earphone, ['a', 'b'])];
    const gnd = net('gnd', ['G', 'gnd'], ['L1', 'a'], ['TC', 'b'], ['C1', 'b'], ['R1', 'b'], ['EP', 'b']);
    if (earth) { parts.push(P('E', 'earth', {}, ['earth'])); gnd.terminals.push({ part: 'E', terminal: 'earth' }); }
    const tank = net('tank', ['L1', 'b'], ['TC', 'a'], ['D1', 'anode']);
    const nets = [gnd, tank, net('out', ['D1', 'cathode'], ['C1', 'a'], ['R1', 'a'], ['EP', 'a'])];
    if (antennaAt === 'tap') nets.push(net('ant', ['ANT', 'a'], ['L1', 'tap']));
    else tank.terminals.push({ part: 'ANT', terminal: 'a' });
    b.setNetlist(parts, nets);
    if (stations) b.setBroadcast(stations);
    b.setPower(true);
    return b;
}

/** Peak-to-peak and mean of a net over a window, sampled every `stepUs`. */
function swing(b, netId, fromMs, toMs, stepUs = 20) {
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    for (let t = fromMs * 1000; t <= toMs * 1000; t += stepUs) {
        b.advanceTo(BigInt(Math.round(t * 1000)));
        const v = b.nodeVoltage(netId);
        lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; n++;
    }
    return { pp: hi - lo, mean: sum / n };
}

const tone = (id, hz, kHz, field = 0.02, depth = 0.5) =>
    ({ id, hz: kHz * 1e3, fieldVPerM: field, depth, audio: hz ? { type: 'tone', hz } : { type: 'none' } });

describe('radio: averaged junction law', () => {
    it('is the Bessel average of the exponential, square-law small and linear large', () => {
        // ln I0 against the series sum.
        for (const x of [0.1, 1, 3, 3.75, 5, 20, 100]) {
            let s = 0, term = 1;
            for (let k = 0; k < 400; k++) { if (k) term *= (x / 2) ** 2 / (k * k); s += term; }
            close(lnI0(x), Math.log(s), 1e-6 * Math.max(1, Math.log(s)), `lnI0(${x})`);
        }
        close(besselGain(0), 1, 1e-12, 'g(0)');
        close(besselGain(400), 2 / 400, 2e-5, 'g(x) -> 2/x');
        // Square law: Is·(I0(x) − 1) ≈ Is·x²/4 at v = 0.
        const is = 1e-7, nVt = 0.03;
        const [iSmall] = rectificationCurrent(0, 0.003, is, nVt);
        close(iSmall / (is * 0.01 / 4), 1, 0.01, 'square-law region');
        // Linear envelope: the bias that passes 1 uA rises one-for-one with A.
        const vFor = (A) => { let lo = -A - 1, hi = 1; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2;
            const [d] = rectificationCurrent(m, A, is, nVt); (is * Math.expm1(m / nVt) + d > 1e-6 ? hi = m : lo = m); } return lo; };
        close(vFor(2) - vFor(1), -1, 0.02, 'peak detector: dV/dA = -1');
        assert.deepEqual(rectificationCurrent(0.2, 0, is, nVt), [0, 0], 'no RF, no extra current');
    });

    it('programmes: tone, alternating two-tone, carrier only', () => {
        const [s] = normalizeStations([{ hz: 1e6, audio: { type: 'two-tone', hz: [500, 1000], period: 0.2 } }]);
        close(programmeValue(s.audio, 0.0005), 1, 1e-9, 'first tone, quarter period');
        // Phase-continuous across the switch.
        close(programmeValue(s.audio, 0.1 - 1e-9), programmeValue(s.audio, 0.1 + 1e-9), 1e-4, 'continuous at the switch');
        assert.equal(programmeValue({ type: 'none' }, 0.3), 0);
        assert.throws(() => normalizeStations([{ hz: 1 }]), /carrier/);
    });
});

describe('radio: tuning, selectivity, detection, interference', () => {
    it('tuning selects a station: the tank response peaks where LC resonates at its carrier', () => {
        const stations = [tone('a', 400, 612), tone('b', 600, 810), tone('c', 1000, 1215)];
        const b = crystalSet({ stations });
        ms(b, 2);
        const peaks = stations.map(() => ({ pos: -1, v: 0 }));
        const curve = [];
        for (let pos = 0; pos <= 1.0001; pos += 0.01) {
            b.setControl('TC', pos);
            ms(b, Number(b.timeNs) / 1e6 + 0.3);
            const v = b.rfVoltage('tank');
            curve.push(v.map(x => x.volts));
            v.forEach((x, k) => { if (x.volts > peaks[k].v) peaks[k] = { pos, v: x.volts }; });
        }
        // Expected: the tuning capacitor (10..500 pF, linear) plus the
        // antenna's 200 pF reflected through the tap (turns ratio 0.25 from
        // the cold end) resonates with the coil (sections coupled k = 0.98).
        const lEff = L_COIL * (0.25 ** 2 + 0.75 ** 2 + 2 * 0.98 * 0.25 * 0.75);
        stations.forEach((s, k) => {
            const c = 1 / ((2 * Math.PI * s.hz) ** 2 * lEff) - 200e-12 * 0.25 ** 2;
            const want = (c - 10e-12) / 490e-12;
            close(peaks[k].pos, want, 0.03, `${s.hz / 1e3} kHz peaks at knob position`);
            // At its own peak the station dominates the others.
            const at = curve[Math.round(peaks[k].pos * 100)];
            for (let j = 0; j < stations.length; j++) {
                if (j !== k) assert.ok(at[k] > 5 * at[j], `${s.hz / 1e3} kHz tuned: ${at[k]} V vs ${at[j]} V`);
            }
        });
        assert.ok(peaks[0].pos > peaks[1].pos && peaks[1].pos > peaks[2].pos, 'lower carrier, more capacitance');
    });

    it('the detected audio follows the programme of the tuned station', () => {
        const stations = [tone('a', 400, 612),
            { id: 'b', hz: 810e3, fieldVPerM: 0.02, depth: 0.5, audio: { type: 'two-tone', hz: [600, 900], period: 0.1 } }];
        const lEff = L_COIL * (0.25 ** 2 + 0.75 ** 2 + 2 * 0.98 * 0.25 * 0.75);
        const posFor = (f) => (1 / ((2 * Math.PI * f) ** 2 * lEff) - 12.5e-12 - 10e-12) / 490e-12;
        const b = crystalSet({ stations, pos: posFor(612e3) });
        ms(b, 40);
        close(b.buzzerTone('EP').hz, 400, 8, 'tuned to 612 kHz: its 400 Hz tone');
        assert.ok(b.buzzerTone('EP').level > 0.05, `audible: level ${b.buzzerTone('EP').level}`);
        b.setControl('TC', posFor(810e3));
        ms(b, 90); // the programme's 900 Hz half (50-100 ms)
        close(b.buzzerTone('EP').hz, 900, 18, 'tuned to 810 kHz: the second tone of its programme');
        ms(b, 140); // back to the 600 Hz half (100-150 ms)
        close(b.buzzerTone('EP').hz, 600, 12, 'and its first tone again');
    });

    it('detected audio amplitude follows the modulation depth (envelope detector)', () => {
        const run = (depth) => {
            const b = crystalSet({ stations: [tone('a', 400, 612, 0.02, depth)], pos: 0.527 });
            ms(b, 20);
            return swing(b, 'out', 20, 30);
        };
        const lo = run(0.25), hi = run(0.5);
        close(hi.pp / lo.pp, 2, 0.25, `audio p-p doubles with depth (${lo.pp.toFixed(4)} -> ${hi.pp.toFixed(4)} V)`);
        assert.ok(hi.mean > 0.1, `the detector's DC output is most of the carrier peak: ${hi.mean} V`);
    });

    it('a germanium diode detects a weak station a silicon diode barely hears', () => {
        const weak = [tone('a', 400, 612, 0.004)];
        const out = (diode) => { const b = crystalSet({ stations: weak, pos: 0.527, diode }); ms(b, 15); return swing(b, 'out', 15, 25).pp; };
        const ge = out({ part: '1N34A' });
        const si = out({});
        assert.ok(ge > 5 * si, `germanium ${ge} V p-p vs silicon ${si} V p-p`);
    });

    it('selectivity: the tap and the coil Q set how much of a neighbour gets through', () => {
        const stations = [tone('a', 400, 612), tone('b', 1000, 700)];
        const reject = (opts) => {
            const b = crystalSet({ stations, ...opts });
            ms(b, 1);
            let best = { pos: 0, ratio: 0, v: 0 };
            for (let pos = 0.35; pos <= 0.65; pos += 0.005) {
                b.setControl('TC', pos);
                ms(b, Number(b.timeNs) / 1e6 + 0.3);
                const [a, n] = b.rfVoltage('tank');
                if (a.volts > best.v) best = { pos, v: a.volts, ratio: a.volts / n.volts };
            }
            return best.ratio;
        };
        const tap = reject({});
        const top = reject({ antennaAt: 'tank' });
        const lowQ = reject({ coil: { q: 30 } });
        assert.ok(tap > 1.5 * top, `antenna on the tap is more selective than on the top: ${tap} vs ${top}`);
        // The detector and the antenna load the tank, so the loaded Q moves
        // less than the coil's own (120 -> 30); it still moves clearly.
        assert.ok(tap > 1.3 * lowQ, `a high-Q coil is more selective: Q 120 ${tap} vs Q 30 ${lowQ}`);
    });

    it('two stations 9 kHz apart beat: a 9 kHz whistle in the earphone', () => {
        const b = crystalSet({ stations: [tone('a', 0, 612), tone('b', 0, 621, 0.015)], pos: 0.52 });
        ms(b, 40);
        close(b.buzzerTone('EP').hz, 9000, 300, 'heterodyne whistle');
        // One carrier alone (no modulation): silence.
        const q = crystalSet({ stations: [tone('a', 0, 612)], pos: 0.52 });
        ms(q, 20);
        assert.equal(q.buzzerTone('EP').on, false, 'an unmodulated carrier alone is silent');
    });

    it('no earth: the counterpoise still receives, much weaker', () => {
        const withEarth = crystalSet({ stations: [tone('a', 400, 612)], pos: 0.527 });
        const without = crystalSet({ stations: [tone('a', 400, 612)], pos: 0.527, earth: false });
        ms(withEarth, 5); ms(without, 5);
        const a = withEarth.rfVoltage('tank')[0].volts;
        const c = without.rfVoltage('tank')[0].volts;
        assert.ok(c > 0 && c < a / 2, `earth ${a} V, counterpoise ${c} V`);
    });
});

/**
 * Tank with the antenna on the tap; the coupling winding feeds a transistor
 * base biased from 9 V through `rb` (RF/audio-held by 100 nF at the cold end).
 */
function transistorFrontEnd({ rb = 1e6, emitter = null, collector, stations }) {
    const b = new BoardImpl(5);
    const parts = [P('G', 'gnd', {}, ['gnd']), P('VS', 'vsource', { volts: 9 }, ['pos', 'neg']), P('E', 'earth', {}, ['earth']),
        P('ANT', 'antenna', {}, ['a']), P('L1', 'ferrite_coil', {}, ['a', 'tap', 'b', 'c1', 'c2']),
        P('TC', 'tuning_cap', { position: 0.527 }, ['a', 'b']), P('RB', 'resistor', { ohms: rb }, ['a', 'b']),
        P('CB', 'capacitor', { farads: 100e-9 }, ['a', 'b']), P('Q1', 'npn', {}, ['base', 'collector', 'emitter'])];
    const g = net('g', ['G', 'gnd'], ['VS', 'neg'], ['E', 'earth'], ['L1', 'a'], ['TC', 'b'], ['CB', 'b']);
    const v = net('v', ['VS', 'pos'], ['RB', 'a']);
    const nets = [g, v, net('ant', ['ANT', 'a'], ['L1', 'tap']), net('tank', ['L1', 'b'], ['TC', 'a']),
        net('bb', ['RB', 'b'], ['CB', 'a'], ['L1', 'c2']), net('base', ['L1', 'c1'], ['Q1', 'base'])];
    if (emitter) {
        parts.push(P('RE', 'resistor', { ohms: emitter }, ['a', 'b']), P('CE', 'capacitor', { farads: 100e-9 }, ['a', 'b']));
        nets.push(net('e', ['Q1', 'emitter'], ['RE', 'a'], ['CE', 'a']));
        g.terminals.push({ part: 'RE', terminal: 'b' }, { part: 'CE', terminal: 'b' });
    } else g.terminals.push({ part: 'Q1', terminal: 'emitter' });
    collector(parts, nets, { g, v });
    b.setNetlist(parts, nets);
    b.setBroadcast(stations);
    b.setPower(true);
    return b;
}

describe('radio: transistor receivers', () => {
    it('single-transistor receiver: the base-emitter junction detects, the collector drives the earphone', () => {
        const b = transistorFrontEnd({
            stations: [tone('a', 400, 612)],
            collector: (parts, nets, { g, v }) => {
                parts.push(P('EP', 'earphone', {}, ['a', 'b']), P('CC', 'capacitor', { farads: 10e-9 }, ['a', 'b']));
                nets.push(net('col', ['Q1', 'collector'], ['EP', 'a'], ['CC', 'a']));
                v.terminals.push({ part: 'EP', terminal: 'b' });
                g.terminals.push({ part: 'CC', terminal: 'b' });
            },
        });
        ms(b, 60);
        close(b.buzzerTone('EP').hz, 400, 8, 'the station\'s tone in the earphone');
        const { pp } = swing(b, 'col', 60, 66);
        assert.ok(pp > 0.5, `audio at the collector: ${pp} V p-p`);
        // Without the antenna's station: no tone.
        const quiet = transistorFrontEnd({ stations: [], collector: (parts, nets, { g, v }) => {
            parts.push(P('EP', 'earphone', {}, ['a', 'b']));
            nets.push(net('col', ['Q1', 'collector'], ['EP', 'a']));
            v.terminals.push({ part: 'EP', terminal: 'b' });
        } });
        ms(quiet, 60);
        assert.equal(quiet.buzzerTone('EP').on, false);
    });

    it('an RF amplifier stage multiplies the carrier by gm·RC before the diode detector', () => {
        const b = transistorFrontEnd({
            rb: 470e3, emitter: 1000, stations: [tone('a', 400, 612, 0.002)],
            collector: (parts, nets, { g, v }) => {
                parts.push(P('RC', 'resistor', { ohms: 2200 }, ['a', 'b']), P('CK', 'capacitor', { farads: 1e-9 }, ['a', 'b']),
                    P('D1', 'diode', { part: '1N34A' }, ['anode', 'cathode']), P('RD', 'resistor', { ohms: 100e3 }, ['a', 'b']),
                    P('R1', 'resistor', { ohms: 47e3 }, ['a', 'b']), P('C1', 'capacitor', { farads: 2.2e-9 }, ['a', 'b']),
                    P('EP', 'earphone', { type: 'crystal' }, ['a', 'b']));
                nets.push(net('col', ['Q1', 'collector'], ['RC', 'a'], ['CK', 'a']),
                    net('det', ['CK', 'b'], ['D1', 'anode'], ['RD', 'a']),
                    net('out', ['D1', 'cathode'], ['R1', 'a'], ['C1', 'a'], ['EP', 'a']));
                v.terminals.push({ part: 'RC', terminal: 'b' });
                g.terminals.push(...['RD', 'R1', 'C1', 'EP'].map(part => ({ part, terminal: 'b' })));
            },
        });
        ms(b, 40);
        const ic = -b._mnaCache.branchCurrents.get('Q1').get('collector');
        const vb = b.rfVoltage('base')[0].volts;
        const vc = b.rfVoltage('col')[0].volts;
        // Upper bound gm·RC; the real stage gives less: the detector loads
        // the collector (≈ R1/2 ‖ RD through 1 nF), the 100 nF emitter bypass
        // is 2.6 Ω at 612 kHz against 1/gm ≈ 18 Ω, and Cμ feeds back.
        const gain = vc / vb;
        const ideal = ic / 0.02585 * 2200;
        const loaded = ic / 0.02585 * (1 / (1 / 2200 + 2 / 47e3 + 1 / 100e3)) / (1 + ic / 0.02585 * 2.6);
        assert.ok(gain > 0.8 * loaded && gain < 1.05 * ideal, `RF gain ${gain.toFixed(1)} vs gm·RC ${ideal.toFixed(1)}, loaded ${loaded.toFixed(1)} (Ic ${(ic * 1e3).toFixed(2)} mA)`);
        assert.ok(vc > 20 * vb, `the carrier is amplified: ${vb} V at the base, ${vc} V at the collector`);
        ms(b, 80);
        close(b.buzzerTone('EP').hz, 400, 8, 'detected after the RF stage');
    });
});

describe('radio: reflex receiver', () => {
    it('one transistor amplifies the carrier and, after the diode, the audio again', () => {
        // Base on the coupling winding; the bottom of that winding ('bb') is
        // held at RF by 10 nF but carries the detected audio back in. The
        // collector feeds an RF choke (whose RF voltage goes through 1 nF to
        // the detector) and, below it, the earphone with an RF bypass.
        const b = transistorFrontEnd({
            rb: 470e3, emitter: 1000, stations: [tone('a', 400, 612, 0.005)],
            collector: (parts, nets, { g, v }) => {
                parts.push(P('LCH', 'inductor', { henrys: 2.5e-3 }, ['a', 'b']), P('EP', 'earphone', {}, ['a', 'b']),
                    P('CEP', 'capacitor', { farads: 10e-9 }, ['a', 'b']), P('CK', 'capacitor', { farads: 1e-9 }, ['a', 'b']),
                    P('RD', 'resistor', { ohms: 47e3 }, ['a', 'b']), P('D1', 'diode', { part: '1N34A' }, ['anode', 'cathode']),
                    P('R1', 'resistor', { ohms: 47e3 }, ['a', 'b']), P('C1', 'capacitor', { farads: 2.2e-9 }, ['a', 'b']),
                    P('CA', 'capacitor', { farads: 100e-9 }, ['a', 'b']), P('CEA', 'capacitor', { farads: 10e-6 }, ['a', 'b']));
                nets.push(net('col', ['Q1', 'collector'], ['LCH', 'a'], ['CK', 'a']),
                    net('ep', ['LCH', 'b'], ['EP', 'a'], ['CEP', 'a']),
                    net('det', ['CK', 'b'], ['RD', 'a'], ['D1', 'anode']),
                    net('out', ['D1', 'cathode'], ['R1', 'a'], ['C1', 'a'], ['CA', 'a']));
                v.terminals.push({ part: 'EP', terminal: 'b' });
                g.terminals.push(...['CEP', 'RD', 'R1', 'C1'].map(part => ({ part, terminal: 'b' })));
                // The detected audio back into the base circuit, and an audio
                // bypass on the emitter so the second pass has gain.
                nets.find(n => n.id === 'bb').terminals.push({ part: 'CA', terminal: 'b' });
                nets.find(n => n.id === 'e').terminals.push({ part: 'CEA', terminal: 'a' });
                g.terminals.push({ part: 'CEA', terminal: 'b' });
            },
        });
        ms(b, 80);
        const t = b.buzzerTone('EP');
        close(t.hz, 400, 8, 'the station in the earphone');
        const rf = b.rfVoltage('col')[0].volts / b.rfVoltage('base')[0].volts;
        assert.ok(rf > 20, `RF gain on the first pass: ${rf}`);
        // Second pass: the audio at the collector side of the earphone is
        // larger than the detected audio fed back in.
        const audioOut = swing(b, 'ep', 80, 90).pp;
        const audioIn = swing(b, 'out', 90, 100).pp;
        assert.ok(audioOut > 3 * audioIn, `audio gain on the second pass: ${audioIn} V p-p in, ${audioOut} V p-p out`);
    });
});

describe('radio: circuits without an antenna are untouched', () => {
    it('builds no radio front end and reports none', () => {
        const b = new BoardImpl(5);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('V', 'vsource', { volts: 5 }, ['pos', 'neg']),
            P('D', 'diode', {}, ['anode', 'cathode']), P('R', 'resistor', { ohms: 1000 }, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['V', 'neg'], ['R', 'b']), net('p', ['V', 'pos'], ['D', 'anode']), net('k', ['D', 'cathode'], ['R', 'a'])]);
        b.setPower(true);
        assert.equal(b.radioReport(), null);
        assert.equal(b._solveParts.some(p => p.kind === 'rf_detect'), false);
    });
});
