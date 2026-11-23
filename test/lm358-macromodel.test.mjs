// LM358 time-domain macromodel (src/ground-sensing-opamp.js) and the ideal
// op-amp under positive feedback. Each block below is a gap a gallery builder
// hit, reproduced first and kept as the regression:
//
//  1. an audio-rate ×101 stage stalled (the old settle-loop op-amp reported a
//     change on every adaptive step, so every step restarted at the floor);
//  2. a 50 mV comparator was still mid-swing after 1 ms (no slew, no pole);
//  3. the output was a fixed 100 Ω with no current limit;
//  4. a capacitor in the feedback path (integrator, triangle generator)
//     stalled the same way as 1;
//  5. the ideal `opamp` failed Newton at the switching instant of a
//     relaxation oscillator (its rail FSM cycled low → linear → low).
//
// Oracles are datasheet numbers (TI SLOS068 LM358: 100 dB, 1 MHz, 0.3 V/µs,
// VOH ≈ VCC − 1.5 V, 40 mA source, 20+ mA sink) and hand arithmetic. Wall
// bounds sit far above the measured time and far below the old stall: they
// catch the stall (orders of magnitude), not machine load.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/index.js';
import { perfHint } from './helpers/perf-hint.mjs';

registerAllDevices();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const V = (id, volts, extra = {}) => ({ id, kind: 'vsource', params: { volts, ...extra }, terminals: ['pos', 'neg'] });
const G = { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] };
const LM358 = { id: 'U1', kind: 'lm358', params: {}, terminals: ['vcc', 'gnd', '1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out'] };

describe('LM358 audio-rate gain stage (gap 1: the stall)', () => {
    // ×101 non-inverting (100 k / 1 k) on 12 V, 10 mV 1 kHz on a 50 mV offset.
    const bench = () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V('VS', 12), G,
            V('FG', 0, { wave: 'sine', freq: 1000, amplitude: 0.01, offset: 0.05 }),
            R('RF', 100000), R('RG', 1000), R('RL', 10000), LM358], [
            net('nv', ['VS', 'pos'], ['U1', 'vcc']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['FG', 'neg'], ['RG', 'b'], ['RL', 'b'], ['U1', 'gnd']),
            net('np', ['FG', 'pos'], ['U1', '1_pos']),
            net('nn', ['U1', '1_neg'], ['RF', 'a'], ['RG', 'a']),
            net('no', ['U1', '1_out'], ['RF', 'b'], ['RL', 'a']),
        ]);
        return board;
    };

    it('10 ms in one advance is fast (was > 100 s in a builder bench)', () => {
        const board = bench();
        const t0 = performance.now();
        board.advanceTo(10_000_000n);
        const wall = performance.now() - t0;
        // Base engine: 133 s for this on a loaded box; ~0.3–1.5 s now.
        assert.ok(wall < 20000, `10 ms of a ×101 audio stage took ${wall.toFixed(0)} ms of wall time`
            + perfHint('Wall-clock cost of 10 ms of an audio-rate LM358 stage'));
        assert.equal(board._transientAccuracyUnmet, null);
    });

    it('amplifies 10 mV at 1 kHz by the finite-bandwidth closed-loop gain', () => {
        // Closed-loop corner GBW/(1+Rf/Rg) = 1 MHz/101 = 9.90 kHz, so at 1 kHz
        // |H| = 101/√(1 + (1/9.90)²) = 100.49 (and the 100 dB loop gain takes
        // 0.1 % more): 2 × 10 mV × 100.39 = 2.008 V peak-to-peak about
        // 0.05 × 100.9 = 5.045 V.
        const board = bench();
        board.advanceTo(5_000_000n);
        let lo = Infinity, hi = -Infinity;
        for (let us = 5005n; us <= 7000n; us += 5n) {
            board.advanceTo(us * 1000n);
            const v = board.nodeVoltage('no');
            lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
        assert.ok(Math.abs((hi - lo) - 2.008) < 0.02, `p-p ${(hi - lo).toFixed(4)} V`);
        assert.ok(Math.abs((hi + lo) / 2 - 5.045) < 0.01, `mid ${((hi + lo) / 2).toFixed(4)} V`);
    });
});

describe('LM358 comparator speed (gap 2: gain, slew, pole)', () => {
    it('50 mV of overdrive swings the output at ≈0.3 V/µs and lands within 50 µs', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V('VS', 5), G, V('VI', 2.45), V('VR', 2.5), R('RL', 10000), LM358], [
            net('nv', ['VS', 'pos'], ['U1', 'vcc']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VI', 'neg'], ['VR', 'neg'], ['RL', 'b'], ['U1', 'gnd']),
            net('np', ['VI', 'pos'], ['U1', '1_pos']),
            net('nn', ['VR', 'pos'], ['U1', '1_neg']),
            net('no', ['U1', '1_out'], ['RL', 'a']),
        ]);
        board.advanceTo(10_000n);
        assert.ok(board.nodeVoltage('no') < 0.02, `starts low, got ${board.nodeVoltage('no')}`);
        board.setControl('VI', 2.55);
        const trace = [];
        for (let ns = 10_000n + 250n; ns <= 60_000n; ns += 250n) {
            board.advanceTo(ns);
            trace.push([Number(ns - 10_000n) / 1000, board.nodeVoltage('no')]);
        }
        const cross = (level) => trace.find(([, v]) => v >= level)?.[0];
        const t1 = cross(1.0), t3 = cross(3.0);
        assert.ok(t1 !== undefined && t3 !== undefined, 'the output crosses 1 V and 3 V');
        const slew = 2.0 / (t3 - t1);
        assert.ok(slew > 0.2 && slew < 0.4, `slew ${slew.toFixed(3)} V/µs (datasheet 0.3)`);
        const final = trace.at(-1)[1];
        // VCC − 1.5 V behind 50 Ω into 10 kΩ: 3.5 × 10000/10050 = 3.4826 V.
        assert.ok(Math.abs(final - 3.4826) < 0.002, `settles at VCC − 1.5 V, got ${final.toFixed(4)}`);
        assert.ok(cross(3.43) < 25, `within 25 µs of the step, got ${cross(3.43)} µs`);
    });

    it('open-loop gain is 100 dB: a 30 µV difference moves the output ~3 V', () => {
        const at = (dv) => {
            const board = new BoardImpl(5.0);
            board.setNetlist([V('VS', 5), G, V('VI', 1.0 + dv), V('VR', 1.0), R('RL', 100000), LM358], [
                net('nv', ['VS', 'pos'], ['U1', 'vcc']),
                net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VI', 'neg'], ['VR', 'neg'], ['RL', 'b'], ['U1', 'gnd']),
                net('np', ['VI', 'pos'], ['U1', '1_pos']),
                net('nn', ['VR', 'pos'], ['U1', '1_neg']),
                net('no', ['U1', '1_out'], ['RL', 'a']),
            ]);
            board.advanceTo(1_000_000n);
            return board.nodeVoltage('no');
        };
        // 1e5 × 10 µV = 1 V and 1e5 × 30 µV = 3 V, through 50 Ω into 100 kΩ.
        assert.ok(Math.abs(at(10e-6) - 1.0) < 0.01, `10 µV → ${at(10e-6)}`);
        assert.ok(Math.abs(at(30e-6) - 3.0) < 0.01, `30 µV → ${at(30e-6)}`);
    });
});

describe('LM358 output stage (gap 3: swing and current limits)', () => {
    // Comparator with the output forced high (v+ > v−) or low (v+ < v−),
    // loaded by RL to `to` (gnd or the 5 V rail).
    const driven = (high, rl, to, led = false) => {
        const board = new BoardImpl(5.0);
        const parts = [V('VS', 5), G, V('VI', high ? 2.6 : 2.4), V('VR', 2.5), R('RL', rl), LM358,
            ...(led ? [{ id: 'D', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] }] : [])];
        const nets = [
            net('nv', ['VS', 'pos'], ['U1', 'vcc'], ...(to === 'vcc' ? [['RL', 'a']] : [])),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VI', 'neg'], ['VR', 'neg'], ['U1', 'gnd'],
                ...(to === 'gnd' ? [['RL', 'b']] : [])),
            net('np', ['VI', 'pos'], ['U1', '1_pos']),
            net('nn', ['VR', 'pos'], ['U1', '1_neg']),
        ];
        if (led) {
            nets.push(net('nled', ['RL', 'b'], ['D', 'anode']), net('no', ['U1', '1_out'], ['D', 'cathode']));
        } else {
            nets.push(net('no', ['U1', '1_out'], [to === 'gnd' ? 'RL' : 'RL', to === 'gnd' ? 'a' : 'b']));
        }
        board.setNetlist(parts, nets);
        board.advanceTo(1_000_000n);
        return board;
    };

    it('light loads: high ≈ VCC − 1.5 V, low within millivolts of ground', () => {
        assert.ok(Math.abs(driven(true, 100000, 'gnd').nodeVoltage('no') - 3.5) < 0.01);
        assert.ok(driven(false, 100000, 'vcc').nodeVoltage('no') < 0.01);
    });

    it('sinks a 220 Ω LED load well below the old 1.2 V floor', () => {
        const board = driven(false, 220, 'vcc', true);
        const vout = board.nodeVoltage('no');
        const iLed = board.ledCurrents.get('D');
        assert.ok(vout < 0.8, `output low under the LED load, got ${vout.toFixed(3)} V`);
        assert.ok(iLed > 0.010, `LED current ${(iLed * 1000).toFixed(2)} mA`);
    });

    it('short circuits are current-limited: ≈40 mA sourcing, ≈25 mA sinking', () => {
        const src = driven(true, 1, 'gnd').nodeVoltage('no') / 1;
        assert.ok(src > 0.030 && src <= 0.0401, `source limit ${(src * 1000).toFixed(1)} mA`);
        const snk = (5 - driven(false, 1, 'vcc').nodeVoltage('no')) / 1;
        assert.ok(snk > 0.020 && snk <= 0.0251, `sink limit ${(snk * 1000).toFixed(1)} mA`);
    });

    it('the package leads carry the load current from VCC (sourcing) and to GND (sinking)', () => {
        const hi = driven(true, 1000, 'gnd');
        const iLoad = hi.nodeVoltage('no') / 1000;
        assert.ok(Math.abs(hi.branchCurrent('U1', '1_out') - iLoad) < 1e-6);
        assert.ok(Math.abs(hi.branchCurrent('U1', 'vcc') + iLoad) < 1e-5);
        const lo = driven(false, 1000, 'vcc');
        const iSink = (5 - lo.nodeVoltage('no')) / 1000;
        assert.ok(Math.abs(lo.branchCurrent('U1', 'gnd') - iSink) < 1e-5);
    });
});

describe('LM358 with a capacitor in the loop (integrator, triangle generator)', () => {
    it('an integrator ramps at (Vref − Vin)/(R·C) and stays fast', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V('VS', 9), G, V('VI', 2.0), V('VR', 2.5), R('RI', 10000), LM358,
            { id: 'C', kind: 'capacitor', params: { farads: 100e-9 }, terminals: ['a', 'b'] }], [
            net('nv', ['VS', 'pos'], ['U1', 'vcc']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VI', 'neg'], ['VR', 'neg'], ['U1', 'gnd']),
            net('nin', ['VI', 'pos'], ['RI', 'a']),
            net('nref', ['VR', 'pos'], ['U1', '1_pos']),
            net('nn', ['RI', 'b'], ['C', 'a'], ['U1', '1_neg']),
            net('no', ['U1', '1_out'], ['C', 'b']),
        ]);
        const t0 = performance.now();
        board.advanceTo(100_000n);
        const v0 = board.nodeVoltage('no');
        board.advanceTo(2_100_000n);
        const v1 = board.nodeVoltage('no');
        // 0.5 V / (10 kΩ · 100 nF) = 0.5 V/ms upward.
        assert.ok(Math.abs((v1 - v0) / 2 - 0.5) < 0.005, `ramp ${((v1 - v0) / 2).toFixed(4)} V/ms`);
        const wall = performance.now() - t0;
        assert.ok(wall < 20000, `2 ms of integrator took ${wall.toFixed(0)} ms` + perfHint('Wall-clock cost of an LM358 integrator'));
    });

    it('a Schmitt + integrator triangle generator runs at its designed, slew-corrected period', () => {
        // Schmitt: v+ from tri via 10 k and square via 22 k, v− = 4.5 V.
        // Square swings 0.005 … 7.5 V (LM358 window on 9 V), so the triangle
        // turns at (4.5·32 − 7.5·10)/22 = 3.136 V and (4.5·32 − 0.05)/22 =
        // 6.543 V. Integrator 10 k / 100 nF around 4.5 V: falls at 3.0 V/ms,
        // rises at 4.495 V/ms → T = 3.407/3 + 3.407/4.495 = 1.894 ms with an
        // instant square. At 0.3 V/µs the square needs 15 µs (rising) and
        // 10 µs (falling) to cross 4.5 V, the triangle keeps ramping the old
        // way meanwhile, and must win that back at the new slope:
        // 15·(1 + 4.495/3) + 10·(1 + 3/4.495) = 54 µs → T ≈ 1.948 ms.
        const board = new BoardImpl(5.0);
        board.setNetlist([V('VS', 9), G, V('VR', 4.5), LM358,
            R('R1', 10000), R('R2', 22000), R('RI', 10000),
            { id: 'C', kind: 'capacitor', params: { farads: 100e-9 }, terminals: ['a', 'b'] }], [
            net('nv', ['VS', 'pos'], ['U1', 'vcc']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VR', 'neg'], ['U1', 'gnd']),
            net('nref', ['VR', 'pos'], ['U1', '1_neg'], ['U1', '2_pos']),
            net('nsp', ['U1', '1_pos'], ['R1', 'b'], ['R2', 'a']),
            net('nsq', ['U1', '1_out'], ['R2', 'b'], ['RI', 'a']),
            net('nin', ['RI', 'b'], ['U1', '2_neg'], ['C', 'a']),
            net('ntri', ['U1', '2_out'], ['C', 'b'], ['R1', 'a']),
        ]);
        const t0 = performance.now();
        const rises = [];
        let last = null, lo = Infinity, hi = -Infinity;
        for (let us = 20n; us <= 12000n; us += 20n) {
            board.advanceTo(us * 1000n);
            const sq = board.nodeVoltage('nsq') > 3.75;
            if (last === false && sq) rises.push(Number(us));
            last = sq;
            if (us > 3000n) {
                const tri = board.nodeVoltage('ntri');
                lo = Math.min(lo, tri); hi = Math.max(hi, tri);
            }
        }
        const wall = performance.now() - t0;
        assert.ok(rises.length >= 4, `oscillates, ${rises.length} rising edges`);
        const period = (rises.at(-1) - rises[1]) / (rises.length - 2) / 1000;
        assert.ok(Math.abs(period - 1.948) < 0.03, `period ${period.toFixed(3)} ms (slew-corrected 1.948)`);
        // The thresholds, overshot OUTWARD only, by less than the slew-time
        // bound (10 µs × 3 V/ms = 30 mV below, 15 µs × 4.495 V/ms = 67 mV above).
        assert.ok(lo <= 3.136 && lo > 3.136 - 0.035 && hi >= 6.543 && hi < 6.543 + 0.072,
            `triangle ${lo.toFixed(3)} … ${hi.toFixed(3)} V`);
        assert.ok(wall < 60000, `12 ms of triangle generator took ${wall.toFixed(0)} ms`
            + perfHint('Wall-clock cost of an LM358 triangle generator'));
    });
});

describe('LM358 slow integrators and charge packets (builder 3)', () => {
    const integrator = (extraParts, extraNets, cFarads, rOhms = null) => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V('VS', 9), G, V('VR', 4.5), LM358,
            { id: 'C', kind: 'capacitor', params: { farads: cFarads }, terminals: ['a', 'b'] },
            ...(rOhms ? [R('RI', rOhms)] : []), ...extraParts], [
            net('nv', ['VS', 'pos'], ['U1', 'vcc']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VR', 'neg'], ['U1', 'gnd'], ...extraNets.gnd),
            net('nref', ['VR', 'pos'], ['U1', '1_pos'], ...extraNets.ref),
            net('nn', ['C', 'a'], ['U1', '1_neg'], ...extraNets.nn),
            net('no', ['U1', '1_out'], ['C', 'b']),
            ...extraNets.more,
        ]);
        return board;
    };

    it('a 10 s integrator (1 MΩ, 10 µF) runs 10 s in 10 ms ticks quickly and on its ramp', () => {
        // 0.1 V below the 4.5 V reference: +0.1/(1 MΩ·10 µF) = +10 mV/s.
        const board = integrator([V('VI', 4.4)],
            { gnd: [['VI', 'neg']], ref: [], nn: [['RI', 'b']], more: [net('nin', ['VI', 'pos'], ['RI', 'a'])] },
            10e-6, 1e6);
        const t0 = performance.now();
        for (let ms = 10n; ms <= 10000n; ms += 10n) board.advanceTo(ms * 1_000_000n);
        const wall = performance.now() - t0;
        assert.ok(Math.abs(board.nodeVoltage('no') - 4.6) < 0.001, `10 s ramp end ${board.nodeVoltage('no')}`);
        assert.ok(wall < 60000, `10 s integrator took ${wall.toFixed(0)} ms`
            + perfHint('Wall-clock cost of a 10 s LM358 integrator'));
    });

    it('a diode charge pump steps the integrator once per rising edge, by C1·ΔV/C', () => {
        // 100 Hz 0–5 V square → 10 nF → D1 into the virtual ground; D2 from
        // the 4.5 V reference resets the pump capacitor on falling edges.
        // Each rising edge moves 10 nF × (5 V − two diode drops ≈ 1.1 V) =
        // ~39 nC into 1 µF: a −39 mV step, and nothing between edges.
        const board = integrator([
            V('VP', 0, { wave: 'square', freq: 100, amplitude: 2.5, offset: 2.5 }),
            { id: 'C1', kind: 'capacitor', params: { farads: 10e-9 }, terminals: ['a', 'b'] },
            { id: 'D1', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] },
            { id: 'D2', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] },
        ], { gnd: [['VP', 'neg']], ref: [['D2', 'anode']], nn: [['D1', 'cathode']],
            more: [net('np', ['VP', 'pos'], ['C1', 'a']), net('nx', ['C1', 'b'], ['D1', 'anode'], ['D2', 'cathode'])] },
            1e-6);
        const settled = [];
        for (let ms = 1n; ms <= 45n; ms++) {
            board.advanceTo(ms * 1_000_000n - 500_000n);    // mid-interval, away from edges
            settled.push(board.nodeVoltage('no'));
        }
        assert.equal(board._transientAccuracyUnmet, null);
        // Rising edges at 10, 20, 30, 40 ms: steps between samples 9.5→10.5 ms etc.
        for (let i = 1; i < settled.length; i++) {
            const d = settled[i] - settled[i - 1];
            const edge = i % 10 === 0;   // sample i is at (i + 0.5) ms
            if (edge) assert.ok(d < -0.030 && d > -0.045, `step at ${i + 0.5} ms: ${(d * 1000).toFixed(1)} mV`);
            else assert.ok(Math.abs(d) < 0.001, `no step at ${i + 0.5} ms: ${(d * 1000).toFixed(2)} mV`);
        }
    });
});

describe('LM358 driving a bare capacitive load', () => {
    // Coordinator report (2026-11-23): a plain 20 nF capacitor on the output
    // of a ×101 stage (lab-attenuator-gain's piezo with no ESR) read −0.19 V
    // for 0.149 V and ran into the 20,000-attempt transient backstop. Kept as
    // a regression: the 50 Ω output stage drives the capacitor like any real
    // op-amp, for split and single supplies and capacitances from 2 nF to 1 µF.
    const stage = (cap, split) => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V('VP', 9), V('VN', split ? 9 : 1e-6), G,
            V('T', 0, { wave: 'sine', freq: 440, amplitude: 4, offset: 0 }),
            R('RS', 220000), R('RSH', 220), R('RF', 100000), R('RG', 1000), LM358,
            { id: 'C', kind: 'capacitor', params: { farads: cap }, terminals: ['a', 'b'] }], [
            net('nv', ['VP', 'pos'], ['U1', 'vcc']),
            net('nneg', ['VN', 'neg'], ['U1', 'gnd']),
            net('ng', ['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos'], ['T', 'neg'], ['RSH', 'b'], ['RG', 'b'], ['C', 'b']),
            net('nt', ['T', 'pos'], ['RS', 'a']),
            net('np', ['RS', 'b'], ['RSH', 'a'], ['U1', '1_pos']),
            net('nn', ['U1', '1_neg'], ['RF', 'a'], ['RG', 'a']),
            net('no', ['U1', '1_out'], ['RF', 'b'], ['C', 'a']),
        ]);
        board.advanceTo(1_000_000n);
        return board;
    };
    it('a 20 nF … 1 µF output capacitor reads the amplified signal at 1 ms', () => {
        // 4 V·sin(2π·440·1 ms) through 220 k/220 Ω = 1.467 mV, ×101 with ~2.5°
        // of closed-loop lag at 440 Hz: ≈ 0.156 V (the gallery's 0.156 ± 0.005).
        for (const split of [true, false]) {
            const bare = stage(1e-15, split).nodeVoltage('no');
            for (const cap of [2e-9, 20e-9, 1e-6]) {
                const board = stage(cap, split);
                assert.equal(board._transientAccuracyUnmet, null);
                assert.ok(board._transientAnalysisWork.attempts < 2000,
                    `${cap} F: ${board._transientAnalysisWork.attempts} attempts`);
                const v = board.nodeVoltage('no');
                assert.ok(v > 0.14 && v < 0.175 && Math.abs(v - bare) < 0.003,
                    `${split ? 'split' : 'single'} supply, ${cap} F on the output: ${v} V (unloaded ${bare})`);
            }
        }
    });
});

describe('ideal opamp under positive feedback (gap 5)', () => {
    it('a relaxation oscillator converges through every switching instant', () => {
        // Rails 0/5 V; v+ = 5/3 or 10/3 V from three 10 k; RC = 1 ms.
        // T = 2·RC·ln 2 = 1.386 ms.
        const board = new BoardImpl(5.0);
        board.setNetlist([V('VS', 5), G,
            { id: 'U1', kind: 'opamp', params: { railHigh: 5, railLow: 0 }, terminals: ['inp', 'inn', 'out'] },
            R('RA', 10000), R('RB', 10000), R('RH', 10000), R('RT', 10000),
            { id: 'C', kind: 'capacitor', params: { farads: 100e-9 }, terminals: ['a', 'b'] }], [
            net('nv', ['VS', 'pos'], ['RA', 'a']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['RB', 'b'], ['C', 'b']),
            net('np', ['RA', 'b'], ['RB', 'a'], ['RH', 'a'], ['U1', 'inp']),
            net('no', ['U1', 'out'], ['RH', 'b'], ['RT', 'a']),
            net('nn', ['RT', 'b'], ['C', 'a'], ['U1', 'inn']),
        ]);
        const rises = [];
        let last = null;
        for (let us = 10n; us <= 10000n; us += 10n) {
            board.advanceTo(us * 1000n);
            assert.equal(board._transientAccuracyUnmet, null, `unconverged at ${us} µs`);
            const high = board.nodeVoltage('no') > 2.5;
            if (last === false && high) rises.push(Number(us));
            last = high;
            // Never the unstable linear root inside the hysteresis band.
            const vo = board.nodeVoltage('no');
            assert.ok(vo < 0.01 || vo > 4.99, `output on a rail, got ${vo} at ${us} µs`);
        }
        const period = (rises.at(-1) - rises[0]) / (rises.length - 1) / 1000;
        assert.ok(Math.abs(period - 1.386) < 0.03, `period ${period.toFixed(3)} ms`);
    });
});

// Round 2: speed. Two causes, each reproduced on its own.
//
//  6. The hidden pole capacitor was integrated trapezoidally. In saturation
//     it sits against the swing clamp (10 S on 1 nF: a 0.1 ns mode), and the
//     trapezoidal rule never damps a mode that much faster than the step: the
//     pole alternated about the clamp by ~90 uV forever, Newton lost
//     convergence on the alternation at any useful step, and a comparator
//     whose input crept toward its threshold took ~350 attempts per ms at
//     ~10 ms of wall time each (lab-v-to-f: 163 s of test time).
//  7. A designer reload (bw-circuit-ui rebuilds the board, then restores the
//     snapshot of the board it replaced) zeroed the pole that setNetlist had
//     just seeded from the bias point, so every LM358 started railed low and
//     slewed back to where it already was (76-multimeter: 10 ms to 1.3 s).
describe('LM358 simulation cost (round 2)', () => {
    // lab-v-to-f without the breadboard: an ideal integrator (100 k, 2.2 uF)
    // ramps down from a 0.89 V input over a 4.5 V reference; an LM358 Schmitt
    // trigger (10 k in, 47 k feedback) drops its output when the ramp reaches
    // its lower threshold, and a diode through 15 k resets the integrator.
    // The trigger's input creeps toward the threshold at ~3 mV/ms: tens of
    // milliseconds with the comparator saturated a few tens of mV from it.
    const vToF = () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V('VS', 9), G, V('VR', 4.5), V('VI', 5.39), R('RIN', 100000),
            { id: 'CI', kind: 'capacitor', params: { farads: 2.2e-6 }, terminals: ['a', 'b'] },
            { id: 'UI', kind: 'opamp', params: { gain: 1e5, railHigh: 9, railLow: 0 }, terminals: ['inp', 'inn', 'out'] },
            { id: 'D1', kind: 'diode', params: { vf: 0.7 }, terminals: ['anode', 'cathode'] }, R('RD', 15000),
            R('RI', 10000), R('RF', 47000), R('RL', 1000),
            { id: 'L1', kind: 'led', params: { vf: 2, color: 'green' }, terminals: ['anode', 'cathode'] }, LM358], [
            net('nv', ['VS', 'pos'], ['U1', 'vcc'], ['RL', 'a']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VR', 'neg'], ['VI', 'neg'], ['U1', 'gnd']),
            net('nr', ['VR', 'pos'], ['U1', '1_neg'], ['UI', 'inp']),
            net('ni', ['VI', 'pos'], ['RIN', 'a']),
            net('ns', ['RIN', 'b'], ['CI', 'a'], ['UI', 'inn'], ['D1', 'anode']),
            net('nt', ['UI', 'out'], ['CI', 'b'], ['RI', 'a']),
            net('nd', ['D1', 'cathode'], ['RD', 'a']),
            net('np', ['RI', 'b'], ['RF', 'a'], ['U1', '1_pos']),
            net('na', ['RL', 'b'], ['L1', 'anode']),
            net('no', ['U1', '1_out'], ['RF', 'b'], ['RD', 'b'], ['L1', 'cathode']),
        ]);
        return board;
    };

    it('a voltage-to-frequency converter keeps its period at a fraction of the work', () => {
        const board = vToF();
        const falls = [];
        let prev = null;
        for (let k = 1; k <= 1600; k++) {
            board.advanceTo(BigInt(k) * 500_000n);
            const high = board.nodeVoltage('no') > 3;
            if (prev === true && !high) falls.push(k * 0.5);
            prev = high;
        }
        assert.equal(board.transientAnalysisStatus().failure, null);
        // The same flashes, to the 0.5 ms sample, as the trapezoidal pole
        // gave (and lab-v-to-f's 2.55 Hz): ramp 4.5 + 0.89 V → 3.86 V and reset.
        assert.deepEqual(falls, [384, 774]);
        const { attempts } = board.transientAnalysisStatus().work;
        // Measured: 14,680 attempts (24.6 s) with the trapezoidal pole,
        // 3,179 (0.9 s) with the damped one; 1,600 is the advance count.
        assert.ok(attempts < 5000, `${attempts} adaptive attempts for 800 ms`);
    });

    it('a designer reload keeps the pole seeded from the bias point', () => {
        // ×1 follower at 2 V: static, so 1 ms needs a handful of steps.
        const parts = [V('VS', 9), G, V('VI', 2), R('RL', 10000), LM358];
        const nets = [
            net('nv', ['VS', 'pos'], ['U1', 'vcc']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VI', 'neg'], ['RL', 'b'], ['U1', 'gnd']),
            net('ni', ['VI', 'pos'], ['U1', '1_pos']),
            net('no', ['U1', '1_out'], ['U1', '1_neg'], ['RL', 'a']),
        ];
        // What Circuit._syncNetlist does on every load and edit.
        const snap = new BoardImpl(5.0).snapshot();
        const board = new BoardImpl(5.0);
        board.setNetlist(parts, nets);
        board.restore(snap);
        assert.ok(Math.abs(board.nodeVoltage('no') - 2) < 1e-3, `t = 0: ${board.nodeVoltage('no')} V`);
        board.advanceTo(1_000_000n);
        assert.ok(Math.abs(board.nodeVoltage('no') - 2) < 1e-3, `t = 1 ms: ${board.nodeVoltage('no')} V`);
        const { attempts } = board.transientAnalysisStatus().work;
        assert.ok(attempts < 20, `${attempts} adaptive attempts for a static 1 ms`);
    });
});
