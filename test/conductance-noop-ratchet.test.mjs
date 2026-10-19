/**
 * The conductance no-op class only ever shrinks.
 *
 * `ctx.conductance(t, null, g)` cannot stamp anything — stampTwoTerminal's
 * air-leg guard returns on a falsy far net — so every such call is a
 * declaration that does nothing. 178 of them existed across 41 files;
 * spec-updates/ideal-high-z-inputs.md adjudicated all five families and the
 * class is now empty.
 *
 * This test is the ratchet. Its ceiling is 0, so any newly added silent no-op
 * fails it by name and has to be adjudicated in that document before it can
 * land. The mutation proof that it can fail is in the last case: the census
 * is run over a fixture that contains one, and must find it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CENSUS = join(ROOT, 'scripts', 'conductance-census.mjs');

/** The adjudicated ceiling. Lowering it is a one-line edit; raising it is not. */
const CEILING = 0;

// The census scans relative to its OWN location (import.meta.url), not the
// cwd — so scanning a different tree means running a COPY of the script that
// sits inside that tree. Passing a cwd would silently census this repo again,
// which is how the mutation case first "passed" against the wrong tree.
const runCensus = (script = CENSUS) =>
  JSON.parse(execFileSync(process.execPath, [script, '--json'], {
    encoding: 'utf8', maxBuffer: 1e8,
  }));

describe('conductance no-op ratchet', () => {
  it(`the class is at or below ${CEILING} silent no-op stamps`, () => {
    const { noop, noopCount } = runCensus();
    assert.ok(noopCount <= CEILING,
      `${noopCount} conductance call(s) stamp nothing silently; adjudicate them in ` +
      'spec-updates/ideal-high-z-inputs.md before adding them:\n' +
      noop.map(r => `  ${r.file}:${r.line}  ${r.device ?? '(builtin)'}  ` +
        `${r.terminal}, ${r.leg}, ${r.g}`).join('\n'));
  });

  it('the live stamps are still there — this is not a ratchet that just deleted everything', () => {
    // The class was emptied by adjudicating it, not by removing the ability to
    // stamp. Two real legs is what a working conductance call looks like, and
    // there are ~100 of them (the 555 divider, the discharge switch, the
    // MAX232 receiver load, every resistor network).
    const { liveCount } = runCensus();
    assert.ok(liveCount > 90,
      `only ${liveCount} two-legged conductance stamps left — something deleted real physics`);
  });

  it('MUTATION: the census finds a no-op that is deliberately planted', () => {
    // A gate that cannot fail is not a gate. Build a throwaway tree with one
    // silent no-op in it and require the census to report exactly that one.
    const dir = mkdtempSync(join(tmpdir(), 'noop-ratchet-'));
    try {
      mkdirSync(join(dir, 'src', 'devices'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      const planted = join(dir, 'scripts', 'conductance-census.mjs');
      copyFileSync(CENSUS, planted);
      writeFileSync(join(dir, 'src', 'devices', 'planted.js'), [
        'export function registerPlanted() {',
        "  registerDevice('planted', {",
        '    stamp(ctx) {',
        "      ctx.conductance('in', null, 1 / 1e6);",
        "      ctx.conductance('a', 'b', 1 / 100);",
        '    },',
        '  });',
        '}',
        '',
      ].join('\n'));
      const { noop, noopCount, liveCount } = runCensus(planted);
      assert.equal(noopCount, 1, 'the planted no-op is found');
      assert.equal(liveCount, 1, 'the two-legged call beside it is NOT counted as one');
      assert.equal(noop[0].device, 'planted');
      assert.equal(noop[0].terminal, "'in'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
