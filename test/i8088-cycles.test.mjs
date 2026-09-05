/**
 * The generated 8088 cycle table, checked WITHOUT the oracle.
 *
 * WHY THIS FILE EXISTS. `src/i8088-cycles.js` is a 738 KB derived artefact
 * built from 677 MB of vectors that live outside the repository. The full
 * regeneration check (scripts/check-i8088-cycles.mjs) needs those vectors and
 * therefore CANNOT RUN IN CI. An artefact whose only check cannot run is an
 * artefact with no check, and it would read as covered.
 *
 * So this asserts the properties that hold with nothing but the tracked tree:
 * the table is present and the right shape, the provenance is populated, and
 * the MIT notice the derived data carries is actually in the file. Those are
 * exactly the things that silently rot -- a regeneration that drops opcodes, a
 * hand-edit, a header lost to a merge.
 *
 * It deliberately does NOT assert accuracy. Accuracy needs the oracle, and
 * pretending otherwise here is how a check that cannot run starts looking like
 * one that passed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLES, PROVENANCE } from '../src/i8088-cycles.js';

test('the table covers the whole measured opcode set', () => {
    const ops = Object.keys(TABLES);
    assert.equal(ops.length, PROVENANCE.opcodes,
        'PROVENANCE.opcodes disagrees with the table it describes');
    assert.ok(ops.length >= 300,
        `only ${ops.length} opcodes -- a regeneration that drops opcodes must not pass quietly`);
    // Spot-check across the classes the model treats differently, so a
    // regeneration that loses one whole family is caught by name.
    for (const op of ['01', '33', '87', '8F', '90', 'C3', 'CD', 'EC',
                      'D2.0', 'D3.7', 'F7.4', '99', 'FF.2']) {
        assert.ok(TABLES[op], `${op} is missing from the table`);
    }
});

test('every opcode entry has the four sub-tables the lookup needs', () => {
    for (const [op, t] of Object.entries(TABLES)) {
        for (const k of ['a', 'd', 's', 't']) {
            assert.ok(t[k] && typeof t[k] === 'object', `${op} is missing sub-table ${k}`);
        }
        // An opcode with neither an anchor nor a no-data entry can predict
        // nothing at all, which is a generation bug rather than a sparse table.
        assert.ok(Object.keys(t.a).length + Object.keys(t.d).length > 0,
            `${op} has no predictable entries at all`);
    }
});

test('anchor entries agree with the shape entries that complete them', () => {
    // Every anchor key (q,len,n,m,v) needs a shape key (n,m,v) or the lookup
    // returns undefined at run time and silently mispredicts.
    let checked = 0;
    for (const [op, t] of Object.entries(TABLES)) {
        for (const key of Object.keys(t.a)) {
            const [, , n, m, v] = key.split(',');
            const sk = `${n},${m},${v}`;
            assert.ok(t.s[sk] !== undefined && t.t[sk] !== undefined,
                `${op}: anchor ${key} has no matching span/tail ${sk}`);
            checked++;
        }
    }
    assert.ok(checked > 10000, `only ${checked} anchor keys cross-checked`);
});

test('provenance is populated, not a placeholder', () => {
    for (const k of ['source', 'vectors', 'cpu', 'license', 'generator', 'opcodes']) {
        assert.ok(PROVENANCE[k], `PROVENANCE.${k} is empty`);
    }
    assert.match(PROVENANCE.vectors, /^[0-9a-f]{40}$/,
        `vectors sha is ${PROVENANCE.vectors} -- an "unknown" sha means the table cannot be traced back`);
    assert.match(PROVENANCE.license, /MIT/);
});

test('the table was built by the generator now in the tree', () => {
    // THE ONLY DRIFT CHECK THAT CAN RUN IN CI. The real one -- regenerate and
    // diff -- needs 677 MB of vectors that are not in the repository, so it
    // cannot run here. That leaves one realistic drift undetected: someone
    // edits the generator and does not regenerate the table, and every other
    // check keeps passing because the committed table is still internally
    // consistent with itself.
    //
    // So: the generator stamps a version into PROVENANCE, and this asserts the
    // stamp matches the generator's own declaration. Bumping the version is
    // then the thing that forces a regeneration, and forgetting to bump is the
    // failure mode this cannot see -- which is why the version lives next to
    // the emit and is documented as needing a bump on any table-shape change.
    const gen = readFileSync(
        new URL('../scripts/gen-i8088-cycle-tables.mjs', import.meta.url), 'utf8');
    const m = gen.match(/const gen = '([^']+)'/);
    assert.ok(m, 'the generator no longer declares a version string the table can be matched against');
    assert.equal(PROVENANCE.generator, m[1],
        `src/i8088-cycles.js was built by ${PROVENANCE.generator} but the generator `
        + `in the tree is ${m[1]} -- regenerate: node scripts/gen-i8088-cycle-tables.mjs`);
});

test('the MIT notice travels with the derived table', () => {
    // The obligation is on the ARTEFACT, not the checkout. A table shipped in a
    // BSD-3 bundle with its notice left behind in a repo nobody distributes is
    // exactly how attribution gets lost.
    const src = readFileSync(new URL('../src/i8088-cycles.js', import.meta.url), 'utf8');
    assert.ok(src.includes('MIT License'), 'the MIT licence header is gone');
    assert.ok(src.includes('Copyright (c) 2024 SingleStepTests'),
        'the upstream copyright line is gone');
    assert.ok(src.includes('WITHOUT WARRANTY OF ANY KIND'),
        'the licence body was truncated -- the notice must be reproduced in full');
});
