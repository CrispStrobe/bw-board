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
    /** A sim that faults once `faultAfter` 1 ms slices (48 000 instructions each at 48 MHz) have run. */
    const faultingSim = (faultAfter) => {
        let steps = 0;
        return {
            get_pc: () => 0x0800_0200,
            step_batch: n => { steps += n; return n; },
            step_single: () => { steps++; },
            fault_verdict: () => steps >= faultAfter * 48_000
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
        assert.deepEqual(bare, { fault: null, fidelityGaps: [], consoleMismatch: null });
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

describe('labwired step over / out / run-to (ARM)', () => {
    /**
     * A tiny Thumb machine: memory holds real encodings, the "CPU" follows a
     * script of PCs and SP values, one entry per step_single.
     *   0x100: BL 0x200 (f000 f87e)   0x104: next
     *   0x200..: callee body, returns to 0x104
     */
    const machine = (trace) => {
        const mem = new Map([[0x100, 0xf000], [0x102, 0xf87e], [0x104, 0xbf00], [0x106, 0x4780]]);
        let i = 0;
        const at = () => trace[Math.min(i, trace.length - 1)];
        return {
            get_pc: () => at().pc,
            step_single: () => { i++; },
            step_batch: () => {},
            read_memory: (a, n) => { const hw = mem.get(a) ?? 0; return n === 2 ? [hw & 0xff, hw >> 8] : []; },
            get_register_names: () => [...Array.from({ length: 13 }, (_, k) => `R${k}`), 'SP', 'LR', 'PC'],
            get_register: k => (k === 13 ? at().sp : k === 14 ? at().lr ?? 0 : 0),
        };
    };
    const on = sim => createLabwiredDebugTarget({ adapter: { ...stubAdapter(), sim } });

    it('over a BL runs the whole call and stops at the return site', () => {
        const t = on(machine([{ pc: 0x100, sp: 0x1000 }, { pc: 0x200, sp: 0x1000 }, { pc: 0x202, sp: 0xff8 },
            { pc: 0x204, sp: 0xff8 }, { pc: 0x104, sp: 0x1000 }, { pc: 0x106, sp: 0x1000 }]));
        assert.equal(t.step('over'), undefined);
        assert.equal(t.runFor(1_000_000), 'halted');
        assert.equal(t.regs().pc, 0x104);
    });
    it('over a non-call is one instruction', () => {
        const t = on(machine([{ pc: 0x104, sp: 0x1000 }, { pc: 0x106, sp: 0x1000 }, { pc: 0x108, sp: 0x1000 }]));
        t.step('over'); t.runFor(1_000_000);
        assert.equal(t.regs().pc, 0x106);
    });
    it('over a 16-bit BLX Rm stops at +2', () => {
        const t = on(machine([{ pc: 0x106, sp: 0x1000 }, { pc: 0x300, sp: 0x1000 }, { pc: 0x108, sp: 0x1000 }]));
        t.step('over'); t.runFor(1_000_000);
        assert.equal(t.regs().pc, 0x108);
    });
    it('out stops on the return to LR, or when SP rises above the entry value', () => {
        const byLr = on(machine([{ pc: 0x200, sp: 0xff8, lr: 0x105 }, { pc: 0x202, sp: 0xff8 }, { pc: 0x104, sp: 0xff8 }, { pc: 0x106, sp: 0xff8 }]));
        byLr.step('out'); byLr.runFor(1_000_000);
        assert.equal(byLr.regs().pc, 0x104, 'LR 0x105 names Thumb 0x104');
        const bySp = on(machine([{ pc: 0x200, sp: 0xff8, lr: 0x999 }, { pc: 0x202, sp: 0xff0 }, { pc: 0x210, sp: 0x1000 }, { pc: 0x212, sp: 0x1000 }]));
        bySp.step('out'); bySp.runFor(1_000_000);
        assert.equal(bySp.regs().pc, 0x210, 'a stacked return (SP rise) ends it even when LR was replaced');
    });
    it('capabilities declare over/out and a synchronous run-to on ARM only', () => {
        const arm = createLabwiredDebugTarget({ adapter: stubAdapter() });
        assert.deepEqual(arm.capabilities().steps, ['insn', 'over', 'out']);
        assert.deepEqual(arm.capabilities().runTo[0].stopSides, ['before']);
        const xt = createLabwiredDebugTarget({ adapter: { ...stubAdapter(), arch: 'xtensa-lx7' } });
        assert.deepEqual(xt.capabilities().steps, ['insn']);
        assert.match(xt.step('over').unsupported, /ARM \(Thumb\) chips only/);
    });
});

describe('labwired runFor: program time is the engine\'s, and a step error halts', () => {
    /** An engine whose instructions cost 4 cycles, with time published at pump. */
    const cpi4 = () => {
        let cycles = 0n;
        let pending = 0n;
        const hz = 48_000_000n;
        const sim = { get_pc: () => 0x100, step_single: () => { pending += 4n; }, step_batch: n => { pending += 4n * BigInt(n); return n; } };
        const adapter = { ...stubAdapter(), sim, timeNs: () => (cycles * 1_000_000_000n) / hz, pump() { cycles += pending; pending = 0n; } };
        return { adapter, sim, cycles: () => cycles };
    };
    it('the slow path stops when the engine\'s cycles cover the slice, not after budget-many steps', () => {
        const m = cpi4();
        const t = createLabwiredDebugTarget({ adapter: m.adapter });
        assert.equal(typeof t.setBreakpoint({ kind: 'code', addr: 0x998 }), 'number');   // forces the slow path
        t.run();
        t.runFor(100_000);                                               // 4800 cycles at 48 MHz
        assert.ok(m.cycles() >= 4800n && m.cycles() < 4800n + 64n * 4n,
            `ran ${m.cycles()} cycles for a 4800-cycle slice (old loop: 19200)`);
    });
    it('the free path is bounded by engine time too', () => {
        const m = cpi4();
        const t = createLabwiredDebugTarget({ adapter: m.adapter });
        t.run();
        t.runFor(100_000);
        assert.ok(m.cycles() >= 4800n && m.cycles() < 4800n + 4096n * 4n, `${m.cycles()}`);
        assert.ok(m.cycles() < 19_200n, 'not budget-many steps of 4 cycles each');
    });
    it('an engine error in a step halts with its message instead of throwing', () => {
        const t = createLabwiredDebugTarget({ adapter: { ...stubAdapter(),
            sim: { get_pc: () => 0x100, step_single: () => { throw new Error('Simulation Error: bus fault at 0xdead'); }, step_batch() {} } } });
        const halts = [];
        t.onHalt(h => halts.push(h));
        t.step('insn', 1);
        assert.equal(t.runFor(1_000_000), 'halted');
        assert.equal(halts[0].cause, 'error');
        assert.match(halts[0].message, /bus fault at 0xdead/);
    });
});

describe('labwired write watchpoints', () => {
    /** Memory where instruction n writes `writes[n]` = [addr, byte]. */
    const writer = (writes) => {
        const mem = new Map();
        let n = 0;
        return {
            get_pc: () => 0x100 + 2 * n,
            step_single: () => { const w = writes[n++]; if (w) mem.set(w[0], w[1]); },
            step_batch() {},
            read_memory: (a, len) => Array.from({ length: len }, (_, k) => mem.get(a + k) ?? 0),
        };
    };
    const on = sim => createLabwiredDebugTarget({ adapter: { ...stubAdapter(), sim } });

    it('halts on the instruction that changes a watched byte, naming the watch', () => {
        const t = on(writer([[0x2000_0100, 1], [0x2000_0004, 9], [0x2000_0101, 2]]));
        const halts = [];
        t.onHalt(h => halts.push(h));
        const h = t.setBreakpoint({ kind: 'write', addr: 0x2000_0004, len: 1 });
        assert.equal(typeof h, 'number');
        assert.ok(t.capabilities().breakpoints.includes('write'));
        t.run();
        assert.equal(t.runFor(1_000_000), 'halted');
        assert.equal(halts[0].cause, 'watchpoint');
        assert.equal(halts[0].bp, h);
        assert.equal(halts[0].bpKind, 'write');
        assert.deepEqual(halts[0].value, [9]);
        assert.equal(t.regs().pc, 0x104, 'stopped after the writing instruction, not at a neighbour');
    });
    it('cleared, it no longer stops; a bad length is refused by name', () => {
        const t = on(writer([[0x10, 1], [0x10, 2]]));
        const h = t.setBreakpoint({ kind: 'write', addr: 0x10 });
        t.clearBreakpoint(h);
        t.run();
        assert.equal(t.runFor(100), 'running');
        assert.match(t.setBreakpoint({ kind: 'write', addr: 0x10, len: 64 }).unsupported, /1\.\.8 bytes/);
    });
});

describe('labwired memory/register writes and any-address decode (when the engine has them)', () => {
    const newEngine = (mem = new Map()) => ({
        mem,
        get_pc: () => 0x100,
        step_single() {}, step_batch() {},
        read_memory: (a, n) => Array.from({ length: n }, (_, k) => mem.get(a + k) ?? 0),
        write_memory: (a, bytes) => bytes.forEach((b, k) => mem.set(a + k, b)),
        get_register_names: () => ['R0', 'R1', 'SP'],
        get_register: () => 0,
        set_register: (i, v) => { mem.set(`r${i}`, v); },
        disassemble_at: a => `decode@${a.toString(16)}`,
        get_disassembly: () => 'decode@pc',
    });
    const on = (sim, arch) => createLabwiredDebugTarget({ adapter: { ...stubAdapter(), sim, arch } });

    it('writes memory and a register by name; decodes any address', () => {
        const sim = newEngine();
        const t = on(sim);
        assert.deepEqual(t.capabilities().writable, ['code', 'sram']);
        assert.equal(t.writeMem('sram', 0x2000_0000, [1, 2]), undefined);
        assert.deepEqual(sim.read_memory(0x2000_0000, 2), [1, 2]);
        assert.equal(t.writeReg('sp', 0x2000_4000), undefined);
        assert.equal(sim.mem.get('r2'), 0x2000_4000);
        assert.match(t.writeReg('lr', 1).unsupported, /no register named lr/);
        assert.equal(t.disasm(0x200), 'decode@200');
    });
    it('instruction lengths per architecture, and the listing stride', () => {
        const mem = new Map([[0x0, 0x00], [0x1, 0xf0], [0x10, 0x00], [0x11, 0xbf],   // Thumb BL (f000) / NOP (bf00)
            [0x20, 0x13], [0x21, 0x00], [0x30, 0x01], [0x31, 0x00],                   // RV addi (…13) / c.nop (0001)
            [0x40, 0x22], [0x50, 0x3d],                                               // Xtensa addi (op0 2) / nop.n (op0 d)
            [0x60, 0x0c], [0x61, 0x94], [0x70, 0x00], [0x71, 0x00]]);                 // AVR JMP (940c) / NOP
        assert.equal(on(newEngine(mem)).instructionLength(0x0), 4);
        assert.equal(on(newEngine(mem)).instructionLength(0x10), 2);
        assert.equal(on(newEngine(mem), 'riscv').instructionLength(0x20), 4);
        assert.equal(on(newEngine(mem), 'riscv').instructionLength(0x30), 2);
        assert.equal(on(newEngine(mem), 'xtensa-lx7').instructionLength(0x40), 3);
        assert.equal(on(newEngine(mem), 'xtensa-lx7').instructionLength(0x50), 2);
        assert.equal(on(newEngine(mem), 'avr').instructionLength(0x60), 4);
        assert.equal(on(newEngine(mem), 'avr').instructionLength(0x70), 2);
        const t = on(newEngine(mem));
        assert.equal(t.nextCodeAddress(0x10, 0), 0x10);
        assert.equal(t.nextCodeAddress(0x10, 2), 0x12);
    });
    it('an older engine refuses writes by name and decodes only the PC', () => {
        const t = createLabwiredDebugTarget({ adapter: { ...stubAdapter(),
            sim: { get_pc: () => 0x100, get_disassembly: () => 'decode@pc', step_single() {}, step_batch() {} } } });
        assert.deepEqual(t.capabilities().writable, []);
        assert.match(t.writeMem('sram', 0, [1]).unsupported, /no memory write/);
        assert.match(t.writeReg('R0', 1).unsupported, /no register write/);
        assert.equal(t.disasm(0x100), 'decode@pc');
        assert.equal(t.disasm(0x200), '', 'never the PC\'s instruction labelled as another address');
    });
});

describe('labwired listing needs an engine that decodes any address', () => {
    it('nextCodeAddress is null on an older engine, so a host lists nothing rather than blank rows', () => {
        const t = createLabwiredDebugTarget({ adapter: { ...stubAdapter(), sim: { get_pc: () => 0x100 } } });
        assert.equal(t.nextCodeAddress(0x100, 0), null);
    });
});
