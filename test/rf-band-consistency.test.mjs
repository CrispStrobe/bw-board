// The envelope integrator must satisfy each nonlinear port's equation.
// A norm of all ports can agree while an unrelated oscillator is moved.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { BandIntegrator, H_UNIT, VT } from '../src/rf-bands.js';

const capacitance = 1e-9;
const conductance = amplitude => 1e-7 * Math.exp(amplitude / VT);
const zeros = n => new Float64Array(n * n);

// C dX_q/dt + g(|X_q|) X_q = J_q: diagonal, uncoupled channels.
// The independent oracle below solves this equation directly, without the
// integrator's Woodbury update or its nonlinear consistency algorithm.
function step(initial, source, k, { phases = initial.map(() => 0), previous = null, junctionCap = () => 0, law = conductance } = {}) {
    const n = initial.length;
    const band = new BandIntegrator({ N: n, ports: initial.map((_, pos) => ({ pos })), blocks: initial.map((_, q) => [q]) });
    const cap = zeros(n);
    for (let q = 0; q < n; q++) cap[q * n + q] = capacitance;
    band.setLinear({ re: zeros(n), im: zeros(n) }, { re: cap, im: zeros(n) });
    const phasors = amplitudes => ({
        re: Float64Array.from(amplitudes, (v, q) => v * Math.cos(phases[q])),
        im: Float64Array.from(amplitudes, (v, q) => v * Math.sin(phases[q])),
    });
    band.X = phasors(initial);
    band.t = 0;
    const result = band.step(k, ports => {
        const S0r = zeros(n), S1r = zeros(n);
        for (let q = 0; q < n; q++) {
            const amplitude = Math.hypot(...ports[q]);
            S0r[q * n + q] = law(amplitude, q);
            S1r[q * n + q] = junctionCap(amplitude);
        }
        return { S0r, S0i: zeros(n), S1r, S1i: zeros(n) };
    }, () => phasors(source), null, previous && phasors(previous));
    return { result, amplitudes: Array.from(result.re, (v, q) => Math.hypot(v, result.im[q])), implicitSteps: band.implicitSteps ?? 0 };
}

function oracle(initial, source, k, { previous = null, junctionCap = () => 0 } = {}) {
    const h = H_UNIT * 2 ** k;
    const a = previous === null ? 1 : 1.5;
    const history = previous === null ? initial : 2 * initial - previous / 2;
    const residual = amplitude => (capacitance + junctionCap(amplitude)) * (a * amplitude - history) / h
        + conductance(amplitude) * amplitude - source;
    let lo = 0, hi = Math.max(initial, history / a);
    assert(residual(lo) < 0 && residual(hi) >= 0, 'passive decay brackets one physical root');
    for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (residual(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
}

it('RF consistency leaves an independent equilibrium unchanged beside a large nonlinear decay', () => {
    const steady = 0.05, current = conductance(steady) * steady;
    for (const k of [12, 13, 14]) {
        const combined = step([0.2, steady], [0, current], k);
        const alone = step([steady], [current], k);
        assert(combined.implicitSteps > 0, 'exercise the nonlinear consistency correction');
        assert.equal(combined.result.inconsistent, false);
        assert(Math.abs(alone.amplitudes[0] - steady) < 1e-14, 'source exactly balances its own shunt');
        assert(Math.abs(combined.amplitudes[1] - steady) < 1e-12,
            `an uncoupled transient must not move the 50 mV equilibrium: ${combined.amplitudes[1]} V at k=${k}`);
        assert(Math.abs(combined.amplitudes[0] - oracle(0.2, 0, k)) < 1e-8,
            'the decaying channel satisfies its own backward-Euler equation');
    }
});

it('RF consistency solves each changing port, independent of ordering and carrier phase', () => {
    const initial = [0.2, 0.16, 0.12], source = [0, 0, 0];
    const phases = [0.7, -2.4, 1.3], k = 14;
    const combined = step(initial, source, k, { phases });
    const reverse = step(initial.toReversed(), source, k, { phases: phases.toReversed() });
    for (let q = 0; q < initial.length; q++) {
        const expected = oracle(initial[q], source[q], k);
        assert(Math.abs(combined.amplitudes[q] - expected) < 1e-8,
            `port ${q} satisfies its scalar equation: ${combined.amplitudes[q]} vs ${expected}`);
        const alone = step([initial[q]], [source[q]], k, { phases: [phases[q]] });
        assert(Math.abs(combined.amplitudes[q] - alone.amplitudes[0]) < 1e-12,
            'each independent transient agrees with its standalone integration');
        assert(Math.abs(combined.amplitudes[q] - reverse.amplitudes[initial.length - 1 - q]) < 1e-12,
            'port order does not transfer amplitude between channels');
        const angle = Math.atan2(combined.result.im[q], combined.result.re[q]);
        assert(Math.abs(angle - phases[q]) < 1e-12, 'a passive shunt does not rotate the carrier');
    }
});

it('RF consistency includes each nonlinear capacitance history in BDF2', () => {
    const initial = [0.2, 0.16], previous = [0.22, 0.17], source = [0, 0], k = 14;
    const junctionCap = amplitude => 2e-9 / (1 + amplitude);
    const combined = step(initial, source, k, { previous, junctionCap });
    for (let q = 0; q < initial.length; q++) {
        const expected = oracle(initial[q], source[q], k, { previous: previous[q], junctionCap });
        assert(Math.abs(combined.amplitudes[q] - expected) < 1e-8,
            `port ${q} includes its own end-stamp capacitive history: ${combined.amplitudes[q]} vs ${expected}`);
    }
});

it('RF consistency does not extend a port beyond its explicit change', () => {
    const initial = 0.2, k = 14, h = H_UNIT * 2 ** k;
    // This decreasing conductance strengthens the decay as the swing
    // drops. Its fully implicit root is below the explicit end, so the
    // bounded consistency correction must leave that end to the step
    // controller; it cannot extrapolate the change or choose another mode.
    const law = amplitude => 1e-4 / (1 + 100 * amplitude);
    const expected = initial / (1 + h * law(initial) / capacitance);
    const actual = step([initial], [0], k, { law });
    assert(Math.abs(actual.amplitudes[0] - expected) < 1e-14);
    assert.equal(actual.result.inconsistent, false);
});

it('RF consistency does not let an independent out-of-bounds root suppress another port correction', () => {
    const initial = 0.2, k = 14, h = H_UNIT * 2 ** k;
    const decreasing = amplitude => 1e-4 / (1 + 100 * amplitude);
    const explicit = initial / (1 + h * decreasing(initial) / capacitance);
    for (const reversed of [false, true]) {
        const corrected = reversed ? 1 : 0, unchanged = reversed ? 0 : 1;
        const actual = step([initial, initial], [0, 0], k, {
            law: (amplitude, q) => q === corrected ? conductance(amplitude) : decreasing(amplitude),
        });
        assert(Math.abs(actual.amplitudes[corrected] - oracle(initial, 0, k)) < 1e-8,
            'the independent compression channel still gets its own consistent root');
        assert(Math.abs(actual.amplitudes[unchanged] - explicit) < 1e-14,
            'the channel whose root is outside its change retains exactly its explicit end');
    }
});
