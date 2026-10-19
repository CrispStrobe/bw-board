#!/usr/bin/env node
/**
 * Run a RISC-V program on the RV32IMA core — the RISC-V twin of run-dos.mjs.
 *
 *   node scripts/run-riscv32.mjs prog.o            # run a clang riscv32 object
 *   node scripts/run-riscv32.mjs prog.c            # compile it first (needs clang)
 *
 * A `.c` is compiled with the freestanding, no-pic, no-relax flags the loader
 * expects; a `.o` (or `.elf`) is loaded as-is. The program talks to the world
 * through the RiscV32Machine ecall ABI (a7=64 write, a7=93 exit), so it needs a
 * tiny `_start` that makes those calls — no libc, no linker.
 *
 * There is no RISC-V linker on this box (ld.lld is absent); scripts/riscv-elf.mjs
 * places sections and applies the object's relocations itself. That covers a
 * single freestanding object — enough to run clang output end to end.
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {loadElfInto} from './riscv-elf.mjs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const maxSteps = Number((args.find(a => a.startsWith('--max=')) || '').slice(6)) || 50_000_000;
if (!file) { console.error('usage: node scripts/run-riscv32.mjs <prog.c|prog.o> [--max=N]'); process.exit(2); }

let objBytes;
if (file.endsWith('.c')) {
    const out = join(tmpdir(), `rv32-${process.pid}.o`);
    execFileSync('clang', ['--target=riscv32', '-march=rv32im', '-O2', '-nostdlib',
        '-ffreestanding', '-fno-pic', '-mno-relax', '-c', '-o', out, file], {stdio: 'inherit'});
    objBytes = new Uint8Array(readFileSync(out));
} else {
    objBytes = new Uint8Array(readFileSync(file));
}

let out = '';
const m = new RiscV32Machine({}, {onSerial: b => { out += String.fromCharCode(b); process.stdout.write(String.fromCharCode(b)); }});
const {entry} = loadElfInto(m, objBytes);
const ran = m.run(maxSteps);

process.stderr.write(`\n[riscv32: entry=0x${entry.toString(16)}, ${ran} instructions, ` +
    `${m.halted ? (m.exitCode != null ? `exit ${m.exitCode}` : 'trapped') : 'step budget exhausted'}]\n`);
process.exit(m.exitCode || 0);
