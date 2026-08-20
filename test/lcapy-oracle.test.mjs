/**
 * Our MNA against lcapy — a SECOND solver, not a snapshot of our own output.
 *
 * Every other test of the solver in this repo checks it against hand-computed
 * numbers or against measured benches. Both are good, and both share one
 * blind spot: they were written by people who had already decided how the
 * circuit behaves. lcapy is an independent implementation that solves
 * symbolically, so it returns an EXACT rational — 20/3, not 6.6667 — from
 * code nobody here wrote.
 *
 * DISCIPLINE THAT MAKES THIS A COMPARISON AND NOT A CURVE FIT
 *
 * Each circuit is described ONCE, in a neutral form (test/lcapy/circuits.mjs),
 * and both the lcapy netlist and our parts/nets are GENERATED from it. Writing
 * each side by hand would let one mistake agree with itself.
 *
 * Sign conventions were established by HAND ARITHMETIC before any comparison
 * was run, not by flipping operands until the numbers matched. 2 mA through
 * 4k7 to ground is +9.4 V; lcapy's `I1 0 1` gives -9.400 and `I1 1 0` gives
 * +9.400, so lcapy injects into its FIRST node, and the neutral spec's
 * ['I', ref, from, to, amps] swaps for it. Our isource injects into `pos`.
 * Both translators were then checked against that same +9.4 V independently.
 *
 * @module
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveMNA } from '../src/mna.js';
import { CIRCUITS } from './lcapy/circuits.mjs';
import { toLcapy } from './lcapy/to-lcapy.mjs';
import { toEngine } from './lcapy/to-engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * lcapy is a development-time oracle, not a dependency: it is a Python package
 * and this is a JS engine. Find an interpreter that can import it, and if
 * there is none SAY WHICH ONES WERE TRIED — a bare "skipped" is
 * indistinguishable from a pass, which is how a hardcoded VPS path in this
 * same directory hid 104 tests.
 */
function findLcapyPython() {
  const candidates = [
    process.env.LCAPY_PYTHON,
    path.join(process.env.HOME || '', '.local/pipx/venvs/lcapy/bin/python'),
    'python3',
  ].filter(Boolean);
  for (const py of candidates) {
    if (py !== 'python3' && !existsSync(py)) continue;
    try {
      execFileSync(py, ['-c', 'import lcapy'], { stdio: 'ignore' });
      return py;
    } catch { /* try the next */ }
  }
  return null;
}

const PY = findLcapyPython();
const SKIP = PY ? false
  : 'no Python with lcapy — tried $LCAPY_PYTHON, ~/.local/pipx/venvs/lcapy/bin/python, '
    + 'python3. Install with: pipx install lcapy';

describe('MNA vs lcapy (independent symbolic solver)', { skip: SKIP }, () => {
  const netlists = Object.fromEntries(CIRCUITS.map((c) => [c.name, toLcapy(c)]));
  const raw = execFileSync(PY, [path.join(HERE, 'lcapy', 'run-lcapy.py')], {
    input: JSON.stringify(netlists), encoding: 'utf8', maxBuffer: 8 << 20,
  });
  const reference = JSON.parse(raw);

  test('lcapy solved every circuit', () => {
    // If lcapy chokes, the comparisons below would silently have nothing to
    // compare. Fail here instead, naming the circuit.
    const errs = Object.entries(reference)
      .filter(([, v]) => v.__error__)
      .map(([k, v]) => `${k}: ${v.__error__}`);
    assert.deepEqual(errs, [], `lcapy could not solve:\n  ${errs.join('\n  ')}`);
  });

  test('the comparison is not vacuous', () => {
    const nodes = Object.values(reference).reduce((a, v) => a + Object.keys(v).length, 0);
    assert.ok(CIRCUITS.length >= 10, `only ${CIRCUITS.length} circuits`);
    assert.ok(nodes >= 30, `only ${nodes} node voltages to compare — the spec has shrunk`);
  });

  for (const c of CIRCUITS) {
    test(`${c.name}: every node voltage matches`, () => {
      const ref = reference[c.name];
      assert.ok(ref && !ref.__error__, 'lcapy produced no result');
      const { parts, nets } = toEngine(c);
      const res = solveMNA(parts, nets, new Map(), new Map(), 5);
      assert.equal(res.converged, true, 'our solver did not converge');

      for (const [node, want] of Object.entries(ref)) {
        const got = res.nodeVoltages.get(`n${node}`);
        assert.notEqual(got, undefined, `we produced no voltage for node ${node}`);
        assert.ok(Math.abs(got - want) <= (c.tol ?? 1e-6),
          `${c.name} n${node}: lcapy ${want} vs ours ${got} `
          + `(delta ${Math.abs(got - want).toExponential(3)}, tol ${c.tol ?? 1e-6})`);
      }
    });
  }

  test('the one known modelling difference is the inductor, and it is 1 mOhm', () => {
    // Not papered over with a loose tolerance: lcapy shorts an inductor
    // EXACTLY at DC, we model it as a 1 mOhm wire (mna.js says so). That is a
    // deliberate choice to keep the matrix non-singular, and the measured
    // difference must stay consistent with it rather than merely "small".
    const c = CIRCUITS.find((x) => x.name === 'inductor-is-a-short');
    assert.ok(c, 'the inductor circuit is part of the spec');
    const { parts, nets } = toEngine(c);
    const res = solveMNA(parts, nets, new Map(), new Map(), 5);
    const drop = Math.abs(res.nodeVoltages.get('n2') - res.nodeVoltages.get('n3'));
    // 5 V across R1+R2 = 2 kOhm -> 2.5 mA; 2.5 mA through 1 mOhm = 2.5 uV.
    const expected = (5 / 2000) * 1e-3;
    assert.ok(Math.abs(drop - expected) < 1e-7,
      `inductor drop ${drop.toExponential(3)} V, expected ~${expected.toExponential(3)} V `
      + '(2.5 mA through the 1 mOhm DC model)');
  });
});
