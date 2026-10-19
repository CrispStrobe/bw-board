/**
 * emu8051-stc recorded facts: pin-history signals, checkpoint refusal, and the
 * instruction/bus/memory evidence a step publishes.
 *
 * WHY A SECOND FILE. `emu8051-debug.test.js` owns the control surface — halts,
 * breakpoints, stepping, time. This one owns what the target PUBLISHES, which
 * is a different question with a different oracle: every case here is driven
 * against the native build and asserts a decoded fact, not a capability string.
 *
 * THE INSTRUMENT IS THE NATIVE RING, AND IT HAS TO BE DRIVEN. `emu_dbg_step`
 * only ARMS a step (see the sibling file's note); nothing retires and no pin
 * moves until the target is pumped. A case that forgets that reads an empty
 * ring and an empty ring is indistinguishable from a target that records
 * nothing — so each case here asserts it produced SOMETHING before it asserts
 * anything about the contents.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmu8051DebugTarget } from '../src/emu8051-debug.js';
import { resolveAncestor } from './helpers/sibling-checkout.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
    process.env.EMU8051_JS,
    resolveAncestor(here, ['emu8051-stc', 'build', 'emu8051.js']),
].filter(Boolean);

let createEmu8051 = null;
for (const p of CANDIDATES) {
    if (existsSync(p)) { createEmu8051 = require(p); break; }
}

/** `skip:` is the runner's own mechanism — an early return would count as ok. */
const SKIP = createEmu8051 ? false
    : 'no emu8051 build reachable — check out CrispStrobe/emu8051-stc beside this '
      + 'repo and build it, or set $EMU8051_JS';
const REQUIRE_CHECKPOINT = process.env.EMU8051_CHECKPOINT_REQUIRED === '1';

/** Assemble one Intel HEX record, checksum computed rather than hand-written. */
function hexOf(bytes, addr = 0) {
    const rec = [bytes.length, (addr >> 8) & 0xff, addr & 0xff, 0, ...bytes];
    const ck = (0x100 - (rec.reduce((a, b) => a + b, 0) & 0xff)) & 0xff;
    const hx = rec.concat(ck).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    return `:${hx}\n:00000001FF\n`;
}

/** MOV P1M0,#01 (push-pull P1.0) ; CLR P1.0 ; SETB P1.0 ; SJMP $ */
const PIN_BYTES = [0x75, 0x92, 0x01, 0xC2, 0x90, 0xD2, 0x90, 0x80, 0xFE];
/** MOV P1M0,#01 ; CPL P1.0 ; SJMP back — one pin edge per iteration, forever. */
const TOGGLE_BYTES = [0x75, 0x92, 0x01, 0xB2, 0x90, 0x80, 0xFC];
/** MOV 0x30,#00 ; MOV 0x30,#42 ; SJMP $ — writes the watched iram byte. */
const WATCH_BYTES = [0x75, 0x30, 0x00, 0x75, 0x30, 0x42, 0x80, 0xFE];

/**
 * ONLY THE OPCODES THESE PROGRAMS USE, and deliberately not the generated
 * table. The real length table is generated from stc-compiler's stc_disasm.py
 * and is injected by the host; copying it in here would put a second
 * unverified copy of a generated artefact in this repo, which is the reason
 * the parameter exists at all. A fixture that covers the fixtures is enough.
 */
const TEST_LENGTHS = {0x75: 3, 0xC2: 2, 0xD2: 2, 0x80: 2, 0xB2: 2};
const testInstructionLength = (opcode) => {
    const n = TEST_LENGTHS[opcode & 0xff];
    assert.ok(n, `test fixture has no length for opcode 0x${(opcode & 0xff).toString(16)}`);
    return n;
};

async function targetWith(bytes, opts = {}) {
    const wasm = await createEmu8051();
    wasm._emu_init(1);
    wasm._emu_set_fosc(11059200);
    wasm._emu_set_vcc(5.0);
    const t = createEmu8051DebugTarget(wasm, opts);
    const hex = hexOf(bytes);
    wasm.ccall('emu_load_hex', 'number', ['string', 'number'], [hex, hex.length]);
    t.reset();
    t.wasm = wasm;
    return t;
}

/** Pump an armed step or a run to its halt. */
function settle(t, budgetNs = 1000) {
    for (let i = 0; i < 4096 && t.state() === 'running'; i++) t.runFor(budgetNs);
}

function stepOnce(t, kind = 'insn') {
    const refusal = t.step(kind, 1);
    assert.ok(!refusal, `step refused: ${JSON.stringify(refusal)}`);
    settle(t);
}

describe('emu8051 pin history: native edges, not polled samples', () => {
    it('publishes one signal fact per edge, carrying native time, mode and level', {skip: SKIP}, async () => {
        const t = await targetWith(PIN_BYTES);
        assert.ok(t.capabilities().events.includes('signal'),
            'this build exposes no native pin history, so the decode below cannot run. '
            + 'Every emu8051-stc ref bw-board has used exports emu_pin_history_*; if that '
            + 'changed, say which build dropped it rather than passing quietly.');

        const facts = [];
        t.onDebugEvent((e) => facts.push(e));
        for (let i = 0; i < 3; i++) stepOnce(t);

        const edges = facts.filter((e) => e.kind === 'signal' && e.phase === 'pin-change');
        // THE INPUT-POPULATION ASSERTION. Without it every claim below is
        // vacuously true on a target that records nothing at all.
        assert.ok(edges.length >= 3, `expected the three P1.0 edges, got ${edges.length}`);

        for (const e of edges) {
            assert.equal(e.fidelity, 'recorded');
            assert.equal(e.cpuId, 'main');
            assert.equal(e.signal.name, 'P1.0', 'the program only touches P1.0');
            assert.equal(e.signal.mode, 'pushpull', 'P1M0=01 selected push-pull');
            assert.equal(typeof e.signal.value, 'boolean');
            assert.equal(typeof e.time.ticks, 'bigint', 'native nanoseconds, not a Number');
            assert.match(e.time.domain, /^8051-simulation-ns-reset-\d+$/);
        }
        // CLR then SETB: the levels must alternate down-then-up, which is the
        // part a decoder reading the wrong struct offset gets wrong while every
        // assertion above still passes.
        assert.deepEqual(edges.slice(0, 3).map((e) => e.signal.value), [true, false, true],
            'P1M0=01 drives the latch high, then CLR P1.0 low, then SETB P1.0 high');
        assert.ok(edges[1].time.ticks > edges[0].time.ticks, 'native time advances across edges');
    });

    it('an overflowed ring is an explicit gap with a count, not a quiet truncation', {skip: SKIP}, async () => {
        const t = await targetWith(TOGGLE_BYTES);
        const facts = [];
        t.onDebugEvent((e) => facts.push(e));

        // ONE budget, deliberately: runFor drains, so several small budgets
        // would each drain under the cap and never overflow the ring.
        t.run();
        t.runFor(5_000_000);

        const produced = t.wasm._emu_pin_history_count() >>> 0;
        assert.ok(produced > 4096,
            `the toggle loop produced only ${produced} edges, so the ring never overflowed `
            + 'and this case would assert nothing. Raise the budget.');

        const gaps = facts.filter((e) => e.phase === 'history-gap');
        assert.equal(gaps.length, 1, 'one gap for one overflow');
        assert.equal(gaps[0].kind, 'signal');
        assert.equal(gaps[0].signal.name, '8051.pin-history-gap');
        assert.equal(gaps[0].signal.value, produced - 4096,
            'the gap states how many edges were lost, derived from the native count');

        const edges = facts.filter((e) => e.phase === 'pin-change');
        assert.equal(edges.length, 4096, 'exactly the retained window is decoded, once each');
    });

    it('a reset re-seeds the read cursor instead of reporting the new epoch as loss', {skip: SKIP}, async () => {
        const t = await targetWith(PIN_BYTES);
        t.run();
        t.runFor(200_000);

        // stc12_init preserves the ring POINTER but zeroes head and count. A
        // cursor left at the pre-reset totals would read the next edges as an
        // overflow of 2^32-ish, so the reset path must re-read both.
        t.reset();
        const facts = [];
        t.onDebugEvent((e) => facts.push(e));
        t.run();
        t.runFor(200_000);

        assert.equal(facts.filter((e) => e.phase === 'history-gap').length, 0,
            'no phantom gap after a reset');
        assert.ok(facts.some((e) => e.phase === 'pin-change'),
            'and the post-reset edges are still delivered');
    });
});

describe('emu8051 checkpoints: a refusal that names what is missing', () => {
    it('self-restores an absolute pin cursor beyond the physical ring', {skip: SKIP}, async () => {
        const t = await targetWith(TOGGLE_BYTES);
        if (!t.capabilities().extensions.checkpoint.supported) return;
        t.run();
        t.runFor(5_000_000);
        const head = t.wasm._emu_pin_history_head() >>> 0;
        assert.ok(head > 4096, `fixture produced only ${head} events`);
        const snapshot = t.captureCheckpoint();
        assert.equal(snapshot.local.pinHistoryReadHead, head,
            'cursor remains the native absolute uint32, not a ring index');
        assert.equal(snapshot.local.pinHistoryReadCount, head);
        assert.equal(t.restoreCheckpoint(snapshot), true);
        const facts = [];
        t.onDebugEvent(fact => facts.push(fact));
        t.runFor(100_000);
        assert.equal(facts.filter(fact => fact.phase === 'history-gap').length, 0,
            'self-restore must not reinterpret an absolute cursor as lost history');
    });

    it('restores the native breakpoint with its matching JS identity', {skip: SKIP}, async () => {
        const t = await targetWith(PIN_BYTES);
        if (!t.capabilities().extensions.checkpoint.supported) return;
        const handle = t.setBreakpoint({kind: 'code', addr: 3});
        assert.equal(typeof handle, 'number');
        const snapshot = t.captureCheckpoint();
        stepOnce(t);
        assert.equal(t.restoreCheckpoint(snapshot), true);
        const halts = [];
        t.onHalt(why => halts.push(why));
        t.run();
        settle(t);
        assert.equal(halts.length, 1);
        assert.equal(halts[0].bp, handle);
        assert.equal(halts[0].bpKind, 'code');
        assert.equal(halts[0].pc, 3);
    });

    it('refuses to save, and says which state an architectural dump omits', {skip: SKIP}, async () => {
        const t = await targetWith(PIN_BYTES);
        const r = t.captureCheckpoint();
        if (REQUIRE_CHECKPOINT) assert.equal(t.capabilities().extensions.checkpoint.supported, true,
            'CI requires the exact checkpoint-capable emu8051 artifact');
        if (t.capabilities().extensions.checkpoint.supported) {
            assert.equal(r.kind, 'emu8051-native');
            assert.ok(r.bytes instanceof Uint8Array && r.bytes.length === r.size);
            assert.deepEqual(t.capabilities().recording, ['checkpoint', 'restore']);
            assert.equal(t.capabilities().reverse, undefined,
                'checkpoint support alone is not a reverse-execution claim');
            const pc = t.regs().pc;
            stepOnce(t);
            assert.notEqual(t.regs().pc, pc, 'the live core moved after capture');
            assert.equal(t.restoreCheckpoint(r), true);
            assert.equal(t.regs().pc, pc, 'the native checkpoint restored the real core');
            return;
        }
        assert.equal(r.code, 'incomplete-snapshot-abi');
        assert.equal(r.operation, 'save');
        assert.match(r.refused, /native complete-state WASM ABI/);
        assert.deepEqual(r.missing, [
            'cpu-in-flight-microstate', 'program-time',
            'timer-and-interrupt-internals', 'uart-queues', 'external-input-latches'
        ]);
        assert.deepEqual(t.capabilities().recording, [],
            'nothing is recorded, because nothing can be restored');
        assert.equal(t.capabilities().extensions.checkpoint.supported, false);
    });

    it('refuses to restore BEFORE reading the state it was handed', {skip: SKIP}, async () => {
        const t = await targetWith(PIN_BYTES);
        const pcBefore = t.regs().pc;
        // A getter on every field: touching any of them would prove the refusal
        // inspected a snapshot it had already decided it could not honour.
        let touched = null;
        const trap = new Proxy({}, {get(_, k) { touched = String(k); return undefined; }});
        const r = t.restoreCheckpoint(trap);
        if (t.capabilities().extensions.checkpoint.supported) {
            assert.equal(r.code, 'invalid-checkpoint-envelope');
            assert.equal(touched, 'schema', 'supported builds inspect only the envelope before refusing');
            assert.equal(t.regs().pc, pcBefore, 'and invalid input moved nothing');
            return;
        }
        assert.equal(r.code, 'incomplete-snapshot-abi');
        assert.equal(r.operation, 'restore');
        assert.equal(touched, null, `restore read '${touched}' out of a snapshot it refused`);
        assert.equal(t.regs().pc, pcBefore, 'and it moved nothing');
    });
});

describe('emu8051 step evidence: what a retire can and cannot carry', () => {
    it('an injected length table puts the opcode bytes in the instruction fact', {skip: SKIP}, async () => {
        const t = await targetWith(PIN_BYTES, {instructionLength: testInstructionLength});
        assert.equal(t.capabilities().extensions.instructionBytes, 'injected-length-table');

        const facts = [];
        t.onDebugEvent((e) => facts.push(e));
        stepOnce(t);

        const insn = facts.find((e) => e.kind === 'instruction' && e.phase === 'retire');
        assert.ok(insn, 'the step retired and said so');
        assert.equal(insn.pcBefore, 0);
        assert.equal(insn.pcAfter, 3, 'MOV P1M0,#01 is three bytes wide');
        assert.equal(insn.instruction.address, 0);
        assert.equal(insn.instruction.length, 3);
        assert.deepEqual(insn.instruction.bytes, [0x75, 0x92, 0x01],
            'the bytes come out of code space at the pre-step PC');
        assert.deepEqual(insn.changes.registers.pc, {before: 0, after: 3});
        assert.equal(insn.fidelity, 'recorded');
    });

    it('without a table the fact still retires: bytes and length are ABSENT, not empty', {skip: SKIP}, async () => {
        // The degradation that matters is which of the two it is. An empty byte
        // list would assert a zero-length instruction — a claim about the
        // program — where absence is a claim about this target's reach.
        const t = await targetWith(PIN_BYTES);
        assert.equal(t.capabilities().extensions.instructionBytes, 'none');

        const facts = [];
        t.onDebugEvent((e) => facts.push(e));
        stepOnce(t);

        const insn = facts.find((e) => e.kind === 'instruction' && e.phase === 'retire');
        assert.ok(insn, 'a target with no length table still publishes the retire');
        assert.equal(insn.pcBefore, 0);
        assert.equal(insn.pcAfter, 3, 'the PC still moved a whole instruction');
        assert.equal(insn.instruction.address, 0, 'the address is known without the table');
        assert.equal(typeof insn.instruction.text, 'string',
            'and so is the disassembly, which comes from the WASM');
        assert.ok(!('bytes' in insn.instruction),
            `bytes must be absent, not empty — got ${JSON.stringify(insn.instruction.bytes)}`);
        assert.ok(!('length' in insn.instruction),
            `length must be absent, not 0 or undefined-valued — got ${JSON.stringify(insn.instruction.length)}`);
        // The rest of the evidence is unaffected by the missing table.
        assert.ok(insn.registersAfter, 'registers are read from the build, not the table');
        assert.deepEqual(insn.changes.registers.pc, {before: 0, after: 3});
    });

    it('a cycle step publishes a bus boundary and claims no bus signals', {skip: SKIP}, async () => {
        const t = await targetWith(PIN_BYTES);
        assert.ok(t.capabilities().steps.includes('cycle'),
            'this build declares no cycle step, so the boundary below cannot be driven. '
            + 'Both emu8051-stc refs bw-board has used declare it.');
        assert.ok(t.capabilities().events.includes('bus'));
        assert.equal(t.capabilities().extensions.busSignals, false,
            'the boundary is exposed; the address/data/control lines are not');

        const facts = [];
        t.onDebugEvent((e) => facts.push(e));
        stepOnce(t, 'cycle');

        const bus = facts.find((e) => e.kind === 'bus');
        assert.ok(bus, 'one oscillator boundary, published');
        assert.equal(bus.phase, 'oscillator-clock');
        assert.equal(bus.fidelity, 'recorded');
        assert.equal(bus.cause, 'step');
        assert.equal(bus.pcBefore, 0);
        assert.ok(!('signals' in bus), 'and it carries no synthesized waveform');
    });

    it('a watchpoint halt publishes the byte that changed, as recorded evidence', {skip: SKIP}, async () => {
        const t = await targetWith(WATCH_BYTES);
        assert.ok(t.capabilities().events.includes('memory'),
            'this build cannot report WHICH byte a watchpoint caught (it predates the '
            + 'halt-reason exports, emu8051-stc cf3c7c0), so the fact below cannot exist. '
            + 'Bump the ref in .github/workflows/ci.yml or point $EMU8051_JS at a newer build.');
        assert.equal(t.capabilities().extensions.memoryEvidence, 'change-watchpoint-only',
            'a change watchpoint is not proof of every store, and says so');

        const facts = [];
        t.onDebugEvent((e) => facts.push(e));
        const handle = t.setBreakpoint({kind: 'write', space: 'iram', addr: 0x30});
        assert.equal(typeof handle, 'number', `watchpoint refused: ${JSON.stringify(handle)}`);

        t.run();
        settle(t);
        assert.equal(t.state(), 'halted', 'the write stopped the program');

        const mem = facts.find((e) => e.kind === 'memory');
        assert.ok(mem, 'the watchpoint halt published its byte');
        assert.equal(mem.phase, 'change-watchpoint');
        assert.equal(mem.fidelity, 'recorded');
        assert.equal(mem.cause, 'watchpoint');
        assert.equal(mem.memory.space, 'iram');
        assert.equal(mem.memory.address, 0x30);
        assert.equal(mem.memory.width, 1);
        assert.equal(mem.memory.direction, 'write');
        assert.equal(mem.memory.value, 0x42, 'the value the program stored');
    });
});

describe('emu8051 writeMem drains edges this target did not drive', () => {
    it('flushes a ring filled by execution that never passed through runFor', {skip: SKIP}, async () => {
        // THE CASE WHOSE ABSENCE LET THE DRAIN BE DELETED. A host can advance
        // the emulator on the module it already holds — `wasm._emu_run` — so
        // edges exist that no runFor drained. writeMem is the next moment this
        // target gets control, and a debugger write is when a caller expects
        // to see them. Without the drain nothing below arrives, and nothing
        // else in this suite notices, because every other case reaches the
        // ring through runFor.
        const t = await targetWith(TOGGLE_BYTES);
        assert.equal(typeof t.wasm._emu_run, 'function',
            'this case needs the raw run export to produce edges out of band');

        const facts = [];
        t.onDebugEvent((e) => facts.push(e));

        // Out of band on purpose: no runFor, so no drain has happened.
        t.wasm._emu_run(20000);
        const produced = t.wasm._emu_pin_history_count() >>> 0;
        assert.ok(produced > 0,
            `the out-of-band run produced ${produced} edges, so this case would assert nothing`);
        assert.equal(facts.length, 0, 'and nothing has been published yet');

        // A write that moves no pin of its own, purely to hand control back.
        t.writeMem('iram', 0x20, [0]);

        const edges = facts.filter((e) => e.phase === 'pin-change');
        assert.ok(edges.length > 0,
            'writeMem published nothing, so edges produced outside runFor are stranded in the '
            + 'ring. Restore drainPinHistory() in writeMem: the write moving no pin does not '
            + 'mean there is nothing to drain.');
        assert.equal(edges[0].fidelity, 'recorded');
        assert.match(edges[0].signal.name, /^P\d\.\d$/);
    });
});

describe('emu8051 onDebugEvent: many listeners, each removable', () => {
    it('rejects a non-function instead of failing at the first fact', {skip: SKIP}, async () => {
        const t = await targetWith(PIN_BYTES);
        // The message is asserted, not just the type: an unguarded push would
        // raise its own TypeError later, from the emit loop, and a bare
        // assert.throws(fn, TypeError) passes with the guard deleted.
        assert.throws(() => t.onDebugEvent(null), /debug event listener must be a function/);
        assert.throws(() => t.onDebugEvent({}), /debug event listener must be a function/);
    });

    it('delivers to every listener, and the unsubscribe stops exactly one', {skip: SKIP}, async () => {
        const t = await targetWith(PIN_BYTES, {instructionLength: testInstructionLength});
        const a = [];
        const b = [];
        const offA = t.onDebugEvent((e) => a.push(e));
        t.onDebugEvent((e) => b.push(e));

        stepOnce(t);
        assert.ok(a.length > 0, 'the first listener heard something');
        assert.equal(a.length, b.length, 'both listeners see the same stream');

        offA();
        const aAfter = a.length;
        const bAfter = b.length;
        stepOnce(t);
        assert.equal(a.length, aAfter, 'the unsubscribed listener is silent');
        assert.ok(b.length > bAfter, 'the other one is not');
    });

    /**
     * NO CASE FOR `destroy()` CLEARING THE FACT LISTENERS, AND THAT IS A
     * MEASUREMENT RATHER THAN AN OVERSIGHT.
     *
     * `debugListeners = []` in destroy has no observable path on this ABI.
     * Every `emitDebug` call site is reached from exactly one of two places —
     * `announce`, which runs from the WASM halt callback, and the single
     * `drainPinHistory` in `runFor` — and both need a target that can still
     * run. `destroy` hands the halt callback back to Emscripten with
     * `removeFunction`, so the next `runFor` traps in the WASM with
     * `null function or function signature mismatch` before any fact could be
     * published. Driven, not reasoned: the version of this suite that ran the
     * target after destroy failed exactly that way.
     *
     * The line stays, because it releases a reference the same way the
     * `listeners = []` beside it does. What is recorded here is that a test for
     * it would be vacuous — an empty fact list after destroy passes equally on
     * a target that clears the listeners and one that cannot publish at all,
     * and the mutation proved it: deleting the line left this suite green.
     */
    it('a debug write does not itself move a pin on this ABI', {skip: SKIP}, async () => {
        // THE ABSENCE IS THE SUBJECT, and it is NOT a licence to drop the drain
        // in writeMem — see the comment there. This pins only that the write
        // produces no edge of its own, because `dbg_write_mem` assigns the SFR
        // array directly and never dispatches the `sfrwrite` hooks that feed
        // the ring. If a future build routes debug writes through those hooks,
        // this fails and says so.
        const t = await targetWith(PIN_BYTES);
        const before = t.wasm._emu_pin_history_count() >>> 0;
        t.writeMem('sfr', 0x90, [0x00]);   // P1 latch 0xFF -> 0x00: eight bits
        t.writeMem('sfr', 0x92, [0x01]);   // P1M0: a mode change too
        assert.equal(t.wasm._emu_pin_history_count() >>> 0, before,
            'a debug write reached the native pin recorder. It did not when this was '
            + 'written, and writeMem drops the drain on that basis — restore the '
            + 'drainPinHistory() call in writeMem and keep this assertion as its reason.');
    });
});
