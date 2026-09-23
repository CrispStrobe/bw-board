// Boot a Zephyr qemu_riscv32 image on RiscV32Machine and assert it multitasks.
//
// Zephyr's `qemu_riscv32` board is M-mode + SiFive CLINT@0x02000000 + NS16550
// UART@0x10000000 + RAM@0x80000000 — an exact match for our machine once the RAM
// base is 0x80000000 (the configurable ramBase). The `synchronization` sample
// runs two threads that hand off a semaphore and each print a line; seeing both
// thread_a and thread_b proves the kernel booted, the CLINT tick drives
// k_sleep/scheduling, and ecall-based context switch reaches Zephyr's trap
// handler (ecallTraps).
//
// Usage: node boot.mjs <path-to-zephyr.elf>
// Exits 0 on success, non-zero (with the captured output) on failure.

import {readFileSync} from 'node:fs';
import {RiscV32Machine} from '../../src/riscv32-machine.js';
import {loadElfInto} from '../../scripts/riscv-elf.mjs';

const elfPath = process.argv[2];
if (!elfPath) { console.error('usage: node boot.mjs <zephyr.elf>'); process.exit(2); }

const elf = new Uint8Array(readFileSync(elfPath));
let out = '';
// 16 MiB RAM at 0x80000000 (Zephyr qemu_riscv32's DRAM base); ecallTraps because
// Zephyr's RISC-V context switch traps via ecall to its own mtvec handler.
const m = new RiscV32Machine(
    {memSize: 1 << 26, ramBase: 0x80000000, ecallTraps: true},   // 64 MiB covers qemu_riscv32 DRAM
    {onSerial: b => { out += String.fromCharCode(b); }});

loadElfInto(m, elf);
console.log('entry =', '0x' + m.cpu.pc.toString(16));

// Run in bounded chunks so a hang is caught rather than spinning forever.
for (let i = 0; i < 40 && !m.halted; i++) {
    m.run(4_000_000);
    if (/thread_a/.test(out) && /thread_b/.test(out)) break;
}

process.stdout.write('--- Zephyr output (first 400 chars) ---\n' + out.slice(0, 400) + '\n');

const okA = /thread_a/.test(out);
const okB = /thread_b/.test(out);
if (okA && okB) {
    console.log('PASS: Zephyr booted; both threads ran (preemptive multitasking on the emulated SoC).');
    process.exit(0);
}
console.error(`FAIL: expected both thread_a and thread_b in the output (a=${okA} b=${okB}).`);
process.exit(1);
