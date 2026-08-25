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
import { SimpleVGA } from './simplevga.js';
import { TileVGA } from './tilevga.js';
import { NS16C550 } from './ns16c550.js';
import { MC6850 } from './mc6850.js';
import { M6532 } from './m6532.js';
import { AY38912 } from './ay-3-8912.js';
import { Latch374 } from './latch374.js';
import { SDCardSPI } from './sdcard-spi.js';

/**
 * @typedef {object} MachineConfig
 * @property {number} clockHz phi2 frequency
 * @property {Array<{kind: 'ram'|'rom', start: number, end: number, perm?: number[]}>} regions
 *   inclusive ranges; perm (E5.2) maps chip A-pin i to CPU address bit perm[i]
 * @property {Array<{kind: 'via'|'acia'|'acia6850'|'riot'|'psg8912'|'um245r'|'uart16550'|'latch', name: string, at: number,
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

/**
 * Nick Gammon's G-Pascal board (MIT, nickgammon/G-Pascal) — the Eater
 * 6502 with the VIA at $7FF0 and NO ACIA: serial is BIT-BANGED on the
 * VIA, 4800 baud 8N1 — PA1 out, PA0 in with the start bit's falling
 * edge also on CB2 (PCR input-negative edge → IFR3 → IRQ). The ROM
 * carries a Pascal compiler, a 65C02 assembler and a text editor —
 * an interactive machine that is shippable end to end.
 *
 * inputs.b = 0x00: the LCD data bus reads not-busy when no LCD device
 * drives it. With the default floating-high inB, every LCD write burns
 * the driver's full 255-retry busy timeout and the banner takes 2.5
 * SECONDS of machine time to appear (measured; the same trap as
 * BeebEater's PB7 busy-poll, in port-A/B clothing).
 */
export const GPASCAL = Object.freeze({
    clockHz: 1_000_000,
    regions: [
        { kind: 'ram', start: 0x0000, end: 0x3fff },
        { kind: 'rom', start: 0x8000, end: 0xffff },
    ],
    chips: [
        { kind: 'via', name: 'via1', at: 0x7ff0, inputs: { b: 0x00 } },
    ],
    serial: { kind: 'via-bitbang', chip: 'via1', txBit: 1, rxBit: 0, cb2: true, baud: 4800 },
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
                : c.kind === 'latch' ? 1 : c.kind === 'vdp' ? 2
                : c.kind === 'acia6850' ? 2
                : c.kind === 'riot' ? 256
                : c.kind === 'psg8912' ? 2
                : c.kind === 'um245r' ? 1
                : c.kind === 'console' ? 8
                : c.kind === 'tilevga' ? 0x4000 : 4;
            const span = c.span || regs;
            if (span < regs) throw new Error(`machine config: ${c.kind} span ${span} smaller than its ${regs} registers`);
            let chip;
            if (c.kind === 'via') {
                chip = new W65C22({
                    onPortChange: (port, value, ddr) => this._portChange(c.name, port, value, ddr),
                    // CA2 read-handshake pulse → any SD card clocked the
                    // Bad Apple way (sck: 'ca2') gets one SPI clock per
                    // LDA PORTA.
                    onCa2Pulse: () => {
                        if (!this._sdCards) return;
                        for (const e of this._sdCards) {
                            if (e.via === c.name && e.sckCa2) e.sd.clockPulse();
                        }
                    },
                });
                // Initial input levels per config: a machine states what
                // sits on its input pins (a missing LCD reads low, a
                // pulled-up serial line reads high). Default stays 0xff.
                if (c.inputs) {
                    if (c.inputs.a != null) chip.inA = c.inputs.a & 0xff;
                    if (c.inputs.b != null) chip.inB = c.inputs.b & 0xff;
                }
            } else if (c.kind === 'acia') {
                chip = new W65C51({
                    onTx: (byte) => { if (this.hooks.onSerial) this.hooks.onSerial(byte, this.tMs); },
                });
            } else if (c.kind === 'psg8912') {
                // AY-3-8912 behind the two-address decode the extractor
                // classifies (spec-updates/ay-two-phase-select.md):
                // even offset = latch the register number, odd = data.
                // The adapter speaks the machine's read(reg)/write(reg)
                // contract over the core's select/write/read protocol.
                const ay = new AY38912({ clockHz: c.xtal || config.clockHz });
                // readMask (from the extractor) says which offsets the
                // read decode actually reaches; elsewhere the chip is off
                // the bus and the CPU sees open bus, like the silicon.
                const readMask = c.readMask ?? 2;
                chip = {
                    ay,
                    read: (reg) => (((readMask >> reg) & 1) ? ay.read() : 0xff),
                    write: (reg, v) => { if (reg === 0) ay.select(v); else ay.write(v); },
                    advance: (n) => ay.advance(n),
                };
            } else if (c.kind === 'um245r') {
                // USB FIFO at one address: a read takes the next queued
                // byte (0xff when empty — the pins float high with no
                // data, and phase-1 has no memory-mapped status; RXF/TXE
                // are PINS on this part), a write leaves via onSerial.
                // Feed it with machine.chips.<name>.rxPush(byte).
                const rx = [];
                chip = {
                    rx,
                    rxPush: (b) => rx.push(b & 0xff),
                    read: () => (rx.length ? rx.shift() : 0xff),
                    write: (reg, v) => { if (this.hooks.onSerial) this.hooks.onSerial(v & 0xff, this.tMs); },
                };
            } else if (c.kind === 'riot') {
                // MOS 6532: 128 bytes RAM + ports + timer in one 256-byte
                // window, RS encoded as address bit 7 (the core's own
                // contract; the extractor pins RS0B to A7 to match).
                chip = new M6532({
                    onPortChange: (port, value, ddr) => this._portChange(c.name, port, value, ddr),
                });
            } else if (c.kind === 'acia6850') {
                // The Motorola-bus ACIA on a 6502 bus — memory-mapped
                // ctrl/status + data, same chip class the z80 machines
                // run. Two registers; the extractor names it acia6850.
                chip = new MC6850({
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
            } else if (c.kind === 'console') {
                // py65mon-convention MMIO console (the interface Tali
                // Forth 2 and the py65 ecosystem target): write reg 1
                // ($F001) emits a character; read reg 4 ($F004) returns
                // the next queued key or 0. Eight registers so the
                // window covers $F000-$F007 like py65mon's.
                const rx = [];
                chip = {
                    rx,
                    read: (reg) => (reg === 4 ? (rx.length ? rx.shift() : 0) : 0),
                    write: (reg, v) => {
                        if (reg === 1 && this.hooks.onSerial) this.hooks.onSerial(v & 0xff, this.tMs);
                    },
                };
            } else if (c.kind === 'vdp') {
                // TMS9918A: frame pacing derives from the CPU clock the
                // machine advances chips with (60 Hz VBLANK + IRQ).
                chip = new TMS9918({ clockHz: config.clockHz });
            } else if (c.kind === 'tilevga') {
                // rene6502's tile VGA card: a 16K dual-port VRAM window
                // (addressed like any chip), vblank pacing off the CPU
                // clock. Reads AND writes hit the same VRAM — dual-port.
                chip = new TileVGA({ clockHz: config.clockHz });
            } else if (c.kind === 'simplevga') {
                // Not an addressed chip: a write-snoop card on the ROM
                // window with its bank line on the VIA's port B. No
                // decode entry — it occupies no address of its own.
                this._vgaCard = new SimpleVGA({ rows: c.rows });
                this._vgaNmi = !!c.nmi;
                this.chips[c.name] = this._vgaCard;
                continue;
            } else if (c.kind === 'framebuffer') {
                // Bus-snooping framebuffer — Eater's "world's worst video
                // card" shape: it watches WRITES in a shared-RAM window
                // ($2000-$3FFF on the real card) and paints from what it
                // sees; the CPU's reads still hit RAM. No decode entry.
                const fb = {
                    at: c.at, size: c.size || 0x2000,
                    buf: new Uint8Array(c.size || 0x2000),
                    frame: 0,
                    getFrame() { return this.buf; },
                };
                if (!this._fbSnoops) this._fbSnoops = [];
                this._fbSnoops.push(fb);
                this.chips[c.name] = fb;
                continue;
            } else if (c.kind === 'sdcard') {
                // SPI-mode SD card on a VIA's port pins (the Bad Apple
                // storage hookup). Like simplevga: wires only, no bus
                // window, no decode entry. config: {kind:'sdcard',
                // name, via:'via1', pins:{cs,sck,mosi,miso, port?}}.
                const sd = new SDCardSPI(c.pins);
                if (!this._sdCards) this._sdCards = [];
                this._sdCards.push({
                    sd, via: c.via || 'via1', sckCa2: c.pins.sck === 'ca2',
                    port: (c.pins.port || 'a').toUpperCase(),
                    // MISO may live on the OTHER port: the Bad Apple build
                    // moved it to PB7 so a single LDA PORTB + ROL grabs the
                    // bit into carry (their comment: "Moved to other port
                    // top bit").
                    miso: c.pins.miso, misoPort: (c.pins.misoPort || c.pins.port || 'a').toLowerCase(),
                    last: null,
                    bits: [c.pins.cs, c.pins.mosi, c.pins.sck].filter((b) => typeof b === 'number'), // cs first, data before clock
                });
                this.chips[c.name] = sd;
                continue;
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
        // ── Bit-banged VIA serial (config.serial.kind === 'via-bitbang') ──
        // TX: watch the tx pin's edges from _portChange; a falling edge
        // while idle is a start bit — schedule 8 mid-bit samples in
        // machine cycles and shift them LSB-first into a byte for
        // hooks.onSerial. RX: serialIn() schedules pin/CB2 transitions
        // as cycle-stamped events applied in step(); the firmware's
        // cycle-counted receive loop then reads real levels at real
        // times. One codec, both directions, no chip pretends to be a
        // UART that the board never had.
        if (config.serial && config.serial.kind === 'via-bitbang') {
            const s = config.serial;
            this._bb = {
                chip: s.chip, txBit: s.txBit ?? 1, rxBit: s.rxBit ?? 0,
                cb2: s.cb2 !== false,
                bitCycles: Math.round(config.clockHz / (s.baud || 4800)),
                txLevel: 1, txIdle: true, txByte: 0, txCount: 0, txNext: 0,
                events: [],   // {at: cycle, port, bit, level, cb2}
            };
        } else {
            this._bb = null;
        }
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
        if (r.perm) return this.mem[r.start + this._permIdx(addr - r.start, r.perm)];
        return this.mem[addr];
    }

    /**
     * E5.2: a permuted address bus, applied where the silicon applies it.
     * perm[i] names the CPU address bit that chip pin A<i> rides, so the
     * chip-internal cell index takes CPU bit perm[i] as its bit i. RAM
     * permutes transparently (reads and writes agree with themselves);
     * a ROM's linear image scrambles under the CPU's eyes — exactly what
     * the real breadboard does, so a fixture can assert it.
     * @param {number} off @param {number[]} perm
     */
    _permIdx(off, perm) {
        let idx = 0;
        for (let i = 0; i < perm.length; i++) idx |= ((off >> perm[i]) & 1) << i;
        return idx;
    }

    _write(addr, val) {
        // The simplevga card snoops the write strobe in $8000-$FFFF —
        // a write-only overlay on the ROM window (reads still hit ROM),
        // exactly the real card's bus arrangement.
        if (this._vgaCard && addr >= 0x8000) this._vgaCard.write(addr, val);
        if (this._fbSnoops) {
            for (const fb of this._fbSnoops) {
                if (addr >= fb.at && addr < fb.at + fb.size) { fb.buf[addr - fb.at] = val; fb.frame++; }
            }
        }
        const r = this._region(addr);
        if (!r || r.kind === 'rom') return; // writes to ROM/open bus vanish
        if (r.chip) { r.chip.write((addr - r.start) % r.regs, val); return; }
        if (r.perm) { this.mem[r.start + this._permIdx(addr - r.start, r.perm)] = val; return; }
        this.mem[addr] = val;
    }

    _portChange(chipName, port, value, ddr) {
        // The simplevga card's bank line rides the VIA's port B
        // (vga.s: `inc PORTB` at the row-128 crossing).
        if (this._vgaCard && port === 'B') this._vgaCard.setBank(value);
        // SD cards listen to their VIA's output pins; MISO answers
        // through setInput. Edge ORDER matters within one write: CS,
        // then MOSI (data stable), then SCK (the sampling edge).
        if (this._sdCards) {
            for (const e of this._sdCards) {
                if (chipName !== e.via || port.toUpperCase() !== e.port) continue;
                if (!e.sd.onMiso) {
                    const via = this.chips[e.via];
                    e.sd.onMiso = (level) => via && via.setInput(e.misoPort, e.miso, level);
                }
                const prev = e.last;
                e.last = value;
                if (prev === null) continue;
                const diff = prev ^ value;
                for (const bit of e.bits) {
                    if ((diff >> bit) & 1) e.sd.pinChange(bit, (value >> bit) & 1);
                }
            }
        }
        // Bit-bang serial TX: watch the tx pin; falling edge while idle
        // is a start bit — arm the mid-bit sampler.
        const bb = this._bb;
        if (bb && chipName === bb.chip && port.toUpperCase() === 'A' && (ddr & (1 << bb.txBit))) {
            const level = (value >> bb.txBit) & 1;
            if (bb.txIdle && bb.txLevel === 1 && level === 0) {
                bb.txIdle = false;
                bb.txByte = 0; bb.txCount = 0;
                bb.txNext = this.cycles + Math.round(bb.bitCycles * 1.5);
            }
            bb.txLevel = level;
        }
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

    /**
     * How far a parked (WAI) CPU may jump in one step: the nearest
     * TIME-DRIVEN wake source. Chips that advance but cannot name a
     * horizon veto the jump entirely (n=1 crawl) — a skipped event is a
     * correctness bug, a crawl is only slow. External input changes
     * arrive at slice boundaries, so with nothing scheduled the park
     * re-checks once per millisecond; the jump is also capped so a
     * pathological horizon cannot swallow a whole slice unexamined.
     */
    _wakeHorizon() {
        let h = Infinity;
        for (const name of Object.keys(this.chips)) {
            const chip = this.chips[name];
            if (!chip || !chip.advance) continue;
            if (typeof chip.nextWake !== 'function') return 1;
            h = Math.min(h, chip.nextWake());
        }
        if (this.devices) {
            for (const name of Object.keys(this.devices)) {
                const dev = this.devices[name];
                if (!dev || !dev.advance) continue;
                if (typeof dev.nextWake !== 'function') return 1;
                h = Math.min(h, dev.nextWake());
            }
        }
        if (this._bb && this._bb.events.length) {
            h = Math.min(h, Math.max(1, this._bb.events[0].at - this.cycles));
        }
        if (this._vgaCard) {
            const half = this.clockHz / 120;
            h = Math.min(h, Math.max(1, Math.ceil((Math.floor(this.cycles / half) + 1) * half - this.cycles)));
        }
        if (!Number.isFinite(h)) h = Math.round(this.clockHz / 1000);
        return Math.max(1, Math.min(h, 0x10000));
    }

    _anyIrq() {
        for (const name of Object.keys(this.chips)) {
            if (this.chips[name].irqAsserted) return true;
        }
        return false;
    }

    /** One instruction (or one idle cycle when waiting); returns cycles consumed. */
    /**
     * Face-input contract: press/release the four control buttons a
     * human (or a face capturing arrow keys) drives. Convention from
     * gfoot's simplevga snake — ACTIVE-LOW buttons on the first VIA's
     * PA0..PA3 (down, up, right, left). mask bit set = pressed.
     */
    setButtons(mask) {
        const via = Object.values(this.chips).find((c) => c && typeof c.setInput === 'function' && 'inA' in c);
        if (!via) return false;
        for (let bit = 0; bit < 4; bit++) {
            via.setInput('a', bit, (mask >> bit) & 1 ? 0 : 1);
        }
        return true;
    }

    step() {
        let n = this.cpu.step();
        if (n === 0) {
            if (this.cpu.stopped) return 0; // STP: only reset revives, time stops mattering
            // WAI: time passes while parked — jump to the nearest wake
            // horizon instead of crawling one cycle per call (a parked
            // core was ADVANCING SLOWER than an executing one). Every
            // advancing chip must name its horizon or veto the jump:
            // correctness over speed.
            n = this._wakeHorizon();
        }
        this.cycles += n;
        this._advanceChips(n);
        // With a simplevga card present, its frame pulse reaches the
        // first VIA's PA4 (the canonical snake hookup: "VGA_V to the
        // 6522's PA4") — a 60 Hz square derived from machine time, so
        // frame-paced games run without a scanline model.
        if (this._vgaCard) {
            const phase = Math.floor(this.cycles / (this.clockHz / 120)) & 1;
            if (phase !== this._vsPhase) {
                const falling = this._vsPhase === 1 && phase === 0;
                this._vsPhase = phase;
                const via = Object.values(this.chips).find((c) => c && typeof c.setInput === 'function' && 'inA' in c);
                if (via) via.setInput('a', 4, phase);
                // vsync → NMI (config {kind:'simplevga', nmi: true}): the
                // Bad Apple hookup — the frame pulse on the 6502's NMI pin
                // gives adaptive per-frame pacing with no timer at all.
                // Edge-triggered like the pin: the FALLING edge fires.
                if (falling && this._vgaNmi) {
                    this.cpu.nmi();
                    this.cycles += 7; // the interrupt sequence is bus time
                    this._advanceChips(7);
                }
            }
        }
        if (this._anyIrq() && this.cpu.irq()) { // level-triggered shared IRQB
            this.cycles += 7; // the interrupt sequence is bus time too
            this._advanceChips(7);
        }
        if (this._bb) this._bbTick();
        return n;
    }

    /** Bit-bang serial housekeeping — due RX events and TX samples. */
    _bbTick() {
        const bb = this._bb;
        // Apply due scheduled input transitions (RX byte in flight).
        while (bb.events.length && bb.events[0].at <= this.cycles) {
            const ev = bb.events.shift();
            const via = this.chips[bb.chip];
            if (!via) continue;
            if (ev.cb2 != null) via.setControl('cb2', ev.cb2);
            if (ev.level != null) via.setInput('a', bb.rxBit, ev.level);
        }
        // TX sampler: mid-bit reads of the tx line, LSB first.
        if (!bb.txIdle && this.cycles >= bb.txNext) {
            bb.txByte |= bb.txLevel << bb.txCount;
            bb.txCount++;
            bb.txNext += bb.bitCycles;
            if (bb.txCount === 8) {
                if (this.hooks.onSerial) this.hooks.onSerial(bb.txByte & 0xff, this.tMs);
                bb.txIdle = true;
            }
        }
    }

    /**
     * Feed one byte INTO the bit-banged serial line (keyboard → machine):
     * start-bit falling edge on the rx pin (and CB2, where the board ties
     * them together), data bits LSB-first, stop bit high. All scheduled
     * in machine cycles so the firmware's cycle-counted receive loop
     * samples real levels at real times.
     * @param {number} byte
     * @returns {boolean} accepted (false when this machine has no bit-bang serial)
     */
    serialIn(byte) {
        const bb = this._bb;
        if (!bb) return false;
        const bit = bb.bitCycles;
        // Clear of any byte still being clocked in.
        const last = bb.events.length ? bb.events[bb.events.length - 1].at : this.cycles;
        let t = Math.max(this.cycles + bit, last + 2 * bit);
        bb.events.push({ at: t, level: 0, cb2: bb.cb2 ? 0 : null });         // start bit
        if (bb.cb2) bb.events.push({ at: t + (bit >> 1), cb2: 1 });          // CB2 pulse ends
        for (let k = 0; k < 8; k++) {
            bb.events.push({ at: t + (k + 1) * bit, level: (byte >> k) & 1 });
        }
        bb.events.push({ at: t + 9 * bit, level: 1 });                       // stop bit / idle
        return true;
    }

    /** CPU state keys to snapshot (same pattern as Z80Machine.CPU_STATE). */
    static CPU_STATE = ['pc', 'a', 'x', 'y', 's', 'p'];

    /**
     * Snapshot the whole machine — CPU, memory, chip state — as a plain
     * JSON-able object (mem is a Uint8Array; the caller chooses encoding).
     * Chips with their own saveState() are included; chips without are
     * skipped with the same contract as Z80Machine.
     */
    saveState() {
        const cpu = {};
        for (const k of M6502Machine.CPU_STATE) cpu[k] = this.cpu[k] ?? 0;
        const chips = {};
        for (const [name, c] of Object.entries(this.chips)) {
            if (typeof c.saveState === 'function') chips[name] = c.saveState();
        }
        return {
            v: 1,
            cpu,
            cycles: this.cycles,
            mem: this.mem.slice(),
            chips,
        };
    }

    /** Restore a saveState() snapshot onto an identically-built machine
     *  (same config, same ROM load). */
    loadState(s) {
        if (s.v !== 1) throw new Error(`unknown machine state version ${s.v}`);
        for (const k of M6502Machine.CPU_STATE) this.cpu[k] = s.cpu[k] ?? 0;
        this.cycles = s.cycles;
        this.mem.set(s.mem);
        for (const [name, cs] of Object.entries(s.chips ?? {})) {
            const c = this.chips[name];
            if (c && typeof c.loadState === 'function') c.loadState(cs);
        }
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
