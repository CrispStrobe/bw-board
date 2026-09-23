// Boot the xv6-rv32 kernel on RiscV32Machine and run it to the shell prompt.
//
// xv6-riscv (michaelengel/xv6-rv32) is self-contained (M-mode start-up, then
// mret to S-mode) and uses exactly our SoC: M/S/U + Sv32 + RVC + CLINT + PLIC
// (supervisor context) + NS16550 UART + a legacy virtio-mmio block disk. It
// links at RAM base 0x80000000. So it boots on our machine with no toolchain at
// run time — only the build (kernel + fs.img) is heavy, which is why this runs
// on a fresh CI runner (the dev box is too contended for the ~10^9-instruction
// boot). On reaching the `$` prompt it prints PASS; otherwise it dumps exactly
// where it stalled (privilege, satp, mip/mie, disk-request count, hot PC).
//
// Usage: node boot.mjs <kernel.elf> <fs.img> [budgetInstr] [wallSeconds]

import {readFileSync} from 'node:fs';
import {RiscV32Machine} from '../../src/riscv32-machine.js';
import {loadElfInto} from '../../scripts/riscv-elf.mjs';

const [kernelPath, fsPath, budgetArg, wallArg] = process.argv.slice(2);
if (!kernelPath || !fsPath) { console.error('usage: node boot.mjs <kernel.elf> <fs.img> [budget] [wallSeconds]'); process.exit(2); }
const BUDGET = Number(budgetArg || 2_000_000_000);
const WALL_MS = Number(wallArg || 600) * 1000;

let out = '';
let notifies = 0;
const m = new RiscV32Machine(
    {memSize: 1 << 24, ramBase: 0x80000000, uartIrq: 10, virtioIrq: 1, virtioDisk: new Uint8Array(readFileSync(fsPath))},
    {onSerial: b => { const c = String.fromCharCode(b); out += c; process.stdout.write(c); }});
loadElfInto(m, new Uint8Array(readFileSync(kernelPath)));
// count disk requests (QUEUE_NOTIFY writes) to tell "blocked on disk" from "never got there"
if (m.virtio) { const vo = m.virtio.store32.bind(m.virtio); m.virtio.store32 = (o, v) => { if (o === 0x50) notifies++; return vo(o, v); }; }

const cpu = m.cpu;
const start = Date.now();
let steps = 0, reached = false;
const CHUNK = 5_000_000;
while (!cpu.halted && steps < BUDGET && (Date.now() - start) < WALL_MS) {
    for (let i = 0; i < CHUNK && !cpu.halted; i++) { m.step(); steps++; }
    if (/\$ $|\$ |init: starting sh/.test(out)) { reached = true; break; }
}

console.log('\n\n=== xv6 boot summary ===');
console.log(`steps=${steps} halted=${cpu.halted} wall=${((Date.now() - start) / 1000) | 0}s reached_shell=${reached}`);
if (reached) { console.log('PASS: xv6 booted to the shell.'); process.exit(0); }
// Diagnostics if it did not reach the shell.
console.log(`priv=${cpu.priv} satp=0x${(cpu.csr[0x180] >>> 0).toString(16)} mstatus=0x${(cpu.csr[0x300] >>> 0).toString(16)}`);
console.log(`mie=0x${(cpu.csr[0x304] >>> 0).toString(16)} mip=0x${(cpu.csr[0x344] >>> 0).toString(16)} mideleg=0x${(cpu.csr[0x303] >>> 0).toString(16)} medeleg=0x${(cpu.csr[0x302] >>> 0).toString(16)}`);
console.log(`disk QUEUE_NOTIFY count=${notifies}`);
const hist = {};
for (let i = 0; i < 200000; i++) { hist[cpu.pc >>> 0] = (hist[cpu.pc >>> 0] || 0) + 1; m.step(); }
const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, c]) => `0x${(+p).toString(16)}:${c}`);
console.log('hottest PCs:', top.join(' '));
process.exit(1);
