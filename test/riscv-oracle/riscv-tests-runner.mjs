// Run a riscv-tests ISA binary (p or v environment) on our RiscV32 core.
//
// The tests report through HTIF `tohost` (a 64-bit word in RAM): a terminate is
// (code << 1) | 1 — code 0 passes, else it names the failing TESTNUM — and the v
// environment prints through device 1 / command 1 (putchar). Only the tohost
// word is intercepted, as an MMIO device over its 8 bytes; everything else is
// plain RAM at 0x80000000, the address Spike's memory also starts at.
//
// The core is built bare: no CLINT/PLIC/UART (the tests never touch them, and
// Spike's own devices sit elsewhere), ECALL traps for real in every mode (the
// tests' trap vector handles it), and no SBI firmware hook.

import {RiscV32} from '../../src/riscv32.js';
import {elfSegments, elfSymbols} from './elf32.mjs';

export const RAM_BASE = 0x80000000;

/** A program to run: an ELF, or the {entry, segments, symbols} a fixture holds. */
export function toProgram(p) {
    if (p instanceof Uint8Array) {
        const {entry, segments} = elfSegments(p);
        return {entry, segments, symbols: elfSymbols(p)};
    }
    return {
        entry: p.entry,
        segments: p.segments.map(s => {
            const bytes = new Uint8Array(s.size);
            bytes.set(Buffer.from(s.b64, 'base64'));
            return {addr: s.addr, bytes};
        }),
        symbols: new Map(Object.entries(p.symbols)),
    };
}

/**
 * @param {Uint8Array|object} program an ELF or a fixture program
 * @param {{maxSteps?: number, memSize?: number, onStep?: (cpu: RiscV32) => void}} [opts]
 */
export function makeTestCpu(program, opts = {}) {
    const {entry, segments, symbols: syms} = toProgram(program);
    const tohostAddr = syms.get('tohost');
    if (tohostAddr === undefined) throw new Error('no tohost symbol');
    const state = {done: false, code: null, console: '', pending: false};
    let lo = 0, hi = 0;
    const tohost = {
        base: tohostAddr, size: 8,
        load32(off) { return off === 0 ? lo : hi; },
        store32(off, v) {
            if (off === 0) { lo = v >>> 0; state.pending = (lo & 1) === 1; return; }
            hi = v >>> 0;
            if (hi === 0 && (lo & 1)) { state.done = true; state.code = lo >>> 1; return; }
            if ((hi >>> 24) === 1 && ((hi >>> 16) & 0xff) === 1) {       // device 1, cmd 1: putchar
                state.console += String.fromCharCode(lo & 0xff);
                lo = 0; hi = 0;                                           // host consumed it
            }
        }
    };
    const mem = new Uint8Array(opts.memSize ?? (1 << 23));
    for (const {addr, bytes} of segments) mem.set(bytes, (addr - RAM_BASE) >>> 0);
    const cpu = new RiscV32(mem, {resetPc: entry, ramBase: RAM_BASE, ecallTraps: true, io: [tohost]});
    return {cpu, state, syms};
}

export function runRiscvTest(program, opts = {}) {
    const {cpu, state} = makeTestCpu(program, opts);
    const max = opts.maxSteps ?? 2_000_000;
    let steps = 0;
    while (!state.done && !cpu.halted && steps < max) {
        if (opts.onStep) opts.onStep(cpu);
        cpu.step();
        steps++;
    }
    const result = state.done ? (state.code === 0 ? 'pass' : 'fail') : cpu.halted ? 'halted' : 'timeout';
    return {result, code: state.code, steps, trap: cpu.trap, pc: cpu.pc >>> 0, console: state.console};
}

/** Run a riscv-arch-test ELF to its halt and return its signature: the 32-bit
 *  words from begin_signature to end_signature, as lowercase 8-digit hex lines
 *  (Spike's `+signature-granularity=4` format). */
export function runArchTest(program, opts = {}) {
    const {cpu, state, syms} = makeTestCpu(program, {memSize: 1 << 23, ...opts});
    const max = opts.maxSteps ?? 5_000_000;
    let steps = 0;
    while (!state.done && !cpu.halted && steps < max) { cpu.step(); steps++; }
    const b = syms.get('begin_signature'), e = syms.get('end_signature');
    const words = [];
    for (let a = b; a < e; a += 4) words.push((cpu.ld32(a) >>> 0).toString(16).padStart(8, '0'));
    return {done: state.done, halted: cpu.halted, trap: cpu.trap, steps, signature: words.join('\n') + '\n'};
}
