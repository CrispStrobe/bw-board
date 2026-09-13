/**
 * A REGISTERED DEVICE MAY SOURCE A TERMINAL ONCE, NOT TWICE.
 *
 * `stampDevice` stamps every entry of `state.drives` as a Norton companion and
 * THEN calls `model.stamp(ctx)`. A model that also calls `ctx.thevenin` on a
 * terminal it already declared in `init().drives` therefore puts two identical
 * Nortons in parallel: the declared source impedance is halved and the current
 * drawn from — or pushed into — that pin is doubled.
 *
 * WHAT IT COST. Nine registered kinds did this: `battery_9v`, `battery_coin`,
 * `solar_cell`, `usb_a` and every dev board (`arduino_nano`, `arduino_uno`,
 * `arduino_mega`, `pi_pico`, `eater6502`). Measured against ngspice: a Pico with
 * VBUS on a 3.3 V bench rail reported 34 A on that pin where the single source
 * gives 17, and its VSYS reported -6 A into a 5 V rail against -3. A 9 V battery
 * had an internal resistance of 0.5 Ohm, not the 1.0 its own model declares.
 * `src/ac.js` collapses drives AND `ctx.thevenin` to output conductance the same
 * way, so the small-signal output impedance was halved too — one root, both
 * solvers.
 *
 * IT WAS ALREADY DIAGNOSED ONCE. `battery_aa` carries the comment "A
 * simultaneous state.drives source would put a second Norton in parallel, halve
 * the declared internal resistance, and incorrectly reference pos to ground" —
 * a correct account of the defect, applied to the one part where it was noticed.
 * A rule about one call site is not a rule about the mechanism, so this file
 * asks the question once per REGISTERED KIND, from the registry, rather than
 * naming the kinds that were found.
 *
 * A model that legitimately needs a state-dependent source keeps `drives` and
 * updates it in `update()`; that is the mechanism board.js's `_staticDrives`,
 * `_applyPinStatesToDrives` and the chip-qualification override are all written
 * against. `ctx.thevenin` is for a source the model does NOT declare.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredKinds, getDevice, initDeviceState } from '../src/devices.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/** Record which terminals a model's own stamp() sources. */
function stampedTerminals(model, part, state) {
    const stamped = [];
    const ctx = {
        netFor: t => `n_${t}`,
        conductance: () => {},
        thevenin: t => stamped.push(t),
        theveninBetween: (tP, tN) => { stamped.push(tP); stamped.push(tN); },
        current: t => stamped.push(t),
        vcc: 5, tempC: 25, tSeconds: 0, dtSec: 1e-6,
        controls: new Map(), control: undefined,
    };
    model.stamp(ctx, part, state);
    return stamped;
}

test('no registered kind sources the same terminal from both drives and stamp()', () => {
    const kinds = registeredKinds();
    // A zero you did not drive: if the registry is empty the loop below passes
    // by having nothing to say.
    assert.ok(kinds.length > 50, `only ${kinds.length} kinds registered — registerAllDevices() did not run`);

    const offenders = [];
    let withBoth = 0;
    for (const kind of kinds) {
        const model = getDevice(kind);
        if (!model.stamp) continue;
        const part = { id: 'p1', kind, params: {} };
        let state;
        try { state = initDeviceState(part); } catch { continue; }
        const declared = new Set(
            Object.entries(state?.drives ?? {}).filter(([, d]) => d).map(([t]) => t));
        if (!declared.size) continue;
        withBoth++;
        let stamped;
        try { stamped = stampedTerminals(model, part, state); } catch { continue; }
        const dup = [...new Set(stamped.filter(t => declared.has(t)))];
        if (dup.length) offenders.push(`${kind}: ${dup.join(', ')}`);
    }

    // The population this can speak about. Without it a refactor that stopped
    // every model from declaring drives would make the assertion below vacuous.
    assert.ok(withBoth > 0,
        'no registered kind declares drives AND has a stamp(), so this gate compared nothing');

    assert.deepEqual(offenders, [],
        'These kinds source a terminal twice — once as a declared drive, once from their own '
        + 'stamp(). The two Nortons are in parallel, so the declared source impedance is halved '
        + 'and the terminal current doubled, in the DC solve and in ac.js alike. Delete the '
        + 'ctx.thevenin, or delete the drives entry, but not both.');
});

test('the probe can see a double source when there is one', () => {
    // The gate above is an empty list. Fire it at a model that HAS the defect,
    // so an assertion that stopped looking cannot read as a clean census.
    const model = {
        terminals: ['pos', 'neg'],
        init() { return { drives: { pos: { vTh: 9, rTh: 1 } } }; },
        stamp(ctx) { ctx.thevenin('pos', 9, 1); },
    };
    const state = model.init();
    const declared = new Set(Object.keys(state.drives));
    const dup = stampedTerminals(model, { id: 'p', kind: 'x', params: {} }, state)
        .filter(t => declared.has(t));
    assert.deepEqual(dup, ['pos']);
});
