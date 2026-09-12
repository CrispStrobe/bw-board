// THE TARGET'S CLOCK AND THE MODULE'S AGREE, AND NOTHING ELSE HOLDS THAT.
//
// `i8086-debug.js` keeps its own event-clock epoch and `installInstructionDebugEvents`
// keeps another. They are two counters over one underlying tick source, so a fact
// and a `debugTime()` can disagree without anything failing -- a consumer ordering
// one against the other would be comparing stamps from two timelines that print
// almost the same.
//
// They agreed only by construction until this file: both read `machine.cycles`,
// both stamp `i8086-cycles`, and since this target passes `rewindLabel: 'rewind'`
// both suffix `-rewind-N`. A comment said so for a while, and by the time anyone
// read it the label half had already stopped being true in the other direction --
// it described a divergence that had since been repaired.
//
// THE REWIND CASE IS THE ONE THAT MATTERS. Before any backward move both are
// unsuffixed and agree trivially, which is the state a careless test would check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import {logicalTimeDomain, REWIND_LABELS} from '../src/instruction-debug-events.js';

const build = () => {
    const r = new Uint8Array(0x10000).fill(0x90);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf0], 0xfff0);
    const machine = new I8086Machine(PCXT8086, {});
    machine.loadRom(r);
    machine.reset();
    machine.step();
    const facts = [];
    const target = createI8086DebugTarget({machine});
    target.onDebugEvent(f => facts.push(f));
    return {machine, target, facts};
};
const lastFactDomain = facts => facts[facts.length - 1].time.domain;

test('before any rewind, both clocks are unsuffixed and agree', () => {
    // The control. It would pass even if the two epochs were unrelated, which is
    // exactly why it is not the assertion this file exists for.
    const {machine, target, facts} = build();
    machine.step();
    assert.ok(facts.length > 0, 'no facts at all -- the instrument, not the target');
    assert.equal(target.debugTime().domain, 'i8086-cycles');
    assert.equal(lastFactDomain(facts), 'i8086-cycles');
});

test('after a restore moves the clock back, both carry the SAME rewind suffix', () => {
    const {machine, target, facts} = build();
    machine.step();
    const snapshot = target.captureCheckpoint();
    assert.ok(!snapshot.refused, `capture refused: ${snapshot.refused}`);
    machine.step();
    machine.step();
    assert.equal(target.restoreCheckpoint(snapshot), true);
    machine.step();

    const targetDomain = target.debugTime().domain;
    const factDomain = lastFactDomain(facts);
    assert.match(targetDomain, /^i8086-cycles-rewind-\d+$/,
        `the target's clock did not open a rewind epoch: ${targetDomain}`);
    assert.equal(factDomain, targetDomain,
        `a fact stamped ${factDomain} while debugTime() says ${targetDomain}; ` +
        'a consumer ordering one against the other is comparing two timelines');
});

test('the label is the one every reader strips, not a private spelling', () => {
    // The defect this guards against was a writer stamping a suffix no reader
    // knew: `-reset-` written, `-rewind-` expected, and a replay comparing the
    // two declared the stream diverged.
    const {machine, target} = build();
    machine.step();
    const snapshot = target.captureCheckpoint();
    machine.step();
    target.restoreCheckpoint(snapshot);

    // DERIVED FROM THE AUTHORITY, not from the one wrong spelling.
    //
    // This asserted `!domain.includes('-reset-')` — true, and true about a
    // single label somebody thought of. The claim is that whatever this target
    // stamps, THE PARSER EVERY READER USES CAN TAKE IT OFF. Written that way it
    // follows REWIND_LABELS: a fifth label added there is covered here for free,
    // and a private spelling fails whatever it happens to be.
    const domain = target.debugTime().domain;
    assert.match(domain, /-rewind-\d+$/,
        `fixture: no rewind epoch was stamped (${domain}), so the check below is looking at `
        + 'an ordinary domain and would pass with any label at all');
    assert.equal(logicalTimeDomain(domain), 'i8086-cycles',
        `this target stamps ${domain}, which logicalTimeDomain() cannot reduce to its base `
        + 'clock. Every reader derives its pattern from REWIND_LABELS, so a label outside '
        + 'that set is one nothing downstream can strip — a replay would compare this '
        + 'against the unstamped recording and declare the stream diverged.');
    for (const label of REWIND_LABELS) {
        assert.equal(logicalTimeDomain(`i8086-cycles-${label}-4`), 'i8086-cycles',
            `the authority no longer strips its own declared label "${label}"`);
    }
});
