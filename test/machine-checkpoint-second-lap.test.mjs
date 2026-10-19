/**
 * RESTORE TWICE. Every debug target, every time.
 *
 * Until 2026-09-11 nothing in this repository restored a checkpoint more than
 * once in a single test. That sounds like a coverage detail and it is not: ONE
 * RESTORE NEVER PRODUCES THE STATE THE SECOND ONE IS ABOUT. The first restore is
 * what stamps the clock with an epoch suffix (`m6502-cycles-rewind-1`), so only
 * a checkpoint captured AFTER a restore carries a suffixed domain, and only that
 * checkpoint can be fed back into a guard that reads domains.
 *
 * The defect that lived there: `m6502-machine.js`'s guard matched
 * `-reset-` while `m6502-debug.js` stamps `-rewind-`, so the second restore was
 * refused —
 *
 *     {"refused":"checkpoint simulation time is inconsistent",
 *      "code":"INVALID_CHECKPOINT_TIME"}
 *
 * Reverse debugging worked exactly once per session and then stopped, blaming
 * simulation time rather than a regex. It survived every checkpoint suite in
 * this repo because all of them stop after one lap.
 *
 * THE MACHINE-LEVEL TWIN IS NOT ENOUGH, and finding that out is why this file
 * exists separately. machine-checkpoint.test.mjs restores three times over a
 * BARE machine — and a bare machine never stamps an epoch, because the suffix
 * comes from installInstructionDebugEvents, which runs only when a debug target
 * is attached. That case stayed green against the reverted guard. The state has
 * to be built with a real target or it is not built at all.
 *
 * "The unit that exists is the unit that gets exercised once."
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { Z80Machine } from '../src/z80-machine.js';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import { logicalTimeDomain } from '../src/instruction-debug-events.js';

/** A running target per core, with the event machinery installed. */
const TARGETS = [
    {
        name: 'm6502',
        make: () => {
            const adapter = createM6502Adapter({});
            const machine = adapter.machine;
            machine.loadRom([0xea, 0x4c, 0x00, 0x80]);          // NOP; JMP $8000
            machine.mem[0xfffc] = 0x00; machine.mem[0xfffd] = 0x80;
            machine.reset();
            const target = createM6502DebugTarget(adapter);
            target.onDebugEvent(() => {});                       // installs the wrappers
            machine.step(); machine.step();
            return { target, run: () => { machine.step(); machine.step(); } };
        }
    },
    {
        name: 'z80',
        make: () => {
            const machine = new Z80Machine();
            const target = createZ80DebugTarget({ machine });
            target.onDebugEvent(() => {});
            machine.step(); machine.step();
            return { target, run: () => { machine.step(); machine.step(); } };
        }
    },
    {
        name: 'i8086',
        make: () => {
            const rom = new Uint8Array(0x10000).fill(0x90);
            rom.set([0xea, 0x00, 0x00, 0x00, 0xf0], 0xfff0);
            const machine = new I8086Machine(PCXT8086, {});
            machine.loadRom(rom); machine.reset(); machine.step();
            const target = createI8086DebugTarget({ machine });
            target.onDebugEvent(() => {});
            machine.step(); machine.step();
            return { target, run: () => { machine.step(); machine.step(); } };
        }
    }
];

const accepted = outcome => outcome === undefined || outcome === true || outcome === false
    ? true
    : !(outcome && outcome.refused);

for (const { name, make } of TARGETS) {
    test(`${name}: a checkpoint captured AFTER a restore is itself restorable`, () => {
        const { target, run } = make();

        const first = target.captureCheckpoint();
        assert.ok(!first.refused,
            `${name}: fixture — the first capture was refused: ${JSON.stringify(first.refused)}`);
        run();
        assert.ok(accepted(target.restoreCheckpoint(first)),
            `${name}: fixture — the FIRST restore was refused, so this case never reaches the `
            + 'second lap it is about');

        const second = target.captureCheckpoint();
        assert.ok(!second.refused,
            `${name}: CAPTURE after a restore was refused: ${JSON.stringify(second.refused)}`);

        // THE PRECONDITION, ASSERTED. Without a stamped domain this case is the
        // bare-machine one over again — green whatever the guard says.
        assert.match(second.time.domain, /-(?:reset|rewind)-\d+$/,
            `${name}: fixture — the restore did not stamp an epoch (domain is `
            + `${JSON.stringify(second.time.domain)}), so the guard below is being handed an `
            + 'ordinary domain and this case cannot fail for the reason it exists');
        assert.equal(logicalTimeDomain(second.time.domain), logicalTimeDomain(first.time.domain),
            `${name}: the stamped domain does not reduce to the same logical clock as the `
            + 'unstamped one — the suffix is not one logicalTimeDomain knows');

        run();
        assert.ok(accepted(target.restoreCheckpoint(second)),
            `${name}: A CHECKPOINT TAKEN AFTER A RESTORE COULD NOT BE RESTORED. Its domain is `
            + `${JSON.stringify(second.time.domain)}; a guard matching a bare base name, or one `
            + 'label spelled out, refuses it. Reverse debugging then works exactly once.');

        // Three, because the epoch counter grows: coping with 1 is not coping with 2.
        const third = target.captureCheckpoint();
        assert.ok(!third.refused, `${name}: capture after the second restore was refused`);
        assert.ok(accepted(target.restoreCheckpoint(third)),
            `${name}: the THIRD restore was refused. Each rewind increments the epoch, so a `
            + 'guard that handles -rewind-1 need not handle -rewind-2.');
    });
}
