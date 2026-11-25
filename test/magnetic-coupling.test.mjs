// Audio-frequency magnetic field sources and a coil-driven pendulum
// (src/magnetic-coupling.js).
//
// Gap (2026-11-24): a coil could only pick up a falling magnet; no part
// carried an audio-frequency current whose MAGNETIC field another coil
// overhears (a loaded mains cable, a telephone's transformer, an induction
// loop) — the hum finder's probe is capacitive. And nothing mechanical
// swung: an electromagnet could not kick a pendulum. Oracles: the field of
// a circular loop on its axis, of a straight wire and of a two-core cable;
// Faraday's law with the mutual inductance (EMF = ωMI); the pendulum's
// period 2π√(L/g)·(1 + θ²/16) and its amplitude decay e^{−ω₀t/2Q}; energy
// bookkeeping of the electromechanical coupling.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { airCoilCard } from '../src/sensing-transducers.js';
import {
    MU0, inductionLoopCard, sourceTeslaPerAmp, pickupMutual, loopDistanceM,
    pendulumCard, bobCoupling, bobCouplingSlope, coilTorque, stepPendulum, pendulumEnergy,
} from '../src/magnetic-coupling.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);
const ms = (x) => BigInt(Math.round(x * 1e6));

describe('magnetic field sources: field per ampere by shape', () => {
    it('a loop on its axis, a straight wire, a two-core cable', () => {
        const loop = inductionLoopCard({ params: { shape: 'loop', turns: 50, radiusM: 0.02 } });
        close(sourceTeslaPerAmp(loop, 0), MU0 * 50 / (2 * 0.02), 1e-12, 'loop centre µ0N/2r');
        // Far off a loop is a dipole: B·d³ → µ0·N·r²/2.
        close(sourceTeslaPerAmp(loop, 2) * 8 / (MU0 * 50 * 4e-4 / 2), 1, 1e-3, 'loop far field ∝ 1/d³');
        const wire = inductionLoopCard({ params: { shape: 'wire' } });
        close(sourceTeslaPerAmp(wire, 0.05), 2e-7 / 0.05, 1e-15, 'wire µ0/2πd');
        const cable = inductionLoopCard({ params: { shape: 'cable', spacingMm: 6 } });
        // Far off a cable the two cores' fields cancel to ∝ s/d²: ten times
        // the distance, a hundredth of the field.
        const r = sourceTeslaPerAmp(cable, 0.5) / sourceTeslaPerAmp(cable, 0.05);
        close(r, 0.01, 2e-4, 'cable ∝ 1/d² far off');
        // At 5 cm, 6 mm apart: s·d/(d² + s²/4) ≈ 0.12 of a single wire's field.
        close(sourceTeslaPerAmp(cable, 0.05) / sourceTeslaPerAmp(wire, 0.05), 0.006 * 0.05 / (0.0025 + 0.000009), 1e-12, 'go and return nearly cancel');
        // The knob: 0 far, 1 near, linear.
        close(loopDistanceM(loop, 0), 0.30, 1e-12, 'knob 0 = farCm');
        close(loopDistanceM(loop, 1), 0.01, 1e-12, 'knob 1 = nearCm');
        close(loopDistanceM(loop, undefined), 0.155, 1e-12, 'rest = position 0.5');
    });

    it('a tone through a loop: the pickup coil develops ω·M·I, falling as the loop moves away', () => {
        // 800 Hz, 1 V peak, 100 Ω (+ the generator's 0 Ω) through a 50-turn
        // loop; a 1000-turn pickup across 1 MΩ.
        const build = (knob, shape = 'loop') => {
            const b = new BoardImpl(5);
            b.setNetlist([
                P('G', 'gnd', {}, ['gnd']),
                P('F', 'function_gen', { wave: 'sine', freq: 800, amplitude: 1, offset: 0, rOut: 0 }, ['out', 'gnd']),
                P('R', 'resistor', { ohms: 100 }, ['a', 'b']),
                P('S', 'induction_loop', { shape, pickup: 'L', turns: 50, radiusM: 0.02 }, ['a', 'b']),
                P('L', 'air_coil', { turns: 1000 }, ['a', 'b']),
                P('RL', 'resistor', { ohms: 1e6 }, ['a', 'b']),
            ], [
                net('g', ['G', 'gnd'], ['F', 'gnd'], ['S', 'b'], ['L', 'b'], ['RL', 'b']),
                net('f', ['F', 'out'], ['R', 'a']), net('s', ['R', 'b'], ['S', 'a']),
                net('o', ['L', 'a'], ['RL', 'a']),
            ]);
            b.setPower(true);
            if (knob !== undefined) b.setControl('S', knob);
            return b;
        };
        const peak = (b) => {
            let mx = 0;
            for (let t = 0.1; t <= 10; t += 0.02) { b.advanceTo(ms(t)); if (t > 5) mx = Math.max(mx, Math.abs(b.nodeVoltages.get('o'))); }
            return mx;
        };
        const src = inductionLoopCard({ params: { turns: 50, radiusM: 0.02 } });
        const coil = airCoilCard({ params: { turns: 1000 } });
        for (const knob of [0.5, 0.9]) {
            const d = loopDistanceM(src, knob);
            const M = pickupMutual(src, coil, d);
            const I = 1 / Math.hypot(100 + src.ohms, 2 * Math.PI * 800 * src.henrys);
            const want = 2 * Math.PI * 800 * M * I;
            const got = peak(build(knob));
            close(got / want, 1, 0.03, `pickup EMF at ${(d * 100).toFixed(1)} cm (want ${(want * 1e3).toFixed(3)} mV)`);
        }
        // A cable carries the same current: at 5 cm its two cores leave far less.
        assert.ok(peak(build(0.5, 'cable')) < peak(build(0.5, 'loop')) / 3, 'two-core cable: weaker field');
    });

    it('two sources, one pickup: the EMFs add; an unloaded cable (no current) adds nothing', () => {
        const build = (lampOn) => {
            const b = new BoardImpl(5);
            const parts = [
                P('G', 'gnd', {}, ['gnd']),
                P('F', 'function_gen', { wave: 'sine', freq: 800, amplitude: 1, offset: 0, rOut: 0 }, ['out', 'gnd']),
                P('R', 'resistor', { ohms: 100 }, ['a', 'b']),
                P('S', 'induction_loop', { shape: 'loop', pickup: 'L', position: 0.5 }, ['a', 'b']),
                P('M', 'function_gen', { wave: 'sine', freq: 50, amplitude: 17, offset: 0, rOut: 0 }, ['out', 'gnd']),
                P('C', 'induction_loop', { shape: 'cable', pickup: 'L', position: 0.9 }, ['a', 'b']),
                P('LAMP', 'resistor', { ohms: lampOn ? 7 : 1e9 }, ['a', 'b']),
                P('L', 'air_coil', { turns: 1000 }, ['a', 'b']),
                P('RL', 'resistor', { ohms: 1e6 }, ['a', 'b']),
            ];
            b.setNetlist(parts, [
                net('g', ['G', 'gnd'], ['F', 'gnd'], ['S', 'b'], ['M', 'gnd'], ['LAMP', 'b'], ['L', 'b'], ['RL', 'b']),
                net('f', ['F', 'out'], ['R', 'a']), net('s', ['R', 'b'], ['S', 'a']),
                net('m', ['M', 'out'], ['C', 'a']), net('c', ['C', 'b'], ['LAMP', 'a']),
                net('o', ['L', 'a'], ['RL', 'a']),
            ]);
            b.setPower(true);
            return b;
        };
        // Sample one 20 ms mains period finely; split the pickup voltage into
        // its 50 Hz and 800 Hz parts by correlation.
        const parts = (b) => {
            b.advanceTo(ms(40));
            let s50 = 0, c50 = 0, s800 = 0, c800 = 0, n = 0;
            for (let t = 40.02; t <= 80.0001; t += 0.02) {
                b.advanceTo(ms(t));
                const v = b.nodeVoltages.get('o'), x = t / 1000;
                s50 += v * Math.sin(2 * Math.PI * 50 * x); c50 += v * Math.cos(2 * Math.PI * 50 * x);
                s800 += v * Math.sin(2 * Math.PI * 800 * x); c800 += v * Math.cos(2 * Math.PI * 800 * x);
                n++;
            }
            return { a50: 2 * Math.hypot(s50, c50) / n, a800: 2 * Math.hypot(s800, c800) / n };
        };
        const on = parts(build(true)), off = parts(build(false));
        const cable = inductionLoopCard({ params: { shape: 'cable' } });
        const coil = airCoilCard({ params: { turns: 1000 } });
        const want50 = 2 * Math.PI * 50 * pickupMutual(cable, coil, loopDistanceM(cable, 0.9)) * 17 / (7 + cable.ohms);
        close(on.a50 / want50, 1, 0.03, `hum from the loaded cable (want ${(want50 * 1e3).toFixed(3)} mV)`);
        assert.ok(off.a50 < want50 / 1000, `unloaded cable: ${off.a50} V of hum`);
        close(on.a800 / off.a800, 1, 0.01, 'the telephone tone is the same either way');
        assert.ok(on.a800 > 1e-4, `telephone tone ${on.a800} V`);
    });
});

describe('coil pendulum', () => {
    it('swings at 2π√(L/g)(1 + θ²/16) and dies away at e^{−ω₀t/2Q} with no current', () => {
        const card = pendulumCard({ params: { lengthM: 0.15, q: 20, startDeg: 10 } });
        let s = { theta: card.startRad, omega: 0 };
        const dt = 1e-3;
        let t = 0, last = null; const crossings = [];
        while (t < 6) {
            const prev = s.theta;
            s = stepPendulum(card, s, 0, dt);
            t += dt;
            if (prev < 0 && s.theta >= 0) { const tc = t - dt * s.theta / (s.theta - prev); if (last !== null) crossings.push(tc - last); last = tc; }
        }
        const T0 = 2 * Math.PI * Math.sqrt(0.15 / 9.81);
        // Early swings are ~10°: the finite-amplitude correction is +0.2 %;
        // damping lengthens by 1/√(1 − 1/4Q²) ≈ +0.03 %.
        close(crossings[0] / T0, 1 + (10 * Math.PI / 180) ** 2 / 16, 3e-3, 'first period');
        const e0 = pendulumEnergy(card, { theta: card.startRad, omega: 0 });
        const e6 = pendulumEnergy(card, s);
        close(Math.log(e6 / e0), -card.omega0 * 6 / card.q, 0.05, 'energy decays at ω₀/Q');
    });

    it('the pull: iron is pulled towards the pole whatever the current sign; a magnet with it', () => {
        const iron = pendulumCard({ params: {} });
        assert.ok(coilTorque(iron, 0, 0.3) > 0 && coilTorque(iron, 0, -0.3) > 0, 'iron: towards the pole (+θ) both ways');
        close(coilTorque(iron, 0, 0.6) / coilTorque(iron, 0, 0.3), 4, 1e-9, 'iron: ∝ i²');
        assert.ok(bobCoupling(iron, 0.1) > bobCoupling(iron, 0), 'iron nearer the pole: more inductance');
        const mag = pendulumCard({ params: { bob: 'magnet' } });
        close(coilTorque(mag, 0.05, 0.3), -coilTorque(mag, 0.05, -0.3), 1e-15, 'magnet: reverses with the current');
        close(coilTorque(mag, 0.05, 0.3), 0.3 * bobCouplingSlope(mag, 0.05), 1e-15, 'τ = i·dΛ/dθ');
    });

    /** Largest swing (degrees) over 8..12 s of current pulses i for `ton` s at f Hz. */
    const pulsed = (card, f, i, ton) => {
        let s = { theta: 0, omega: 0 }, mx = 0;
        const dt = 1e-3;
        for (let k = 0; k < 12000; k++) {
            const t = k * dt;
            const on = (t * f - Math.floor(t * f)) / f < ton;
            s = stepPendulum(card, s, on ? i : 0, dt);
            if (t > 8) mx = Math.max(mx, Math.abs(s.theta));
        }
        return mx * 180 / Math.PI;
    };

    it('pulsed at its own frequency it swings up, at half rate it still builds, detuned it barely moves', () => {
        // 60 mA for 0.11 s per kick: the paper clip's pull is a strong,
        // nonlinear spring near the pole, so the response peaks a little
        // below f0 (the pull softens the swing) and is lopsided.
        const card = pendulumCard({ params: {} });
        const f0 = card.naturalHz;
        const res = Math.max(pulsed(card, 0.9 * f0, 0.06, 0.11), pulsed(card, 0.95 * f0, 0.06, 0.11));
        const half = Math.max(pulsed(card, 0.45 * f0, 0.06, 0.11), pulsed(card, 0.5 * f0, 0.06, 0.11));
        const off = Math.max(pulsed(card, 0.7 * f0, 0.06, 0.11), pulsed(card, 1.2 * f0, 0.06, 0.11), pulsed(card, 1.4 * f0, 0.06, 0.11));
        // MEASURED 2026-11-24: res -> 14.7°, half -> 1.5°, off -> 0.5°.
        assert.ok(res > 10, `resonant ${res}°`);
        assert.ok(res > 10 * off, `resonant ${res}° vs detuned ${off}°`);
        assert.ok(half > 2 * off, `half rate ${half}° vs detuned ${off}°`);
    });

    /**
     * A two-transistor astable whose Q1 carries the pendulum's coil
     * (flyback diode across it): Q1 conducts for ≈0.69·10 kΩ·15 µF and is
     * off for a time set by RB1 and 220 µF.
     */
    const astable = (rb1) => {
        const b = new BoardImpl(9);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('V', 'vsource', { volts: 9 }, ['pos', 'neg']),
            P('X', 'coil_pendulum', {}, ['a', 'b']), P('D', 'diode', {}, ['anode', 'cathode']), P('RC2', 'resistor', { ohms: 1000 }, ['a', 'b']),
            P('C1', 'capacitor', { farads: 15e-6 }, ['a', 'b']), P('C2', 'capacitor', { farads: 220e-6 }, ['a', 'b']),
            P('RB1', 'resistor', { ohms: rb1 }, ['a', 'b']), P('RB2', 'resistor', { ohms: 10000 }, ['a', 'b']),
            P('Q1', 'npn', { beta: 100 }, ['collector', 'base', 'emitter']), P('Q2', 'npn', { beta: 100 }, ['collector', 'base', 'emitter'])],
        [net('g', ['G', 'gnd'], ['V', 'neg'], ['Q1', 'emitter'], ['Q2', 'emitter']),
            net('vcc', ['V', 'pos'], ['RC2', 'a'], ['X', 'a'], ['D', 'cathode'], ['RB1', 'a'], ['RB2', 'a']),
            net('c1', ['X', 'b'], ['D', 'anode'], ['Q1', 'collector'], ['C1', 'a']), net('b2', ['C1', 'b'], ['Q2', 'base'], ['RB2', 'b']),
            net('c2', ['RC2', 'b'], ['Q2', 'collector'], ['C2', 'a']), net('b1', ['C2', 'b'], ['Q1', 'base'], ['RB1', 'b'])]);
        b.setPower(true);
        return b;
    };

    it('in a circuit: a transistor astable near the pendulum frequency swings it, a fast one does not', () => {
        const tuned = astable(9400), fast = astable(4700);
        tuned.advanceTo(ms(6000)); fast.advanceTo(ms(6000));
        const a = tuned.getDeviceState('X').amplitudeDeg, o = fast.getDeviceState('X').amplitudeDeg;
        // MEASURED 2026-11-24: tuned (drive 1.21 Hz) -> observed ≈ 16°, fast (2.14 Hz) -> ≈ 0.3°.
        assert.ok(a > 8, `tuned astable: ${a}°`);
        assert.ok(o < 1.5, `fast astable: ${o}°`);
        assert.ok(tuned.getDeviceState('X').amps >= 0, 'coil current published');
        assert.equal(tuned.transientAnalysisStatus().failure, null);
    });

    it('a swinging magnet induces dΛ/dθ·ω in the open coil; energy is conserved through the coupling', () => {
        const b = new BoardImpl(5);
        b.setNetlist([
            P('G', 'gnd', {}, ['gnd']),
            P('X', 'coil_pendulum', { bob: 'magnet', startDeg: 20, q: 200 }, ['a', 'b']),
            P('RL', 'resistor', { ohms: 1e6 }, ['a', 'b']),
        ], [net('g', ['G', 'gnd'], ['X', 'b'], ['RL', 'b']), net('o', ['X', 'a'], ['RL', 'a'])]);
        b.setPower(true);
        const card = pendulumCard({ params: { bob: 'magnet', startDeg: 20, q: 200 } });
        let worst = 0, peak = 0;
        for (let t = 5; t <= 400; t += 5) {
            b.advanceTo(ms(t));
            const st = b.getDeviceState('X');
            const want = bobCouplingSlope(card, st.angleDeg * Math.PI / 180) * st.omega;
            const v = b.nodeVoltages.get('o');
            peak = Math.max(peak, Math.abs(want));
            worst = Math.max(worst, Math.abs(v - want));
        }
        assert.ok(peak > 1e-3, `a swinging magnet induces ${peak} V`);
        assert.ok(worst < 0.02 * peak, `EMF follows dΛ/dθ·ω (worst ${worst} of ${peak})`);

        // Loaded by a few ohms the induced current brakes the swing (Lenz):
        // it loses energy faster than it does open-circuit.
        const braked = (ohms) => {
            const c = new BoardImpl(5);
            c.setNetlist([
                P('G', 'gnd', {}, ['gnd']),
                P('X', 'coil_pendulum', { bob: 'magnet', startDeg: 20, q: 200, gapMm: 6, offsetMm: 0, magnetAm2: 0.2, momentPerAmp: 1 }, ['a', 'b']),
                P('RL', 'resistor', { ohms }, ['a', 'b']),
            ], [net('g', ['G', 'gnd'], ['X', 'b'], ['RL', 'b']), net('o', ['X', 'a'], ['RL', 'a'])]);
            c.setPower(true);
            c.advanceTo(ms(1500));
            return c.getDeviceState('X').energyJ;
        };
        assert.ok(braked(0.01) < 0.9 * braked(1e6), 'shorted coil brakes the magnet');
    });
});
