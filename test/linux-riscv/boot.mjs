// Boot an RV32 Linux kernel + initramfs on RiscV32Machine to an interactive
// busybox shell, and measure it.
//
//   node test/linux-riscv/boot.mjs <Image> <initramfs.cpio> [budgetInstr] [wallSeconds]
//
// The machine's in-emulator SBI stands in for OpenSBI (src/riscv32-linux.js
// does fw_jump's hand-off). PASS requires: the kernel reaches userspace (the
// initramfs /init prints BWB-LINUX-USERSPACE-UP), a shell prompt appears, and
// a command typed over the UART runs (`uname -a` answers with "Linux").
// Prints the instructions and wall time to each milestone.

import {readFileSync} from 'node:fs';
import {RiscV32Machine} from '../../src/riscv32-machine.js';
import {bootLinux} from '../../src/riscv32-linux.js';

const [kernelPath, initrdPath, budgetArg, wallArg] = process.argv.slice(2);
if (!kernelPath) { console.error('usage: node boot.mjs <Image> <initramfs.cpio> [budget] [wallSeconds]'); process.exit(2); }
const BUDGET = Number(budgetArg || 3_000_000_000);
const WALL_MS = Number(wallArg || 900) * 1000;
const QUIET = process.env.QUIET === '1';

let out = '';
const m = new RiscV32Machine({memSize: 1 << 26, ramBase: 0x80000000, uartIrq: 10},
    {onSerial: b => { const ch = String.fromCharCode(b); out += ch; if (!QUIET) process.stdout.write(ch); }});
const layout = bootLinux(m, {
    kernel: new Uint8Array(readFileSync(kernelPath)),
    initrd: initrdPath ? new Uint8Array(readFileSync(initrdPath)) : undefined,
    bootargs: process.env.BOOTARGS,
});
if (!QUIET) console.error(`[boot] kernel @0x${layout.kernelAt.toString(16)} dtb @0x${layout.dtbAddr.toString(16)} initrd ${layout.initrd ? '@0x' + layout.initrd.start.toString(16) + ' ' + layout.initrd.size + ' B' : 'none'}`);

const cpu = m.cpu;
const t0 = Date.now();
const marks = {};
const MILESTONES = [
    ['kernel_banner', /Linux version/],
    ['init_run', /Run \/init as init process|BWB-LINUX-USERSPACE-UP/],
    ['userspace', /BWB-LINUX-USERSPACE-UP/],
    ['prompt', /BWB-LINUX-USERSPACE-UP[\s\S]*# $/],
];
const budgetLeft = () => cpu.retired < BUDGET && (Date.now() - t0) < WALL_MS && !cpu.halted;
const note = () => {
    for (const [k, re] of MILESTONES) if (!marks[k] && re.test(out))
        marks[k] = {instructions: cpu.retired, wall: (Date.now() - t0) / 1000, mtime: m.clint.mtime};
};
while (budgetLeft() && !marks.prompt) { m.run(2_000_000); note(); }

let interactive = false;
if (marks.prompt) {
    const mark = out.length;
    for (const ch of 'uname -a\n') m.uart.rxPush(ch.charCodeAt(0));
    while (budgetLeft()) {
        m.run(1_000_000);
        if (/Linux \S+ \d/.test(out.slice(mark)) && /# $/.test(out)) { interactive = true; break; }
    }
    marks.command = {instructions: cpu.retired, wall: (Date.now() - t0) / 1000, mtime: m.clint.mtime};
}

const wall = (Date.now() - t0) / 1000;
console.log('\n\n=== Linux boot summary ===');
for (const [k, v] of Object.entries(marks))
    console.log(`${k.padEnd(14)} ${String(v.instructions).padStart(12)} instr  ${v.wall.toFixed(1).padStart(7)} s wall  mtime ${v.mtime}`);
console.log(`total: ${cpu.retired} instructions in ${wall.toFixed(1)} s = ${(cpu.retired / wall / 1e6).toFixed(2)} MIPS; idle-skipped ${m.idleSkipped} ticks; halted=${cpu.halted}`);
if (marks.prompt && interactive) { console.log('PASS: Linux booted to an interactive busybox shell (uname -a answered).'); process.exit(0); }
console.log(`FAIL: ${marks.prompt ? 'prompt but the command did not answer' : 'no shell prompt'} within budget`);
console.log(`priv=${cpu.priv} pc=0x${(cpu.pc >>> 0).toString(16)} satp=0x${(cpu.csr[0x180] >>> 0).toString(16)} sstatus=0x${cpu._readCsr(0x100).toString(16)}`);
console.log(`mie=0x${cpu.csr[0x304].toString(16)} mip=0x${cpu.csr[0x344].toString(16)} scause=0x${(cpu.csr[0x142] >>> 0).toString(16)} sepc=0x${(cpu.csr[0x141] >>> 0).toString(16)} stval=0x${(cpu.csr[0x143] >>> 0).toString(16)}`);
if (cpu.trap) console.log('core trap:', JSON.stringify(cpu.trap));
const hist = {};
for (let i = 0; i < 200000 && !cpu.halted; i++) { hist[cpu.pc >>> 0] = (hist[cpu.pc >>> 0] || 0) + 1; m.step(); }
console.log('hottest PCs:', Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, c]) => `0x${(+p).toString(16)}:${c}`).join(' '));
process.exit(1);
