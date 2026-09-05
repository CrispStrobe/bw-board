/**
 * `src/target-kinds.js` MUST STAY A LEAF, and this is why it is a test rather
 * than a comment.
 *
 * lite's `debug-panel.jsx` dynamic-imports this module behind
 * `webpackChunkName: "bw-debug-target-kinds"` so the target picker's labels
 * reach the browser without the debugger backend. The isolation is worth about
 * 20 KB of first-load JavaScript and the entire adapter graph -- emu8051,
 * avr8js, labwired, serial, intel-hex -- and it is invisible from inside this
 * repository, because nothing here bundles anything.
 *
 * IT HAS ALREADY BEEN LOST ONCE. `547bb4e perf: isolate debugger target
 * metadata` created the module for this reason; it was folded back into
 * debug-target-factory.js days later, and the loss showed up as a downstream
 * bundle-ratchet risk rather than as a failure here. A comment saying "do not
 * add imports" would have lost the same way -- prose is evaluated once, by its
 * author, at the moment they were most confident.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABWIRED_KIND, getTargetKinds } from '../src/target-kinds.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const leaf = () => readFileSync(join(SRC, 'target-kinds.js'), 'utf8');

test('target-kinds.js imports nothing — the property the chunk isolation rests on', () => {
    const imports = [...leaf().matchAll(/^\s*import\s.+$/gm)].map((m) => m[0].trim());
    assert.deepEqual(imports, [],
        '\n  target-kinds.js has grown an import, which silently ends its usefulness as' +
        '\n  an isolated chunk downstream: whatever it imports is pulled in with it.' +
        '\n  If the data genuinely needs a dependency, that is a real decision — make it' +
        '\n  deliberately, tell brickwright-lite, and expect a first-load ratchet.\n');
});

test('the extractor would notice if it stopped reading the file', () => {
    // Species 1: "no imports found" and "read nothing" are the same result.
    // Prove the file was actually read before trusting an empty match.
    const src = leaf();
    assert.ok(src.length > 1500, `target-kinds.js is only ${src.length} bytes — did it move?`);
    assert.match(src, /export function getTargetKinds/, 'and it still holds the data');
});

test('debug-target-factory re-exports both symbols, so consumers are unaffected', async () => {
    const factory = await import('../src/debug-target-factory.js');
    assert.equal(factory.LABWIRED_KIND, LABWIRED_KIND, 'same object, not a copy that can drift');
    assert.equal(factory.getTargetKinds, getTargetKinds);
});

test('the kinds are pure data — no functions, no live objects to alias', () => {
    for (const k of getTargetKinds()) {
        assert.equal(typeof k.kind, 'string');
        assert.equal(typeof k.label, 'string');
        for (const v of Object.values(k)) assert.notEqual(typeof v, 'function');
    }
    assert.equal(LABWIRED_KIND.kind, 'labwired');
});
