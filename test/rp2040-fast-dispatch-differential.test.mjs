/**
 * DIFFERENTIAL CORRECTNESS GATE for the switch-dispatch fork of rp2040js's
 * Cortex-M0+ decoder (src/vendor/rp2040js-fast/execute-instruction.js).
 *
 * The fork restructures an 82-branch linear if/else decode chain into a
 * two-level `switch (opcode >> 12)` dispatch, copying every instruction
 * body VERBATIM. This test proves the restructuring is behavior-identical
 * the only way that actually counts: run EVERY one of the 65536 Thumb
 * halfwords (and, for wide instructions, a battery of second-halfwords)
 * through BOTH the stock upstream method and the fork, from byte-identical
 * seed state, and assert the resulting core state + touched memory match
 * exactly. A single wrong Thumb decode silently breaks real firmware, so a
 * mismatch here must FAIL the suite.
 *
 * What is compared after ONE executeInstruction(): all 16 registers
 * (PC/SP/LR included), N/Z/C/V, PM, waiting, eventRegistered,
 * pendingSVCall, interruptsUpdated, breakRewind, cycles, the returned
 * deltaCycles, whether execution threw, and a checksum over the SRAM
 * window every store/push/stmia from the seed can reach. Several seed
 * profiles run each opcode: a rich ALU/flags profile (with both C=0 and
 * C=1, for the carry-dependent ADCS/SBCS), and an address profile that
 * puts a live SRAM pointer in the base register so load/store dispatch is
 * distinguished by the bytes it moves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

let SKIP = false;
let RP2040, fastExecuteInstruction, stockExecuteInstruction;
try {
  ({ RP2040 } = await import('rp2040js'));
  ({ fastExecuteInstruction } = await import('../src/vendor/rp2040js-fast/execute-instruction.js'));
  // The stock method is the one a plain, unpatched RP2040 core carries.
  stockExecuteInstruction = new RP2040().core.executeInstruction;
} catch (e) {
  SKIP = `rp2040js not installed (${e?.message ?? e})`;
}

const RAM_START = 0x20000000;
// Window covering every address the seeds below can store to (base
// 0x20002000 + imm, SP 0x20003000 push/pop, stmia base). 32 KiB is ample.
const WIN_OFF = 0x2000; // bytes into SRAM
const WIN_WORDS = 0x2000; // 32 KiB / 4

// Fields to compare after one instruction (besides registers + memory).
const SCALAR_FIELDS = [
  'N', 'C', 'Z', 'V', 'PM', 'waiting', 'eventRegistered',
  'pendingSVCall', 'interruptsUpdated', 'breakRewind', 'cycles',
];

// Seed register profiles. r0 always holds a live SRAM base so address
// forms land in mapped RAM; the rest carry values that exercise flags.
function makeProfiles() {
  const rich = [
    0x20002000, 0x00000001, 0x7fffffff, 0x80000000,
    0xffffffff, 0x12345678, 0x000000ff, 0x0000002a,
    0xdeadbeef, 0xa5a5a5a5, 0x00010000, 0x0000ffff,
    0xcafebabe, 0x20003000, 0x00000000, RAM_START,
  ];
  // Address profile: base in r0, small/zero indices so register-offset
  // forms resolve to r0's SRAM window rather than summing two pointers.
  const addr = [
    0x20002000, 0x00000000, 0x00000004, 0x00000008,
    0x0000000c, 0x00000010, 0x00000014, 0x00000018,
    0x11111111, 0x22222222, 0x33333333, 0x44444444,
    0x55555555, 0x20003000, 0x00000000, RAM_START,
  ];
  const flagsC0 = { N: false, Z: false, C: false, V: false };
  const flagsC1 = { N: true, Z: false, C: true, V: false };
  return [
    { name: 'rich/C0', regs: rich, flags: flagsC0 },
    { name: 'rich/C1', regs: rich, flags: flagsC1 },
    { name: 'addr/C0', regs: addr, flags: flagsC0 },
  ];
}

function seedCore(core, regs, flags) {
  for (let i = 0; i < 16; i++) core.registers[i] = regs[i];
  core.N = flags.N; core.Z = flags.Z; core.C = flags.C; core.V = flags.V;
  core.PM = false;
  core.waiting = false;
  core.eventRegistered = false;
  core.pendingSVCall = false;
  core.interruptsUpdated = false; // skip the top interrupt path identically
  core.breakRewind = 0;
  core.cycles = 0;
}

function memChecksum(rp2040) {
  const view = new Uint32Array(rp2040.sram.buffer, WIN_OFF, WIN_WORDS);
  // FNV-1a-ish rolling sum, kept in 32-bit space.
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < WIN_WORDS; i++) {
    h = (Math.imul(h ^ view[i], 0x01000193)) | 0;
  }
  return h >>> 0;
}

function runOne(rp2040, core, exec, opcode, opcode2, regs, flags) {
  seedCore(core, regs, flags);
  rp2040.writeUint16(RAM_START, opcode);
  rp2040.writeUint16(RAM_START + 2, opcode2);
  core.PC = RAM_START;
  let threw = null;
  let delta = -1;
  try {
    delta = exec.call(core);
  } catch (e) {
    threw = e?.message ?? String(e);
  }
  const snap = { threw, delta, regs: new Uint32Array(core.registers), mem: memChecksum(rp2040) };
  for (const f of SCALAR_FIELDS) snap[f] = core[f];
  return snap;
}

function diff(a, b) {
  if (a.threw !== b.threw) return `threw: stock=${a.threw} fork=${b.threw}`;
  if (a.delta !== b.delta) return `deltaCycles: stock=${a.delta} fork=${b.delta}`;
  for (let i = 0; i < 16; i++) {
    if ((a.regs[i] >>> 0) !== (b.regs[i] >>> 0)) {
      return `r${i}: stock=0x${(a.regs[i] >>> 0).toString(16)} fork=0x${(b.regs[i] >>> 0).toString(16)}`;
    }
  }
  for (const f of SCALAR_FIELDS) {
    if (a[f] !== b[f]) return `${f}: stock=${a[f]} fork=${b[f]}`;
  }
  if (a.mem !== b.mem) return `SRAM window: stock=0x${a.mem.toString(16)} fork=0x${b.mem.toString(16)}`;
  return null;
}

// Second-halfword variants that flip every guard in the wide-instruction
// (top nibble 0xF / 0b11101) decode paths: BL J-bits, DMB/DSB/ISB option
// fields, MRS/MSR SYSm+Rd, UDF T2.
const OPCODE2_VARIANTS = [
  0x0000, 0xffff, 0x8f50, 0x8f40, 0x8f60, 0x8f5f,
  0xd000, 0xc000, 0xe000, 0x8800, 0x8888, 0x8000,
  0xa000, 0xa5a5, 0xf000, 0x1234,
];

test('fork decodes every Thumb opcode identically to stock rp2040js', { skip: SKIP }, () => {
  const stock = new RP2040();
  const fork = new RP2040();
  // Silence the not-implemented warn flood identically on both.
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  stock.logger = quiet;
  fork.logger = quiet;
  // onBreak must not throw or diverge; neutralize identically on both.
  stock.onBreak = () => {};
  fork.onBreak = () => {};
  const stockCore = stock.core;
  const forkCore = fork.core;

  const profiles = makeProfiles();
  let mismatches = 0;
  let firstMsg = '';
  let checked = 0;

  for (let opcode = 0; opcode <= 0xffff; opcode++) {
    const wide = opcode >> 12 === 0b1111 || opcode >> 11 === 0b11101;
    const op2list = wide ? OPCODE2_VARIANTS : [0x0000];
    for (const opcode2 of op2list) {
      for (const p of profiles) {
        const a = runOne(stock, stockCore, stockExecuteInstruction, opcode, opcode2, p.regs, p.flags);
        const b = runOne(fork, forkCore, fastExecuteInstruction, opcode, opcode2, p.regs, p.flags);
        checked++;
        const d = diff(a, b);
        if (d) {
          mismatches++;
          if (!firstMsg) {
            firstMsg = `opcode=0x${opcode.toString(16).padStart(4, '0')} ` +
              `opcode2=0x${opcode2.toString(16).padStart(4, '0')} profile=${p.name} -> ${d}`;
          }
        }
      }
    }
  }

  assert.equal(mismatches, 0,
    `${mismatches} stock/fork decode mismatches over ${checked} checks. First: ${firstMsg}`);
});
