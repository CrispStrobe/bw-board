// Dynamic loudspeaker and earphone (src/transducers.js).
//
// Gap (2026-11-23, round 3): there was no loudspeaker; the gallery's LM386
// bench (sb3 lab-amp-horn) stood a piezo with leakOhms 8 in for one. A
// speaker is its voice coil, Re + Le (+ optional motional impedance), and
// it sounds at the frequency of its coil current with a loudness that
// follows the current. Oracles: |Z| = |Re + jωLe| (+ the parallel motional
// R‖L‖C, = Re + Res at fs); the tone and level of a known drive.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);

/** A source (params) driving `kind` through a 1 Ω sense resistor. */
function drive(kind, params, src) {
    const b = new BoardImpl(5);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('SIG', 'vsource', src, ['pos', 'neg']),
        P('RS', 'resistor', { ohms: 1 }, ['a', 'b']), P('SPK', kind, params, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['SIG', 'neg'], ['SPK', 'b']), net('in', ['SIG', 'pos'], ['RS', 'a']),
        net('s', ['RS', 'b'], ['SPK', 'a'])]);
    b.setPower(true);
    return b;
}

/** |Z| of the transducer from a small-signal sweep: |V(in)| / |I| − 1 Ω. */
function impedance(kind, params, hz) {
    const b = drive(kind, params, { volts: 0 });
    const [pt] = b.runAc({ sourceId: 'SIG', from: hz, to: hz * 1.0001, pointsPerDecade: 1 });
    const vin = pt.results.get('in'); const vs = pt.results.get('s');
    const re = vin.mag * Math.cos(vin.phaseDeg * Math.PI / 180) - vs.mag * Math.cos(vs.phaseDeg * Math.PI / 180);
    const im = vin.mag * Math.sin(vin.phaseDeg * Math.PI / 180) - vs.mag * Math.sin(vs.phaseDeg * Math.PI / 180);
    return vs.mag / Math.hypot(re, im);
}

describe('speaker: voice-coil impedance', () => {
    it('is Re + jωLe: 8 Ω at low frequency, rising with the coil inductance', () => {
        close(impedance('speaker', {}, 100), Math.hypot(8, 2 * Math.PI * 100 * 2e-4), 0.01, '|Z| at 100 Hz');
        close(impedance('speaker', {}, 10e3), Math.hypot(8, 2 * Math.PI * 1e4 * 2e-4), 0.05, '|Z| at 10 kHz');
        close(impedance('speaker', { ohms: 4, henrys: 5e-4 }, 5e3), Math.hypot(4, 2 * Math.PI * 5e3 * 5e-4), 0.05, 'params');
    });

    it('optional motional impedance peaks at the cone resonance', () => {
        const params = { resonanceHz: 150, motionalOhms: 20, qm: 2 };
        close(impedance('speaker', params, 150), Math.hypot(28, 2 * Math.PI * 150 * 2e-4), 0.1, '|Z| at fs = Re + Res');
        assert.ok(impedance('speaker', params, 1500) < 9, 'far above fs the motional branch is a short');
        assert.ok(impedance('speaker', params, 15) < 9, 'far below fs too');
    });

    it('a magnetic earphone is a high-impedance coil; a crystal one a capacitor', () => {
        close(impedance('earphone', {}, 1000), Math.hypot(2000, 2 * Math.PI * 1000 * 0.1), 1, 'magnetic earphone at 1 kHz');
        const zc = impedance('earphone', { type: 'crystal' }, 1000);
        close(zc, 1 / (2 * Math.PI * 1000 * 10e-9), 200, 'crystal earphone at 1 kHz ≈ 1/(ωC)');
    });
});

describe('speaker: sound follows the coil current', () => {
    const run = (amp, hz = 1000, kind = 'speaker', params = {}) => {
        const b = drive(kind, params, { wave: 'sine', freq: hz, amplitude: amp, volts: 0 });
        b.advanceTo(60_000_000n);
        return b.buzzerTone('SPK');
    };

    it('pitch is the drive frequency; level is I_rms / I_rated', () => {
        const t = run(1);
        close(t.hz, 1000, 5, 'pitch');
        assert.equal(t.on, true);
        // 1 V peak across 1 Ω + |8 + j1.26| Ω: I_rms = 0.0866 A; rated sqrt(0.5 W / 8 Ω) = 0.25 A.
        const irms = 1 / Math.hypot(9, 2 * Math.PI * 1000 * 2e-4) / Math.SQRT2;
        close(t.amps, irms, 0.003, 'RMS coil current');
        close(t.level, irms / 0.25, 0.015, 'level');
        const t2 = run(0.5);
        close(t2.level / t.level, 0.5, 0.03, 'half the current, half the amplitude');
        close(run(1, 300).hz, 300, 3, 'a 300 Hz drive');
    });

    it('a steady DC through the coil makes no sound', () => {
        const b = drive('speaker', {}, { volts: 1 });
        b.advanceTo(40_000_000n);
        const t = b.buzzerTone('SPK');
        assert.equal(t.on, false);
        assert.equal(t.level, 0);
    });

    it('earphone: rated at a milliwatt, so a small current is loud', () => {
        const t = run(0.5, 800, 'earphone');
        close(t.hz, 800, 5, 'pitch');
        const irms = 0.5 / Math.hypot(2001, 2 * Math.PI * 800 * 0.1) / Math.SQRT2;
        close(t.level, Math.min(1, irms / Math.sqrt(1e-3 / 2000)), 0.02, 'level');
    });
});
