/**
 * The DebugTarget SURFACE, checked against what the consumer actually calls.
 *
 * Every behavioural test for this target passed while the GUI crashed the
 * instant it started running: the runner calls `target.timeNs()` unguarded on
 * every pump, and the target never exposed it. The method existed one layer
 * down on the adapter, so the failure named a symbol that does exist — which
 * reads as an engine fault, not a missing delegation.
 *
 * Behaviour tests cannot catch that; they drive the target directly and never
 * touch the methods only the runner calls. This asserts the shape instead, and
 * does it WITHOUT the wasm engine, so it runs everywhere the other labwired
 * tests skip.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLabwiredDebugTarget } from '../src/labwired-debug.js';

/** Methods bw-debug's debug-runner/debug-session/trace call with no typeof
 *  guard. Adding one to the runner means adding it here. */
const REQUIRED = [
    'capabilities', 'state', 'run', 'halt', 'step',
    'setBreakpoint', 'clearBreakpoint', 'readMem', 'writeMem', 'regs',
    'onHalt', 'reset', 'runFor', 'timeNs', 'bwMs', 'detach', 'destroy',
];

/** Enough of the boundary-A adapter to build a target; no engine needed. */
/** A stub whose PC and disassembly are distinguishable sentinels. */
const stubAdapterAt = pc => ({
    sim: {
        get_pc: () => pc,
        get_disassembly: () => 'Branch { offset: -4 }',
        step: () => {},
        step_single: () => {},
        step_batch: () => {},
    },
    clockHz: 48_000_000,
    timeNs: () => 12_345n,
    attachBoard() {}, syncInputs() {}, advanceNs() {}, resetToProgram() {},
    onSerial() {}, feedSerial() {}, pump() {},
    stats: () => ({}), readMem: () => new Uint8Array(0), regs: () => ({pc}),
});

const stubAdapter = () => ({
    // The target requires `sim` to exist and reads clockHz off the adapter.
    sim: { get_pc: () => 0x0800_0100, step: () => {}, },
    clockHz: 48_000_000,
    timeNs: () => 12_345n,
    attachBoard() {},
    syncInputs() {},
    advanceNs() {},
    resetToProgram() {},
    onSerial() {},
    feedSerial() {},
    pump() {},
    stats: () => ({}),
    readMem: () => new Uint8Array(0),
    regs: () => ({ pc: 0 }),
});

describe('labwired DebugTarget surface', () => {
    it('exposes every method the runner calls unguarded', () => {
        const target = createLabwiredDebugTarget({ adapter: stubAdapter() });
        const missing = REQUIRED.filter(m => typeof target[m] !== 'function');
        assert.deepEqual(missing, [], `missing from the labwired target: ${missing.join(', ')}`);
    });

    it('timeNs delegates to the adapter rather than inventing a clock', () => {
        // The bug was not a wrong time, it was no method at all — so assert the
        // value comes THROUGH, which a stub returning a sentinel proves.
        const target = createLabwiredDebugTarget({ adapter: stubAdapter() });
        assert.equal(target.timeNs(), 12_345n);
    });
});

describe('labwired disassembly', () => {
    it('answers for the current PC', () => {
        const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0x0800_0008) });
        assert.equal(target.disasm(0x0800_0008), 'Branch { offset: -4 }');
    });

    it('tolerates the Thumb bit on either side', () => {
        // A PC read off a vector or an LR carries bit 0 set; the address the
        // trace asks about does not. Comparing them raw would silently answer
        // '' for every instruction on a Cortex-M, which is every instruction.
        const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0x0800_0009) });
        assert.equal(target.disasm(0x0800_0008), 'Branch { offset: -4 }');
    });

    it('refuses any OTHER address instead of guessing', () => {
        // get_disassembly() takes no address — it decodes wherever the core is
        // standing. Returning that for a different address would be a wrong
        // instruction presented as a right one.
        const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0x0800_0008) });
        assert.equal(target.disasm(0x0800_0100), '');
    });

    it('is listed as a method the runner may call', () => {
        const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0x0800_0008) });
        assert.equal(typeof target.disasm, 'function');
    });
});

const CODE_ADDRESS_MAX = 0xfffffffe;
const CODE_ADDRESS_REFUSAL = {
    unsupported: 'code breakpoint addr must be in 0x00000000..0xfffffffe',
};
const ARCHITECTURAL_WIDTH_ONLY =
    'this bounds the 32-bit Thumb PC width; mapped execution is deliberately not constrained';

describe('labwired code breakpoint only', () => {
    for (const [name, addr] of [
        ['negative address', -2],
        ['fractional address', 2.5],
        ['NaN address', Number.NaN],
        ['infinite address', Number.POSITIVE_INFINITY],
        ['address wider than the 32-bit PC', 0x100000000],
    ]) {
        it(`refuses ${name}`, () => {
            const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0) });
            assert.deepEqual(target.setBreakpoint({ kind: 'code', addr }), CODE_ADDRESS_REFUSAL,
                ARCHITECTURAL_WIDTH_ONLY);
        });
    }

    it('accepts the highest even 32-bit address', () => {
        const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0) });
        assert.equal(target.setBreakpoint({ kind: 'code', addr: CODE_ADDRESS_MAX }), undefined,
            ARCHITECTURAL_WIDTH_ONLY);
    });

    it('still refuses the Thumb-state bit', () => {
        const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0) });
        assert.deepEqual(target.setBreakpoint({ kind: 'code', addr: 1 }), {
            unsupported: 'Thumb code address 1 is odd. Bit 0 is the execution-state flag, ' +
                'not part of the address — a breakpoint set on it could never match.',
        });
    });

    it('a malformed clear cannot alias and remove the breakpoint at address zero', () => {
        const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0) });
        assert.equal(target.setBreakpoint({ kind: 'code', addr: 0 }), undefined);
        target.clearBreakpoint({ kind: 'code', addr: Number.NaN });
        target.run();
        assert.equal(target.runFor(1_000n), 'halted',
            'NaN must not coerce to zero and clear a legitimate breakpoint');
    });
});
