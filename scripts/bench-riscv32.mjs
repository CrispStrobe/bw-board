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

const W = await import(pathToFileURL(resolve(here, 'riscv-bench/workloads.mjs')).href);

function benchDir() {
    const dir = process.env.RV_BENCH_DIR;
    if (!dir) throw new Error('RV_BENCH_DIR not set (build it with scripts/riscv-bench/build.sh DIR)');
    return dir;
}
const runElf = name => W.runBareElf(RiscV32Machine, new Uint8Array(readFileSync(join(benchDir(), `${name}-ecall.elf`))));
async function runAlu(clint) {
    const {assembleRiscv} = await import(pathToFileURL(resolve(here, '../src/riscv-asm.js')).href);
    return W.runAlu(RiscV32Machine, assembleRiscv, {clint});
}
async function runXv6() {
    const kpath = process.env.XV6_KERNEL, fpath = process.env.XV6_FS;
    if (!kpath || !fpath) throw new Error('XV6_KERNEL / XV6_FS not set');
    return W.runXv6(RiscV32Machine, new Uint8Array(readFileSync(kpath)), new Uint8Array(readFileSync(fpath)));
}

async function runLinuxBench() {
    const k = process.env.LINUX_IMAGE, i = process.env.LINUX_INITRD;
    if (!k || !i) throw new Error('LINUX_IMAGE / LINUX_INITRD not set (test/linux-riscv/build.sh)');
    const {bootLinux} = await import(pathToFileURL(join(SRC, 'riscv32-linux.js')).href);
    return W.runLinux(RiscV32Machine, bootLinux, new Uint8Array(readFileSync(k)), new Uint8Array(readFileSync(i)));
}

let r;
switch (workload) {
    case 'alu': r = await runAlu(true); break;
    case 'alu-noclint': r = await runAlu(false); break;
    case 'coremark': r = runElf('coremark'); break;
    case 'dhrystone': r = runElf('dhrystone'); break;
    case 'xv6': r = await runXv6(); break;
    case 'linux': r = await runLinuxBench(); break;
    default: console.error('usage: bench-riscv32.mjs <alu|alu-noclint|coremark|dhrystone|xv6|linux> [--src DIR] [--json]'); process.exit(2);
}
r.mips = r.instructions / r.seconds / 1e6;
if (JSON_OUT) console.log(JSON.stringify({workload, ...r, output: undefined}));
else {
    if (r.output) process.stdout.write(r.output.slice(-600));
    console.log(`${workload}: ${r.instructions} instructions in ${r.seconds.toFixed(2)} s = ${r.mips.toFixed(2)} MIPS`);
}
