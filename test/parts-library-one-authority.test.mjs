/**
 * THE LIBRARY IS THE ONLY HOME FOR AN ELECTRICAL NUMBER.
 *
 * This file exists because the same quantity had three homes that disagreed.
 * An LED's series resistance was 10 in the piecewise path, 2 in the exponential
 * path and 5 in bw-circuit-ui's SPICE exporter, and each was individually
 * plausible, which is why it survived. A library that merely ADDS a fourth
 * table makes that worse, so these are the assertions that make it an
 * authority instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {allCards, cardFor, cardIds, spiceModelFor, resolveParams,
    ELECTRICAL_FIELDS, I_RATED} from '../src/parts-library.js';
import {JUNCTION_RD, JUNCTION_I_RATED} from '../src/mna.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the library is populated, and every card carries provenance', () => {
    // ANTI-VACUITY: every assertion below iterates the cards, so an empty
    // library would pass the lot.
    assert.ok(cardIds().length >= 5, `only ${cardIds().length} card(s) — the library is empty or the export broke`);
    for (const c of allCards()) {
        assert.ok(c.provenance && c.provenance.length > 20,
            `${c.id}: no provenance. A number nobody can check is what this file exists to prevent — `
            + 'say where it came from, or say that it is a guess.');
        assert.ok(c.kind, `${c.id}: no kind`);
        assert.ok(c.params && Object.keys(c.params).length,
            `${c.id}: no params`);
    }
});

test('every card param is in the declared electrical schema', () => {
    // The schema is what bw-circuit-ui's sidecar gate forbids. If a card can
    // carry a field the schema does not name, the gate cannot forbid it there.
    for (const c of allCards()) {
        for (const k of Object.keys(c.params)) {
            assert.ok(ELECTRICAL_FIELDS.has(k),
                `${c.id}.params.${k} is not in ELECTRICAL_FIELDS. Add it there so the sidecar `
                + 'gate in bw-circuit-ui forbids it too, or it becomes a field a sidecar may carry.');
        }
    }
});

test('every schema field is one the solver actually reads', () => {
    // DERIVED, NOT ASSERTED. A schema that can grow entries nothing reads is a
    // schema that grows false positives elsewhere: `w` and `l` were in the
    // first draft, read by nothing, and matched a top-level geometry width in
    // all 267 bw-circuit-ui sidecars. The set is the CONTRACT another repo
    // gates on, so an unread name there is a rule imposed for no reason.
    const src = ['src/mna.js', 'src/board.js', 'src/ac.js'].map(f => read(f)).join('\n');
    // Card keys are checked as KEYS, not by searching joined text for `.key` —
    // the first version did the latter and reported `bv` unread when a card
    // plainly carried it. The gate was right about bv for the wrong reason:
    // bv IS unread by the solver, and the card was storing SPICE's spelling of
    // vz alongside vz. Both were fixed; the check now cannot be right by luck.
    const inCards = new Set(allCards().flatMap(c => Object.keys(c.params)));
    const unread = [...ELECTRICAL_FIELDS].filter(f =>
        !new RegExp(`params\\??\\.${f}\\b|\\.${f}\\b`).test(src) && !inCards.has(f));
    assert.deepEqual(unread, [],
        'these schema fields are read by no solver source and by no card: '
        + JSON.stringify(unread) + '. Remove them, or point the scan at the file that reads them.');
    assert.ok(ELECTRICAL_FIELDS.size >= 10,
        `only ${ELECTRICAL_FIELDS.size} field(s) — the schema is empty and every check over it is vacuous`);
});

test('the library agrees with the constants the solver actually uses', () => {
    // THE RECONCILIATION, ASSERTED. Not "we chose 10" but "10 is the number
    // mna.js uses", so a change to either side fails here rather than drifting.
    assert.equal(I_RATED, JUNCTION_I_RATED,
        'the library and mna.js disagree about the rated current a vf is specified at');
    const led = cardFor('LED_RED');
    assert.equal(led.params.rd, JUNCTION_RD,
        `LED_RED.rd=${led.params.rd} but mna.js JUNCTION_RD=${JUNCTION_RD}`);
    assert.equal(led.params.rs, led.params.rd,
        'rs and rd are the same physical quantity; while they differ the routing toggle '
        + 'switches DEVICES rather than models');
    const si = cardFor('1N4148');
    const m = read('src/mna.js').match(/SILICON_RD\s*=\s*([\d.]+)/);
    assert.ok(m, 'mna.js no longer declares SILICON_RD — re-point this, do not delete it');
    assert.equal(si.params.rs, Number(m[1]),
        `1N4148.rs=${si.params.rs} but mna.js SILICON_RD=${m[1]}`);
});

test('the .model line is DERIVED, so a card change moves it', () => {
    // The exporter must not be able to hold its own copy. Proving derivation
    // needs the value to MOVE when the card does, which a fixed golden cannot
    // show — so the card is perturbed in memory and the output compared.
    const before = spiceModelFor('2N2222');
    assert.match(before.body, /Bf=200/);
    const card = cardFor('2N2222');
    const orig = card.params.beta;
    try {
        card.params.beta = 137;
        const after = spiceModelFor('2N2222');
        assert.match(after.body, /Bf=137/,
            'the emitted .model did not follow the card — it is holding its own copy of the number');
        assert.notEqual(before.body, after.body);
    } finally { card.params.beta = orig; }
    assert.equal(spiceModelFor('2N2222').body, before.body, 'the perturbation was not restored');
});

test('explicit params beat the card, because a typed number was meant', () => {
    const d = resolveParams({part: 'LED_RED'});
    assert.equal(d.vf, 2.0);
    const e = resolveParams({part: 'LED_RED', vf: 3.2});
    assert.equal(e.vf, 3.2, 'a card is a DEFAULT with provenance, not an override');
    assert.equal(e.rd, 10, 'the rest of the card must still apply');
    // An unknown part must not silently resolve to nothing useful.
    assert.deepEqual(resolveParams({part: 'NO_SUCH_PART', ohms: 5}), {part: 'NO_SUCH_PART', ohms: 5});
});

test('no card duplicates a number the solver hardcodes elsewhere', () => {
    // A card that RESTATES a constant is a second home wearing a card's
    // clothes. The two that legitimately match are asserted equal above; this
    // catches a THIRD appearing.
    const mna = read('src/mna.js');
    const literals = [...mna.matchAll(/^\s*const rd\s*=\s*([\d.]+)\s*;/gm)].map(x => Number(x[1]));
    assert.ok(literals.length >= 5, `only ${literals.length} rd literal(s) in mna.js — the scan drifted`);
    for (const v of literals) {
        assert.equal(v, JUNCTION_RD,
            `an rd literal of ${v} disagrees with JUNCTION_RD=${JUNCTION_RD}; it is a home this `
            + 'library does not own');
    }
});
