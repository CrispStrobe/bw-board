/**
 * THE CENSUS MUST RANGE OVER THE TREE, NOT OVER A LIST SOMEONE MAINTAINED.
 *
 * `scripts/oracle-census.mjs` says it prints "every external input that gates a
 * check in this repo". That claim was FALSE when this file was written: sixteen
 * test files probe an external input and turn its absence into a skip, without
 * a census row — including BOTH `oracle-masm` and `oracle-nasm`, which have the
 * word oracle in their names, and `avr-attiny88.test.js`, which gates on
 * `BLINKENROCKET_HEX`, an input the census DOES list but whose `gates` array
 * omits the file.
 *
 * The defect is the census's own shape, and it is the one this fleet keeps
 * finding: **it ranges over what someone remembered, not over what exists.**
 * A tool whose success is defined over its own inputs cannot report on the
 * inputs it never received. Same as a sync that printed "wrote 15 files, exit
 * 0" while fifteen OTHER files silently lost content, and same as a coverage
 * counter read against a corpus that never exercised the interesting case.
 *
 * So this test DERIVES the gated set from `test/` and requires every file using
 * the guard-then-skip idiom to be either (a) named in a census row's `gates`,
 * or (b) listed below with a reason. It cannot be satisfied by forgetting.
 *
 * THE LIST BELOW IS FROZEN DEBT, NOT AN EXEMPTION SCHEME. Every entry is a real
 * gap found on 2026-09-05 and left un-triaged because writing a census row
 * honestly needs research per input — what it proves, how to obtain it, whether
 * CI has it — and sixteen rows of guesswork would be worse than none. What this
 * test buys today is that the debt cannot GROW: a new guard-then-skip file
 * fails immediately. Entries should be deleted as rows are written, and the
 * list should only ever shrink.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/** An external input is probed, and its ABSENCE becomes a skip, not a failure. */
const EXTERNAL = /existsSync\(|process\.env\.[A-Z][A-Z0-9_]{2,}/;
const SKIPS = /\{ *skip:|skip: *[!a-z]|SKIPPED|process\.exit\(0\)/;

/**
 * NOT DEBT: the detector over-matches here. These guard on an IN-REPO path, so
 * the `existsSync` is defensive and never fires on a normal checkout — there is
 * no external input, and a census row would describe something that is not
 * missing. Counting them as debt would make the number wrong in the flattering
 * direction: more work outstanding than exists.
 */
const IN_REPO_DEFENSIVE = new Set([
    'sixty5o2.test.mjs',   // rom/sixty5o2/ is vendored: 6 tracked files
]);

/** Known, dated, un-triaged. Delete entries as census rows are written. */
const UNTRIAGED_2026_09_05 = new Set([
    'arduino-drivers.test.mjs',
    'avr-attiny88.test.js',        // gates on BLINKENROCKET_HEX; the row exists, the gates list omits it
    'avr-cross-check.test.js',
    'media-bundle.test.mjs',
    'multimeter-chain.test.mjs',
    // oracle-masm.test.mjs and oracle-nasm.test.mjs PROMOTED to census rows
    // (2026-09-05, id 'masm' and 'nasm'). The ratchet below drops 16 -> 14 in
    // the same change, so removing them can only be made green by the rows, not
    // by forgetting.
    'sap1-differential.test.mjs',
    'sap1-digital-parity.test.mjs',
    'serial-debug-e2e.test.js',
    'stc89c52-demos.test.mjs',
    'twi-bridge.test.mjs',
]);

/**
 * Comments removed, string and template literals intact.
 *
 * THE DETECTOR WAS READING PROSE. `EXTERNAL` matches `existsSync(` and `SKIPS`
 * matches `{ skip:`, and a file that DISCUSSES either -- a comment quoting
 * `if (existsSync(fixedDepth)) return;`, say -- matched both without containing
 * either. It cost a red master within minutes of a documentation-only commit:
 * the standing list added to `cases-that-were-never-declared.test.mjs` made that
 * file look like a guard-then-skip test, in the gate whose own header warns that
 * a document about a thing matches every pattern meant for the thing.
 *
 * Measured: stripping comments drops exactly two files from the derived set --
 * that one, and `hb6502-ehbasic-boot.mjs`, which had been a false positive
 * before anyone noticed.
 */
function stripComments(source) {
    let out = '';
    let quote = null;
    let escaped = false;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        const next = source[i + 1];
        if (quote) {
            out += c;
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; out += c; }
        else if (c === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; out += '\n'; }
        else if (c === '/' && next === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i++;
        } else out += c;
    }
    return out;
}

function derived() {
    const out = [];
    for (const f of readdirSync('test').filter((f) => /\.(test\.)?m?js$/.test(f))) {
        const s = stripComments(readFileSync('test/' + f, 'utf8'));
        if (EXTERNAL.test(s) && SKIPS.test(s)) out.push(f);
    }
    return out;
}

function censusGates() {
    const src = readFileSync('scripts/oracle-census.mjs', 'utf8');
    return new Set([...src.matchAll(/gates: \[([^\]]*)\]/g)]
        .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
        .map((p) => p.replace(/^test\//, '')));
}

test('every guard-then-skip test is in the census or named as debt', () => {
    const gates = censusGates();
    const unaccounted = derived()
        .filter((f) => !gates.has(f) && !UNTRIAGED_2026_09_05.has(f)
            && !IN_REPO_DEFENSIVE.has(f));
    assert.deepEqual(unaccounted, [],
        'These probe an external input and skip when it is absent, with no census '
        + 'row and no debt entry. An absent input that reads as a pass is how '
        + 'fifteen cross-repo tests once went quiet for weeks. Add a row to '
        + 'scripts/oracle-census.mjs, or add the file to UNTRIAGED with a reason:\n  '
        + unaccounted.join('\n  '));
});

test('the debt list does not outlive the debt', () => {
    // An entry for a file that no longer uses the idiom is stale, and a stale
    // exemption is how a list stops describing the tree it exempts from.
    const current = new Set(derived());
    const stale = [...UNTRIAGED_2026_09_05, ...IN_REPO_DEFENSIVE]
        .filter((f) => !current.has(f));
    assert.deepEqual(stale, [],
        'These are exempted but no longer probe-and-skip. Remove them from '
        + 'UNTRIAGED — an exemption must be able to stop being true:\n  ' + stale.join('\n  '));
});

test('the debt list is not a way to exempt the whole tree', () => {
    // If the exemption list ever covers most of the derived set, the guard has
    // become decorative. A ratchet, so this can only improve.
    const total = derived().length;
    // Both sets count: the ratchet is on TOTAL exemptions, so reclassifying a
    // file from debt to detector-false-positive cannot be used to make room.
    const exempt = derived().filter(
        (f) => UNTRIAGED_2026_09_05.has(f) || IN_REPO_DEFENSIVE.has(f)).length;
    // EXACT, NOT A CEILING, AND THE DIFFERENCE IS NOT PEDANTRY. This was
    // `exempt <= 12` and the count was under it, so ADDING an exemption passed
    // — measured, under time pressure, by me, while master was red: only the
    // failure text above ("write a census row instead") stopped the wrong fix.
    // A cap that sits above the count is permission to spend the gap, and the
    // moment somebody spends it is the moment nobody is reading carefully.
    //
    // So both directions red. Growing means the debt grew; SHRINKING means
    // somebody paid it down and must write the smaller number here, which is
    // the only way a ratchet reaches its terminal value of zero rather than
    // sitting under a ceiling forever.
    const EXEMPT_AT_2026_09_10 = 11;
    assert.equal(exempt, EXEMPT_AT_2026_09_10,
        exempt > EXEMPT_AT_2026_09_10
            ? `the exemption list GREW to ${exempt} of ${total} (was `
              + `${EXEMPT_AT_2026_09_10} on 2026-09-10). Write a census row in `
              + 'scripts/oracle-census.mjs instead of extending the list — the frozen debt '
              + 'was 16 on 2026-09-05 and 14 when masm and nasm were promoted, and it only '
              + 'goes down.'
            : `the exemption list FELL to ${exempt} of ${total} — good. Lower `
              + `EXEMPT_AT_2026_09_10 in this file to ${exempt} and date it, so the next `
              + 'person cannot spend what you paid off.');
});
