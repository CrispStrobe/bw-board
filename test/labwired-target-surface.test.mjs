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

describe('labwired fault halt and diagnostics', () => {
    /** A sim that faults once `faultAfter` batches have run. */
    const faultingSim = (faultAfter) => {
        let batches = 0;
        return {
            get_pc: () => 0x0800_0200,
            step_batch: () => { batches++; },
            step_single: () => {},
            fault_verdict: () => batches >= faultAfter
                ? JSON.stringify({ summary: 'HardFault: UsageFault (UNDEFINSTR) at 0x08000200', pc: 0x0800_0200 })
                : undefined,
            fidelity_gaps: () => [{ kind: 'undecoded', addr: 0x0800_0300 }],
        };
    };
    const build = sim => createLabwiredDebugTarget({ adapter: { ...stubAdapter(), sim } });

    it('halts with reason `fault` and the engine\'s one-sentence summary, once', () => {
        const t = build(faultingSim(2));
        const halts = [];
        t.onHalt(h => halts.push(h));
        t.run();
        assert.equal(t.runFor(1_000_000), 'running', 'no fault yet');
        assert.equal(t.runFor(1_000_000), 'halted');
        assert.equal(halts.length, 1);
        assert.equal(halts[0].reason, 'fault');
        assert.match(halts[0].summary, /UsageFault/);
        t.run();
        assert.equal(t.runFor(1_000_000), 'running', 'Continue past a fault it already reported');
    });
    it('reset re-arms the fault halt', () => {
        const t = build(faultingSim(1));
        t.run(); assert.equal(t.runFor(1_000_000), 'halted');
        t.reset(); t.run();
        assert.equal(t.runFor(1_000_000), 'halted', 'the same verdict, after a reset, is a new fault');
    });
    it('diagnostics(): fault verdict and fidelity gaps; empty on an engine without them', () => {
        const d = build(faultingSim(0)).diagnostics();
        assert.match(d.fault.summary, /HardFault/);
        assert.deepEqual(d.fidelityGaps, [{ kind: 'undecoded', addr: 0x0800_0300 }]);
        const bare = build({ get_pc: () => 0 }).diagnostics();
        assert.deepEqual(bare, { fault: null, fidelityGaps: [] });
    });
});

describe('labwired halts use the shared halt shape', () => {
    it('a breakpoint halt names its cause and the handle that fired', () => {
        let pc = 0x0800_0100;
        const t = createLabwiredDebugTarget({ adapter: { ...stubAdapter(),
            sim: { get_pc: () => pc, step_single: () => { pc += 2; }, step_batch: () => {} } } });
        const halts = [];
        t.onHalt(h => halts.push(h));
        t.setBreakpoint({ kind: 'code', addr: 0x0800_0200 });            // a decoy, never reached
        const handle = t.setBreakpoint({ kind: 'code', addr: 0x0800_0104 });
        t.run();
        assert.equal(t.runFor(1_000_000), 'halted');
        assert.equal(halts[0].cause, 'breakpoint');
        assert.equal(halts[0].bp, handle, 'bw-debug maps this handle back to the UI breakpoint');
        assert.equal(halts[0].bpKind, 'code');
        assert.equal(halts[0].pc, 0x0800_0104);
        assert.equal(halts[0].tNs, 12_345n);
    });
    it('a user halt is `pause`, like every other target', () => {
        const t = createLabwiredDebugTarget({ adapter: stubAdapter() });
        const halts = [];
        t.onHalt(h => halts.push(h));
        t.run(); t.halt();
        assert.equal(halts[0].cause, 'pause');
        assert.equal(halts[0].bp, undefined);
    });
});

describe('labwired save points (engine snapshots)', () => {
    const snapSim = () => {
        const saved = [];
        let cycles = 0;
        return {
            saved,
            get_pc: () => 0x100,
            step_batch: n => { cycles += n; },
            step_single: () => { cycles++; },
            snapshot_unavailable_reason: () => null,
            snapshot_save: label => { const p = { id: saved.length + 1, label, cycles }; saved.push(p); return JSON.stringify(p); },
            snapshot_list: () => JSON.stringify(saved),
            snapshot_restore: id => {
                const p = saved.find(s => s.id === id);
                if (!p) throw new Error(`no save point ${id}`);
                cycles = p.cycles; return JSON.stringify(p);
            },
            now: () => cycles,
        };
    };
    const fwOnly = sim => createLabwiredDebugTarget({ adapter: { ...stubAdapter(), sim, firmwareOnly: true } });

    it('a bench (circuit attached) refuses by name — the circuit cannot be rewound', () => {
        const t = createLabwiredDebugTarget({ adapter: { ...stubAdapter(), sim: snapSim() } });
        assert.match(t.snapshotUnavailable(), /circuit cannot be rewound/);
        assert.match(t.saveSnapshot('x').unsupported, /circuit/);
        assert.deepEqual(t.listSnapshots(), []);
    });
    it('firmware-only: save, list and restore round-trip through the engine', () => {
        const sim = snapSim();
        const t = fwOnly(sim);
        assert.equal(t.snapshotUnavailable(), null);
        t.run(); t.runFor(1000);
        const a = t.saveSnapshot('before');
        t.run(); t.runFor(5000);
        assert.ok(sim.now() > a.cycles);
        assert.deepEqual(t.listSnapshots().map(p => p.label), ['before']);
        assert.equal(t.restoreSnapshot(a.id), undefined);
        assert.equal(sim.now(), a.cycles, 'the engine went back to the save point');
    });
    it('a restore the engine refuses is reported, and restoring mid-run halts first', () => {
        const sim = snapSim();
        const t = fwOnly(sim);
        const halts = [];
        t.onHalt(h => halts.push(h));
        assert.match(t.restoreSnapshot(99).unsupported, /restore refused: no save point 99/);
        const p = t.saveSnapshot();
        t.run();
        t.restoreSnapshot(p.id);
        assert.equal(t.state(), 'halted');
        assert.equal(halts.at(-1).cause, 'pause');
    });
});

describe('labwired opt-in reverse (recording)', () => {
    /** Deterministic engine: PC walks 2 bytes per instruction, snapshots restore it. */
    const detSim = () => {
        let pcNow = 0x100;
        const saved = [];
        return {
            get_pc: () => pcNow,
            step_single: () => { pcNow += 2; },
            step_batch: () => { throw new Error('recording must never batch'); },
            snapshot_unavailable_reason: () => null,
            snapshot_save: () => { saved.push(pcNow); return JSON.stringify({ id: saved.length, cycles: 0 }); },
            snapshot_list: () => JSON.stringify(saved.map((_, i) => ({ id: i + 1 }))),
            snapshot_restore: id => { pcNow = saved[id - 1]; return '{}'; },
        };
    };
    const fwOnly = () => createLabwiredDebugTarget({ adapter: { ...stubAdapter(), sim: detSim(), firmwareOnly: true } });

    it('refused on a bench; capabilities follow the toggle', () => {
        const bench = createLabwiredDebugTarget({ adapter: { ...stubAdapter(), sim: detSim() } });
        assert.match(bench.setRecording(true).unsupported, /circuit/);
        assert.deepEqual(bench.capabilities().recording, []);
        const t = fwOnly();
        assert.deepEqual(t.capabilities().recording, []);
        assert.equal(t.setRecording(true), undefined);
        assert.deepEqual(t.capabilities().recording, ['checkpoint', 'restore']);
        assert.equal(t.capabilities().extensions.eventBreakpointBoundary, 'instruction-retire');
    });

    it('a restored checkpoint replays the exact recorded retire events', () => {
        const t = fwOnly();
        t.setRecording(true);
        const events = [];
        t.onDebugEvent(e => events.push(e));
        const cp = t.captureCheckpoint();
        assert.equal(typeof cp.snapshotId, 'number');
        assert.deepEqual(structuredClone(cp), cp, 'a checkpoint survives structuredClone');
        t.run();
        t.runFor(105);                                  // 5 instructions at 48 MHz (floor), forced slow path
        const live = events.splice(0);
        assert.equal(live.length, 5);
        assert.deepEqual(live.map(e => e.time.ticks), [1, 2, 3, 4, 5]);
        assert.deepEqual(live.map(e => [e.pcBefore, e.pcAfter]), [[0x100, 0x102], [0x102, 0x104], [0x104, 0x106], [0x106, 0x108], [0x108, 0x10a]]);

        assert.equal(t.restoreCheckpoint(cp), undefined);
        assert.match(t.debugTime().domain, /^labwired-instructions-rewind-1$/);
        for (let i = 0; i < 5; i++) assert.equal(t.replayInstruction().accepted, true);
        const strip = e => ({ ...e, time: { ...e.time, domain: e.time.domain.replace(/-rewind-\d+$/, '') } });
        assert.deepEqual(events.map(strip), live, 'replay reproduces every recorded field');
    });

    it('recording off: no events, and replay/checkpoint are refused', () => {
        const t = fwOnly();
        const events = [];
        t.onDebugEvent(e => events.push(e));
        t.step('insn', 2); t.runFor(1e6);
        assert.equal(events.length, 0);
        assert.equal(t.replayInstruction().accepted, false);
        assert.ok(t.captureCheckpoint().refused);
        assert.equal(t.applyReplayInput({}).accepted, false);
    });
});

describe('labwired serial input is recorded and replayed at its instruction', () => {
    it('a typed byte is stamped with the retire count, and replay re-applies it there', () => {
        let pcNow = 0x100;
        const saved = [];
        const fed = [];
        const t = createLabwiredDebugTarget({ adapter: { ...stubAdapter(), firmwareOnly: true, feedSerial: b => fed.push(b),
            sim: { get_pc: () => pcNow, step_single: () => { pcNow += 2; }, step_batch: () => {},
                snapshot_unavailable_reason: () => null,
                snapshot_save: () => { saved.push(pcNow); return JSON.stringify({ id: saved.length }); },
                snapshot_list: () => '[]', snapshot_restore: id => { pcNow = saved[id - 1]; return '{}'; } } } });
        t.setRecording(true);
        const facts = [];
        t.onDebugInput(f => facts.push(f));
        const cp = t.captureCheckpoint();
        t.step('insn', 3); t.runFor(1e6);
        t.feedSerial(0x41);
        assert.deepEqual(facts[0].payload, { byte: 0x41 });
        assert.equal(facts[0].time.ticks, 3, 'stamped on the instruction clock');

        t.restoreCheckpoint(cp);
        const back = t.replayToInputBoundary(facts[0].time);
        assert.equal(back.accepted, true);
        assert.equal(t.debugTime().ticks, 3);
        assert.equal(t.applyReplayInput(facts[0]).accepted, true);
        assert.deepEqual(fed, [0x41, 0x41], 'the same byte, live and on replay');
        assert.equal(t.replayToInputBoundary({ ticks: 1, domain: 'labwired-instructions' }).code, 'input-boundary-passed');
        assert.equal(t.replayToInputBoundary({ ticks: 'x', domain: 'labwired-instructions' }).code, 'invalid-input-boundary');
    });
});
