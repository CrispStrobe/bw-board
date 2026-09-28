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
        assert.equal(typeof target.setBreakpoint({ kind: 'code', addr: CODE_ADDRESS_MAX }), 'number',
            ARCHITECTURAL_WIDTH_ONLY);
    });

    it('still refuses the Thumb-state bit', () => {
        const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0) });
        assert.deepEqual(target.setBreakpoint({ kind: 'code', addr: 1 }), {
            unsupported: 'Thumb code address 1 is odd. Bit 0 is the execution-state flag, ' +
                'not part of the address — a breakpoint set on it could never match.',
        });
    });

    it('a malformed or unknown handle cannot remove the breakpoint at address zero', () => {
        const target = createLabwiredDebugTarget({ adapter: stubAdapterAt(0) });
        const handle = target.setBreakpoint({ kind: 'code', addr: 0 });
        assert.equal(typeof handle, 'number');
        target.clearBreakpoint(Number.NaN);
        target.clearBreakpoint(0);
        target.run();
        assert.equal(target.runFor(1_000n), 'halted',
            'malformed and unknown handles must not clear a legitimate breakpoint');

        // The first opaque handle is odd. That is valid: Thumb alignment
        // constrains addresses, not identities. Clear the returned identity
        // exactly, then prove the address is no longer watched.
        assert.equal(handle & 1, 1);
        assert.equal(target.clearBreakpoint(handle), undefined);
        target.run();
        assert.equal(target.runFor(1_000n), 'running');
    });
});

/** A sim that names registers like one labwired core and answers index*3+1. */
const namedSim = names => ({
    get_pc: () => 0x100,
    get_register_names: () => names,
    get_register: i => {
        if (i >= names.length) throw new Error(`register ${i} out of range`);
        return i * 3 + 1;
    },
});

describe('labwired regs() is the core\'s own register list', () => {
    const cores = {
        'cortex-m': [...Array.from({length: 13}, (_, i) => `R${i}`), 'SP', 'LR', 'PC'],
        avr: [...Array.from({length: 32}, (_, i) => `R${i}`), 'SP', 'SREG', 'PC'],
        riscv: [...Array.from({length: 32}, (_, i) => `x${i}`), 'pc'],
        xtensa: Array.from({length: 16}, (_, i) => `a${i}`),
    };
    for (const [core, names] of Object.entries(cores)) {
        it(`${core}: every named register, under its own name, with its own value`, () => {
            const target = createLabwiredDebugTarget({adapter: {...stubAdapter(), sim: namedSim(names)}});
            const regs = target.regs();
            assert.equal(regs.pc, 0x100, 'pc is get_pc, not the PC slot');
            assert.equal('r' in regs, false, 'no `r` array: inspect() would read it as an 8051');
            names.forEach((name, i) => {
                const key = name.toLowerCase();
                if (key === 'pc') return;
                assert.equal(regs[key], i * 3 + 1, `${key} is register ${i}`);
            });
            const shown = Object.keys(regs).filter(k => k !== 'pc' && k !== 'cycles');
            assert.equal(shown.length, names.filter(n => n.toLowerCase() !== 'pc').length);
        });
    }
    it('avr: R13/R14 keep their names and SP/SREG are present (the old ARM labelling lost them)', () => {
        const target = createLabwiredDebugTarget({adapter: {...stubAdapter(), sim: namedSim(cores.avr)}});
        const regs = target.regs();
        assert.equal(regs.r13, 13 * 3 + 1);
        assert.equal(regs.r14, 14 * 3 + 1);
        assert.equal(regs.r31, 31 * 3 + 1);
        assert.equal(regs.sp, 32 * 3 + 1);
        assert.equal(regs.sreg, 33 * 3 + 1);
        assert.equal('lr' in regs, false);
    });
});
