/**
 * The composable 6502 machine — a CONFIG realized, not a fixed build.
 *
 * A machine is { clockHz, regions, chips }: RAM/ROM address ranges plus
 * peripheral chips (W65C22 VIA, W65C51 ACIA) at their decoded addresses.
 * The config can come from a preset (EATER6502 below), from MAP/CHIP
 * declarations in the pseudocode, or from the bus extractor solving a
 * hand-wired breadboard's glue logic — this class does not care which.
 * The bus stays inside: execution is instruction-stepped (the vector-
 * verified W65C02 core), peripherals advance by each instruction's cycle
 * count, and only pin-level effects (VIA ports, ACIA TX/RX) cross the
 * boundary, in the same {tMs, pin, level} shape every other device emits.
 *
 * IRQ wiring: every chip's IRQ output is open-drain onto the CPU's IRQB —
 * asserted if ANY chip asserts, exactly like the shared line on the bench.
 *
 * @module
 */
import { W65C02 } from './w65c02.js';
import { W65C22 } from './w65c22.js';
import { W65C51 } from './w65c51.js';
import { TMS9918 } from './tms9918.js';
import { NS16C550 } from './ns16c550.js';
import { Latch374 } from './latch374.js';

/**
 * @typedef {object} MachineConfig
 * @property {number} clockHz phi2 frequency
 * @property {Array<{kind: 'ram'|'rom', start: number, end: number}>} regions inclusive ranges
 * @property {Array<{kind: 'via'|'acia'|'uart16550'|'latch', name: string, at: number,
 *   xtal?: number, span?: number}>} chips
 *   base addresses; xtal overrides a uart16550's input clock (defaults to
 *   the machine clock — the KiT wiring — since a breadboard that gives the
 *   UART its own can states it explicitly). span widens the decoded window
 *   beyond the chip's register count — PARTIAL DECODE, the breadboard
 *   normal: registers mirror through the window (a latch on a bare
 *   A12-A14 match owns a whole $1000 like cool-web's $7xxx LED port).
 */

/** The canonical breadboard-computer preset: RAM low, VIA at $6000, ACIA at $5000, ROM high. */
export const EATER6502 = Object.freeze({
    clockHz: 1_000_000,
    regions: [
        { kind: 'ram', start: 0x0000, end: 0x3fff },
        { kind: 'rom', start: 0x8000, end: 0xffff },
    ],
    chips: [
        { kind: 'via', name: 'via1', at: 0x6000 },
        { kind: 'acia', name: 'acia1', at: 0x5000 },
    ],
});

/**
 * mike42/6502-computer (CC-BY-4.0 Mike Billington).
 * 65C02 + 65C22 + 65C51N, 1.8432 MHz, 32K RAM, 16K ROM (one bank of a
 * physically-switched 32K EEPROM). 74LS138 decodes A12/A11/A10 in the
 * $8000–$BFFF I/O window (active when A15=1, A14=0).
 *   VIA  $8000  (Y0)
 *   ACIA $8400  (Y1)
 *   speaker toggle $8800 (Y2) — not modelled, read-toggled latch
 *   IRQ priority encoder $8C00 (Y3) — not modelled, glue logic
 * ROM bank select is a physical SPDT switch on EEPROM A14, not software-
 * controlled; the CPU always sees 16K at $C000–$FFFF.
 */
export const HB6502 = Object.freeze({
    clockHz: 1_843_200,
    regions: [
        { kind: 'ram', start: 0x0000, end: 0x7fff },
        { kind: 'rom', start: 0xc000, end: 0xffff },
    ],
    chips: [
        { kind: 'via', name: 'via1', at: 0x8000 },
        { kind: 'acia', name: 'acia1', at: 0x8400 },
    ],
});

/**
 * Garth Wilson's 6502 primer machine (wilsonminesco.com/6502primer) — the
 * design Ben Eater credits as his ancestor, so this preset is EATER6502's
 * parent with the primer's own expansion discipline: one NAND package of
 * decode, I/O devices on individual address lines in the $4000-$7FFF
 * window (each mirrors through its subwindow; use the canonical address).
 * Shape is uncopyrightable fact; the primer text itself is unlicensed and
 * stays research-only. VIA3 at $4800 exists in the primer's plan and is
 * omitted here only to keep the preset to the chips a program can
 * meaningfully drive today — declare it via MAP/CHIP when needed.
 */
export const WILSON6502 = Object.freeze({
    clockHz: 1_000_000,
    regions: [
        { kind: 'ram', start: 0x0000, end: 0x3fff },
        { kind: 'rom', start: 0x8000, end: 0xffff },
    ],
    chips: [
        { kind: 'via', name: 'via1', at: 0x6000 },
        { kind: 'via', name: 'via2', at: 0x5000 },
        { kind: 'acia', name: 'acia1', at: 0x4400 },
    ],
});

/**
 * KiT-shaped preset (Kiran Tomlinson's Cornell breadboard build, blog
 * series cs.cornell.edu/~kt/post/6502-1 — no license on the repos, so the
 * MAP below is encoded from documented facts and nothing is copied).
 * W65C02 @ 1 MHz; RAM to $6FFF; the $7000-$77FF dual-port VRAM appears as
 * plain RAM (the video side is unmodeled — the CPU-visible behavior of a
 * dual-port SRAM without a reader IS plain RAM); VIA at $7800; NS16C550
 * at $7820 clocked from the system clock, so the KiT's divisor 13 gives
 * ~4808 baud; ROM high. The 16550 over the W65C51 is the build's stated
 * dodge of the ACIA TDRE bug — LSR polling works here and on silicon.
 */
export const KIT1 = Object.freeze({
    clockHz: 1_000_000,
    regions: [
        { kind: 'ram', start: 0x0000, end: 0x6fff },
        { kind: 'ram', start: 0x7000, end: 0x77ff },
        { kind: 'rom', start: 0x8000, end: 0xffff },
    ],
    chips: [
        { kind: 'via', name: 'via1', at: 0x7800 },
        { kind: 'uart16550', name: 'uart1', at: 0x7820 },
    ],
});

export class M6502Machine {
    /**
     * @param {MachineConfig} [config]
     * @param {{ onPinChange?: (pin: string, level: 0|1, tMs: number) => void,
     *           onSerial?: (byte: number, tMs: number) => void }} [hooks]
     */
    constructor(config = EATER6502, hooks = {}) {
        this.config = config;
        this.hooks = hooks;
        this.clockHz = config.clockHz;
        this.mem = new Uint8Array(65536);
        /** @type {Record<string, W65C22|W65C51>} */
        this.chips = {};
        this._decode = [];
        for (const r of config.regions) {
            this._decode.push({ ...r, chip: null });
        }
        for (const c of config.chips) {
            const regs = c.kind === 'via' ? 16 : c.kind === 'uart16550' ? 8
                : c.kind === 'latch' ? 1 : c.kind === 'vdp' ? 2 : 4;
            const span = c.span || regs;
            if (span < regs) throw new Error(`machine config: ${c.kind} span ${span} smaller than its ${regs} registers`);
            let chip;
            if (c.kind === 'via') {
                chip = new W65C22({
                    onPortChange: (port, value, ddr) => this._portChange(c.name, port, value, ddr),
                });
            } else if (c.kind === 'acia') {
                chip = new W65C51({
                    onTx: (byte) => { if (this.hooks.onSerial) this.hooks.onSerial(byte, this.tMs); },
                });
            } else if (c.kind === 'uart16550') {
                chip = new NS16C550({
                    onTx: (byte) => { if (this.hooks.onSerial) this.hooks.onSerial(byte, this.tMs); },
                    clockHz: c.xtal || config.clockHz,
                });
            } else if (c.kind === 'latch') {
                chip = new Latch374({
                    onChange: (value, prev) => this._latchChange(c.name, value, prev),
                });
            } else if (c.kind === 'vdp') {
                // TMS9918A: frame pacing derives from the CPU clock the
                // machine advances chips with (60 Hz VBLANK + IRQ).
                chip = new TMS9918({ clockHz: config.clockHz });
            } else {
                throw new Error(`unknown chip kind in machine config: ${c.kind}`);
            }
            this.chips[c.name] = chip;
            this._decode.push({ kind: c.kind, start: c.at, end: c.at + span - 1, regs, chip });
        }
        // Overlap is a wiring bug the user should hear about, not silence.
        const sorted = [...this._decode].sort((a, b) => a.start - b.start);
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].start <= sorted[i - 1].end) {
                throw new Error(`machine config: ${sorted[i - 1].kind} and ${sorted[i].kind} overlap at $${sorted[i].start.toString(16)}`);
            }
        }
        /** Last observed level per port pin, for edge detection. */
        this._pinLevels = {};
        this.cycles = 0;
        this.cpu = new W65C02({
            read: (a) => this._read(a),
            write: (a, v) => this._write(a, v),
        });
    }

    /** Machine time in (fractional) milliseconds. */
    get tMs() { return this.cycles * 1000 / this.clockHz; }

    _region(addr) {
        for (const r of this._decode) if (addr >= r.start && addr <= r.end) return r;
        return null;
    }

    _read(addr) {
        const r = this._region(addr);
        if (!r) return 0xff; // open bus reads high, like the undriven data lines
        if (r.chip) return r.chip.read((addr - r.start) % r.regs); // mirrors through the window
        return this.mem[addr];
    }

    _write(addr, val) {
        const r = this._region(addr);
        if (!r || r.kind === 'rom') return; // writes to ROM/open bus vanish
        if (r.chip) { r.chip.write((addr - r.start) % r.regs, val); return; }
        this.mem[addr] = val;
    }

    _portChange(chipName, port, value, ddr) {
        if (!this.hooks.onPinChange) return;
        for (let bit = 0; bit < 8; bit++) {
            const mask = 1 << bit;
            if (!(ddr & mask)) continue; // only driven pins produce edges
            const pin = `${chipName}.P${port.toUpperCase()}${bit}`;
            const level = value & mask ? 1 : 0;
            if (this._pinLevels[pin] !== level) {
                this._pinLevels[pin] = level;
                this.hooks.onPinChange(pin, level, this.tMs);
            }
        }
    }

    _latchChange(chipName, value, prev) {
        if (!this.hooks.onPinChange) return;
        for (let bit = 0; bit < 8; bit++) {
            const mask = 1 << bit;
            if ((value & mask) === (prev & mask)) continue;
            // Q, not P: latch outputs are always driven — no DDR exists.
            this.hooks.onPinChange(`${chipName}.Q${bit}`, value & mask ? 1 : 0, this.tMs);
        }
    }

    /** Load a ROM image at an address (defaults to the first rom region's start). */
    loadRom(bytes, at) {
        const rom = this.config.regions.find((r) => r.kind === 'rom');
        const base = at ?? (rom ? rom.start : 0x8000);
        this.mem.set(bytes, base);
    }

    /** Reset the CPU through the vector at $FFFC (part of the ROM image). */
    reset() {
        this.cpu.reset();
        this.cycles += 7;
        this._advanceChips(7);
    }

    /**
     * Attach a non-bus device that needs machine time (a PS/2 capture
     * chain, a sensor with its own pacing). It gets advance(cycles) in
     * step with the chips but owns no addresses — its outputs reach the
     * CPU through chip inputs (VIA pins, control lines), like the bench.
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

    _anyIrq() {
        for (const name of Object.keys(this.chips)) {
            if (this.chips[name].irqAsserted) return true;
        }
        return false;
    }

    /** One instruction (or one idle cycle when waiting); returns cycles consumed. */
    step() {
        let n = this.cpu.step();
        if (n === 0) {
            if (this.cpu.stopped) return 0; // STP: only reset revives, time stops mattering
            n = 1; // WAI: time still passes while parked
        }
        this.cycles += n;
        this._advanceChips(n);
        if (this._anyIrq() && this.cpu.irq()) { // level-triggered shared IRQB
            this.cycles += 7; // the interrupt sequence is bus time too
            this._advanceChips(7);
        }
        return n;
    }

    /** Run until machine time reaches tMs (or the CPU executes STP). */
    advanceToMs(tMs) {
        const target = Math.ceil(tMs * this.clockHz / 1000);
        while (this.cycles < target) {
            if (this.step() === 0) break;
        }
    }
}

export default M6502Machine;
