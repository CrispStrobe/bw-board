/**
 * Our MNA against ngspice, from the SAME neutral description lcapy uses.
 *
 * `test/lcapy/circuits.mjs` describes each circuit ONCE, and `to-engine`,
 * `to-lcapy` and `to-ngspice` all generate from it — so a mistake in one
 * description cannot agree with itself across the comparison. That discipline
 * is the whole reason any of this is evidence rather than a curve fit, and it
 * is why this file exists beside `lcapy-oracle.test.mjs` rather than describing
 * the circuits again.
 *
 * WHY A THIRD ORACLE WHEN LCAPY ALREADY DISAGREES INDEPENDENTLY. lcapy solves
 * SYMBOLICALLY and returns exact rationals, so it is the better judge of a
 * linear network — but it cannot help with a junction. ngspice is numeric and
 * models devices. Where the two agree and we do not, it is us. Where THEY
 * disagree, the circuit is degenerate or ill-posed and belongs in neither
 * corpus: a verdict no single oracle can deliver.
 *
 * THIS FILE IS THE POINT OF to-ngspice.mjs. The emitter landed with no caller,
 * which is the same shape as an export no menu can reach — a feature that is
 * really a defect, because nothing fails when it rots. `the emitter has a
 * caller` below is asserted from the emitter's own source so that deleting this
 * comparison cannot quietly restore that state.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveMNA } from '../src/mna.js';
import { CIRCUITS } from './lcapy/circuits.mjs';
import { toNgspice, parseOp } from './lcapy/to-ngspice.mjs';
import { toEngine } from './lcapy/to-engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * ngspice is a development-time oracle, not a dependency. If it is absent SAY
 * SO BY NAME — a bare "skipped" is indistinguishable from a pass, which is how
 * a hardcoded VPS path in this same directory once hid 104 tests.
 */
function findNgspice() {
  const cand = [process.env.NGSPICE, 'ngspice'].filter(Boolean);
  for (const exe of cand) {
    try {
      execFileSync(exe, ['-v'], { stdio: 'ignore' });
      return exe;
    } catch { /* try the next */ }
  }
  return null;
}

const NG = findNgspice();
const SKIP = NG ? false
  : 'no ngspice — tried $NGSPICE and `ngspice` on PATH. Install with: apt install ngspice';

describe('MNA vs ngspice (independent numeric solver, same neutral source)', { skip: SKIP }, () => {
  const OUT = mkdtempSync(path.join(tmpdir(), 'bwb-neutral-ng-'));

  /** Solve one neutral circuit with ngspice and return {node: volts}. */
  const runNgspice = (c) => {
    // precision: true -> the .control/print form, 16 digits. The bare `.op`
    // table is capped at seven significant figures, which showed up as a
    // 3.8e-6 "disagreement" on series-three that is entirely print rounding.
    const deck = toNgspice(c, { precision: true });
    const f = path.join(OUT, `${c.name}.cir`);
    writeFileSync(f, deck);
    const stdout = execFileSync(NG, ['-b', f], { encoding: 'utf8', maxBuffer: 8 << 20 });
    return { volts: parseOp(stdout), deck, f };
  };

  const reference = Object.fromEntries(CIRCUITS.map((c) => {
    try { return [c.name, runNgspice(c)]; }
    catch (e) { return [c.name, { __error__: String(e && e.message || e) }]; }
  }));

  test('ngspice solved every circuit', () => {
    const errs = Object.entries(reference)
      .filter(([, v]) => v.__error__)
      .map(([k, v]) => `${k}: ${v.__error__}`);
    assert.deepEqual(errs, [], `ngspice could not solve:\n  ${errs.join('\n  ')}`);
  });

  test('the comparison is not vacuous', () => {
    // ZERO COMPARED MUST NEVER READ AS AGREEMENT. parseOp returned {} for all
    // 14 circuits twice during development, because batch `.op` prints a table
    // with BARE node names and the first two fixes guessed at the format
    // instead of reading it. A per-circuit loop over an empty object passes
    // every assertion inside it, so the population is asserted here.
    const nodes = Object.values(reference)
      .reduce((a, v) => a + Object.keys(v.volts || {}).length, 0);
    assert.ok(CIRCUITS.length >= 10, `only ${CIRCUITS.length} circuits`);
    assert.ok(nodes >= 30,
      `only ${nodes} node voltages parsed out of ngspice — parseOp has stopped matching its `
      + 'output format, which reads as agreement rather than as a failure to measure');
  });

  test('the emitter has a caller', () => {
    // to-ngspice.mjs landed with no consumer anywhere in the tree. An emitter
    // nobody invokes cannot fail, so it rots silently and its first real use is
    // a debugging session. Assert from the emitter's own exports that this file
    // reaches both of them.
    // BOTH SPELLINGS OF AN EXPORT. The scan matched `export function X` only,
    // so moving parseOp into src/ngspice.js and re-exporting it here made the
    // export list shrink to one and the gate red -- correctly firing, for the
    // wrong reason. A re-export is still a name this module offers, and a
    // re-exported helper with no caller rots exactly like a defined one.
    const src = readFileSync(path.join(HERE, 'lcapy', 'to-ngspice.mjs'), 'utf8');
    const exported = [
        ...[...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]),
        ...[...src.matchAll(/^export\s*\{([^}]*)\}/gm)]
            .flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()))
            .filter(Boolean),
    ];
    assert.ok(exported.length >= 2, `to-ngspice exports only ${exported.join(', ')}`);
    const self = readFileSync(path.join(HERE, 'ngspice-neutral-oracle.test.mjs'), 'utf8');
    // Count CALLS, not the import line: importing a symbol and never using it
    // is the state this test exists to prevent.
    for (const name of exported) {
      const calls = [...self.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))].length;
      assert.ok(calls >= 1, `${name} is exported by to-ngspice.mjs and never called here`);
    }
  });

  test('both deck forms parse, and they agree to the table\'s own precision', () => {
    // parseOp handles the bare `.op` table AND the .control `print` form. A
    // branch with no caller rots, and the failure is silent -- it returns {},
    // which a per-node loop reports as agreement. Drive BOTH here on the same
    // circuit and require they describe the same solve.
    const c = CIRCUITS.find((x) => x.name === 'series-three') ?? CIRCUITS[0];
    const runForm = (opts, tag) => {
      const f = path.join(OUT, `formcheck-${tag}.cir`);
      writeFileSync(f, toNgspice(c, opts));
      return parseOp(execFileSync(NG, ['-b', f], { encoding: 'utf8', maxBuffer: 8 << 20 }));
    };
    const table = runForm({}, 'table');
    const print = runForm({ precision: true }, 'print');
    assert.ok(Object.keys(table).length > 0, 'the bare .op table parsed to nothing');
    assert.ok(Object.keys(print).length > 0, 'the .control print form parsed to nothing');
    assert.deepEqual(Object.keys(table).sort(), Object.keys(print).sort(),
      'the two deck forms report different node sets');
    for (const k of Object.keys(table)) {
      // 7 significant figures is what the table can express; that is the gap
      // being asserted, and asserting it pins WHY the precision form exists.
      assert.ok(Math.abs(table[k] - print[k]) <= Math.abs(print[k]) * 1e-6 + 1e-9,
        `${k}: table ${table[k]} vs print ${print[k]} differ by more than the table's rounding`);
    }
    const anyGain = Object.keys(print).some((k) => table[k] !== print[k]);
    assert.ok(anyGain,
      'the precision form returned the SAME digits as the table on every node, so either it is '
      + 'not taking effect or this circuit has no digits to gain — pick one that does');
  });

  for (const c of CIRCUITS) {
    test(`${c.name}: every node voltage matches ngspice`, () => {
      const ref = reference[c.name];
      assert.ok(ref && !ref.__error__, `ngspice produced no result: ${ref && ref.__error__}`);
      const volts = ref.volts;
      assert.ok(Object.keys(volts).length > 0,
        `no node voltages parsed for ${c.name} — deck at ${ref.f}`);

      const { parts, nets } = toEngine(c);
      const res = solveMNA(parts, nets, new Map(), new Map(), 5);
      assert.equal(res.converged, true, 'our solver did not converge');

      let compared = 0;
      for (const [node, want] of Object.entries(volts)) {
        const got = res.nodeVoltages.get(node);      // parseOp lowercases; nodes are `n<k>`
        if (got === undefined) continue;             // ngspice prints internal nodes too
        compared++;
        assert.ok(Math.abs(got - want) <= (c.tol ?? 1e-6),
          `${c.name} ${node}: ngspice ${want} vs ours ${got} `
          + `(delta ${Math.abs(got - want).toExponential(3)}, tol ${c.tol ?? 1e-6}). Deck: ${ref.f}`);
      }
      assert.ok(compared > 0,
        `${c.name}: ngspice reported ${Object.keys(volts).join(', ')} and NONE matched a node our `
        + 'solver produced — the two sides are naming nodes differently, which compares nothing');
    });
  }

  test('the real agreement is far tighter than the shared tolerance, and stays so', () => {
    // `c.tol` is the contract SHARED with lcapy-oracle.test.mjs, so it is not
    // this file's to tighten. But leaving 1e-6 as the only statement would hide
    // three orders of magnitude of headroom, and a regression that ate it would
    // pass silently until it crossed the shared bound.
    //
    // MEASURED 2026-09-13 against ngspice-44, .control/print form, worst node
    // per circuit:
    //
    //   divider-1k-2k          4.444e-9    bridged-tee            1.723e-9
    //   series-three           1.505e-9    current-source-into-r  4.418e-8
    //   parallel-pair          5.556e-10   current-source-divider 1.254e-9
    //   wheatstone-unbalanced  7.355e-9    mixed-v-and-i          5.199e-9
    //   ladder-r2r             2.120e-9    cap-blocks-dc          5.000e-9
    //   two-sources-opposing   1.556e-9    cap-across-resistor    1.250e-9
    //   rc-lowpass-dc          3.300e-8    inductor-is-a-short    1.253e-6 *
    //
    // * the ONE modelling difference, and it is not an error: ngspice shorts an
    //   inductor exactly at DC and we model it as 1 mOhm to keep the matrix
    //   non-singular. 2.5 mA through 1 mOhm is 2.5 uV, and 1.253 uV is that
    //   drop at this circuit's current. It is excluded by NAME below, never by
    //   a threshold that would also excuse a real regression.
    const KNOWN_MODEL_DIFF = new Set(['inductor-is-a-short']);
    let worst = 0, worstAt = '';
    let checked = 0;
    for (const c of CIRCUITS) {
      if (KNOWN_MODEL_DIFF.has(c.name)) continue;
      const ref = reference[c.name];
      assert.ok(ref && !ref.__error__, `${c.name}: no ngspice result`);
      const { parts, nets } = toEngine(c);
      const res = solveMNA(parts, nets, new Map(), new Map(), 5);
      for (const [node, want] of Object.entries(ref.volts)) {
        const got = res.nodeVoltages.get(node);
        if (got === undefined) continue;
        checked++;
        const d = Math.abs(got - want);
        if (d > worst) { worst = d; worstAt = `${c.name} ${node}`; }
      }
    }
    assert.ok(checked >= 25, `only ${checked} nodes compared — the spec has shrunk`);
    assert.ok(worst < 1e-7,
      `worst linear-network disagreement with ngspice is ${worst.toExponential(3)} V at ${worstAt}; `
      + 'the recorded ceiling is 1e-7. This is 10x inside the shared c.tol, so a failure here is a '
      + 'real regression that the shared tolerance would not have caught for another 10x.');
    // ANTI-VACUITY: a zero would mean we are comparing our own output.
    assert.ok(worst > 0,
      'every node matched ngspice EXACTLY, to the last bit. Two independent solvers do not do '
      + 'that — check that the reference is not being produced by our own engine');
  });
});
