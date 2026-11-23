// A loudspeaker or earphone as a microphone, and acoustic coupling between
// transducers (src/acoustics.js).
//
// Gap (2026-11-23, round 4): sound could leave a speaker but never reach one,
// so "speak into the speaker", a telephone bell picked up by a speaker and
// the earphone-over-the-speaker feedback howl had no circuit at all. Oracles:
// e = S·p with p from the dB SPL level (p_rms = 20 µPa·10^(dB/20)); the
// coupled pressure K·i/r_eff, delayed by r/c; the loop-gain condition of the
// howl.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { soundWaveform, isListener, SPEED_OF_SOUND } from '../src/acoustics.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);

/** Sample a node every `stepUs` over [ms0, ms1): RMS and the samples. */
function sample(b, node, ms0, ms1, stepUs) {
    let s = 0; let n = 0; const tr = [];
    for (let us = ms0 * 1000; us < ms1 * 1000; us += stepUs) {
        b.advanceTo(BigInt(Math.round(us * 1000)));
        const v = b.nodeVoltages.get(node) ?? 0;
        s += v * v; n++; tr.push([us / 1e6, v]);
    }
    return { rms: Math.sqrt(s / n), tr };
}

/** A transducer as microphone into a 100 kΩ load. */
function mic(kind, params) {
    const b = new BoardImpl(5);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('S', kind, params, ['a', 'b']), P('R', 'resistor', { ohms: 1e5 }, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['S', 'b'], ['R', 'b']), net('o', ['S', 'a'], ['R', 'a'])]);
    b.setPower(true);
    return b;
}

describe('a transducer as a microphone', () => {
    it('only a transducer that listens gets the sound EMF; the rest are built as before', () => {
        assert.equal(isListener({ params: {} }), false);
        assert.equal(isListener({ params: { soundDb: 80 } }), true);
        assert.equal(isListener({ params: { hears: 'spk' } }), true);
        assert.equal(isListener({ params: { listen: true } }), true);
        const b = mic('speaker', {});
        assert.ok(b._solveParts.some(p => p.id === 'S_re' && p.kind === 'resistor'), 'plain speaker: plain resistor');
        assert.ok(mic('speaker', { soundDb: 80 })._solveParts.some(p => p.id === 'S_vc'), 'listening speaker: voice coil');
    });

    it('EMF = sensitivity × pressure: 94 dB SPL (1 Pa) gives 0.5 mV from a speaker', () => {
        for (const wave of ['tone', 'voice']) {
            const b = mic('speaker', { soundDb: 94, soundWave: wave });
            const { rms } = sample(b, 'o', 5, 45, 50);
            close(rms * 1e3, 0.5 * 1.0024 * 1e5 / (1e5 + 8), 0.02, `${wave}: EMF rms (mV)`);
        }
        const e = mic('earphone', { soundDb: 74, soundWave: 'tone', soundHz: 1000 });
        // 74 dB = 0.1 Pa; magnetic earphone 3 mV/Pa, 2 kΩ + 0.1 H into 100 kΩ.
        close(sample(e, "o", 5, 25, 25).rms * 1e3, 3 * 0.1002 * 1e5 / Math.hypot(1.02e5, 2 * Math.PI * 1000 * 0.1), 0.01, 'earphone EMF (mV)');
    });

    it('a louder sound is a bigger EMF: 20 dB is ten times', () => {
        const a = sample(mic('speaker', { soundDb: 70, soundWave: 'tone' }), 'o', 5, 25, 50).rms;
        const b = sample(mic('speaker', { soundDb: 90, soundWave: 'tone' }), 'o', 5, 25, 50).rms;
        close(b / a, 10, 0.05, 'ratio');
    });

    it('the sounds are normalised to RMS 1 and deterministic', () => {
        for (const soundWave of ['tone', 'voice', 'noise']) {
            let s = 0; let n = 0;
            for (let t = 0; t < 0.5; t += 1e-5) { const v = soundWaveform({ soundWave }, t); s += v * v; n++; }
            close(Math.sqrt(s / n), 1, 0.06, `${soundWave} RMS`);
        }
        assert.equal(soundWaveform({ soundWave: 'noise' }, 0.123), soundWaveform({ soundWave: 'noise' }, 0.123));
        // A bell rings in bursts: silent between them.
        const P = { soundWave: 'ring', ringOnS: 0.2, ringOffS: 0.3 };
        assert.ok(Math.abs(soundWaveform(P, 0.05)) > 0 || Math.abs(soundWaveform(P, 0.051)) > 0);
        assert.equal(soundWaveform(P, 0.45), 0);
    });
});

describe('acoustic coupling between transducers', () => {
    /** A 1 kHz, 1 V drive into a speaker; an earphone hears it at `cm`. */
    const pair = (cm) => {
        const b = new BoardImpl(5);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('SIG', 'vsource', { wave: 'sine', freq: 1000, amplitude: 1, volts: 0 }, ['pos', 'neg']),
            P('S', 'speaker', {}, ['a', 'b']), P('E', 'earphone', { hears: 'S', distanceCm: cm }, ['a', 'b']),
            P('R', 'resistor', { ohms: 1e6 }, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['SIG', 'neg'], ['S', 'b'], ['E', 'b'], ['R', 'b']), net('i', ['SIG', 'pos'], ['S', 'a']),
            net('o', ['E', 'a'], ['R', 'a'])]);
        b.setPower(true);
        return b;
    };
    const iRms = 1 / Math.hypot(8, 2 * Math.PI * 1000 * 2e-4) / Math.SQRT2;

    it('p = K·i/r_eff: 1/r far away, levelling off near the cone', () => {
        for (const cm of [1, 10, 100]) {
            const got = sample(pair(cm), 'o', 5, 25, 10).rms;
            const rEff = Math.hypot(cm / 100, 0.025);
            close(got, 3e-3 * 1.0 * iRms / rEff, 0.01 * got + 1e-6, `${cm} cm`);
        }
    });

    it('sound takes r/c to arrive', () => {
        const { tr } = sample(pair(100), 'o', 5, 8, 2);
        // The earphone EMF lags the drive by 1 m / 343 m/s = 2.92 ms (plus the
        // small phase of the coils): correlate against delayed copies.
        const score = (lag) => tr.reduce((s, [t, v]) => s + v * Math.sin(2 * Math.PI * 1000 * (t - lag)), 0);
        let best = 0; let bestLag = 0;
        for (let lag = 2.5e-3; lag < 3.5e-3; lag += 2e-6) { const sc = score(lag); if (sc > best) { best = sc; bestLag = lag; } }
        const coilPhase = (Math.atan2(2 * Math.PI * 1000 * 2e-4, 8) + Math.atan2(2 * Math.PI * 1000 * 0.1, 1.002e6)) / (2 * Math.PI * 1000);
        // Sampled every 2 µs; the lag lands within a sample or two of the oracle,
        // modulo a period of the 1 kHz drive.
        const want = 1 / SPEED_OF_SOUND + coilPhase;
        close(bestLag, want, 6e-6, 'delay (s)');
    });

    it('feedback howl: earphone over the speaker of a ×200 amplifier howls close, not far away', () => {
        const howl = (cm, ms) => {
            const b = new BoardImpl(9);
            b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('BAT', 'vsource', { volts: 9 }, ['pos', 'neg']),
                P('U', 'lm386', {}, ['gain1', 'inn', 'inp', 'gnd', 'vout', 'vs', 'bypass', 'gain8']),
                P('CG', 'capacitor', { farads: 10e-6 }, ['a', 'b']), P('CO', 'capacitor', { farads: 220e-6 }, ['a', 'b']),
                P('S', 'speaker', {}, ['a', 'b']), P('E', 'earphone', { hears: 'S', distanceCm: cm }, ['a', 'b'])],
            [net('g', ['G', 'gnd'], ['BAT', 'neg'], ['U', 'gnd'], ['U', 'inn'], ['S', 'b'], ['E', 'b']), net('v', ['BAT', 'pos'], ['U', 'vs']),
                net('in', ['E', 'a'], ['U', 'inp']), net('g1', ['U', 'gain1'], ['CG', 'a']), net('g8', ['U', 'gain8'], ['CG', 'b']),
                net('o', ['U', 'vout'], ['CO', 'a']), net('sp', ['CO', 'b'], ['S', 'a'])]);
            b.setPower(true);
            b.advanceTo(BigInt(ms) * 1_000_000n);
            assert.equal(b.transientAnalysisStatus().failure, null);
            return b.buzzerTone('S');
        };
        // Loop gain = S_ear · K_spk / r_eff · 200 / 8 Ω = 0.075 m / r_eff: above
        // one inside r_eff = 7.5 cm (r ≈ 7 cm), below beyond.
        const near = howl(3, 30);
        assert.equal(near.on, true);
        assert.ok(near.level > 0.9, `3 cm: howls at full level (${near.level})`);
        // Far away the switch-on thump rings down (the loop gain is 0.24) and
        // the speaker falls silent; the level is a 20 ms running RMS, so
        // listen once the thump has left it.
        const far = howl(30, 150);
        assert.ok(!(far.level > 0.02), `30 cm: no howl (${far.level})`);
    });
});
