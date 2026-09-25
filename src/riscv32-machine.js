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
import {createVirtioBlk} from './riscv32-virtio-blk.js';

const MASK = size => size - 1;
const IRQ_SSIP = 1 << 1, IRQ_STIP = 1 << 5, IRQ_MTIP = 1 << 7;
const SBI_EXT_BASE = 0x10, SBI_EXT_TIME = 0x54494D45, SBI_EXT_IPI = 0x735049, SBI_EXT_RFENCE = 0x52464E43,
    SBI_EXT_HSM = 0x48534D, SBI_EXT_SRST = 0x53525354, SBI_EXT_DBCN = 0x4442434E;
const SBI_EXTENSIONS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, SBI_EXT_BASE, SBI_EXT_TIME, SBI_EXT_IPI,
    SBI_EXT_RFENCE, SBI_EXT_HSM, SBI_EXT_SRST, SBI_EXT_DBCN]);
const SBI_ERR_NOT_SUPPORTED = -2, SBI_ERR_INVALID_PARAM = -3, SBI_ERR_ALREADY_AVAILABLE = -6;

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
        this._rxQueue = [];            // legacy SBI getchar input
        this._sbiTimer = false;        // SBI set_timer armed: forward MTIP to STIP
        this.idleSkipped = 0;          // mtime ticks skipped by WFI idle skips
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
        this._firmwareInit();
        // A CLINT (timer + software interrupt) so an RTOS gets its tick. It maps
        // outside any sane program's RAM footprint, so it's inert for the
        // bare-metal ecall programs that never touch it. Opt out with clint:false.
        if (config.clint !== false) {
            this.clint = createClint(this.cpu, {base: config.clintBase});
            this.cpu.io.push(this.clint);
            this.cpu.timeSource = () => this.clint.mtime;   // the `time` CSR reads mtime
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
        // A legacy virtio-mmio block device (default 0x10001000) backed by
        // `config.virtioDisk` — the root disk a kernel (xv6) mounts. Its
        // completion interrupt raises PLIC source `virtioIrq` (default 1). Given
        // only when a disk image is supplied.
        if (config.virtioDisk && this.plic) {
            const virtioIrq = config.virtioIrq ?? 1;
            this.virtio = createVirtioBlk(this.cpu, {
                base: config.virtioBase, disk: config.virtioDisk,
                setIrq: on => this.plic.setPending(virtioIrq, on)
            });
            this.cpu.io.push(this.virtio);
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

    /** The M-mode SBI firmware an S-mode kernel calls via ecall — an
     *  in-emulator stand-in for OpenSBI. SBI v0.3 BASE (with an honest
     *  probe_extension), TIME, IPI, RFENCE, HSM, SRST and DBCN, plus the legacy
     *  v0.1 calls (set_timer, console putchar/getchar, IPI, fences, shutdown).
     *  Return convention: a0 = error (0 = SBI_SUCCESS), a1 = value. */
    _sbi(c) {
        const eid = c.x[17] >>> 0, fid = c.x[16] >>> 0;   // a7 = extension, a6 = function
        const a0 = c.x[10] >>> 0, a1 = c.x[11] >>> 0;
        const ok = (v = 0) => { c.x[10] = 0; c.x[11] = v | 0; };
        const err = e => { c.x[10] = e | 0; c.x[11] = 0; };
        switch (eid) {
            case 0x00: this._sbiSetTimer(a0, a1); c.x[10] = 0; return;           // legacy set_timer
            case 0x01: this._emit(String.fromCharCode(a0 & 0xff)); c.x[10] = 0; return;   // legacy putchar
            case 0x02: c.x[10] = this._rxQueue.length ? this._rxQueue.shift() : -1; return;   // legacy getchar
            case 0x03: c.setInterruptPending(IRQ_SSIP, false); c.x[10] = 0; return;            // legacy clear_ipi
            case 0x04: c.setInterruptPending(IRQ_SSIP, true); c.x[10] = 0; return;             // legacy send_ipi (self)
            case 0x05: case 0x06: case 0x07: c._tlbFlush && c._tlbFlush(); c.x[10] = 0; return; // legacy fences
            case 0x08: this.exitCode = 0; c.halted = true; return;              // legacy shutdown
            case SBI_EXT_BASE:
                switch (fid) {
                    case 0: return ok(0x3);                                     // spec v0.3 (adds SRST)
                    case 1: return ok(0x62776273);                              // impl id ('bwbs')
                    case 2: return ok(1);                                       // impl version
                    case 3: return ok(SBI_EXTENSIONS.has(a0) ? 1 : 0);          // probe_extension
                    case 4: case 5: case 6: return ok(0);                       // mvendorid / marchid / mimpid
                    default: return err(SBI_ERR_NOT_SUPPORTED);
                }
            case SBI_EXT_TIME:
                if (fid === 0) { this._sbiSetTimer(a0, a1); return ok(); }
                return err(SBI_ERR_NOT_SUPPORTED);
            case SBI_EXT_IPI:                                                   // one hart: an IPI to ourselves
                if (fid === 0) { if (this._hartSelected(a0, a1)) c.setInterruptPending(IRQ_SSIP, true); return ok(); }
                return err(SBI_ERR_NOT_SUPPORTED);
            case SBI_EXT_RFENCE:                                                // fence.i / sfence.vma (any range): flush
                if (fid <= 6) { if (c._tlbFlush) c._tlbFlush(); return ok(); }
                return err(SBI_ERR_NOT_SUPPORTED);
            case SBI_EXT_HSM:
                if (fid === 2) return a0 === 0 ? ok(0) : err(SBI_ERR_INVALID_PARAM);   // hart_get_status: started
                if (fid === 0) return err(a0 === 0 ? SBI_ERR_ALREADY_AVAILABLE : SBI_ERR_INVALID_PARAM);
                return err(SBI_ERR_NOT_SUPPORTED);
            case SBI_EXT_SRST: this.exitCode = a1 | 0; c.halted = true; return ok();   // reset: halt
            case SBI_EXT_DBCN:
                if (fid === 2) { this._emit(String.fromCharCode(a0 & 0xff)); return ok(); }   // write_byte
                if (fid === 0) {                                                // write(num, base_lo)
                    let s = '';
                    for (let i = 0; i < a0; i++) s += String.fromCharCode(c.ld8((a1 + i) >>> 0) & 0xff);
                    this._emit(s); return ok(a0);
                }
                return ok(0);                                                   // read: nothing
            default: return err(SBI_ERR_NOT_SUPPORTED);
        }
    }

    /** IPI hart mask (hart_mask, hart_mask_base): is hart 0 selected? */
    _hartSelected(mask, maskBase) { return (maskBase >>> 0) === 0xffffffff || (maskBase === 0 && (mask & 1)); }

    /** SBI set_timer: program mtimecmp and, like OpenSBI, forward the machine
     *  timer to the supervisor — STIP is cleared now and raised by
     *  _clintEvent() when mtime reaches the new compare value. */
    _sbiSetTimer(lo, hi) {
        const c = this.cpu;
        c.setInterruptPending(IRQ_STIP, false);
        if (!this.clint) return;
        this._sbiTimer = true;
        this.clint.store32(0x4004, 0xffffffff);          // no transient match while the halves change
        this.clint.store32(0x4000, lo >>> 0);
        this.clint.store32(0x4004, hi >>> 0);
        this._clintEvent();
    }

    /** The CLINT reached its deadline (or was written): re-derive its lines, and
     *  if the SBI timer is armed and MTIP is now up, raise STIP (once). */
    _clintEvent() {
        this.clint.sync();
        if (this._sbiTimer && (this.cpu.csr[0x344] & IRQ_MTIP)) {
            this._sbiTimer = false;
            this.cpu.setInterruptPending(IRQ_STIP, true);
        }
    }

    /** WFI with nothing pending and enabled: jump mtime to the timer deadline
     *  instead of spinning the idle loop through it (an idle skip). mtime then
     *  runs ahead of the retired-instruction count by the time skipped. */
    _idleSkip() {
        const c = this.cpu, cl = this.clint;
        if (!cl || (c.csr[0x344] & c.csr[0x304]) !== 0 || cl.deadline === Infinity) return;
        const d = cl.deadline - c.instret;
        if (d > 0) { cl.tick(d); this.idleSkipped += d; }
        this._clintEvent();
    }

    /** Load bytes into RAM at physical address `base` (default the RAM base):
     *  translated to a flat index by subtracting `ramBase`. */
    load(bytes, base = this.ramBase) { this.mem.set(bytes, ((base >>> 0) - this.ramBase) >>> 0); }

    /**
     * Boot a linked `{entry, segments}` image the way an OS would hand a program
     * control: place each segment, set pc = entry, and give it a valid stack —
     * `sp` near the top of RAM with `argc`/`argv` (= 0) laid out where a
     * Linux-style `_start` reads them. shecc emits exactly that ABI and does NOT
     * set its own sp, so without this it would run with sp = 0; a program that
     * sets its own sp (a picolibc/newlib crt0, an RTOS) simply overwrites it, so
     * doing this unconditionally is safe for every image. `entrySp` overrides
     * the stack top when a caller wants a specific layout.
     */
    loadImage(image, entrySp) {
        for (const {addr, bytes} of image.segments) this.load(bytes, addr);
        this.cpu.pc = (image.entry >>> 0);
        const sp = ((entrySp ?? (this.ramBase + this.memSize - 16)) >>> 0);
        this.cpu.x[2] = sp | 0;                                   // sp
        // argc = 0, argv = NULL, envp = NULL where _start expects them.
        for (let i = 0; i < 16; i++) this.mem[(sp + i - this.ramBase) & MASK(this.memSize)] = 0;
        return this;
    }

    /** Firmware-set state a supervisor kernel expects at hand-off: hardware
     *  A/D updates (menvcfg.ADUE, Svadu) — what OpenSBI enables when the hart
     *  has Svadu, and what xv6 (which never sets A/D itself) relies on. */
    _firmwareInit() { this.cpu.csr[0x31a] |= 1 << 29; }

    reset() {
        const t = this.clint ? this.clint.mtime : 0;
        this.cpu.reset();
        if (this.clint) this.clint.rebase(t);            // mtime is continuous across a reset
        this._firmwareInit(); this.output = ''; this.exitCode = null;
    }

    /** One instruction; returns instructions retired (0 when halted). Advances
     *  the CLINT's mtime so a scheduled timer interrupt eventually fires. */
    step() {
        const cpu = this.cpu, r = cpu.step();
        if (this.clint) {
            if (cpu.instret >= this.clint.deadline) this._clintEvent();
            if (cpu.waiting) { cpu.waiting = false; this._idleSkip(); }
        }
        return r;
    }

    /** Run until halt or `max` instructions; returns instructions executed. */
    run(max = 10_000_000) {
        const cpu = this.cpu, clint = this.clint;
        let n = 0;
        if (!clint) { while (!cpu.halted && n++ < max) cpu.step(); return n; }
        while (!cpu.halted && n++ < max) {
            cpu.step();
            if (cpu.instret >= clint.deadline) this._clintEvent();
            if (cpu.waiting) { cpu.waiting = false; this._idleSkip(); }
        }
        return n;
    }

    /** True once the program exited (via the exit syscall) or trapped. */
    get halted() { return this.cpu.halted; }
}

export default RiscV32Machine;
