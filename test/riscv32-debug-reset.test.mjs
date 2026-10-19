// A program-mode reset of the RISC-V debug target (riscv32-debug.js reset()
// -> riscv32-adapter reset() -> RiscV32Machine.reset()) restarts the LOADED
// IMAGE: pc = its entry, sp and the argc/argv words the loader handed it, and
// every other register/CSR at its reset value — the architectural state of a
// fresh load. Until C5 it restarted at the CPU's resetPc (0), where an image
// linked at 0x1000 (the assembler's default textBase) has no code.
//
// The convention (every bench's debug reset: z80, 6502, i8086, avr8js,
// rp2040's resetToProgram) is a CPU reset, not a reload: RAM is kept. The
// decode cache is flushed, and the timing models (E8) start fresh.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDebugTarget} from '../src/debug-target-factory.js';
import {assembleRiscv} from '../src/riscv-asm.js';

// Dirties registers and CSRs, bumps a .data counter, and exits with it.
const SRC = `
.text
_start:
  lw   t0, 0(sp)          # argc: the loader's hand-off must read 0 here
  bnez t0, bad
  li   t1, 0x123
  csrw mscratch, t1
  csrw mtvec, t1
  li   s0, 0x55
  la   t2, counter
  lw   a0, 0(t2)
  addi a0, a0, 1
  sw   a0, 0(t2)
  sw   s0, 0(sp)          # clobber the argc word the next start reads
  li   a7, 93
  ecall
bad:
  li   a0, 99
  li   a7, 93
  ecall
.data
counter: .word 0
`;

function build() {
    const asm = assembleRiscv(SRC);
    assert.equal(asm.image.entry, 0x1000, 'the image is linked away from pc 0');
    return createDebugTarget('riscv32', {image: asm.image}).then(t => ({...t, asm}));
}

const runToExit = adapter => { for (let i = 0; i < 100 && !adapter.exited(); i++) adapter.advanceNs(1000); };

const archState = machine => ({
    pc: machine.cpu.pc >>> 0,
    x: Array.from(machine.cpu.x),
    csr: Array.from(machine.cpu.csr),
    priv: machine.cpu.priv,
    halted: machine.cpu.halted,
    waiting: machine.cpu.waiting,
    retired: machine.cpu.retired,
    exitCode: machine.exitCode,
});

test('reset returns to the image entry with the architectural state of a fresh load', async () => {
    const {target, adapter} = await build();
    const fresh = await build();
    const expected = archState(fresh.adapter.machine);
    assert.equal(expected.pc, 0x1000);

    runToExit(adapter);
    assert.equal(adapter.exitCode(), 1, 'first run: counter 0 -> 1, argc read 0');
    assert.notDeepEqual(archState(adapter.machine), expected, 'the run dirtied the state');

    target.reset();
    assert.equal(target.state(), 'halted');
    assert.deepEqual(archState(adapter.machine), expected, 'registers, CSRs, pc: as a fresh load');
    assert.equal(target.regs().pc, 0x1000, 'the debugger reads the entry');

    // RAM is kept (a reset is not a reload): the .data counter carries on,
    // and the loader's argc word — clobbered by the run — is handed off again.
    runToExit(adapter);
    assert.equal(adapter.exitCode(), 2, 'second run: .data kept (counter 1 -> 2), argc re-zeroed');
});

test('reset flushes the decode cache: code rewritten behind the core runs after reset', async () => {
    const {target, adapter} = await build();
    runToExit(adapter);                                   // the entry page is now predecoded
    assert.equal(adapter.exitCode(), 1);
    const m = adapter.machine;
    // Rewrite the entry instruction in place WITHOUT load() (which flushes):
    // "lw t0,0(sp)" becomes "li t0,1", so the program takes the 'bad' path
    // and exits 99 — unless a stale predecoded "lw" runs instead.
    const LI_T0_1 = 0x00100293;                           // addi t0, x0, 1
    const at = 0x1000 - m.ramBase;
    m.mem[at] = LI_T0_1 & 0xff; m.mem[at + 1] = (LI_T0_1 >>> 8) & 0xff;
    m.mem[at + 2] = (LI_T0_1 >>> 16) & 0xff; m.mem[at + 3] = LI_T0_1 >>> 24;
    target.reset();
    runToExit(adapter);
    assert.equal(adapter.exitCode(), 99, 'the rewritten instruction executed, not a stale decode');
});

test('reset starts the timing models fresh: a rerun reports exactly the first run', async () => {
    const {target, adapter} = await build();
    // Caches on, so a model carried across the reset would run warm (fewer
    // misses, fewer cycles) and differ from the first run.
    const cache = {size: 256, ways: 2, line: 16};
    assert.equal(target.setTiming({icache: cache, dcache: cache, predictor: {kind: 'bimodal'}}), undefined);
    runToExit(adapter);
    const first = target.timing().stats;
    assert.ok(first['cpu.cycles'] > 0 && first['cpu.insts'] > 0, JSON.stringify(first));

    target.reset();
    const zero = target.timing().stats;
    assert.equal(zero['cpu.cycles'], 0, 'counters start at zero after reset');
    assert.equal(zero['cpu.insts'], 0);

    runToExit(adapter);
    // Same instructions (the counter path differs only in a value), cold
    // caches and predictor again: the same cycle count as the first run.
    assert.deepEqual(target.timing().stats, first, 'a fresh model, not a warm one');
});
