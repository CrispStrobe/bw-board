/**
 * The composable 8086 machine — a CONFIG realized, the m6502-machine.js
 * shape with the two things an x86 breadboard has that a 6502 one does not.
 *
 * TWENTY-BIT MEMORY. A megabyte, not 64K, and every region address is a
 * physical one. The CPU's segments never appear here: seg:off resolution
 * happens inside the core, and the machine sees only what the address pins
 * carry.
 *
 * A SECOND DECODE SPACE. The 8086 has IN and OUT and a port address space
 * that shares no pins-decoded logic with memory, so a chip declares which
 * bus it sits on: `bus: 'io'` (the default, and where a breadboard normally
 * puts its 8255 and UART, because a 74138 on A0-A7 with M/IO is cheaper
 * than decoding twenty address lines) or `bus: 'mem'` for the memory-mapped
 * arrangement. Getting this wrong is silent: the program writes, nothing
 * moves, and the LED stays dark.
 *
 * Everything else is the house contract. Execution is instruction-stepped
 * (the vector-verified core), peripherals advance by each instruction's
 * cycle count, and only pin-level effects cross the boundary, in the same
 * {tMs, pin, level} shape every other device emits.
 *
 * INTERRUPT DELIVERY IS NOT HERE YET. The core deliberately does not
 * deliver INTR or NMI on its own; that is this layer's job, and it arrives
 * with the 8259 (ROADMAP E6.3) together with the IF check and the
 * one-instruction inhibition after a segment-register load. Until then a
 * HLT parks the machine and only time passes.
 *
 * @module
 */
import { I8086 } from './i8086.js';
import { I8255 } from './i8255.js';
import { NS16C550 } from './ns16c550.js';
import { MC6850 } from './mc6850.js';

/**
 * @typedef {object} MachineConfig
 * @property {number} clockHz CPU clock
 * @property {Array<{kind: 'ram'|'rom', start: number, end: number}>} regions
 *   inclusive PHYSICAL address ranges in the 1 MB space
 * @property {Array<{kind: 'ppi'|'uart16550'|'acia6850', name: string, at: number,
 *   bus?: 'io'|'mem', span?: number, xtal?: number, inputs?: object}>} chips
 *   `at` is a port address when bus is 'io' (the default) and a physical
 *   address when it is 'mem'. `span` widens the decoded window past the
 *   chip's register count — PARTIAL DECODE, the breadboard normal, where
 *   registers mirror through the window because the high address lines
 *   were never wired to the comparator.
 */

/** Registers each chip kind answers to; the window mirrors past it. */
const REGS = { ppi: 4, uart16550: 8, acia6850: 2 };

/**
 * The canonical 8086 breadboard preset — OURS, not a copy of anyone's.
 *
 * It is the arrangement these machines converge on because the parts make
 * them converge: RAM from zero (the interrupt vector table has to live at
 * 0000:0000 whether or not you use it), ROM at the top of the megabyte so
 * the reset fetch at FFFF:0000 lands in it, and I/O in the port space
 * behind a small decoder. slador.uk's 8088 machine and GREENSHELLRAGE's
 * 8086 both have this skeleton; neither was copied, and neither could be
 * (the first is a blog, the second carries no licence at all).
 *
 * 32K of ROM means the reset vector sits at F8000+7FF0. A monitor small
 * enough to read is the point, not a large one.
 */
export const BREADBOARD8086 = Object.freeze({
    clockHz: 5_000_000,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'ppi', name: 'ppi1', at: 0x00 },         // LEDs, switches, LCD
        { kind: 'uart16550', name: 'uart1', at: 0x10 },  // the terminal
    ],
});

export class I8086Machine {
    /**
     * @param {MachineConfig} [config]
     * @param {{ onPinChange?: (pin: string, level: 0|1, tMs: number) => void,
     *           onSerial?: (byte: number, tMs: number) => void }} [hooks]
     */
    constructor(config = BREADBOARD8086, hooks = {}) {
        this.config = config;
        this.hooks = hooks;
        this.clockHz = config.clockHz;
        this.mem = new Uint8Array(1 << 20);
        /** @type {Record<string, I8255|NS16C550|MC6850>} */
        this.chips = {};
        this.cycles = 0;
        this._pinLevels = {};
        /** Regions of the memory space, in declaration order. */
        this._mem = config.regions.map((r) => ({ ...r }));
        /** Decoded windows, split by which bus they answer on. */
        this._io = [];
        this._mmio = [];

        for (const c of config.chips || []) {
            const regs = REGS[c.kind];
            if (!regs) throw new Error(`machine config: unknown chip kind ${c.kind}`);
            const span = c.span || regs;
            if (span < regs) {
                throw new Error(`machine config: ${c.kind} span ${span} smaller than its ${regs} registers`);
            }
            let chip;
            if (c.kind === 'ppi') {
                chip = new I8255({
                    onPortChange: (port, value, out) => this._portChange(c.name, port, value, out),
                });
                if (c.inputs) {
                    for (const p of ['a', 'b', 'c']) {
                        if (c.inputs[p] != null) chip.setInputPort(p, c.inputs[p]);
                    }
                }
            } else if (c.kind === 'uart16550') {
                chip = new NS16C550({
                    onTx: (byte) => { if (this.hooks.onSerial) this.hooks.onSerial(byte, this.tMs); },
                    clockHz: c.xtal || config.clockHz,
                });
            } else {
                chip = new MC6850({
                    onTx: (byte) => { if (this.hooks.onSerial) this.hooks.onSerial(byte, this.tMs); },
                });
            }
            this.chips[c.name] = chip;
            const win = { name: c.name, chip, regs, start: c.at, end: c.at + span - 1 };
            ((c.bus ?? 'io') === 'io' ? this._io : this._mmio).push(win);
        }

        this.cpu = new I8086({
            read: (a) => this._read(a),
            write: (a, v) => this._write(a, v),
            in: (p) => this._in(p),
            out: (p, v) => this._out(p, v),
        });
    }

    /** Machine time in (fractional) milliseconds. */
    get tMs() { return this.cycles * 1000 / this.clockHz; }

    // ---- the memory bus -------------------------------------------------
    _read(addr) {
        for (const w of this._mmio) {
            if (addr >= w.start && addr <= w.end) return w.chip.read((addr - w.start) % w.regs);
        }
        for (const r of this._mem) if (addr >= r.start && addr <= r.end) return this.mem[addr];
        return 0xff;   // open bus reads high, like the undriven data lines
    }

    _write(addr, val) {
        for (const w of this._mmio) {
            if (addr >= w.start && addr <= w.end) { w.chip.write((addr - w.start) % w.regs, val); return; }
        }
        for (const r of this._mem) {
            if (addr < r.start || addr > r.end) continue;
            if (r.kind === 'rom') return;   // a write to ROM vanishes, as on the bench
            this.mem[addr] = val & 0xff;
            return;
        }
        // Unmapped: the write goes nowhere. Silently, exactly like the board.
    }

    // ---- the port bus ---------------------------------------------------
    _in(port) {
        for (const w of this._io) {
            if (port >= w.start && port <= w.end) return w.chip.read((port - w.start) % w.regs);
        }
        return 0xff;
    }

    _out(port, val) {
        for (const w of this._io) {
            if (port >= w.start && port <= w.end) { w.chip.write((port - w.start) % w.regs, val); return; }
        }
    }

    // ---- pins -----------------------------------------------------------
    /** @param {string} chipName @param {'a'|'b'|'c'} port @param {number} value @param {number} out */
    _portChange(chipName, port, value, out) {
        if (!this.hooks.onPinChange) return;
        for (let bit = 0; bit < 8; bit++) {
            const mask = 1 << bit;
            if (!(out & mask)) continue;    // only driven pins produce edges
            const pin = `${chipName}.P${port.toUpperCase()}${bit}`;
            const level = value & mask ? 1 : 0;
            if (this._pinLevels[pin] !== level) {
                this._pinLevels[pin] = level;
                this.hooks.onPinChange(pin, level, this.tMs);
            }
        }
    }

    // ---- loading and running --------------------------------------------
    /** Load a ROM image at a physical address (default: the first rom region). */
    loadRom(bytes, at) {
        const rom = this.config.regions.find((r) => r.kind === 'rom');
        const base = at ?? (rom ? rom.start : 0xf8000);
        this.mem.set(bytes, base);
        return base;
    }

    /**
     * Reset. The 8086 fetches its first instruction from FFFF:0000 —
     * physical FFFF0h, sixteen bytes below the top of the space, which is
     * why every ROM image for one of these ends in a far jump.
     */
    reset() {
        this.cpu.reset();
        this.cycles += 4;
        this._advanceChips(4);
    }

    /**
     * Attach a non-bus device that needs machine time. It gets
     * advance(cycles) with the chips but owns no addresses — its outputs
     * reach the CPU through chip inputs, like the bench.
     */
    attachDevice(name, dev) {
        this.devices = this.devices || {};
        this.devices[name] = dev;
        return dev;
    }

    _advanceChips(n) {
        for (const name of Object.keys(this.chips)) {
            const chip = this.chips[name];
            if (chip.advance) chip.advance(n);
        }
        if (this.devices) {
            for (const name of Object.keys(this.devices)) {
                const dev = this.devices[name];
                if (dev.advance) dev.advance(n);
            }
        }
    }

    /**
     * How far a halted CPU may jump in one step: the nearest time-driven
     * wake source, exactly the 6502 machine's WAI rule. A chip that
     * advances but cannot name a horizon vetoes the jump (n=1 crawl) — a
     * skipped event is a correctness bug, a crawl is only slow.
     */
    _wakeHorizon() {
        let h = Infinity;
        for (const c of Object.values(this.chips)) {
            if (!c || !c.advance) continue;
            if (typeof c.nextWake !== 'function') return 1;
            h = Math.min(h, c.nextWake());
        }
        if (this.devices) {
            for (const d of Object.values(this.devices)) {
                if (!d || !d.advance) continue;
                if (typeof d.nextWake !== 'function') return 1;
                h = Math.min(h, d.nextWake());
            }
        }
        if (!Number.isFinite(h)) h = Math.round(this.clockHz / 1000);   // re-check once per millisecond
        return Math.max(1, Math.min(h, Math.round(this.clockHz / 1000)));
    }

    /** Execute one instruction (or, while halted, let time pass). */
    step() {
        if (this.cpu.halted) {
            const n = this._wakeHorizon();
            this.cycles += n;
            this._advanceChips(n);
            return n;
        }
        const n = this.cpu.step();
        this.cycles += n;
        this._advanceChips(n);
        return n;
    }

    /** Run until machine time reaches targetMs — the adapter's verb. */
    advanceToMs(targetMs) {
        const target = Math.round(targetMs * this.clockHz / 1000);
        let steps = 0;
        while (this.cycles < target) { this.step(); steps++; }
        return steps;
    }

    /** Run for a slice of machine time. */
    runMs(ms) { return this.advanceToMs(this.tMs + ms); }

    /** Feed a byte to the first UART on the machine. */
    serialIn(byte) {
        for (const c of Object.values(this.chips)) {
            if (typeof c.rxPush === 'function') { c.rxPush(byte & 0xff); return true; }
            if (typeof c.rxByte === 'function') { c.rxByte(byte & 0xff); return true; }
        }
        return false;
    }

    /** CPU state keys to snapshot (same pattern as M6502Machine.CPU_STATE). */
    static CPU_STATE = ['ax', 'bx', 'cx', 'dx', 'sp', 'bp', 'si', 'di',
        'ip', 'cs', 'ds', 'es', 'ss', 'flags', 'halted'];

    saveState() {
        const cpu = {};
        for (const k of I8086Machine.CPU_STATE) cpu[k] = this.cpu[k] ?? 0;
        const chips = {};
        for (const [name, c] of Object.entries(this.chips)) {
            if (typeof c.getState === 'function') chips[name] = c.getState();
            else if (typeof c.saveState === 'function') chips[name] = c.saveState();
        }
        return { v: 1, cpu, cycles: this.cycles, mem: this.mem.slice(), chips };
    }

    loadState(s) {
        for (const k of I8086Machine.CPU_STATE) if (k in s.cpu) this.cpu[k] = s.cpu[k];
        this.cycles = s.cycles;
        this.mem.set(s.mem);
        for (const [name, cs] of Object.entries(s.chips || {})) {
            const c = this.chips[name];
            if (!c) continue;
            if (typeof c.setState === 'function') c.setState(cs);
            else if (typeof c.loadState === 'function') c.loadState(cs);
        }
    }
}

export default I8086Machine;
