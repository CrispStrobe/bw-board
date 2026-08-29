// LM358 + LM3915 goldens: feedback CONVERGES in the settle loop — the
// follower and the resistor-gain stage are the hard asserts; the VU
// ladder checks the 3 dB law and dot vs bar.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';

registerAnalogAmps();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const DIV = (id, top, bot) => [R(`${id}T`, top), R(`${id}B`, bot)];

const AMP = { id: 'U1', kind: 'lm358', params: {}, terminals: ['vcc', 'gnd', '1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out'] };

describe('LM358', () => {
    it('open loop saturates like the comparator it then is', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G, ...DIV('A', 10000, 10000), ...DIV('B', 15000, 10000), AMP,
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }], [
            net('nv', ['VCC', 'vcc'], ['AT', 'a'], ['BT', 'a'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['AB', 'b'], ['BB', 'b'], ['U1', 'gnd']),
            net('np', ['AT', 'b'], ['AB', 'a'], ['U1', '1_pos']),      // 2.5 V
            net('nn', ['BT', 'b'], ['BB', 'a'], ['U1', '1_neg']),      // 2.0 V
            net('no', ['U1', '1_out'], ['MCU', 'P1.0']),
        ]);
        board.setPin('P1.0', 'input', false);
        board.advanceTo(1n);
        const v = board.readAnalog('P1.0');
        assert.ok(v > 3.3, `v+ > v- → output at the top swing (~3.5), got ${v.toFixed(2)}`);
    });

    it('a voltage follower converges onto its input', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G, ...DIV('A', 15000, 10000), AMP,
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }], [
            net('nv', ['VCC', 'vcc'], ['AT', 'a'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['AB', 'b'], ['U1', 'gnd']),
            net('np', ['AT', 'b'], ['AB', 'a'], ['U1', '1_pos']),      // 2.0 V
            net('nfb', ['U1', '1_out'], ['U1', '1_neg'], ['MCU', 'P1.0']),
        ]);
        board.setPin('P1.0', 'input', false);
        board.advanceTo(1n);
        const v = board.readAnalog('P1.0');
        assert.ok(Math.abs(v - 2.0) < 0.03, `follower tracks 2.0 V, got ${v.toFixed(3)}`);
    });

    it('a non-inverting ×2 stage lands on twice the input', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G, ...DIV('A', 40000, 10000), R('RF', 10000), R('RG', 10000), AMP,
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }], [
            net('nv', ['VCC', 'vcc'], ['AT', 'a'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['AB', 'b'], ['RG', 'b'], ['U1', 'gnd']),
            net('np', ['AT', 'b'], ['AB', 'a'], ['U1', '1_pos']),      // 1.0 V
            net('nn', ['U1', '1_neg'], ['RF', 'a'], ['RG', 'a']),
            net('no', ['U1', '1_out'], ['RF', 'b'], ['MCU', 'P1.0']),
        ]);
        board.setPin('P1.0', 'input', false);
        board.advanceTo(1n);
        const v = board.readAnalog('P1.0');
        assert.ok(Math.abs(v - 2.0) < 0.05, `gain 2 on 1.0 V → 2.0 V, got ${v.toFixed(3)}`);
    });
});

describe('LM3915', () => {
    function rig(sigVolts, bar) {
        const board = new BoardImpl(5.0);
        // The signal comes from a divider so it is a real node voltage.
        const rTop = Math.max(1, Math.round(10000 * (5 - sigVolts) / Math.max(0.001, sigVolts)));
        board.setNetlist([V, G, R('ST', rTop), R('SB', 10000),
            { id: 'U1', kind: 'lm3915', params: {}, terminals: ['vcc', 'gnd', 'sig', 'mode', ...Array.from({ length: 10 }, (_, i) => `l${i + 1}`)] },
        ], [
            net('nv', ['VCC', 'vcc'], ['ST', 'a'], ['U1', 'vcc'],
                ...(bar ? [['U1', 'mode']] : [])),
            net('ng', ['GND', 'gnd'], ['SB', 'b'], ['U1', 'gnd'],
                ...(bar ? [] : [['U1', 'mode']])),
            net('ns', ['ST', 'b'], ['SB', 'a'], ['U1', 'sig']),
        ]);
        board.advanceTo(1n);
        return board.getDeviceState('U1');
    }

    it('the 3 dB ladder: full scale lights all ten, −9 dB lights seven', () => {
        assert.equal(rig(1.26, true).level, 10);
        const minus9 = 1.25 * Math.pow(10, -9 / 20) * 1.01;   // just above step 7
        assert.equal(rig(minus9, true).level, 7);
        assert.equal(rig(0.02, true).level, 0, 'below the bottom step: dark');
    });

    it('bar sinks all LEDs up to the level; dot sinks exactly one', () => {
        const bar = rig(1.26, true);
        assert.equal(bar.bar, true);
        const dot = rig(1.26, false);
        assert.equal(dot.bar, false);
        assert.equal(dot.level, 10, 'dot mode still knows the level');
    });
});

// ─── D18: the realised closed-loop gain IS the design gain ──────────────
//
// The defect (docs/WAVE-OPEN-DEFECTS.md D18, found by lite's Wave 2
// review): the LM358 was a damped integrator that halted once its output
// step fell below 1 mV, leaving up to 1 mV / G_STEP = 0.667 mV of INPUT
// error unamplified. On the shipped ×46.45 shunt front end (100 kΩ /
// 2.2 kΩ) that is a third of a 2 mV signal, so the realised gain came out
// 31.04 at 2 mV, 38.79 at 4 mV, 43.39 at 10 mV — short of the design gain,
// and DIFFERENT at every input, which is the part that cannot be papered
// over with a tolerance.
//
// Every number below is hand-computed from the resistors, not recorded
// from a run. The model's declared 1 MΩ input resistance does NOT appear
// in them, and that is measured, not assumed: `ctx.conductance(t, null, g)`
// is a no-op since the air-leg guard landed in `stampTwoTerminal` (a
// terminal on no net carries no current, and `null` is no net), so the
// inverting input is the ideal high-Z node the textbook formula assumes.
const NONINV_GAIN = 1 + 100000 / 2200;   // 46.454545454545454…

/** Non-inverting stage: VS → 1_pos, RF from 1_out to 1_neg, RG to gnd. */
function nonInverting(vin, { rf = 100000, rg = 2200, rl = 100000 } = {}) {
    const board = new BoardImpl(5.0);
    board.setNetlist([V, G,
        { id: 'VS', kind: 'vsource', params: { volts: vin }, terminals: ['pos', 'neg'] },
        AMP, R('RF', rf), R('RG', rg), R('RL', rl)], [
        net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
        net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['VS', 'neg'], ['RG', 'b'], ['RL', 'b']),
        net('np', ['VS', 'pos'], ['U1', '1_pos']),
        net('nn', ['U1', '1_neg'], ['RF', 'a'], ['RG', 'a']),
        net('no', ['U1', '1_out'], ['RF', 'b'], ['RL', 'a']),
    ]);
    board.advanceTo(1n);
    return board;
}

describe('LM358 closed-loop gain (D18)', () => {
    it('the ×46.4545 shunt front end realises 1 + Rf/Rg at every input', () => {
        // Hand oracle: at the fixed point v− = v+ = Vin, and the inverting
        // node's KCL is (Vin − Vout)/Rf + Vin/Rg = 0, so
        //   Vout = Vin · (1 + Rf/Rg) = Vin · 46.454545454545…
        // The measured gain used to be 31.04 / 38.79 / 43.39 at 2 / 4 /
        // 10 mV; it is now the same number at all six.
        const gains = [];
        for (const vin of [0.0005, 0.001, 0.002, 0.004, 0.010, 0.050]) {
            const board = nonInverting(vin);
            const vout = board.nodeVoltage('no');
            gains.push(vout / vin);
            assert.ok(Math.abs(vout - vin * NONINV_GAIN) < vin * 1e-6,
                `Vin ${(vin * 1000).toFixed(3)} mV → ${(vin * NONINV_GAIN * 1000).toFixed(4)} mV, ` +
                `got ${(vout * 1000).toFixed(4)} mV (gain ${(vout / vin).toFixed(4)})`);
        }
        // And it is INPUT-INDEPENDENT, which the damped integrator never was.
        const spread = Math.max(...gains) - Math.min(...gains);
        assert.ok(spread < 1e-6, `the gain must not depend on the input; spread ${spread}`);
    });

    it('the 2 mV shunt signal the ammeter bench measures lands on 92.909 mV', () => {
        // 2.000 mV across a 20 mΩ shunt at 100 mA, the case the review
        // measured at 62.088 mV (gain 31.04). 0.002 × 46.454545… =
        // 0.09290909090909… V.
        const board = nonInverting(0.002);
        assert.ok(Math.abs(board.nodeVoltage('no') - 0.0929090909090909) < 1e-7,
            `got ${board.nodeVoltage('no')}`);
    });

    it('an inverting ×10 around a 2.5 V reference lands on its own arithmetic', () => {
        // v+ = Vref, so v− = Vref and Vout = Vref − (Rf/Rin)·(Vin − Vref).
        // Rf/Rin = 100 k/10 k = 10 exactly.
        const bench = (vin) => {
            const board = new BoardImpl(5.0);
            board.setNetlist([V, G,
                { id: 'VS', kind: 'vsource', params: { volts: vin }, terminals: ['pos', 'neg'] },
                { id: 'VR', kind: 'vsource', params: { volts: 2.5 }, terminals: ['pos', 'neg'] },
                AMP, R('RIN', 10000), R('RF', 100000), R('RL', 100000)], [
                net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
                net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['VS', 'neg'], ['VR', 'neg'], ['RL', 'b']),
                net('nin', ['VS', 'pos'], ['RIN', 'a']),
                net('nref', ['VR', 'pos'], ['U1', '1_pos']),
                net('nn', ['U1', '1_neg'], ['RIN', 'b'], ['RF', 'a']),
                net('no', ['U1', '1_out'], ['RF', 'b'], ['RL', 'a']),
            ]);
            board.advanceTo(1n);
            return board.nodeVoltage('no');
        };
        for (const [vin, expected] of [[2.45, 3.0], [2.5, 2.5], [2.55, 2.0]]) {
            assert.ok(Math.abs(bench(vin) - expected) < 1e-5,
                `Vin ${vin} V → ${expected} V, got ${bench(vin)}`);
        }
    });

    it('a demand above the swing still clamps at VCC − 1.5, not at the gain', () => {
        // 100 mV × 46.4545 = 4.645 V, past the LM358's 3.5 V top swing.
        // The drive clamps at 3.5 V behind R_OUT = 100 Ω, and the load is
        // RL ∥ (RF + RG) = 100 k ∥ 102.2 k = 50 544.0158 Ω, so the OUTPUT
        // NODE reads 3.5 × 50544.0158 / 50644.0158 = 3.4930890 V.
        const board = nonInverting(0.100);
        const rload = (100000 * 102200) / (100000 + 102200);
        const expected = 3.5 * rload / (rload + 100);
        assert.ok(Math.abs(board.nodeVoltage('no') - expected) < 1e-4,
            `clamped output ${expected.toFixed(6)} V, got ${board.nodeVoltage('no')}`);
        assert.ok(board.nodeVoltage('no') < 3.5, 'and it never reaches the ideal 4.645 V');
    });

    it('two identical solves agree bit-for-bit (the engine stays deterministic)', () => {
        const a = nonInverting(0.002).nodeVoltage('no');
        const b = nonInverting(0.002).nodeVoltage('no');
        assert.equal(a, b);
    });
});
