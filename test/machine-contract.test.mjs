/**
 * The retro machine contract — one suite over three CPUs, because three
 * near-identical implementations are not a coincidence any more.
 *
 * `m6502-machine.js`, `z80-machine.js` and `i8086-machine.js` are about 1,800
 * lines with visibly the same shape: a `{clockHz, regions, chips}` config
 * realised, `tMs` derived from cycles, a wake horizon so a halted CPU still
 * lets time pass, `_advanceChips` after each instruction, and a `saveState`
 * that walks the chip map. Each was written by looking at the last one. That
 * is a reasonable way to build them and a bad way to maintain them: a fix to
 * one machine's save/restore or time-keeping has no mechanism at all for
 * reaching the other two, and nothing would go red if it did not.
 *
 * THIS IS A TEST, NOT A REFACTOR, and deliberately so. Collapsing the three
 * into a base class would touch working, separately-verified code across the
 * whole retro tier to buy tidiness. What is actually needed is the thing a
 * base class would have given for free and a shared test gives directly: a
 * property asserted of all three at once, so the next divergence announces
 * itself instead of being discovered by a user.
 *
 * WHAT IS ASSERTED HERE IS ONLY WHAT IS GENUINELY COMMON. The three differ in
 * real ways that this file must not pretend away — a 16-bit address space
 * against a 20-bit one, a second decode space for I/O ports that only the
 * 8086 has, `mem` as a flat array on the Z80 against region routing on the
 * other two. Those belong in each machine's own suite. The divergences that
 * are NOT deliberate are recorded at the bottom as an explicit table, so a
 * missing `reset()` is a known gap with a name rather than an absence nobody
 * noticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';
import { M6502Machine } from '../src/m6502-machine.js';
import { I8086Machine } from '../src/i8086-machine.js';

/**
 * CHIPS THAT CANNOT BE SNAPSHOTTED, AND THE DEFECT THIS RECORDS.
 *
 * READ THE MACHINE DEFECT FIRST, because it is the one that GENERATES the
 * others: for most of this tier's life the three machines disagreed about how
 * to find a chip's state. I8086Machine accepted getState/setState OR
 * saveState/loadState; M6502Machine and Z80Machine accepted only the latter.
 * So every chip using the newer convention -- I8255, I8254, I8259, NS16C550,
 * the display cards -- was invisible to two machines out of three, silently,
 * because the discovery loop has no `else`. One chip missing a method is a
 * gap. Three machines disagreeing about the convention is the thing that
 * manufactures gaps, and it was found by the assertion below rather than by
 * reading any of the three files.
 *
 * `saveState()` on all three machines walks the chip map and takes
 * `getState()` or `saveState()` from each — and SKIPS, without comment, any
 * chip that has neither.
 *
 * THE LIST IS EMPTY, and both rows were closed by this test rather than by
 * anyone remembering to come back, which is the whole argument for an
 * exemption that can fail:
 *
 *   NS16C550  listed 2026-09-03; the support-chip lane gave it
 *             getState/setState the same evening; the merge turned this file
 *             RED, by name, unprompted; the row was deleted.
 *   W65C51    listed the same day and deliberately LEFT listed, because the
 *             6502 tier has no owner in this fleet and a mechanical fix by
 *             someone who does not own the file is how a boundary erodes.
 *             Closed 2026-09-04 on the owner's explicit instruction to close
 *             all gaps — the boundary was crossed deliberately, not forgotten.
 *
 * That second name is one this test corrected. The list was first written
 * from a guess -- MC6850, the ACIA the Z80 tier uses -- and the run named
 * W65C51 instead. Both are "the serial chip"; only one is on that machine.
 *
 * Closing W65C51 is what exposed the machine defect described at the top:
 * giving the chip its methods was not enough, because the machine still
 * dropped it. Both machines now accept both conventions, and the assertion
 * below pins that behaviourally.
 *
 * The set stays, empty, rather than being deleted with the last row: an empty
 * exemption list is a working mechanism with nothing to excuse, and the next
 * chip without persistence should meet a guard rather than a blank page.
 *
 * The chips are owned by the support-chip lane; this file reports, it does
 * not fix.
 */
const NO_PERSISTENCE = new Set([]);

/** Each machine at its default config. No program is loaded: these are
 *  properties of the TIME AND STATE machinery, which must hold whatever the
 *  CPU is executing — and "whatever memory happens to read as" is a fair and
 *  unusually varied instruction stream to hold them over. */
const MACHINES = [
    { name: 'z80', make: () => new Z80Machine() },
    { name: 'm6502', make: () => new M6502Machine() },
    { name: 'i8086', make: () => new I8086Machine() },
];

for (const { name, make } of MACHINES) {
    test(`${name}: step() returns the cycles it charged`, () => {
        const m = make();
        for (let i = 0; i < 200; i++) {
            const before = m.cycles;
            const n = m.step();
            assert.ok(Number.isInteger(n) && n > 0,
                `step() must return a positive integer cycle count, got ${n}`);
            assert.equal(m.cycles - before, n,
                'the machine advanced by a different amount than step() reported');
        }
    });

    test(`${name}: tMs is cycles at the configured clock, and never goes backwards`, () => {
        const m = make();
        let last = m.tMs;
        assert.equal(last, 0, 'a fresh machine is at time zero');
        for (let i = 0; i < 200; i++) {
            m.step();
            assert.ok(m.tMs >= last, `tMs went backwards: ${m.tMs} after ${last}`);
            assert.equal(m.tMs, m.cycles * 1000 / m.clockHz,
                'tMs must be derived from cycles, not accumulated separately — an '
                + 'independently accumulated clock drifts from the one the chips see');
            last = m.tMs;
        }
    });

    test(`${name}: advanceToMs reaches its target and a past target is a no-op`, () => {
        const m = make();
        m.advanceToMs(1);
        assert.ok(m.tMs >= 1, `advanceToMs(1) left the machine at ${m.tMs}`);

        // Overshoot is bounded by one instruction: a machine that ran to the
        // next whole millisecond, or to a chip deadline past the target, would
        // make every timed measurement in the tier arrive late.
        const overshootCycles = m.cycles - (m.clockHz / 1000);
        assert.ok(overshootCycles < 200,
            `overshot the target by ${overshootCycles} cycles — more than any one instruction`);

        const at = m.cycles;
        m.advanceToMs(0.5);
        assert.equal(m.cycles, at, 'a target already passed must not run the CPU backwards or on');
    });

    test(`${name}: a restored snapshot runs in lockstep with the original`, () => {
        // The property that matters is not "the fields came back" — it is that
        // the machine CONTINUES the same way. A snapshot missing one chip's
        // internal counter restores a state that looks right in a debugger and
        // diverges on the next tick, which is the failure this catches and a
        // field-by-field comparison does not.
        const a = make();
        a.advanceToMs(0.2);
        const snap = JSON.parse(JSON.stringify(a.saveState()));

        const b = make();
        b.loadState(snap);
        assert.equal(b.cycles, a.cycles, 'restore did not carry the cycle count');

        const trace = (m) => {
            const out = [];
            for (let i = 0; i < 300; i++) out.push(`${m.step()}@${m.cycles}`);
            return out.join(',');
        };
        assert.equal(trace(b), trace(a),
            'the restored machine diverged from the original — saveState is missing state '
            + 'that execution depends on');
    });

    test(`${name}: every chip on the machine is in the snapshot`, () => {
        // THE LOCKSTEP TEST ABOVE CANNOT SEE THIS, and finding that out is why
        // this one exists. Deleting BOTH snapshot branches from a machine's
        // saveState left the lockstep assertion green: the CPU is executing
        // whatever memory reads as, it never touches a port, so no chip state
        // ever reaches the trace. A property nothing drives is a property
        // nothing tests, so chip coverage is asserted STRUCTURALLY instead —
        // every chip either round-trips or is named below as one that cannot.
        const m = make();
        const snap = m.saveState();
        for (const [chip, c] of Object.entries(m.chips || {})) {
            const snapshottable = typeof c.getState === 'function'
                || typeof c.saveState === 'function';
            if (!snapshottable) {
                assert.ok(NO_PERSISTENCE.has(c.constructor.name),
                    `${name}: chip "${chip}" (${c.constructor.name}) has neither getState() nor `
                    + 'saveState(), so the machine snapshot drops it silently. Either give it '
                    + 'one or add it to NO_PERSISTENCE with a reason.');
                continue;
            }
            assert.ok(chip in snap.chips,
                `${name}: chip "${chip}" can be snapshotted but is absent from saveState() — `
                + 'the machine walked past it');
        }
    });

    test(`${name}: a wake horizon exists, is positive, and is bounded`, () => {
        // A halted CPU must still let time pass, or a UI that calls advanceToMs
        // hangs. Both halves matter: a horizon of zero spins forever, and an
        // unbounded one skips past every chip deadline in between.
        const m = make();
        const h = m._wakeHorizon();
        assert.ok(Number.isFinite(h) && h >= 1,
            `_wakeHorizon() returned ${h} — a halted machine would spin`);
        assert.ok(h <= Math.round(m.clockHz / 1000),
            `_wakeHorizon() returned ${h}, past one millisecond of cycles — a device deadline `
            + 'inside that window would be stepped over');
    });
}

test('no chip in the exemption list has quietly gained persistence', () => {
    // THE CLAIM THIS EXISTS TO MAKE TRUE. When the coverage test above was
    // written I said, in its commit message and to the lane that owns these
    // chips, that giving an exempted chip a getState() would turn this suite
    // RED so the row had to be deleted. That was FALSE. The assertion above
    // only fires for a chip with NO snapshot method; a chip that gained one
    // sails past it into the normal path and passes, leaving a stale
    // exemption in the list forever — the exact "excuse that has stopped
    // being true" this repo has a rule about, written by the person writing
    // the rule.
    //
    // So the list is checked in the other direction too. Two other instruments
    // in this tier already do this and print HEALED; this one goes RED,
    // because a test cannot print a note nobody reads.
    const seen = new Map();
    for (const { make } of MACHINES) {
        for (const c of Object.values(make().chips || {})) {
            seen.set(c.constructor.name,
                typeof c.getState === 'function' || typeof c.saveState === 'function');
        }
    }
    for (const name of NO_PERSISTENCE) {
        assert.ok(seen.has(name),
            `NO_PERSISTENCE names "${name}", which no machine's default config builds any `
            + 'more. An exemption for a chip nobody instantiates protects nothing — delete '
            + 'the row, or point a config at it.');
        assert.equal(seen.get(name), false,
            `HEALED — "${name}" now has a snapshot method, so its NO_PERSISTENCE row has `
            + 'stopped being true. Delete it. This failure is the row doing its job.');
    }
});

test('all three machines discover chip state the same way', () => {
    // THE DIVERGENCE THAT HID THE 6551, asserted so it cannot come back. Two
    // conventions exist in this tree -- getState/setState and
    // saveState/loadState -- and a machine that honours only one drops every
    // chip using the other, silently, because the discovery loop has no
    // `else`. That is not a style difference; it is a snapshot that looks
    // complete and is not.
    //
    // Asserted BEHAVIOURALLY rather than by reading the source, because the
    // property is "does the machine pick this chip up", not "does the file
    // contain a getState branch".
    for (const { name, make } of MACHINES) {
        const m = make();
        const probe = { getState: () => ({ marker: `${name}-getState` }), setState() {} };
        const legacy = { saveState: () => ({ marker: `${name}-saveState` }), loadState() {} };
        m.chips.__probeNew = probe;
        m.chips.__probeOld = legacy;
        const snap = m.saveState();
        assert.equal(snap.chips.__probeNew?.marker, `${name}-getState`,
            `${name} does not honour getState() — every chip using that convention is `
            + 'dropped from its snapshots without comment');
        assert.equal(snap.chips.__probeOld?.marker, `${name}-saveState`,
            `${name} does not honour saveState() — every chip using that convention is dropped`);
    }
});

test('the 6551 ACIA survives a machine snapshot with its queue intact', () => {
    // The end-to-end version of the row that was just deleted: not "the chip
    // has a method" but "the machine carries its state across a round trip".
    const m = new M6502Machine();
    const acia = m.chips.acia1;
    acia.rxByte?.(0x41) ?? acia.rx.push(0x41, 0x42);
    acia.overrun = true;
    acia.cmd = 0x0b;

    const snap = JSON.parse(JSON.stringify(m.saveState()));
    assert.ok(snap.chips.acia1, 'the ACIA reached the snapshot at all');

    const restored = new M6502Machine();
    restored.loadState(snap);
    const back = restored.chips.acia1;
    assert.deepEqual(back.rx, acia.rx, 'the receive queue came back');
    assert.equal(back.overrun, acia.overrun, 'and the overrun flag');
    assert.equal(back.cmd, acia.cmd, 'and the command register');

    // The queue must be a COPY, and this is asserted AT THE CHIP rather than
    // through the machine snapshot, because the machine path serialises via
    // JSON and JSON copies everything — an assertion about sharing placed
    // after a round trip through JSON.stringify cannot fail no matter how the
    // chip behaves. Mutation proved that: replacing `this.rx.slice()` with
    // `this.rx` left the machine-level version green.
    const direct = acia.getState();
    assert.notEqual(direct.rx, acia.rx,
        'getState() handed back the live queue rather than a copy — a caller that does not '
        + 'serialise would share the array with the running chip');
    direct.rx.push(0x99);
    assert.equal(acia.rx.length, 2, 'and mutating the snapshot did not reach the chip');
});

test('the three machines expose the same core surface', () => {
    // Named rather than assumed. When a fourth CPU joins the tier this is the
    // list it has to satisfy, and it is short on purpose.
    const REQUIRED = ['step', 'advanceToMs', 'saveState', 'loadState', 'attachDevice',
        '_wakeHorizon', '_advanceChips'];
    for (const { name, make } of MACHINES) {
        const m = make();
        for (const k of REQUIRED) {
            assert.equal(typeof m[k], 'function', `${name} is missing ${k}()`);
        }
        for (const k of ['cycles', 'clockHz', 'tMs']) {
            assert.equal(typeof m[k], 'number', `${name} is missing ${k}`);
        }
        assert.ok(m.cpu, `${name} does not expose its cpu`);
    }
});

test('the surface divergences are the known ones, and no more', () => {
    // AN INVENTORY, NOT AN ASPIRATION. These three methods exist on some
    // machines and not others, and this test's job is to make that a decision
    // with a name rather than an absence nobody noticed. If a machine GAINS
    // one, this goes red and the row should move up into REQUIRED above; if
    // one is added to a machine not listed here, that is a divergence being
    // introduced and it should be argued for, not merged quietly.
    const KNOWN_GAPS = {
        // The Z80 machine has no reset(): its config boots from 0000h and the
        // Searle monitor is re-entered by reloading, so nothing has needed one.
        reset: ['m6502', 'i8086'],
        // runMs is i8086-only sugar over advanceToMs. Harmless, and it means
        // code written against one machine does not port to the others.
        runMs: ['i8086'],
        // Only the machines with region routing read and write through a
        // decoder; the Z80 exposes a flat `mem` instead.
        _read: ['m6502', 'i8086'],
    };
    for (const [method, expected] of Object.entries(KNOWN_GAPS)) {
        const actual = MACHINES.filter(({ make }) => typeof make()[method] === 'function')
            .map(({ name }) => name);
        assert.deepEqual(actual, expected,
            `${method}() is now on [${actual}], the inventory says [${expected}] — `
            + 'either a divergence closed (move it into the required surface) or a new '
            + 'one opened (say why here)');
    }
});
