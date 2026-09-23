/**
 * RiscV32Machine — the machine wrapper around {@link RiscV32}, in the shape of
 * z80-machine.js / m6502-machine.js: a flat RAM, the CPU, `load`/`reset`/`step`,
 * and a console. The console is a tiny **Linux-style `ecall` ABI** (a7 = syscall
 * number) so an ordinary newlib/picolibc program with a minimal syscall stub can
 * print and exit — the two calls a bare RISC-V program needs:
 *
 *   a7=64  write(fd=a0, buf=a1, len=a2)  → bytes to the console; returns len
 *   a7=93  exit(code=a0)                 → halts the machine
 *
 * (a7=64/93 is the riscv Linux convention; RARS/newlib and picolibc both use
 * it, so this runs their output unchanged.) Unknown syscalls are ignored, not
 * fatal, so a richer libc that calls fstat/brk/etc. keeps running.
 *
 * @module
 */
import {RiscV32} from './riscv32.js';
import {createClint} from './riscv32-clint.js';
import {createUart} from './riscv32-uart.js';
import {createPlic} from './riscv32-plic.js';

const MASK = size => size - 1;

export class RiscV32Machine {
    /**
     * @param {{memSize?: number, resetPc?: number}} [config]
     * @param {{onSerial?: (byte: number) => void}} [hooks]
     */
    constructor(config = {}, hooks = {}) {
        this.memSize = config.memSize || (1 << 20);   // 1 MiB, power of two
        this.mem = new Uint8Array(this.memSize);
        this.hooks = hooks;
        this.output = '';
        this.exitCode = null;
        this.cpu = new RiscV32(this.mem, {
            resetPc: config.resetPc || 0,
            ecall: c => this._syscall(c)
        });
        // A CLINT (timer + software interrupt) so an RTOS gets its tick. It maps
        // outside any sane program's RAM footprint, so it's inert for the
        // bare-metal ecall programs that never touch it. Opt out with clint:false.
        if (config.clint !== false) {
            this.clint = createClint(this.cpu, {base: config.clintBase});
            this.cpu.io.push(this.clint);
        }
        // A PLIC (external interrupts) so a device — the UART's receive line —
        // can trap the core via MEIP. The third of the standard CLINT+PLIC+UART.
        if (config.plic !== false) {
            this.plic = createPlic(this.cpu, {base: config.plicBase});
            this.cpu.io.push(this.plic);
        }
        // A memory-mapped NS16550 UART (default 0x10000000) so a program can
        // print without the ecall ABI — the way an RTOS driver does. Its RX line
        // raises PLIC source `uartIrq` (default 1). Opt out with uart:false.
        const uartIrq = config.uartIrq ?? 1;
        if (config.uart !== false) {
            this.uart = createUart({
                base: config.uartBase,
                onSerial: b => this._emit(String.fromCharCode(b)),
                onRx: this.plic ? (on => this.plic.setPending(uartIrq, on)) : undefined
            });
            this.cpu.io8.push(this.uart);
        }
    }

    _emit(s) {
        this.output += s;
        if (this.hooks.onSerial) for (const ch of s) this.hooks.onSerial(ch.charCodeAt(0) & 0xff);
    }

    _syscall(c) {
        const num = c.x[17] >>> 0;                    // a7
        if (num === 64) {                             // write(fd, buf, len)
            const buf = c.x[11] >>> 0, len = c.x[12] >>> 0;
            let s = '';
            for (let i = 0; i < len; i++) s += String.fromCharCode(this.mem[(buf + i) & MASK(this.memSize)]);
            this._emit(s);
            c.x[10] = len | 0;                        // return bytes written in a0
        } else if (num === 93 || num === 10) {        // exit / exit_group
            this.exitCode = c.x[10] | 0;
            c.halted = true;
        }
        // other syscalls: a no-op (a0 unchanged) so a fuller libc keeps going
    }

    /** Load bytes into RAM at `base` (default 0). */
    load(bytes, base = 0) { this.mem.set(bytes, base >>> 0); }

    reset() { this.cpu.reset(); this.output = ''; this.exitCode = null; }

    /** One instruction; returns instructions retired (0 when halted). Advances
     *  the CLINT's mtime so a scheduled timer interrupt eventually fires. */
    step() { const r = this.cpu.step(); if (this.clint && r) this.clint.tick(r); return r; }

    /** Run until halt or `max` instructions; returns instructions executed. */
    run(max = 10_000_000) { let n = 0; while (!this.cpu.halted && n++ < max) this.step(); return n; }

    /** True once the program exited (via the exit syscall) or trapped. */
    get halted() { return this.cpu.halted; }
}

export default RiscV32Machine;
