/**
 * The 6507SBC machine — R6507 + MOS 6532 RIOT + 4K ROM.
 *
 * Address space (13 bits, 8K, everything mirrors mod $2000):
 *   A12=0 ($0000–$0FFF): 6532 RIOT, active when CS2B (active-low) = A12 = 0
 *     RSB = A7 selects RAM (A7=0) vs registers (A7=1)
 *     RIOT occupies $00–$FF and mirrors through the entire A12=0 half
 *   A12=1 ($1000–$1FFF): 4K ROM
 *     Assembled at $F000 in 6502 address space; the 6507's 13-bit mask
 *     maps $F000–$FFFF → $1000–$1FFF. Vectors at $1FFC/$1FFE.
 *
 * The 6507 has no IRQ/NMI pins, so RIOT interrupts cannot reach the CPU.
 * Timer polling is the only way to synchronize — exactly how real 6507
 * systems (Atari 2600, etc.) work.
 *
 * Documented limitation: uses a W65C02 (CMOS) core. NMOS undocumented
 * opcodes are not supported.
 *
 * @module
 */
import { R6507 } from './r6507.js';
import { M6532 } from './m6532.js';

/**
 * @typedef {object} M6507Config
 * @property {number} clockHz phi2 frequency
 */

/** Default 6507SBC preset: 1 MHz. */
export const SBC6507 = Object.freeze({
    clockHz: 1_000_000,
});

export class M6507Machine {
    /**
     * @param {M6507Config} [config]
     * @param {{ onPinChange?: (pin: string, level: 0|1, tMs: number) => void }} [hooks]
     */
    constructor(config = SBC6507, hooks = {}) {
        this.config = config;
        this.hooks = hooks;
        this.clockHz = config.clockHz;
        /** 4K ROM image at $1000–$1FFF in the 8K space. */
        this.rom = new Uint8Array(4096);
        this.riot = new M6532({
            onPortChange: (port, value, ddr) => this._portChange(port, value, ddr),
        });
        /** Last observed level per port pin, for edge detection. */
        this._pinLevels = {};
        this.cycles = 0;
        this.cpu = new R6507({
            read: (a) => this._read(a),
            write: (a, v) => this._write(a, v),
        });
    }

    /** Machine time in (fractional) milliseconds. */
    get tMs() { return this.cycles * 1000 / this.clockHz; }

    _read(addr) {
        // addr is already masked to 13 bits ($0000–$1FFF) by R6507
        if (addr & 0x1000) {
            // A12=1: ROM
            return this.rom[addr & 0x0fff];
        }
        // A12=0: RIOT (address bits A0–A7 are significant)
        return this.riot.read(addr & 0xff);
    }

    _write(addr, val) {
        if (addr & 0x1000) {
            // ROM: writes vanish
            return;
        }
        // RIOT
        this.riot.write(addr & 0xff, val);
    }

    _portChange(port, value, ddr) {
        if (!this.hooks.onPinChange) return;
        for (let bit = 0; bit < 8; bit++) {
            const mask = 1 << bit;
            if (!(ddr & mask)) continue;
            const pin = `riot.P${port.toUpperCase()}${bit}`;
            const level = value & mask ? 1 : 0;
            if (this._pinLevels[pin] !== level) {
                this._pinLevels[pin] = level;
                this.hooks.onPinChange(pin, level, this.tMs);
            }
        }
    }

    /**
     * Load a 4K ROM image. The ROM is assembled at $F000 in 6502 address
     * space; the 6507's 13-bit mask maps it to $1000–$1FFF.
     * @param {Uint8Array|number[]} bytes up to 4096 bytes
     */
    loadRom(bytes) {
        this.rom.set(bytes);
    }

    /** Reset the CPU through the vector at $1FFC (i.e. $FFFC masked). */
    reset() {
        this.cpu.reset();
        this.cycles += 7;
        this.riot.advance(7);
    }

    /** One instruction; returns cycles consumed. */
    step() {
        let n = this.cpu.step();
        if (n === 0) {
            if (this.cpu.stopped) return 0;
            n = 1;
        }
        this.cycles += n;
        this.riot.advance(n);
        // 6507 has no IRQ pin — RIOT interrupts cannot reach the CPU
        return n;
    }

    /** Run until machine time reaches tMs (or CPU stops). */
    advanceToMs(tMs) {
        const target = Math.ceil(tMs * this.clockHz / 1000);
        while (this.cycles < target) {
            if (this.step() === 0) break;
        }
    }
}
