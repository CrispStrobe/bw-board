import test from 'node:test';
import assert from 'node:assert/strict';

import { M6502Machine } from '../src/m6502-machine.js';
import { Z80Machine } from '../src/z80-machine.js';
import { I8086Machine } from '../src/i8086-machine.js';
import { MACHINE_CHECKPOINT_SCHEMA } from '../src/machine-checkpoint.js';

// The shared machine-checkpoint contract, exercised at the MACHINE layer on all
// three consumers. machine-contract.test.mjs proves saveState/loadState carry
// state; this proves the checkpoint envelope on top of them — schema stamp,
// topology guard, complete round trip, and fail-closed refusals — behaves the
// same way for m6502, z80 and i8086, which is the point of a shared contract.
//
// Default config, no program loaded: "whatever memory reads as" is a fair and
// varied instruction stream to hold a checkpoint over, the same premise the
// machine-contract suite runs on.
const MACHINES = [
    { name: 'm6502', make: () => new M6502Machine() },
    { name: 'z80', make: () => new Z80Machine() },
    { name: 'i8086', make: () => new I8086Machine() },
];

const trace = (m, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(`${m.step()}@${m.cycles}`);
    return out.join(',');
};

for (const { name, make } of MACHINES) {
    test(`${name}: a default machine is checkpointable and captures a complete envelope`, () => {
        const m = make();
        const support = m.checkpointSupport();
        assert.equal(support.supported, true,
            `default ${name} should be checkpointable, refused: ${support.reasons.join('; ')}`);

        const cp = m.captureCheckpoint();
        assert.equal(cp.schema, MACHINE_CHECKPOINT_SCHEMA, 'the envelope carries the shared schema');
        assert.ok(typeof cp.topology === 'string' && cp.topology.length, 'the envelope carries a topology');
        assert.ok(cp.time && Number.isFinite(cp.time.ticks) && typeof cp.time.domain === 'string',
            'the envelope carries a machine time domain');
        assert.ok(cp.state && typeof cp.state === 'object', 'the envelope carries machine state');
    });

    test(`${name}: capture then restore continues in lockstep with the original`, () => {
        // The property is CONTINUATION, not field equality: capture, run the
        // machine PAST the checkpoint so its state genuinely moves, then restore
        // and require it to continue exactly as a fresh run from the checkpoint.
        const a = make();
        a.advanceToMs(0.2);
        const cp = a.captureCheckpoint();

        const reference = make();
        reference.advanceToMs(0.2);
        const forward = trace(reference, 300);

        trace(a, 150);                                   // move a off the checkpoint
        assert.equal(a.restoreCheckpoint(cp), undefined, 'restore onto the same machine is accepted');
        assert.equal(trace(a, 300), forward,
            `the restored ${name} diverged from a continuation of the checkpoint — the envelope `
            + 'is missing state that execution depends on');
    });

    test(`${name}: restore fails closed on a tampered schema`, () => {
        const m = make();
        const cp = m.captureCheckpoint();
        const result = m.restoreCheckpoint({ ...cp, schema: 0xdead });
        assert.equal(result.code, 'CHECKPOINT_SCHEMA_MISMATCH',
            'a checkpoint with the wrong schema is refused, not loaded');
    });

    // THE AXIS THE OTHER CASES DO NOT REACH. Schema and topology are answered by
    // the shared module, so all three machines were always going to agree there;
    // this suite passed with 13 green while the state BODY — the one thing each
    // machine validated alone — went unchecked. It was not a hypothetical gap:
    // on 2026-09-10 the converged 8086 accepted a truncated memory image and
    // restored the destination's own bytes past the end of it, where m6502
    // refused the same input by name. Every entry below is a VALID envelope
    // carrying ONE malformed field, so a machine that fails for some unrelated
    // reason cannot look like a pass.
    test(`${name}: restore fails closed on a malformed memory image`, () => {
        const source = make();
        const cp = source.captureCheckpoint();
        const bytes = cp.state.mem.length;
        const cases = [
            ['one byte short', new Uint8Array(bytes - 1)],
            ['one byte long', new Uint8Array(bytes + 1)],
            ['a bare Array', new Array(7).fill(0x11)],
            ['a string', 'not a memory image'],
            ['absent', undefined],
        ];
        for (const [label, mem] of cases) {
            const target = make();
            target.mem.fill(0x5a);
            const witness = target.mem[bytes - 1];
            const refusal = target.restoreCheckpoint({ ...cp, state: { ...cp.state, mem } });
            assert.ok(refusal && refusal.code === 'INVALID_CHECKPOINT',
                `${name} accepted a memory image that was ${label}: ${JSON.stringify(refusal)}`);
            assert.match(refusal.details.reason, /memory image/,
                `${name} refused ${label} for the wrong reason: ${refusal.details.reason}`);
            assert.equal(target.mem[bytes - 1], witness,
                `${name} mutated memory while refusing a checkpoint that was ${label}`);
        }
    });

    test(`${name}: restore fails closed on a foreign topology`, () => {
        const m = make();
        const cp = m.captureCheckpoint();
        const result = m.restoreCheckpoint({ ...cp, topology: cp.topology + '/tampered' });
        assert.equal(result.code, 'CHECKPOINT_TOPOLOGY_MISMATCH',
            'a checkpoint from a different machine topology is refused');
    });
}

test('an incompletely-serialisable machine refuses to capture rather than drop state', () => {
    // The completeness policy lives in the contract, not in saveState: a chip
    // with no paired state codec makes checkpointSupport unsupported, so
    // captureCheckpoint returns a refusal instead of a checkpoint that would
    // silently omit that chip and restore to a divergent machine.
    const m = new M6502Machine();
    m.chips.__opaque = { tick() {} };                    // neither getState nor saveState
    const support = m.checkpointSupport();
    assert.equal(support.supported, false, 'a chip without a state codec makes the machine unsupported');
    const cp = m.captureCheckpoint();
    assert.equal(cp.code, 'INCOMPLETE_CHECKPOINT_STATE', 'capture refuses rather than dropping the chip');
    assert.ok(cp.refused.includes('__opaque'), 'the refusal names the offending chip');
});
