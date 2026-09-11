/**
 * ONE RULE FOR STAMPING AN EPOCH SUFFIX, AND ONE FOR TAKING IT OFF.
 *
 * `installInstructionDebugEvents` stamps `<domain>-<rewindLabel>-<epoch>` after a
 * backward clock move. Every reader that compares two time facts has to take
 * that suffix off first — and until 2026-09-11 each reader carried its own copy
 * of the rule. The copies disagreed, and the wrong ones were the production
 * ones:
 *
 *   z80-machine.js           /-(?:reset|rewind)-\d+/   right
 *   m6502-machine.js         /-reset-\d+/              WRONG — m6502 stamps `rewind`
 *   m6502-debug.js           /-reset-\d+/              WRONG — three lines from its own label
 *   lite's replayClockDomain /-reset-\d+/              WRONG for z80, m6502 and 8086
 *
 * Three of four cores here pass `rewindLabel: 'rewind'`, so after ANY restore a
 * reader that strips only `-reset-` calls the domain foreign, every replayed
 * event compares unequal, and a reverse step refuses with "replayed event stream
 * diverged". That refusal names the symptom; the cause was a regex.
 *
 * WHY NOTHING CAUGHT IT, which is the part worth keeping: every TEST that drives
 * a replay defines its own `logicalDomain`, and all of them strip BOTH labels,
 * because whoever wrote them had read the builder. The tests were doing the
 * app's job. They passed while the app failed, and only a browser driving the
 * real thing could tell the difference.
 *
 * So this file asserts the two directions against each other, and — the case
 * that would actually have caught it — drives a real restore and checks the
 * domain the guard sees.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {REWIND_LABELS, EPOCH_SUFFIX, logicalTimeDomain, installInstructionDebugEvents}
    from '../src/instruction-debug-events.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

test('the parser strips exactly the suffixes the builder can stamp', () => {
    // The two directions pinned against each other, over the whole declared set,
    // rather than over the one label somebody happened to think of.
    assert.ok(REWIND_LABELS.length >= 2, 'the label set collapsed to fewer than two');
    for (const label of REWIND_LABELS) {
        for (const epoch of [1, 7, 128]) {
            const stamped = `z80-cycles-${label}-${epoch}`;
            assert.equal(logicalTimeDomain(stamped), 'z80-cycles',
                `a domain stamped with the declared label "${label}" is not stripped by the `
                + 'parser that is supposed to be its inverse');
        }
    }
    // And it must not eat things that are not an epoch suffix, or two genuinely
    // different clocks would compare equal — the failure in the other direction.
    for (const keep of ['z80-cycles', 'm6502-cycles', 'i8086-cycles',
        'z80-cycles-rewind', 'z80-cycles-rewind-x', 'some-reset-domain']) {
        assert.equal(logicalTimeDomain(keep), keep,
            `${keep} is not an epoch-stamped domain but the parser truncated it`);
    }
});

test('EVERY core in this repo passes a label the parser knows — enumerated, not named', () => {
    // DERIVED FROM SOURCE. Naming the four cores I know about is how the fourth
    // one gets missed; this reads whatever is actually there. A fifth core with
    // a new label fails here by name, before it can ship a domain nothing can
    // take apart.
    const found = [];
    for (const file of readdirSync(SRC).filter(f => f.endsWith('.js'))) {
        const text = readFileSync(path.join(SRC, file), 'utf8');
        for (const m of text.matchAll(/rewindLabel:\s*'([^']+)'/g)) found.push([file, m[1]]);
    }
    assert.ok(found.length >= 3,
        `only ${found.length} rewindLabel declaration(s) found in src/ — the scan stopped `
        + 'matching, and an enumeration that finds nothing approves everything');
    const unknown = found.filter(([, label]) => !REWIND_LABELS.includes(label));
    assert.deepEqual(unknown, [],
        'these cores stamp an epoch label the parser cannot strip, so every reader downstream '
        + 'sees a foreign clock after the first rewind: '
        + unknown.map(([f, l]) => `${f} -> ${l}`).join(', '));
});

test('no reader keeps its own copy of the rule', () => {
    // THE ACTUAL DEFECT, as a rule rather than as four fixes. Four readers, four
    // regexes, three of them wrong. A literal epoch pattern outside the file
    // that declares it is a second opinion about a fact this repo now has one
    // answer for.
    const offenders = [];
    for (const file of readdirSync(SRC).filter(f => f.endsWith('.js'))) {
        if (file === 'instruction-debug-events.js') continue;   // the declaring file
        const text = readFileSync(path.join(SRC, file), 'utf8');
        text.split('\n').forEach((line, i) => {
            if (/^\s*(\/\/|\*)/.test(line)) return;             // a comment may quote it
            if (/-(?:reset|rewind)-\\d\+/.test(line) || /-reset-\\d\+/.test(line)) {
                offenders.push(`${file}:${i + 1}`);
            }
        });
    }
    assert.deepEqual(offenders, [],
        'these files write the epoch-suffix pattern out again instead of calling '
        + '`logicalTimeDomain`: ' + offenders.join(', ') + '. A copy does not follow '
        + 'REWIND_LABELS when a core is added, which is how three of four readers came to '
        + 'disagree with the writer.');
});

test('the builder REFUSES a label the parser cannot strip', () => {
    // Without this, the two can still drift: someone adds a core with
    // rewindLabel: 'restore', every test passes, and the defect appears only
    // after a user rewinds. Refusing at construction makes them one decision.
    assert.throws(
        () => installInstructionDebugEvents({
            cpu: {}, machine: {cycles: 0, clockHz: 1}, cpuId: 'x', timeDomain: 'x-cycles',
            captureRegisters: () => ({}), captureInstruction: () => ({}),
            rewindLabel: 'restore'
        }),
        /logicalTimeDomain\(\) cannot strip/,
        'a label outside REWIND_LABELS was accepted, so the writer can stamp a suffix no '
        + 'reader can remove');

    // And the declared ones are still accepted — the guard must not refuse everything.
    for (const label of REWIND_LABELS) {
        assert.doesNotThrow(
            () => installInstructionDebugEvents({
                cpu: {}, machine: {cycles: 0, clockHz: 1}, cpuId: 'x', timeDomain: 'x-cycles',
                captureRegisters: () => ({}), captureInstruction: () => ({}),
                rewindLabel: label
            }),
            `the declared label "${label}" is being refused`);
    }
});

test('EPOCH_SUFFIX is built from the label set, so a new label carries to every reader', () => {
    // Pins the derivation itself: a hand-written EPOCH_SUFFIX would let the list
    // and the pattern drift, which is the same defect one level in.
    for (const label of REWIND_LABELS) {
        assert.ok(EPOCH_SUFFIX.test(`d-${label}-1`),
            `EPOCH_SUFFIX does not match the declared label "${label}" — it was written out `
            + 'by hand rather than built from REWIND_LABELS');
    }
});

// ---- and now the case that would actually have caught it -------------------

import {createM6502Adapter} from '../src/m6502-adapter.js';
import {createM6502DebugTarget} from '../src/m6502-debug.js';

/** A running 6502 whose only job is to move the clock. */
const running = () => {
    const adapter = createM6502Adapter({});
    const machine = adapter.machine;
    machine.loadRom([0xea, 0x4c, 0x00, 0x80]);     // NOP; JMP $8000
    machine.mem[0xfffc] = 0x00; machine.mem[0xfffd] = 0x80;
    machine.reset();
    const target = createM6502DebugTarget(adapter);
    target.onDebugEvent(() => {});                  // install the event machinery
    machine.step(); machine.step();
    return {machine, target};
};

test('a checkpoint taken AFTER a restore is itself restorable — rewind twice', () => {
    // THE USER-FACING SHAPE OF THE BUG, and the reason the unit checks above are
    // not enough on their own. Every one of them is about a string.
    //
    // Measured 2026-09-11 against the pre-fix readers: restore worked ONCE. The
    // first restore stamps the clock `m6502-cycles-rewind-1`; the next
    // checkpoint therefore carries that domain; and the guard, which knew only
    // `-reset-`, called it a foreign clock —
    //
    //     {"refused":"checkpoint simulation time is inconsistent",
    //      "code":"INVALID_CHECKPOINT_TIME"}
    //
    // A reverse debugger that works exactly once, and refuses afterwards with a
    // message about simulation time rather than about a regex.
    //
    // EVERY EXISTING TEST MISSED IT BECAUSE NONE RESTORES TWICE. One restore
    // never produces a stamped domain to feed back in, so the whole defect lives
    // in the second lap.
    const {target} = running();

    const first = target.captureCheckpoint();
    assert.ok(!first.refused, `fixture: the first checkpoint was refused: ${JSON.stringify(first)}`);
    assert.equal(first.time.domain, 'm6502-cycles',
        'fixture: the clock is already stamped before any rewind, so this case is not '
        + 'testing what it says');

    assert.equal(target.restoreCheckpoint(first) || false, false,
        'the FIRST restore was refused — this case cannot reach the defect it is about');

    const second = target.captureCheckpoint();
    assert.ok(!second.refused, `the checkpoint after a restore was refused: ${JSON.stringify(second)}`);
    assert.match(second.time.domain, /^m6502-cycles-rewind-\d+$/,
        'fixture: the restore did not stamp a rewind epoch, so the second restore below is '
        + 'not exercising a stamped domain and would pass with the defect present');

    assert.equal(target.restoreCheckpoint(second) || false, false,
        'A CHECKPOINT TAKEN AFTER A RESTORE COULD NOT BE RESTORED. Its domain carries the '
        + 'rewind epoch the restore stamped, and the guard was matching `-reset-` only — so '
        + 'reverse debugging worked exactly once and then refused, blaming simulation time.');
});

test('replayToInputBoundary accepts a boundary recorded after a rewind', () => {
    // Same defect, the other reader in the same file. `m6502-debug.js` installs
    // its events with `rewindLabel: 'rewind'` and then stripped `-reset-` three
    // lines further down, so every boundary recorded after a restore was refused
    // as `invalid-input-boundary` — outside the m6502 cycle clock, on the m6502.
    const {target} = running();
    const checkpoint = target.captureCheckpoint();
    target.restoreCheckpoint(checkpoint);

    const now = target.debugTime();
    assert.match(now.domain, /-rewind-\d+$/,
        'fixture: no rewind epoch is stamped, so the boundary below is an ordinary one and '
        + 'this case proves nothing');

    // Walk forward to a real instruction boundary on the post-rewind clock.
    const out = target.replayToInputBoundary({ticks: Number(now.ticks) + 2, domain: now.domain});
    assert.notEqual(out.code, 'invalid-input-boundary',
        'a boundary on THIS target\'s own post-rewind clock was rejected as outside the '
        + `m6502 cycle clock: ${JSON.stringify(out)}`);
});
