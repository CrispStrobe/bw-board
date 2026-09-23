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
        // Base physical address of RAM (default 0). Set to 0x80000000 to boot
        // images linked at the standard riscv `virt` base (Zephyr qemu_riscv32,
        // xv6, Linux); `load()` and the CPU translate addresses to 0-based indices.
        this.ramBase = (config.ramBase ?? 0) >>> 0;
        this.hooks = hooks;
        this.output = '';
        this.exitCode = null;
        this.cpu = new RiscV32(this.mem, {
            resetPc: config.resetPc || 0,
            ecall: c => this._syscall(c),
            // RTOS images (FreeRTOS) yield via ecall and install their own trap
            // handler: turn ECALL into a real M-mode exception rather than the
            // Linux write/exit ABI. Default off — bare ecall programs are unchanged.
            ecallTraps: config.ecallTraps === true,
            ramBase: this.ramBase,
            // The machine also acts as the M-mode SBI firmware (an OpenSBI-lite)
            // for a supervisor kernel: an S-mode ecall is serviced here (console,
            // timer, shutdown) instead of trapping. Inert for M-mode programs,
            // which never take the SBI path.
            sbi: c => this._sbi(c)
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

    /** The M-mode SBI firmware an S-mode kernel calls via ecall. Supports the
     *  legacy console/timer/shutdown extensions and SBI v0.2 DBCN (debug console)
     *  and SRST (reset) — enough for a supervisor kernel to print and stop. The
     *  SBI return convention is a0 = error, a1 = value (0 = SBI_SUCCESS). */
    _sbi(c) {
        const eid = c.x[17] >>> 0, fid = c.x[16] >>> 0;   // a7 = extension, a6 = function
        if (eid === 1) {                                  // legacy console_putchar
            this._emit(String.fromCharCode(c.x[10] & 0xff));
            c.x[10] = 0;
        } else if (eid === 0x4442434E) {                  // DBCN — debug console
            if (fid === 2) {                              //   write_byte(a0)
                this._emit(String.fromCharCode(c.x[10] & 0xff)); c.x[10] = 0; c.x[11] = 0;
            } else if (fid === 0) {                       //   write(num=a0, base_lo=a1)
                const len = c.x[10] >>> 0, addr = c.x[11] >>> 0;
                let s = '';
                for (let i = 0; i < len; i++) s += String.fromCharCode(c.ld8((addr + i) >>> 0) & 0xff);
                this._emit(s); c.x[10] = 0; c.x[11] = len;
            } else { c.x[10] = 0; c.x[11] = 0; }          //   read: nothing pending
        } else if (eid === 8 || eid === 0x53525354) {     // legacy shutdown / SRST reset
            this.exitCode = 0; c.halted = true;
        } else if (eid === 0 || eid === 0x54494D45) {     // legacy set_timer / TIME set_timer
            c.st32(0x02004000, c.x[10] >>> 0);            // program CLINT mtimecmp (lo, hi)
            c.st32(0x02004004, c.x[11] >>> 0);
            c.setInterruptPending(1 << 5, false);         // clear the pending S-timer (STIP)
            c.x[10] = 0;
        } else if (eid === 0x10) {                        // BASE: probe/impl id — report present
            c.x[10] = 0; c.x[11] = fid === 0 ? 0x10000 : 1;
        } else {
            c.x[10] = -2 | 0;                             // SBI_ERR_NOT_SUPPORTED
        }
    }

    /** Load bytes into RAM at physical address `base` (default the RAM base):
     *  translated to a flat index by subtracting `ramBase`. */
    load(bytes, base = this.ramBase) { this.mem.set(bytes, ((base >>> 0) - this.ramBase) >>> 0); }

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
