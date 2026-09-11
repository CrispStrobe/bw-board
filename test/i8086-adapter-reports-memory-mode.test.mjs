// THE ADAPTER REPORTS WHICH MEMORY MODE IT RESOLVED TO.
//
// `fastWords: false` in the config makes the machine skip the RAM word-access
// fast path. Nothing reported that, so a caller could ask for the reference
// path, not get it, and have no way to notice: the adapter's surface is
// machine/clockHz/unloggedBoardInputs/onSerial/sendSerial/loadRom/attachBoard/
// syncInputs/advanceNs/timeNs/stats, and none of them mention memory.
//
// WHY THIS MATTERS NOW. Resolving that preference used to happen INSIDE the
// adapter, which reached out of the vendored tree to do it; that reach was
// removed and the CALLER now resolves. That is the right seam, but it is only
// safe if the absence is DECLARABLE -- the same rule the injected
// instruction-length table follows, where a target with no table says
// `extensions.instructionBytes: 'none'` rather than quietly publishing facts
// without bytes. A caller that forgets to resolve currently gets the optimized
// accessors it asked not to have, silently. This is the declaration that makes
// that detectable.
//
// THE REPORT IS PINNED TO THE EFFECT, NOT TO THE CONFIG. The decisive case is
// the last one: whatever the adapter says must agree with what the machine
// actually did. A report re-derived from the config would drift the day the
// machine's own condition changes, which is how one value with two builders
// always fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createI8086Adapter } from '../src/i8086-adapter.js';
import { BREADBOARD8086 } from '../src/i8086-machine.js';

/** The observable effect: the fast path installs its own `_rd16` on the cpu. */
const fastPathInstalled = adapter => Object.hasOwn(adapter.machine.cpu, '_rd16');

test('the adapter reports the fast word path when the config does not decline it', () => {
    const adapter = createI8086Adapter();
    assert.equal(adapter.fastWordAccess, true,
        'the default config takes the fast path, and the adapter must say so');
    assert.equal(fastPathInstalled(adapter), true, 'and the machine really installed it');
});

test('the adapter reports the reference path when the config declines the fast one', () => {
    const adapter = createI8086Adapter({config: {...BREADBOARD8086, fastWords: false}});
    assert.equal(adapter.fastWordAccess, false,
        'a caller that resolved to the reference path must be able to confirm it');
    assert.equal(fastPathInstalled(adapter), false, 'and the machine really skipped it');
});

test('the report agrees with what the machine did, in both modes', () => {
    // THE ANTI-LIE CASE. Asserting the report alone would pass on an adapter
    // that hardcodes it; asserting the effect alone would pass on an adapter
    // that reports nothing. Only the agreement makes the report worth reading,
    // and it is what fails if the machine's condition and the adapter's report
    // ever stop being the same decision.
    for (const fastWords of [undefined, true, false]) {
        const config = fastWords === undefined
            ? {...BREADBOARD8086}
            : {...BREADBOARD8086, fastWords};
        const adapter = createI8086Adapter({config});
        assert.equal(adapter.fastWordAccess, fastPathInstalled(adapter),
            `report and effect disagree for fastWords: ${String(fastWords)} — the adapter is `
            + 'describing a decision it did not observe');
    }
});
