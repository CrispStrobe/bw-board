/**
 * The 8086's event epoch is a REWIND, and the label says so.
 *
 * `reset()` on this core ADVANCES the clock. The only backward moves are
 * `loadState` and the explicit bump in `restoreCheckpoint` — so an epoch opened
 * here is a rewind epoch, never a reset one.
 *
 * The shared module stamps `${timeDomain}-${rewindLabel}-${n}`, and that label
 * became a required per-target parameter when z80 and m6502 needed `rewind`.
 * This target passed `'reset'` for one commit as an explicit no-op while the
 * parameter landed, with a note routing the correction here.
 *
 * WHY A TEST AND NOT JUST A WORD: the evidence for `rewind` is downstream.
 * brickwright-lite renamed this epoch on 2026-09-10 after measuring what moves
 * the clock, and its `i8086-debug-events` suite asserts `i8086-cycles-rewind-1`.
 * Nothing here held it, so the no-op reached a pin bump and reddened a consumer.
 * This is that expectation, upstream, where the label lives.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createI8086DebugTarget} from '../src/i8086-debug.js';
import {I8086Machine} from '../src/i8086-machine.js';

test('an epoch opened by a restore is named a REWIND, not a reset', () => {
    const machine = new I8086Machine();
    const target = createI8086DebugTarget({machine});
    const facts = [];
    target.onDebugEvent(f => facts.push(f));

    const before = target.debugTime().domain;
    assert.equal(before, 'i8086-cycles',
        'fixture: a fresh target must start on the bare base, or the suffix below proves nothing');

    machine.step();
    const cp = target.captureCheckpoint();
    assert.ok(cp && !cp.refused, `fixture: the checkpoint was refused (${cp?.code})`);
    machine.step();
    target.restoreCheckpoint(cp);

    machine.step();   // produce a module fact INSIDE the new epoch

    // THE MODULE'S FACT, not `debugTime()`. `rewindLabel` governs what the SHARED
    // MODULE stamps; the target's own clock derives its suffix separately and says
    // `-rewind-` whatever the parameter is. A first version of this test asserted
    // on `debugTime()` and passed with the label flipped back to 'reset' — a test
    // for a parameter, probing a value the parameter does not reach.
    const domains = [...new Set(facts.map(f => f.time?.domain).filter(Boolean))];
    assert.ok(domains.length > 1,
        `fixture: every module fact carries one domain (${domains.join(', ')}), so the `
        + 'restore produced no post-epoch fact and the assertion below is vacuous');
    const after = domains.at(-1);
    assert.notEqual(after, before, 'fixture: the restore opened no new epoch at all');
    assert.match(after, /^i8086-cycles-rewind-\d+$/,
        `the epoch is named '${after}'. This core's reset() ADVANCES the clock, so an epoch `
        + 'opened by a restore is a REWIND. `-reset-` here is the 8051\'s label, and that '
        + 'target\'s own mechanism is genuinely a reset — the two must not be converged.');
});
