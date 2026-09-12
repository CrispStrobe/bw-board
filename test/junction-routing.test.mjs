/**
 * WHICH JUNCTION MODEL A CIRCUIT GETS, AND WHY THERE IS A CHOICE.
 *
 * E1.3 asked whether every junction should use the Shockley exponential rather
 * than the walker's piecewise knee. `fable/e13b-shockley-default` flipped it
 * wholesale and said, in its own subject line, "do not merge unmeasured".
 *
 * MEASURED 2026-09-12 against test/golden/ngspice_diode.json, 19 cases:
 *
 *     PWL everywhere      mean 11.4%   worst 100%
 *     Shockley everywhere mean  1.8%   worst 7.8%   but ~4x slower per solve
 *     auto (this)         mean  3.0%   worst 7.6%   and no measurable slowdown
 *
 * The 100% is the reason any of this exists: two 2.0 V LEDs on a 3.3 V rail
 * read 0.000 mA under PWL where ngspice and Shockley both say 0.020 mA. The
 * hard knee reports a conducting circuit as DARK.
 *
 * Flipping wholesale fixes that and costs ~4x on every LED circuit — including
 * the single-LED cases where PWL was already within 2%, and where Shockley with
 * default parameters is actually WORSE (led_red_100: 0.8% -> 7.8%). Routing per
 * circuit takes the fix without the bill, and without those two regressions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';
import { JUNCTION_ROUTING, MNA_HEADROOM_V, junctionModelOf } from '../src/mna.js';

const chain = (n, vf, vcc) => {
    let b = new NetlistBuilder().vcc('VCC').gnd('GND').resistor('R1', 1000);
    for (let i = 1; i <= n; i++) b = b.led(`LED${i}`, vf);
    b = b.wire('VCC.vcc', 'R1.a').wire('R1.b', 'LED1.anode');
    for (let i = 1; i < n; i++) b = b.wire(`LED${i}.cathode`, `LED${i + 1}.anode`);
    b = b.wire(`LED${n}.cathode`, 'GND.gnd');
    const { parts, nets } = b.build();
    const board = new BoardImpl(vcc);
    board.setNetlist(parts, nets);
    return board;
};

test('a part with an explicit model always gets it, whatever the policy says', () => {
    // A choice written on the device is a statement about that device. A global
    // policy that overruled it would make `params.model` advisory, and every
    // circuit that opted in for a measured reason would silently change.
    for (const mode of ['auto', 'pwl', 'shockley']) {
        assert.equal(junctionModelOf({params: {model: 'shockley'}}, 99), 'shockley',
            `an explicit shockley was overruled with policy ${mode}`);
        assert.equal(junctionModelOf({params: {model: 'pwl'}}, -99), 'pwl',
            `an explicit pwl was overruled with policy ${mode}`);
    }
});

test('the threshold routes by headroom, and it is the derived one', () => {
    // MNA_HEADROOM_V is not a taste. Sweeping supply headroom against the worst
    // PWL/Shockley disagreement over R and topology gives a curve that
    // asymptotes at ~13.7%: 100% at cut-off, 32.8% at 1 V, 18.7% at 2 V, 13.7%
    // by 4 V. Two volts is where the walker reaches ~1.4x its asymptotic best —
    // past it, routing buys accuracy that is not there.
    assert.equal(MNA_HEADROOM_V, 2.0,
        'the routing threshold moved. It was derived from a measured curve; move it with a '
        + 'new measurement in the commit, not with a preference.');
    const bare = {kind: 'led', params: {}};
    assert.equal(junctionModelOf(bare, MNA_HEADROOM_V - 0.01), 'shockley', 'just below the threshold must route to MNA');
    assert.equal(junctionModelOf(bare, MNA_HEADROOM_V + 0.01), 'pwl', 'just above it must stay on the walker');
    assert.equal(junctionModelOf(bare, -1), 'shockley', 'a circuit below cut-off must never be left to the knee');
});

test('the toggle reaches a real solve, in both directions', () => {
    // The escape hatch has to WORK, or it is a comment. A single LED at 5 V is
    // above the threshold, so auto leaves it on the walker; forcing shockley
    // must change the answer, and forcing pwl must restore it.
    const before = JUNCTION_ROUTING.mode;
    try {
        JUNCTION_ROUTING.mode = 'pwl';
        const iPwl = chain(1, 2.0, 5.0).branchCurrent('LED1', 'anode');
        JUNCTION_ROUTING.mode = 'shockley';
        const iShk = chain(1, 2.0, 5.0).branchCurrent('LED1', 'anode');
        JUNCTION_ROUTING.mode = 'auto';
        const iAuto = chain(1, 2.0, 5.0).branchCurrent('LED1', 'anode');

        assert.ok(Math.abs(iPwl - iShk) > 1e-6,
            'forcing shockley produced the same current as forcing pwl — the toggle is not '
            + `reaching the solve (both ${(iPwl * 1000).toFixed(4)} mA)`);
        assert.equal(iAuto, iPwl,
            'a single LED at 5 V has 3 V of headroom, above the threshold, so auto must agree '
            + 'with pwl here — if it does not, the routing is not using the threshold');
    } finally { JUNCTION_ROUTING.mode = before; }
});

test('the qualitative failure is gone: a conducting circuit is not reported dark', () => {
    // THE CASE THIS WHOLE MECHANISM EXISTS FOR. Two 2.0 V LEDs on 3.3 V:
    // headroom is NEGATIVE, ngspice measures 0.020 mA, and the piecewise knee
    // says exactly zero. A simulated board that is dark while the real one is
    // lit is not a tolerance question.
    const i = chain(2, 2.0, 3.3).branchCurrent('LED1', 'anode');
    assert.ok(i > 1e-5,
        `two LEDs on a 3.3 V rail read ${i} A — the knee model is reporting a conducting `
        + 'circuit as off. ngspice measures 0.020 mA.');
    assert.ok(Math.abs(i - 0.00002) < 0.00002,
        `current ${(i * 1e6).toFixed(1)} uA is not within a factor of two of ngspice's 20 uA`);
});

test('the model is resolved ONCE per solve, so stamp and read cannot disagree', () => {
    // mna.js's junctionCurrent says "must match what was stamped". If the model
    // were decided per call site, a matrix stamped for one model could be read
    // with the other — silently, as a wrong current rather than an error. The
    // board resolves it in setNetlist and stamps the solve-local parts; this is
    // what pins that.
    const board = chain(2, 2.0, 3.3);
    const stamped = board._solveParts.filter(p => p.kind === 'led');
    assert.ok(stamped.length >= 2, 'fixture: the solve-local parts hold no LEDs');
    for (const p of stamped) {
        assert.equal(p._junctionModel, 'shockley',
            `${p.id} was not stamped with a resolved model — every junction must carry the `
            + 'one decision the solver will read');
    }
    const above = chain(1, 2.0, 5.0);
    for (const p of above._solveParts.filter(p => p.kind === 'led')) {
        assert.equal(p._junctionModel, 'pwl', 'a high-headroom circuit must be stamped pwl');
    }
});
