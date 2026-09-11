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
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDebugTarget} from '../src/debug-target-factory.js';

const rom = () => {
    const img = new Uint8Array(0x8000);
    img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // reset vector -> 0xf800:0000
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
