/**
 * The factory must hand the debug target a REAL ADAPTER.
 *
 * `createI8086DebugTarget(adapter, opts)` reads `.machine`, `.sendSerial` and
 * `.unloggedBoardInputs()`. The factory used to pass `{machine: adapter.machine}`,
 * which carries the first and drops the other two -- so two guarantees this repo
 * declares were inert in every production build:
 *
 *   - `replayRefusalReasons()` returned [] unconditionally, and its own comment
 *     says it exists to convert a silent wrong answer into a stated refusal.
 *   - the serial wrapper was installed on the throwaway literal, so a byte sent
 *     through `adapter.sendSerial` reached the machine and logged nothing.
 *
 * Both had tests. Both tests passed. They construct the adapter themselves,
 * which is the object the factory did not build -- a gate exercised only by
 * someone who shares the author's picture of how the thing is made.
 *
 * So these drive `createDebugTarget()`, the entry point production uses.
 *
 * AND THEY ITERATE THE KINDS RATHER THAN NAMING ONE. The i8086 call site was
 * fixed and this file was written for it, which left the same defect live on
 * another kind in the same function for weeks: a rule about one call site was
 * never a rule about the method, and a by-name gate is how the second one hid.
 *
 * THE POPULATION IS DERIVED, NOT LISTED FROM MEMORY: the targets that wrap
 * `adapter.sendSerial` are exactly i8086-debug, m6502-debug and z80-debug --
 * `rootDebugSendSerial` is the marker they leave -- and the factory kinds that
 * build them are `i8086`, `eater6502` and `z80`. If a fourth target starts
 * wrapping, add it here; the wrapper marker is the thing to grep for.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDebugTarget} from '../src/debug-target-factory.js';

const rom = () => {
    const img = new Uint8Array(0x8000);
    img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // reset vector -> 0xf800:0000
    return img;
};

/** A 6502 blink image with a reset vector into $8000. */
const m6502Rom = () => {
    const img = new Uint8Array(0x8000);
    img[0x7ffc] = 0x00;
    img[0x7ffd] = 0x80;
    return img;
};

/** A Z80 image with an IN/OUT stub at the interrupt vector. */
const z80Rom = () => {
    const img = new Uint8Array(0x2000);
    img.set([0xdb, 0x81, 0xd3, 0x81, 0xfb, 0xed, 0x4d], 0x38);
    return img;
};

/** A board that SAMPLES: readPin is the property the refusal is about. */
const samplingBoard = () => ({advanceTo() {}, setPin() {}, readPin() { return 1; }});

const build = async () => {
    const made = await createDebugTarget('i8086', {rom: rom(), board: samplingBoard()});
    // ANTI-VACUITY. createI8086Target swallows a throw into `adapter-only mode`,
    // so a broken factory returns {target: null} and every assertion below would
    // be skipped by an optional chain rather than failing.
    assert.ok(made.target, 'the factory produced no debug target at all');
    assert.ok(made.adapter, 'the factory produced no adapter');
    return made;
};

/**
 * One kind-independent invariant, driven for every serial-wrapping kind: the
 * object the target wrapped must BE the adapter the factory handed back.
 *
 * `rootDebugSendSerial` is set on the wrapper the target installs over
 * `adapter.sendSerial`. Passing `{machine: adapter.machine}` wraps a throwaway
 * literal instead, so the returned adapter's method is left unwrapped -- which
 * is observable here without knowing anything about the kind's producers,
 * refusal strings or board shape.
 */
const SERIAL_WRAPPING_KINDS = [
    {kind: 'i8086', opts: () => ({rom: rom(), board: samplingBoard()})},
    {kind: 'eater6502', opts: () => ({rom: m6502Rom(), board: samplingBoard()})},
    {kind: 'z80', opts: () => ({rom: z80Rom()})}
];

for (const {kind, opts} of SERIAL_WRAPPING_KINDS) {
    test(`the factory hands the ${kind} target the adapter it returns, not a copy`, async () => {
        const made = await createDebugTarget(kind, opts());
        // ANTI-VACUITY: every helper swallows a throw into adapter-only mode, so
        // a broken fixture returns {target: null} and an optional chain below
        // would skip the assertion instead of failing.
        assert.ok(made.target, `${kind}: the factory produced no debug target at all`);
        assert.ok(made.adapter, `${kind}: the factory produced no adapter`);
        assert.equal(typeof made.adapter.sendSerial, 'function',
            `${kind}: fixture -- the adapter must have sendSerial, or this proves nothing`);

        assert.ok(Object.hasOwn(made.adapter.sendSerial, 'rootDebugSendSerial'),
            `${kind}: the target wrapped a DIFFERENT object than the adapter the factory `
            + 'returned, so everything it reads off the adapter is inert -- serial is not '
            + 'recorded and adapter-derived refusals never fire. Pass the adapter, not '
            + '{machine: adapter.machine}.');
    });
}

test('the factory wires the adapter: a sampling board reaches replayRefusalReasons', async () => {
    const {target, adapter} = await build();
    assert.equal(adapter.unloggedBoardInputs?.(), true,
        'fixture: the adapter must itself report unlogged sampling, or this proves nothing');
    assert.deepEqual(target.replayRefusalReasons(), ['live board input sampling is not logged'],
        'the target cannot see the adapter, so a topology it must refuse replays silently');
});

test('the factory wires the adapter: serial sent THROUGH it is recorded', async () => {
    const {target, adapter} = await build();
    const facts = [];
    target.onDebugInput(f => facts.push(f.producer));
    assert.equal(adapter.sendSerial(0x41), true, 'fixture: the adapter accepted the byte');
    assert.deepEqual(facts, ['i8086.serial'],
        'the byte reached the machine and nothing logged it -- the wrapper went onto a '
        + 'throwaway object instead of the adapter the caller keeps');
});
