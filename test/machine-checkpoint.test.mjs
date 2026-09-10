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
    // THE REMAINING SHARED CLAUSES, each fired on its own. Measured on the
    // converged tree before these existed: neutering the version, CPU-field or
    // component-set check changed NOTHING across seven machine and state suites.
    // A clause no test holds is a clause that can be deleted in a refactor
    // without anything going red, which is how the memory check was lost in the
    // first place. Every entry is a VALID envelope carrying ONE malformed field.
    test(`${name}: restore fails closed on each malformed state field`, () => {
        const source = make();
        const cp = source.captureCheckpoint();
        const cpuKey = Object.keys(cp.state.cpu)[0];
        const chipKey = Object.keys(cp.state.chips)[0];
        assert.ok(cpuKey && chipKey, `${name} needs at least one CPU field and one chip to vary`);

        const cases = [
            ['an unsupported state version', s => ({ ...s, v: s.v + 1 }), /version/],
            ['a missing CPU field', s => {
                const cpu = { ...s.cpu }; delete cpu[cpuKey];
                return { ...s, cpu };
            }, /CPU fields missing/],
            ['a CPU record that is not an object', s => ({ ...s, cpu: null }), /CPU record/],
            ['an extra chip in the snapshot', s => ({ ...s, chips: { ...s.chips, ghost: {} } }), /chip set/],
            ['a missing chip in the snapshot', s => {
                const chips = { ...s.chips }; delete chips[chipKey];
                return { ...s, chips };
            }, /chip set/],
            ['an extra device in the snapshot', s => ({ ...s, devices: { ...s.devices, ghost: {} } }), /device set/],
        ];
        for (const [label, mangle, reason] of cases) {
            const target = make();
            const before = target.cycles;
            const refusal = target.restoreCheckpoint({ ...cp, state: mangle(cp.state) });
            assert.ok(refusal && refusal.code === 'INVALID_CHECKPOINT',
                `${name} accepted a checkpoint with ${label}: ${JSON.stringify(refusal)}`);
            assert.match(refusal.details.reason, reason,
                `${name} refused ${label} for the wrong reason: ${refusal.details.reason}`);
            assert.equal(target.cycles, before,
                `${name} advanced its clock while refusing a checkpoint with ${label}`);
        }
    });

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

// THE SHAPE CHECK IS NOT UNIVERSAL, and that is a decision rather than a gap.
// m6502 and i8086 pass a freshly-captured saveState() as `shape`, so a restored
// value whose TYPE differs from what this machine captures is refused before any
// component is touched. z80 does not, because its chip state legitimately changes
// shape between captures — the tape's block list and the ULA's edge arrays grow —
// so a shape check against a fresh sample would refuse valid checkpoints. z80
// checks the same ground precisely, per chip, in its own clauses. This test names
// both halves so that neither can be quietly dropped: it asserts the two machines
// that opt in DO refuse, and that z80's abstention is deliberate.
for (const { name, make, shapeChecked } of [
    { name: 'm6502', make: () => new M6502Machine(), shapeChecked: true },
    { name: 'z80', make: () => new Z80Machine(), shapeChecked: false },
    { name: 'i8086', make: () => new I8086Machine(), shapeChecked: true },
]) {
    test(`${name}: a CPU field of the wrong type is ${shapeChecked ? 'refused' : 'left to the machine'}`, () => {
        const source = make();
        const cp = source.captureCheckpoint();
        const cpuKey = Object.keys(cp.state.cpu).find(k => typeof cp.state.cpu[k] === 'number');
        assert.ok(cpuKey, `${name} needs a numeric CPU field to retype`);
        const state = { ...cp.state, cpu: { ...cp.state.cpu, [cpuKey]: 'not a number' } };

        const target = make();
        const refusal = target.restoreCheckpoint({ ...cp, state });
        if (shapeChecked) {
            assert.ok(refusal && refusal.code === 'INVALID_CHECKPOINT',
                `${name} opts into the shape check and must refuse a retyped ${cpuKey}`);
            assert.match(refusal.details.reason, /shape/,
                `${name} refused for the wrong reason: ${refusal.details.reason}`);
        } else {
            assert.equal(refusal, undefined,
                `${name} does not opt into the shape check; if it now refuses, the ` +
                'comment above and the z80 abstention need rewriting rather than this line');
        }
    });
}

// THE TICK COUNT HAS TWO SPELLINGS AND THEY MEAN THE SAME THING. `debugTime()`
// returns a BigInt; a machine counts in Numbers. A checkpoint whose `time` came
// from a debug bridge therefore carries BigInt ticks against a Number
// `state.cycles`, and `!==` between them is false for identical digits. Landed
// 2026-09-10, that refused EVERY debug-target checkpoint restore on m6502 and
// z80 — nine cases red in lite, all of them printing two numbers that looked
// the same. So both machines accept either spelling of the SAME number, and
// this holds that they still refuse a different one.
//
// i8086 is excluded and says why: it validates no time at all, because its
// checkpoint time is written by the debug layer's event clock rather than
// derived from the machine, so the machine cannot judge it.
for (const { name, make, validatesTime } of [
    { name: 'm6502', make: () => new M6502Machine(), validatesTime: true },
    { name: 'z80', make: () => new Z80Machine(), validatesTime: true },
    { name: 'i8086', make: () => new I8086Machine(), validatesTime: false },
]) {
    test(`${name}: a BigInt tick count is ${validatesTime ? 'the same time, and a wrong one still refuses' : 'not judged here at all'}`, () => {
        const source = make();
        source.step();
        source.step();
        const cp = source.captureCheckpoint();
        assert.equal(typeof cp.time.ticks, 'number', 'a machine stamps its own capture in Numbers');

        const asBigInt = { ...cp, time: { ...cp.time, ticks: BigInt(cp.time.ticks) } };
        assert.equal(make().restoreCheckpoint(asBigInt), undefined,
            `${name} refused a checkpoint whose ticks are the same number spelled as a BigInt`);

        if (!validatesTime) return;
        for (const [label, ticks] of [
            ['a BigInt one tick off', BigInt(cp.time.ticks) + 1n],
            ['a Number one tick off', cp.time.ticks + 1],
            ['a string', 'nope'],
            ['a fraction', cp.time.ticks + 0.5],
        ]) {
            const refusal = make().restoreCheckpoint({ ...cp, time: { ...cp.time, ticks } });
            assert.equal(refusal?.code, 'INVALID_CHECKPOINT_TIME',
                `${name} accepted ${label} as the captured time`);
        }
    });
}
