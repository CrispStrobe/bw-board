/**
 * Manifest validation: verify all example bundles are loadable
 * and their pins.json produces valid netlists.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferNetlist } from '../src/infer-netlist.js';
import { validateNetlist } from '../src/validate.js';
import { BoardImpl } from '../src/board.js';
import { resolveAncestor } from './helpers/sibling-checkout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// WALKED UP, NOT A FIXED DEPTH. `'../../x'` is where a sibling checkout sits
// relative to a CLONE and never relative to a git WORKTREE, which lives a level
// deeper -- so CI kept these cases and every lane lost them, as a '# skipped'
// that reads like a deliberate exclusion. The absent case is unchanged: with
// nothing found anywhere, resolveAncestor returns the same path this named.
const EXAMPLES_DIR = resolveAncestor(here, ['stc', 'examples']);
const MANIFEST_PATH = `${EXAMPLES_DIR}/manifest.json`;

/**
 * A CASE THAT WAS NEVER DECLARED IS QUIETER THAN ONE COUNTED AS A PASS.
 *
 * This used to `it.skip('manifest.json not found'); return;` from the describe
 * BODY, so with the examples unreachable the ten real cases were never declared
 * at all. Measured: `# tests 1` without the oracle, `# tests 11` with it. Not
 * skipped — ABSENT. A pass-shaped skip at least leaves a line someone can grep;
 * this leaves nothing but a test count nobody compares across runs.
 *
 * The manifest is read lazily so the file can still be parsed when it is not
 * there, and every case carries the same named skip.
 */
const SKIP = existsSync(MANIFEST_PATH) ? false
  : `no example manifest at ${MANIFEST_PATH} — check out CrispStrobe/stc beside this `
    + 'repo and build its examples; CI does not carry them';

describe('example manifest: all bundles valid', () => {
  const manifest = SKIP ? {} : JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

  it('manifest lists all examples', {skip: SKIP}, () => {
    assert.ok(manifest.examples || manifest.bundles || Array.isArray(manifest),
      'manifest should list examples');
  });

  // Load each example's pins.json and verify the pipeline
  const examples = existsSync(EXAMPLES_DIR)
    ? readdirSync(EXAMPLES_DIR)
        .filter(d => d.match(/^\d\d-/) && existsSync(`${EXAMPLES_DIR}/${d}/pins.json`))
    : [];

  // NINE OF THESE CASES ARE GENERATED FROM THE ORACLE'S CONTENTS, so without it
  // there is nothing to declare -- you cannot name the cases for examples you
  // cannot see, and that is honest rather than a defect. What IS a defect is
  // their absence leaving no trace: with the examples gone this file went from
  // eleven tests to one and nothing said why.
  //
  // So the generator gets a case of its own. Present: it asserts the loop found
  // something, which also catches an examples tree that exists but has stopped
  // matching the pattern. Absent: one visible skip stands in for however many
  // cases could not be built.
  it('the examples tree yields cases to generate', {skip: SKIP}, () => {
    assert.ok(examples.length > 0,
      `${EXAMPLES_DIR} has no NN-name directories with a pins.json — the per-example `
      + 'cases below all silently generate to nothing when that happens');
  });

  for (const name of examples) {
    it(`${name}: pins.json → inferNetlist → validate → setNetlist`, {skip: SKIP}, () => {
      const stc = JSON.parse(readFileSync(`${EXAMPLES_DIR}/${name}/pins.json`, 'utf-8'));
      const { parts, nets, notes } = inferNetlist(stc);
      const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
      assert.equal(errors.length, 0,
        `${name}: ${errors.map(e => e.message).join('; ')}`);

      // setNetlist should not throw
      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);

      // getRenderState should work
      const state = board.getRenderState();
      assert.ok(state.powered);
    });
  }

  it('every direction value is handled', {skip: SKIP}, () => {
    const allDirections = new Set();
    for (const name of examples) {
      const stc = JSON.parse(readFileSync(`${EXAMPLES_DIR}/${name}/pins.json`, 'utf-8'));
      for (const pin of stc.pins) {
        allDirections.add(pin.direction);
      }
    }

    console.log(`# Directions found across examples: ${[...allDirections].join(', ')}`);

    // All should be handled without producing notes
    for (const dir of allDirections) {
      const { notes } = inferNetlist({
        pins: [{ name: 'test', port: 1, bit: 0, direction: dir, activeLow: false }],
      });
      assert.equal(notes.length, 0,
        `direction "${dir}" should be handled without notes: ${notes.join('; ')}`);
    }
  });
});
