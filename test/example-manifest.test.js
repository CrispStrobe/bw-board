/**
 * Manifest validation: verify all example bundles are loadable
 * and their pins.json produces valid netlists.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { inferNetlist } from '../src/infer-netlist.js';
import { validateNetlist } from '../src/validate.js';
import { BoardImpl } from '../src/board.js';

const EXAMPLES_DIR = '/mnt/volume1/code/stc/examples';
const MANIFEST_PATH = `${EXAMPLES_DIR}/manifest.json`;

describe('example manifest: all bundles valid', () => {
  if (!existsSync(MANIFEST_PATH)) {
    it.skip('manifest.json not found');
    return;
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

  it('manifest lists all examples', () => {
    assert.ok(manifest.examples || manifest.bundles || Array.isArray(manifest),
      'manifest should list examples');
  });

  // Load each example's pins.json and verify the pipeline
  const examples = existsSync(EXAMPLES_DIR)
    ? readdirSync(EXAMPLES_DIR)
        .filter(d => d.match(/^\d\d-/) && existsSync(`${EXAMPLES_DIR}/${d}/pins.json`))
    : [];

  for (const name of examples) {
    it(`${name}: pins.json → inferNetlist → validate → setNetlist`, () => {
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

  it('every direction value is handled', () => {
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
