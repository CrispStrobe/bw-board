// Accepted DC bias must not be hidden behind a rejected RF trial's future.
// These controls use an independently soluble complex RC envelope; no
// oscillator frequency or circuit-specific amplitude is an oracle here.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { BandIntegrator, H_UNIT } from '../src/rf-bands.js';

registerAllDevices();
// Obtain the private band's implementation through its real public owner,
// without exposing a new production API solely for these tests.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/rf-remote-netlist.json', import.meta.url), 'utf8'));
const owner = new BoardImpl(fixture.vcc);
owner.setNetlist(fixture.parts, fixture.nets);
owner.setPower(true);
owner.advanceTo(1n);
const RfBand = owner._radio._bands[0].constructor;

const capacitance = 1e-9, firstG = 1e-4, nextG = 2e-4, angle = 0.7;
const zeros = () => new Float64Array(1);
function decay(k = 7) {
    const radio = { substeps: 0, _events: [], conductance: firstG,
        _otherAmplitudes: () => null,
        _stamps: () => ({ S0r: Float64Array.of(radio.conductance), S0i: zeros(), S1r: zeros(), S1i: zeros() }) };
    const b = new RfBand(radio, 1e6, 0);
    b.integ = new BandIntegrator({ N: 1, ports: [{ pos: 0 }], blocks: [[0]] });
    b.integ.setLinear({ re: zeros(), im: zeros() }, { re: Float64Array.of(capacitance), im: zeros() });
    b.X = { re: Float64Array.of(Math.cos(angle)), im: Float64Array.of(Math.sin(angle)) };
    b.integ.X = b.X; b.integ.t = 0;
    b.k = b.kMax = k; b.growth = 0; b._sinceBound = 0;
    b._kForBias = b._kForRotation = () => k;
    b.units = []; b.noise = [];
    b.hist = [{ t: 0, X: b.X, vp: b.integ.portVoltages(b.X), k }];
    return b;
}

it('accepted bias invalidates surplus RF future and keeps the interpolation grid and phase', () => {
    const b = decay();
    b.advanceTo(20e-6); // A full/rejected transient trial ran far ahead.
    const accepted = 5.2e-6, grid = b.hist.slice();
    const phasor = b.phasorAt(0, accepted);
    const first = grid.findLastIndex(e => e.t <= accepted);
    const retainedEnd = grid[first + 2]; // Bracket endpoint plus its C1 neighbour.
    b.prune(accepted);
    assert.equal(b.t, retainedEnd.t, 'the old-bias rejected horizon cannot survive acceptance');
    assert.equal(b.X, retainedEnd.X, 'continue from an existing complex grid state, without interpolation');
    assert.equal(b.integ.t, b.t);
    assert.equal(b.integ.X, b.X);
    assert.deepEqual(b.hist, grid.slice(first, first + 3));
    assert.deepEqual(b.phasorAt(0, accepted), phasor, 'accepted phase and voltage retain their exact bracket');
    assert(b.t - accepted <= 2 * H_UNIT * 2 ** b.k, 'only the interpolation look-ahead remains');
});

it('a changed bias controls the RC envelope after acceptance, with the grid delay converging away', () => {
    const accepted = 5.2e-6, observed = 15e-6;
    const exact = Math.exp(-(firstG * accepted + nextG * (observed - accepted)) / capacitance);
    const errors = [];
    for (const k of [7, 6, 5]) {
        const b = decay(k);
        b.advanceTo(20e-6);
        b.prune(accepted);
        b.radio.conductance = nextG;
        b.advanceTo(observed);
        const z = b.phasorAt(0, observed), amplitude = Math.hypot(...z);
        const h = H_UNIT * 2 ** k;
        // The accepted interpolation bracket retains at most two old-bias
        // grid intervals. BDF2's old derivative adds at most half an
        // interval at the discontinuity (the parasitic root is 1/3).
        // The extra 5e-5 covers the independent BE/BDF2 start error at h=128ns.
        const delayBound = exact * Math.expm1((nextG - firstG) * 2.5 * h / capacitance) + 5e-5;
        assert(Math.abs(amplitude - exact) < delayBound,
            `new bias must determine future decay: ${amplitude} vs ${exact}, allowed grid delay ${delayBound}`);
        assert(Math.abs(Math.atan2(z[1], z[0]) - angle) < 1e-12, 'a real shunt cannot rotate a carrier');
        errors.push(Math.abs(amplitude - exact));
    }
    assert(errors[1] < errors[0] && errors[2] < errors[1], 'halving the retained grid delay improves the independent solution');
});

it('discarded RF impulses can be applied again, while retained impulses are not duplicated', () => {
    const b = decay();
    b.advanceTo(20e-6);
    const retained = { tc: 4e-6 }, future = { tc: 12e-6 };
    b.radio._events = [retained, future];
    b._applied = new WeakSet([retained, future]);
    b.prune(5.2e-6);
    assert(b._applied.has(retained), 'an impulse already in retained complex state stays consumed');
    assert(!b._applied.has(future), 'an impulse in the discarded future must not disappear');
});

it('acceptance with no surplus RF future does not reset the existing continuation', () => {
    const b = decay();
    b.advanceTo(5.35e-6);
    const accepted = 5.2e-6;
    const last = b.hist.at(-1), currentX = b.X, currentT = b.t, currentK = b.k;
    b.calm = 3;
    const cache = b._sigmaCache = { ic: 1, amp: 1, sigma: -1 };
    b.prune(accepted);
    assert.equal(b.hist.at(-1), last);
    assert.equal(b.X, currentX);
    assert.equal(b.t, currentT);
    assert.equal(b.k, currentK);
    assert.equal(b.calm, 3);
    assert.equal(b._sigmaCache, cache);
});
