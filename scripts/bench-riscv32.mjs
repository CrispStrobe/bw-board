#!/usr/bin/env node
/**
 * RISC-V core throughput bench — one workload, one process, one reading.
 *
 *   node scripts/bench-riscv32.mjs <workload> [--src DIR] [--json]
 *
 * Workloads (instructions are retired instructions, cpu.retired):
 *   alu        a mixed ALU / load / store / mul loop (8 instructions per turn),
 *              30 M instructions after a 2 M warm-up, on the default machine
 *              (CLINT ticking) — `alu-noclint` runs it with no CLINT.
 *   coremark   CoreMark, 100 iterations (scripts/riscv-bench), to completion.
 *   dhrystone  Dhrystone, 200 000 runs (scripts/riscv-bench), to completion.
 *   xv6        xv6-rv32 boot to the `$ ` prompt (needs XV6_KERNEL / XV6_FS).
 *
 * The CoreMark/Dhrystone ELFs come from scripts/riscv-bench/build.sh (pinned
 * sources, fixed sizes; the *-ecall variant, RAM at 0x80000000, write/exit by
 * ecall); pass their directory as RV_BENCH_DIR. The same workloads in their
 * *-htif variant run on Spike, and the *-ecall one on rv32emu.
 *
 * --src DIR loads riscv32-machine.js (and so the whole core) from DIR instead
 * of this tree's src/ — how bench-riscv32-ab.mjs times two trees.
 *
 * Timing on a shared box lies: read a ratio against a reference measured in the
 * same session, and treat CI-runner numbers as the real ones.
 */
import {readFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const workload = args[0];
const srcIdx = args.indexOf('--src');
const SRC = srcIdx >= 0 ? resolve(args[srcIdx + 1]) : resolve(here, '../src');
const JSON_OUT = args.includes('--json');

const {RiscV32Machine} = await import(pathToFileURL(join(SRC, 'riscv32-machine.js')).href);

function runElf(name) {
    const dir = process.env.RV_BENCH_DIR;
    if (!dir) throw new Error('RV_BENCH_DIR not set (build it with scripts/riscv-bench/build.sh DIR)');
    const elf = new Uint8Array(readFileSync(join(dir, `${name}-ecall.elf`)));
    const m = new RiscV32Machine({memSize: 1 << 22, ramBase: 0x80000000});
    const dv = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
    const phoff = dv.getUint32(0x1c, true), phnum = dv.getUint16(0x2c, true), phentsize = dv.getUint16(0x2a, true);
    for (let i = 0; i < phnum; i++) {
        const p = phoff + i * phentsize;
        if (dv.getUint32(p, true) !== 1) continue;
        const off = dv.getUint32(p + 4, true), paddr = dv.getUint32(p + 12, true), filesz = dv.getUint32(p + 16, true);
        m.load(elf.subarray(off, off + filesz), paddr);
    }
    m.cpu.pc = dv.getUint32(0x18, true) >>> 0;
    const cpu = m.cpu;
    const t0 = process.hrtime.bigint();
    while (!cpu.halted) m.run(1_000_000);
    const s = Number(process.hrtime.bigint() - t0) / 1e9;
    return {instructions: cpu.retired, seconds: s, exit: m.exitCode, output: m.output};
}

async function runAlu(clint) {
    const {assembleRiscv} = await import(pathToFileURL(resolve(here, '../src/riscv-asm.js')).href);
    const img = assembleRiscv(`
      li t0, 0
      li t1, 0x8000
      li t2, 3
    loop:
      addi t0, t0, 1
      sw t0, 0(t1)
      lw a1, 0(t1)
      mul a2, a1, t2
      xor a3, a2, t0
      andi a4, a3, 255
      add a5, a4, a1
      j loop
    `, {textBase: 0, dataBase: 0x8000});
    const m = new RiscV32Machine({clint: clint ? undefined : false});
    m.loadImage(img.image);
    m.run(2_000_000);
    const i0 = m.cpu.retired, N = 30_000_000;
    const t0 = process.hrtime.bigint();
    m.run(N);
    const s = Number(process.hrtime.bigint() - t0) / 1e9;
    return {instructions: m.cpu.retired - i0, seconds: s};
}

async function runXv6() {
    const kpath = process.env.XV6_KERNEL, fpath = process.env.XV6_FS;
    if (!kpath || !fpath) throw new Error('XV6_KERNEL / XV6_FS not set');
    const {loadElfInto} = await import(pathToFileURL(resolve(here, 'riscv-elf.mjs')).href);
    let out = '';
    const m = new RiscV32Machine(
        {memSize: 1 << 24, ramBase: 0x80000000, uartIrq: 10, virtioIrq: 1, virtioDisk: new Uint8Array(readFileSync(fpath))},
        {onSerial: b => { out += String.fromCharCode(b); }});
    // loadElfInto (scripts/) sets pc on m.cpu — the core loaded from --src.
    loadElfInto(m, new Uint8Array(readFileSync(kpath)));
    const cpu = m.cpu;
    const t0 = process.hrtime.bigint();
    while (!cpu.halted && !/init: starting sh\n\$ /.test(out)) m.run(1_000_000);
    const s = Number(process.hrtime.bigint() - t0) / 1e9;
    return {instructions: cpu.retired, seconds: s, reached: /\$ /.test(out)};
}

let r;
switch (workload) {
    case 'alu': r = await runAlu(true); break;
    case 'alu-noclint': r = await runAlu(false); break;
    case 'coremark': r = runElf('coremark'); break;
    case 'dhrystone': r = runElf('dhrystone'); break;
    case 'xv6': r = await runXv6(); break;
    default: console.error('usage: bench-riscv32.mjs <alu|alu-noclint|coremark|dhrystone|xv6> [--src DIR] [--json]'); process.exit(2);
}
r.mips = r.instructions / r.seconds / 1e6;
if (JSON_OUT) console.log(JSON.stringify({workload, ...r, output: undefined}));
else {
    if (r.output) process.stdout.write(r.output.slice(-600));
    console.log(`${workload}: ${r.instructions} instructions in ${r.seconds.toFixed(2)} s = ${r.mips.toFixed(2)} MIPS`);
}
