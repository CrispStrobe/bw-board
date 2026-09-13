/**
 * NO GOLDEN ORACLE MAY BE RECORDED FROM A DIODE NGSPICE SILENTLY SUBSTITUTED.
 *
 * ngspice clamps a diode saturation current at 1e-28 and says nothing about it
 * -- not on stdout, not on stderr, not in the raw file. A `.model` line asking
 * for IS=1e-30 is solved as 1e-28 and the answer is recorded as truth.
 *
 * MEASURED: led_blue_470 asked for IS=1e-30, and its recorded v_anode of
 * 3.090935 reproduces bit-identically at 1e-28, 1e-30 AND 1e-35. The deck and
 * the number had stopped being about the same device, and nothing in the corpus
 * could show it -- the value is a perfectly good ngspice solve of a diode
 * nobody asked for. That is why this is a gate and not a code review: the
 * failure mode is a CORRECT-LOOKING number, so only the generator's INPUT can
 * be checked, never its output.
 *
 * An LED calibrated to drop vf at 20 mA has IS = 0.02 / exp((vf - 0.02*rs)/nVt),
 * so at n=1.8 the clamp makes anything above about 2.86 V unrepresentable AS A
 * `.model D`. An absent oracle is honest; a wrong one is not, and a wrong one is
 * worse than none because it will be defended.
 *
 * "LEAVE THOSE PARTS OUT OF THE CORPUS" WAS THE WRONG CONCLUSION, AND IT WAS
 * MINE. The clamp is a property of ngspice's DIODE MODEL, not of ngspice. A
 * behavioural source carries no such clamp, so the same device can be solved by
 * the same engine:
 *
 *     B1 na nj I = <Is>*(exp(V(na,nj)/<nVt>)-1)
 *     Rs nj 0 <rs>
 *
 * VALIDATED, because an instrument nobody checked is not an oracle: on a
 * vf = 2.0 part, which BOTH forms can express, the two decks agree to 5e-6
 * relative at three operating points. It then reads white (vf 3.4,
 * Is = 3.17e-32) and UV (vf 3.8) and the vf = 3.5 bench in
 * complex-circuits.test.js, all of which the D model silently mis-solves.
 * test/measurements/repro/bsource-oracle.mjs.
 *
 * So the rule below is unchanged -- never record a golden from a clamped
 * `.model D` -- but the remedy is no longer exclusion. Blue is currently
 * recorded AT the clamp (IS=1e-28) rather than at its true Is for the same
 * reason, and can now be re-derived; that is a separate lane and is named here
 * so it is not lost.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'test/golden/run_ngspice.py');
export const NGSPICE_IS_CLAMP = 1e-28;

/** Every IS= literal the generator can emit into a .model line. */
export const generatorIsValues = (src = fs.readFileSync(GEN, 'utf8')) =>
    [...src.matchAll(/'(\d(?:\.\d+)?e-\d+)'/g)]
        .map(m => ({text: m[1], value: Number(m[1])}))
        .filter(v => Number.isFinite(v.value) && v.value < 1e-10);

test('the generator declares the clamp it must refuse', () => {
    const src = fs.readFileSync(GEN, 'utf8');
    assert.match(src, /NGSPICE_IS_CLAMP\s*=\s*1e-28/,
        'run_ngspice.py must name the clamp, because a reader cannot infer it from ngspice, '
        + 'which reports the substitution nowhere');
    // THE CALL, NOT THE NAME. `/_refuse_clamped_is/` is satisfied by
    // `_DISABLED_refuse_clamped_is` -- a substring match cannot tell a live
    // guard from a renamed corpse, and the first mutation run proved it: the
    // guard was disabled and this gate stayed green. Match the invocation at
    // the top of the recording function instead.
    assert.match(src, /\n    _refuse_clamped_is\(name, netlist\)/,
        'run_spice_op must CALL _refuse_clamped_is(name, netlist) before recording; a definition '
        + 'that nothing invokes is not a guard');
    assert.match(src, /def _refuse_clamped_is\(/,
        'and the function it calls must be defined under exactly that name');
});

test('no IS the generator can emit is below the clamp', () => {
    const found = generatorIsValues();
    // ANTI-VACUITY: if the scan finds no IS literals at all, the regex has
    // drifted away from the file and an empty result is a broken instrument,
    // not a clean corpus.
    assert.ok(found.length >= 2,
        `only ${found.length} IS literal(s) found in run_ngspice.py -- the scan is broken, `
        + 'and an empty result would read as a clean bill');
    const bad = found.filter(v => v.value < NGSPICE_IS_CLAMP);
    assert.deepEqual(bad.map(v => v.text), [],
        'these IS values are below ngspice\'s silent clamp, so the recorded oracle would be a '
        + 'measurement of a different diode: ' + JSON.stringify(bad.map(v => v.text)));
});
