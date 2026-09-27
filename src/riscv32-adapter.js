/**
 * The RISC-V debug adapter — the thin wrapper the debug-target factory builds
 * around a {@link RiscV32Machine}, in the shape of z80-adapter / m6502-adapter
 * but stripped to what a console-only bench needs: this machine has no pin
 * boundary and no board, so `attachBoard` is a time-sync stub (the same stance
 * the z80 and 6502 console shapes take). Its I/O is the machine's `ecall` ABI,
 * surfaced through `onSerial`, so the app's console face reads its output the
 * way it reads any serial machine.
 *
 * The factory wraps this adapter in riscv32-debug.js's DebugTarget (run/pause/
 * instruction step/registers/memory), so a host's debug session can drive it.
 * With the `linux` option it boots a Linux kernel instead of a program image
 * and its console input reaches the 16550A (riscv32-linux-session.js).
 *
 * @module
 */
import {RiscV32Machine} from './riscv32-machine.js';
import {createRiscvLinuxMachine, createLinuxBootProgress, LINUX_NS_PER_TICK} from './riscv32-linux-session.js';

// A console C program (the compile routes' output) wants more room than a bare
// demo: picolibc's malloc heap, a real stack, and headroom between them. 8 MiB
// is generous for a learner's program and cheap to allocate; a caller can still
// pass its own `config.memSize` (an OS image at the qemu `virt` base does).
const DEFAULT_RISCV_MEM = 8 * 1024 * 1024;

// The `linux` option's time-slicing. A frame's advanceNs(deltaNs) spends CPU
// only while the kernel has work: it runs in CHUNK-instruction pieces and stops
// either when the wall allowance is spent (a busy boot: fast-forward, bounded
// so the UI keeps painting) or once the kernel has IDLED through deltaNs of its
// own time (the WFI idle skip jumps mtime to the next timer deadline, so an
// idle shell advances with real time and costs almost nothing).
const LINUX_CHUNK = 5_000;
const LINUX_WALL_MS = 10;
const LINUX_MAX_INSTR_PER_ADVANCE = 8_000_000;
const wallNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * @param {{image?: {segments: {addr:number,bytes:Uint8Array}[], entry:number},
 *          config?: object,
 *          linux?: {kernel: Uint8Array, initrd?: Uint8Array, bootargs?: string,
 *                   wallMs?: number, maxInstructionsPerAdvance?: number, now?: () => number}}} [opts]
 *   `linux`: boot a Linux kernel (+ initramfs) instead of a program image —
 *   the bytes must already be sha256-verified (riscv32-linux-session.js
 *   verifyLinuxMedia). The machine is the 64 MiB `virt`-style one the kernel
 *   expects; console input goes to the 16550A's receive FIFO.
 */
export function createRiscV32Adapter(opts = {}) {
    let serialListener = null;
    const stats = {serialCount: 0, stepCount: 0};
    const linux = opts.linux || null;
    let progress = null;
    const onSerial = b => {
        stats.serialCount++;
        if (progress) progress.feed(b);
        if (serialListener) serialListener(b & 0xff);
    };
    const buildLinux = () => {
        progress = createLinuxBootProgress();
        return createRiscvLinuxMachine({kernel: linux.kernel, initrd: linux.initrd, bootargs: linux.bootargs, onSerial}).machine;
    };
    let machine = linux ? buildLinux()
        : new RiscV32Machine({memSize: DEFAULT_RISCV_MEM, ...(opts.config || {})}, {onSerial});

    // Boot a linked program image (segments + entry) if one was given — with a
    // proper stack + argc/argv, so a Linux-ABI image (shecc) starts correctly
    // rather than relying on address wraparound from sp = 0.
    if (opts.image && Array.isArray(opts.image.segments) && typeof opts.image.entry === 'number') {
        machine.loadImage(opts.image);
    }

    let tNs = 0;
    const now = (linux && linux.now) || wallNow;
    const wallMs = (linux && linux.wallMs) ?? LINUX_WALL_MS;
    const maxPerAdvance = (linux && linux.maxInstructionsPerAdvance) ?? LINUX_MAX_INSTR_PER_ADVANCE;

    /** One host frame of a Linux machine: see LINUX_CHUNK above. */
    function advanceLinux(deltaNs) {
        const idleTarget = Math.max(1, Math.round(deltaNs / LINUX_NS_PER_TICK));
        const idle0 = machine.idleSkipped;
        const r0 = machine.cpu.retired;
        const deadline = now() + wallMs;
        while (!machine.halted) {
            stats.stepCount += machine.run(LINUX_CHUNK);
            if (machine.idleSkipped - idle0 >= idleTarget) break;
            if (machine.cpu.retired - r0 >= maxPerAdvance) break;
            if (now() >= deadline) break;
        }
    }

    return {
        /** The live machine. A getter, because a Linux reset REBOOTS: it
         *  builds a fresh machine rather than resetting the CPU into a RAM
         *  image the kernel has already rewritten. */
        get machine() { return machine; },
        kind: 'riscv32',
        /** 'linux' when booted with the linux option, else 'program'. */
        mode: linux ? 'linux' : 'program',

        load(bytes, at) { machine.load(bytes, at); },

        // No pins to publish; a time-sync stub suffices (z80/6502 stance).
        attachBoard() { /* console-only bench: nothing to wire */ },

        /** The serial console face: listen for the ecall ABI's output bytes. */
        onSerial(cb) { serialListener = cb; },

        /**
         * Console input: a byte into the NS16550A's receive FIFO, which raises
         * its PLIC line — the path a Linux tty (or any UART-driven program)
         * reads. Returns false when the machine was built without a UART.
         */
        sendSerial(byte) {
            if (!machine.uart) return false;
            machine.uart.rxPush(byte & 0xff);
            return true;
        },

        /** Linux boot progress {phase, percent, ready}, or null for a program. */
        linuxProgress() {
            return progress ? progress.state(machine.cpu.retired) : null;
        },

        exited() { return machine.halted; },
        exitCode() { return machine.exitCode; },

        step() { stats.stepCount++; return machine.step(); },

        /** Advance ~deltaNs of work. RISC-V here has no fixed clock, so this
         *  approximates one instruction per ns, bounded, and stops on halt. */
        advanceNs(deltaNs) {
            if (linux) { advanceLinux(deltaNs); tNs += deltaNs; return; }
            const budget = Math.max(1, Math.min(2_000_000, Math.round(deltaNs)));
            let n = 0;
            while (!machine.halted && n++ < budget) { machine.step(); stats.stepCount++; }
            tNs += deltaNs;
        },

        timeNs() { return BigInt(Math.round(tNs)); },

        reset() {
            if (linux) machine = buildLinux();
            else machine.reset();
            tNs = 0;
        },

        stats
    };
}

export default createRiscV32Adapter;
