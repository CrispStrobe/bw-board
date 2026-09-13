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
import {allCards, cardFor, cardIds, cardAliases, spiceModelFor, resolveParams, classDefaults,
    ELECTRICAL_FIELDS, I_RATED} from '../src/parts-library.js';
import {JUNCTION_RD, JUNCTION_I_RATED, junctionRd} from '../src/mna.js';

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
    // THE SOLVER IS NOT THREE FILES. A registered device stamps its own
    // behaviour in `src/devices/`, so a number it reads is read by the solver
    // just as surely as one mna.js reads — and the scan said `kV`,
    // `contactOhms` and `openOhms` were unread the moment the motor and relay
    // constants got a home, when relay.js and dc-motor.js were reading all
    // three. A file list is a claim about where the solver lives; enumerate it
    // rather than remember it.
    const deviceDir = path.join(ROOT, 'src/devices');
    const deviceFiles = fs.existsSync(deviceDir)
        ? fs.readdirSync(deviceDir).filter(f => f.endsWith('.js')).map(f => `src/devices/${f}`)
        : [];
    assert.ok(deviceFiles.length >= 5,
        `only ${deviceFiles.length} device file(s) found — the scan drifted and would report `
        + 'every device-only field as unread');
    const src = ['src/mna.js', 'src/board.js', 'src/ac.js', ...deviceFiles]
        .map(f => read(f)).join('\n');
    // Card keys are checked as KEYS, not by searching joined text for `.key` —
    // the first version did the latter and reported `bv` unread when a card
    // plainly carried it. The gate was right about bv for the wrong reason:
    // bv IS unread by the solver, and the card was storing SPICE's spelling of
    // vz alongside vz. Both were fixed; the check now cannot be right by luck.
    const inCards = new Set(allCards().flatMap(c => Object.keys(c.params)));
    // DESTRUCTURING COUNTS AS READING. mosK does `const {kp, w, l} = params`,
    // which no `params.w` pattern can see — so the gate reported w and l unread
    // immediately after the solver was extended to read them. A scan that only
    // knows one access form reports a fact about the scan.
    const destructured = new Set();
    for (const m of src.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*\w*[Pp]arams\b/g)) {
        for (const name of m[1].split(',')) destructured.add(name.trim().split(/[:=]/)[0].trim());
    }
    const unread = [...ELECTRICAL_FIELDS].filter(f =>
        !new RegExp(`params\\??\\.${f}\\b|\\.${f}\\b`).test(src)
        && !destructured.has(f) && !inCards.has(f));
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
    // AND THE SAME CHECK FOR EVERY JUNCTION KIND, THROUGH THE FUNCTION THE
    // SOLVER CALLS. The clause here used to pin one CONSTANT (SILICON_RD)
    // against one CARD (1N4148), which is true of led and diode and was blind
    // to zener: junctionRd branched on `kind === 'diode'`, so a zener -- which
    // is silicon -- fell into the else and got rd = 10 against classDefaults'
    // 0.568. Two of three kinds agreeing is what a two-kind check reports as
    // full agreement. Enumerate the kinds from the table itself.
    const junctionKinds = ['led', 'diode', 'zener'];
    for (const kind of junctionKinds) {
        const want = classDefaults(kind).rs;
        assert.ok(want !== undefined, `classDefaults(${kind}) has no rs — the table lost a junction kind`);
        assert.equal(junctionRd({kind}), want,
            `junctionRd(${kind})=${junctionRd({kind})} but classDefaults(${kind}).rs=${want}; `
            + 'the piecewise path and the exponential path would model different devices');
    }
    // Every card of a junction kind agrees with its own class default unless it
    // deliberately overrides -- and if it overrides, both spellings must move.
    for (const id of cardIds()) {
        const card = cardFor(id);
        if (!junctionKinds.includes(card.kind)) continue;
        const {rs, rd} = card.params;
        if (rs !== undefined && rd !== undefined) assert.equal(rs, rd,
            `${id} carries rs=${rs} and rd=${rd}; they are one quantity in two spellings`);
        assert.equal(junctionRd({kind: card.kind, params: card.params}), rs ?? rd ?? classDefaults(card.kind).rs,
            `${id}: junctionRd does not return the card's own bulk resistance`);
    }
});

test("every card's kind is a kind the engine actually registers", () => {
    // THE SECOND-HOME CHECK, from the other side. A card whose kind is not a
    // real kind is numbers nobody reaches; a card naming the WRONG kind is
    // worse, because both halves look fine alone. TIP120 was exactly that: the
    // card said `npn` while devices/analog-ics.js registers `tip120` with its
    // own Darlington stamp, so a placed tip120 would have ignored the card and
    // a placed npn+part:TIP120 would have missed the stamp. Found by lego-38
    // reading the registry, not by any test here — hence this test.
    const known = new Set();
    for (const f of ['src/devices.js', 'src/register-all.js']) {
        for (const m of read(f).matchAll(/registerDevice\(\s*'([a-z0-9_]+)'/g)) known.add(m[1]);
        for (const m of read(f).matchAll(/'([a-z0-9_]+)'/g)) known.add(m[1]);
    }
    for (const f of fs.readdirSync(path.join(ROOT, 'src/devices'))) {
        if (!f.endsWith('.js')) continue;
        for (const m of read(`src/devices/${f}`).matchAll(/registerDevice\(\s*'([a-z0-9_]+)'/g)) known.add(m[1]);
    }
    assert.ok(known.size >= 20, `only ${known.size} kind(s) discovered — the scan drifted and this check is vacuous`);
    for (const c of allCards()) {
        assert.ok(known.has(c.kind),
            `card ${c.id} names kind '${c.kind}', which no registerDevice call or builtin list mentions. `
            + 'A card is numbers for a stamp that EXISTS.');
    }
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

test('EVERY card can emit a .model body — a card that cannot is worse than no card', () => {
    // THE GATE THAT WOULD HAVE CAUGHT ALL THREE OF lego-38's FINDINGS, and did
    // not exist because the .model test sampled one card instead of enumerating.
    //
    // A card that exists and returns null is not a harmless gap. The exporter
    // derives its element line from the card and its `.model` line from
    // spiceModelFor, so a null produces a deck that NAMES a model it never
    // defines: no warning, nothing in `skipped`, a deck that reads complete and
    // cannot simulate. TIP120 and NMOS_GENERIC were both in that state — the
    // model builder branched on npn/pnp/diode/led/zener and neither `tip120`
    // (its own Darlington stamp) nor `nmos` had a branch.
    const broken = [];
    for (const id of cardIds()) {
        const m = spiceModelFor(id);
        if (!m || !m.name || !m.type || !m.body) { broken.push(id); continue; }
        // A body of nothing but `null`s is the same defect wearing a string.
        if (/(^|[ =])null([ )]|$)/.test(m.body)) broken.push(`${id} (body has null: ${m.body})`);
    }
    assert.deepEqual(broken, [],
        'these cards cannot produce a .model body, so an exporter that derives from the library '
        + 'emits an element line naming a model the deck never defines');
});

test('every name cardFor resolves is reachable, and every card is reachable by both', () => {
    // The key and the `id` are ALLOWED to differ — NMOS_GENERIC/MOSFET does —
    // but then BOTH must resolve, or the card is invisible under the name its
    // consumer actually uses. cardFor('MOSFET') returned null while the card
    // existed for the sole purpose of replacing a `.model MOSFET` literal.
    for (const name of cardAliases()) {
        assert.ok(cardFor(name), `cardAliases() lists ${name} but cardFor cannot resolve it`);
    }
    for (const key of cardIds()) {
        const card = cardFor(key);
        assert.ok(card, `cardFor cannot resolve its own key ${key}`);
        assert.equal(cardFor(card.id)?.id, card.id,
            `${key} has id ${card.id} and cardFor(${card.id}) does not find it`);
        assert.equal(cardFor(key.toLowerCase())?.id, card.id, `${key} is not case-insensitive`);
    }
    // ANTI-VACUITY: the split this exists for must still be present, or the
    // test is asserting a property of an empty difference.
    const split = cardIds().filter(k => k !== cardFor(k).id);
    assert.ok(split.length >= 1,
        'no card key differs from its id any more — if that was deliberate, delete this test '
        + 'rather than leaving it passing over a case that cannot occur');
});

test('the generics are marked, and a generic is reachable through its KIND', () => {
    // A reachability gate has to answer "can a user get to this card", and the
    // answer differs by species: a real part number is offered BY NAME, a
    // generic is not — nothing puts "NMOS_GENERIC" in a menu, it is reached by
    // placing an nmos. bw-circuit-ui needs that split derivable rather than
    // hand-kept in the other repo, which is one more place we can disagree.
    const generics = allCards().filter(c => c.generic);
    const parts = allCards().filter(c => !c.generic);
    assert.ok(generics.length >= 2, `only ${generics.length} cards marked generic`);
    assert.ok(parts.length >= 4, `only ${parts.length} cards are real part numbers`);

    // AND THE MARK MUST MATCH THE FILE'S OWN CLAIM ABOUT ITSELF, not merely be
    // populous. A `>= 2` floor is a population check: unmarking ONE generic
    // leaves two and passes, which a mutation run showed immediately. The
    // source already states the answer in a section header, so make that
    // comment a checkable claim rather than a decoration — a card that moves
    // into the generics block without the mark, or carries the mark outside it,
    // is then a failure by name.
    const src = read('src/parts-library.js');
    const start = src.indexOf('// ---- generics');
    assert.ok(start > 0, 'the generics section header is gone — re-point this, do not delete it');
    const rest = src.slice(start + 10);
    const end = rest.indexOf('// ---- ');
    const block = end === -1 ? rest : rest.slice(0, end);
    const declared = new Set([...block.matchAll(/^\s*'([A-Za-z0-9_]+)':\s*\{/gm)].map(m => m[1]));
    assert.ok(declared.size >= 2,
        `the generics block declares ${declared.size} cards — the scan drifted, it is not `
        + 'reporting an empty section as agreement');
    for (const key of declared) {
        assert.equal(cardFor(key)?.generic, true,
            `${key} is declared under the generics header and is not marked generic: true`);
    }
    for (const c of generics) {
        // LED_RED sits with the junctions because that is where a reader looks
        // for it, so membership is one-way: everything in the block is generic,
        // not everything generic is in the block. Assert the direction that
        // holds, and name the exception rather than loosening the rule.
        if (declared.has(cardIds().find(k => cardFor(k) === c))) continue;
        assert.equal(c.id, 'LED_RED',
            `${c.id} is marked generic but is not in the generics block and is not the one `
            + 'documented exception — either move it there or say here why it is out');
    }
    for (const c of allCards()) {
        assert.ok(c.generic === undefined || c.generic === true,
            `${c.id}.generic is ${c.generic}; the mark is true or absent, never false — an `
            + 'explicit false and an absent field would be two spellings of one state');
    }
    // A generic's kind must be placeable, because that is its ONLY route.
    const known = new Set();
    for (const f of ['src/devices.js', 'src/register-all.js']) {
        for (const m of read(f).matchAll(/registerDevice\(\s*'([a-z0-9_]+)'/g)) known.add(m[1]);
        for (const m of read(f).matchAll(/'([a-z0-9_]+)'/g)) known.add(m[1]);
    }
    for (const c of generics) {
        assert.ok(known.has(c.kind),
            `${c.id} is generic, so its only route to a user is placing a ${c.kind} — and no `
            + 'registerDevice call offers that kind, which makes the card unreachable entirely');
    }
});
