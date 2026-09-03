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
 * INTERRUPT DELIVERY LIVES HERE. The core deliberately does not deliver
 * INTR on its own; this layer does it (ROADMAP E6.3). When an 8259 is on
 * the machine, step() checks its INTR output before each instruction: if
 * the line is asserted AND the CPU's interrupt flag is set, the machine
 * runs the acknowledge cycle (pic.acknowledge() → vector), delivers it
 * through cpu.interrupt(vector), and a HLT waiting on a timer tick wakes.
 * A peripheral reaches the PIC by declaring `irq: n` in its config; a
 * PIT counter's OUT and a UART's IRQ pin are wired the same way. NMI is
 * separate: machine.nmi() latches an edge that is delivered ahead of any
 * INTR, ignores the interrupt flag, and always takes vector 2. The
 * one-instruction inhibition after a segment-register load is the core's
 * concern and is not modelled at this resolution.
 *
 * @module
 */
import { I8086 } from './i8086.js';
import { I8255 } from './i8255.js';
import { NS16C550 } from './ns16c550.js';
import { MC6850 } from './mc6850.js';
import { I8254 } from './i8254.js';
import { I8259 } from './i8259.js';
import { I8251 } from './i8251.js';
import { CGACard } from './cga-card.js';
import { PCSpeaker } from './pc-speaker.js';
import { HerculesCard } from './hercules-card.js';
import { VGACard } from './vga-card.js';
import { I8237 } from './i8237.js';
import { UPD765 } from './upd765.js';

/** The interrupt flag bit in FLAGS — the machine's gate on INTR delivery. */
const IF = 0x0200;

/**
 * Which register of a decoded window an address hits, honouring the
 * window's stride (address step per register) and mirroring past the
 * register count the way an under-decoded window does on the bench.
 */
function regOf(w, addr) {
    return Math.floor((addr - w.start) / w.stride) % w.regs;
}

/**
 * @typedef {object} MachineConfig
 * @property {number} clockHz CPU clock
 * @property {Array<{kind: 'ram'|'rom', start: number, end: number}>} regions
 *   inclusive PHYSICAL address ranges in the 1 MB space
 * @property {Array<{kind: 'ppi'|'uart16550'|'acia6850'|'pit'|'pic'|'usart8251',
 *   name: string, at: number, bus?: 'io'|'mem', span?: number, xtal?: number,
 *   inputs?: object, irq?: number, irqChannel?: number}>} chips
 *   `at` is a port address when bus is 'io' (the default) and a physical
 *   address when it is 'mem'. `span` widens the decoded window past the
 *   chip's register count — PARTIAL DECODE, the breadboard normal, where
 *   registers mirror through the window because the high address lines
 *   were never wired to the comparator. `irq` names the PIC input line a
 *   chip's interrupt output is wired to (a serial chip's IRQ pin, or a
 *   PIT counter's OUT); `irqChannel` picks which PIT counter drives it
 *   (default 0, the way OUT0 feeds IRQ0 on a PC).
 */

/** Registers each chip kind answers to; the window mirrors past it. */
const REGS = {
    ppi: 4, uart16550: 8, acia6850: 2,
    pit: 4,          // counters 0/1/2 and the control word
    pic: 2,          // A0 selects command/status vs data/mask
    usart8251: 2,    // C/D selects data vs control/status
    cga: 16,         // the 3D0h-3DFh block (mode 3D8h, colour 3D9h, status 3DAh)
    hercules: 16,    // the 3B0h-3BFh block (mode 3B8h, status 3BAh, config 3BFh)
    vga: 32,         // the 3C0h-3DFh block (attr/seq/gc/crtc/dac/misc + status)
    dma: 16,         // the 8237's 00h-0Fh: four channels, then the command block
    // THE PAGE LATCH IS NOT PART OF THE 8237. The chip counts sixteen bits of
    // address and the XT needs twenty, so IBM bolted a separate 74LS670 latch
    // file at 80h-8Fh to supply A16-A19. It is a second decoded window onto the
    // same chip, which is why it is its own kind rather than a wider span: the
    // two blocks are 0x70 ports apart and nothing decodes the gap.
    dmapage: 16,
    fdc: 8,          // the uPD765 card's 3F0h-3F7h (DOR 3F2h, MSR 3F4h, data 3F5h)
};

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

/**
 * The Tier A reference build: an 8088 behind an 8284 clock, its I/O behind a
 * 74LS138 with 74LS244 buffers, an 8254 for the timer tick, an 8255 driving
 * a text LCD and the switches, and an 8259 to take the timer interrupt.
 * Flash at the top of the megabyte.
 *
 * Named for its ROLE, not its source. It is modelled on the CHIP LIST of a
 * published hobbyist 8088 breadboard writeup (slador.uk) — a list of which
 * parts sit on a board is not copyrightable, and nothing of that build's
 * ROM, code or schematic is here. The 8284 and the 74-series glue carry no
 * registers, so they are not machine devices; they are wiring the extractor
 * infers. The port map is ours.
 */
export const TIERA8088 = Object.freeze({
    clockHz: 5_000_000,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x1ffff },   // 128K
        { kind: 'rom', start: 0xe0000, end: 0xfffff },   // 128K flash, holds the reset vector
    ],
    chips: [
        { kind: 'ppi', name: 'ppi1', at: 0x00 },            // text LCD, LEDs, switches
        { kind: 'pit', name: 'pit1', at: 0x20, irq: 0 },    // OUT0 -> IRQ0, the timer tick
        { kind: 'pic', name: 'pic1', at: 0x40 },
    ],
});

/**
 * A serial + SD-card 8086 reference build: an 8086, 256K of RAM and 256K of
 * ROM, an 8259, an 8251 UART, and an SD-card interface.
 *
 * Named for its SHAPE, not its source — deliberately, because the build it
 * is modelled on is a personal project that carries NO LICENCE (all rights
 * reserved). Only the non-copyrightable facts were used: the list of chips
 * from its public README and nothing else — no ROM, no .asm, no schematic,
 * and its author's handle is not embedded in our shipped API. A chip roster
 * this generic (8086 + PIC + UART + SD + 256K/256K) is a natural
 * configuration, not that project's intellectual property.
 *
 * The SD interface and an unconnected graphic LCD are NOT modelled here; the
 * SPI side lives in sdcard-spi.js and attaches as a device when a lesson
 * wants it. The port map is ours.
 */
export const SDCARD8086 = Object.freeze({
    clockHz: 10_000_000,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x3ffff },   // 256K
        { kind: 'rom', start: 0xc0000, end: 0xfffff },   // 256K, holds the reset vector
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x40 },
        { kind: 'usart8251', name: 'uart1', at: 0x00, irq: 0 },   // 8251 IRQ -> IRQ0
    ],
});

/**
 * A PC/XT-shaped machine: the real IBM XT I/O map, so a corpus program
 * written for a PC finds its hardware where it expects. 8259 at 20h, 8254 at
 * 40h, 8255 at 60h, the PC speaker gated off port 61h, and the CGA card at
 * 3D0h. 640K of RAM, a small BIOS ROM at the top holding the reset vector.
 *
 * This is where the speaker and the CGA status card actually live in this
 * lane — the ports are the ones the 24 corpus writes to 61h and the retrace
 * polls on 3DAh are aimed at. A DOS-service tier that carries no hardware can
 * name these same chip kinds in its own config to make a beep audible.
 */
export const PCXT8086 = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x9ffff },   // 640K
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K BIOS, holds the reset vector
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },                       // XT: 8259 at 20-21h
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },               // XT: 8254 at 40-43h, OUT0 -> IRQ0
        { kind: 'ppi', name: 'ppi1', at: 0x60 },                       // XT: 8255 at 60-63h
        { kind: 'pcspeaker', name: 'spk', ppi: 'ppi1', pit: 'pit1' },  // 61h bits 0/1 gate counter 2
        { kind: 'cga', name: 'cga1', at: 0x3d0 },                      // CGA at 3D0-3DFh
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
        this._nmiPending = false;
        /** Regions of the memory space, in declaration order. */
        this._mem = config.regions.map((r) => ({ ...r }));
        /** Decoded windows, split by which bus they answer on. */
        this._io = [];
        this._mmio = [];

        // The PC speaker is not a bus chip — it observes an 8255 port and an
        // 8254 counter that ARE, so it is built in a second pass once they
        // exist. Collect its configs here.
        const speakerConfigs = [];
        // The DMA page latch names the 8237 it extends, which may be declared
        // after it, so it is built in the same second pass as the speaker.
        const pageConfigs = [];

        for (const c of config.chips || []) {
            if (c.kind === 'pcspeaker') { speakerConfigs.push(c); continue; }
            if (c.kind === 'dmapage') { pageConfigs.push(c); continue; }
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
            } else if (c.kind === 'pit') {
                chip = new I8254({
                    onOutput: (channel, level) => this._pitOutput(c, channel, level),
                });
            } else if (c.kind === 'pic') {
                // The INTR output is polled in step(); the hook is only a
                // convenience for a test or UI that wants the edge.
                chip = new I8259({
                    onInterrupt: (active) => { if (this.hooks.onIntr) this.hooks.onIntr(c.name, active); },
                });
            } else if (c.kind === 'usart8251') {
                chip = new I8251({
                    onTx: (byte) => { if (this.hooks.onSerial) this.hooks.onSerial(byte, this.tMs); },
                });
            } else if (c.kind === 'cga') {
                chip = new CGACard(config.clockHz, {
                    onVSync: () => { if (this.hooks.onVSync) this.hooks.onVSync(); },
                });
            } else if (c.kind === 'hercules') {
                chip = new HerculesCard(config.clockHz, {
                    onVSync: () => { if (this.hooks.onVSync) this.hooks.onVSync(); },
                });
            } else if (c.kind === 'dma') {
                chip = new I8237({
                    // TC is the pin that tells a peripheral the count ran out;
                    // the FDC ends its transfer on it. Surfaced as a hook so a
                    // machine can wire it without the 8237 knowing who listens.
                    onTerminalCount: (ch) => { if (this.hooks.onDmaComplete) this.hooks.onDmaComplete(c.name, ch); },
                    onHrq: (active) => { if (this.hooks.onDmaRequest) this.hooks.onDmaRequest(c.name, active); },
                });
            } else if (c.kind === 'fdc') {
                chip = new UPD765({
                    onMotorChange: (drive, on) => {
                        if (this.hooks.onMotorChange) this.hooks.onMotorChange(c.name, drive, on);
                    },
                }, { seekBeyondEnd: c.seekBeyondEnd });
            } else if (c.kind === 'vga') {
                chip = new VGACard(config.clockHz, {
                    onVSync: () => { if (this.hooks.onVSync) this.hooks.onVSync(); },
                });
            } else {
                chip = new MC6850({
                    onTx: (byte) => { if (this.hooks.onSerial) this.hooks.onSerial(byte, this.tMs); },
                });
            }
            this.chips[c.name] = chip;
            // `stride` is the address step between consecutive registers. It
            // is 1 for a chip whose register select rides A0, and 2 for the
            // "even addresses only" wiring an 8086's 16-bit bus gives a
            // byte-wide device — data at the base, the next register two
            // ports up, the odd address in between mirroring the register
            // below it (A0 unwired).
            const stride = c.stride || 1;
            const win = {
                name: c.name, chip, regs, stride,
                start: c.at, end: c.at + stride * span - 1,
            };
            ((c.bus ?? 'io') === 'io' ? this._io : this._mmio).push(win);
        }

        // The master PIC — the one step() polls to deliver INTR. A breadboard
        // has at most one; if there are several, the first declared wins.
        this._pic = Object.values(this.chips).find((c) => c instanceof I8259) || null;

        // Wire each interrupting peripheral's output to its PIC line. The PIT
        // routes through _pitOutput (it has three outputs, only one of which
        // is the IRQ source); a serial chip drives onIrqChange directly. The
        // wiring is a second pass so a peripheral declared before the PIC in
        // config order still finds it.
        this._irqLines = {};
        for (const c of config.chips || []) {
            if (c.irq == null) continue;
            const chip = this.chips[c.name];
            if (chip instanceof I8254) {
                this._irqLines[c.name] = { irq: c.irq, channel: c.irqChannel ?? 0 };
            } else if (chip && chip.hooks) {
                chip.hooks.onIrqChange = (asserted) => {
                    if (this._pic) this._pic.setIRQ(c.irq, asserted ? 1 : 0);
                };
            }
        }

        // The page latch: a second window onto an already-built 8237, reached
        // through readPage/writePage rather than read/write. It is registered
        // as a decoded window but NOT added to this.chips -- the page bytes
        // live inside the 8237 and are already in its getState(), and a second
        // entry would snapshot them twice and restore them twice.
        for (const c of pageConfigs) {
            const dma = this.chips[c.dma];
            if (!dma) {
                throw new Error(
                    `machine config: dmapage '${c.name}' names dma '${c.dma}', which is not a `
                    + `declared chip. The latch supplies A16-A19 for that 8237 and is inert `
                    + `without it.`);
            }
            const span = c.span || REGS.dmapage;
            const stride = c.stride || 1;
            this._io.push({
                name: c.name, regs: REGS.dmapage, stride,
                chip: { read: (r) => dma.readPage(r), write: (r, v) => dma.writePage(r, v) },
                start: c.at, end: c.at + stride * span - 1,
            });
        }

        // Build the PC speaker(s) now that the 8255 and 8254 they observe
        // exist. Each reads its counter's divisor on demand and listens to a
        // named 8255 port (61h = port B on a PC) through _portChange.
        this._speakers = [];
        for (const c of speakerConfigs) {
            const pitName = c.pit;
            const channel = c.channel ?? 2;
            const spk = new PCSpeaker({
                readDivisor: () => {
                    const pit = this.chips[pitName];
                    const cnt = pit && pit.counters && pit.counters[channel];
                    return cnt ? cnt.reload : 0;
                },
            });
            this.chips[c.name] = spk;
            this._speakers.push({ spk, ppi: c.ppi, port: c.port ?? 'b' });
        }

        this.cpu = new I8086({
            read: (a) => this._read(a),
            write: (a, v) => this._write(a, v),
            in: (p) => this._in(p),
            out: (p, v) => this._out(p, v),
            // Asked between REP iterations, so a long block move does not
            // starve the timer -- and so the 8086's mid-REP segment-override
            // erratum has something to happen to.
            intPending: () => !!(this._pic && this._pic.intActive),
        });
    }

    /** The tone the speaker is producing, if any. {hz, on} or null. */
    audioTone() {
        for (const { spk } of this._speakers || []) {
            if (spk.on) return spk.audioTone();
        }
        // Nothing sounding: report the first speaker's silent tone, or null.
        if (this._speakers && this._speakers.length) return this._speakers[0].spk.audioTone();
        return null;
    }

    /** Machine time in (fractional) milliseconds. */
    get tMs() { return this.cycles * 1000 / this.clockHz; }

    // ---- the memory bus -------------------------------------------------
    _read(addr) {
        for (const w of this._mmio) {
            if (addr >= w.start && addr <= w.end) return w.chip.read(regOf(w, addr));
        }
        for (const r of this._mem) if (addr >= r.start && addr <= r.end) return this.mem[addr];
        return 0xff;   // open bus reads high, like the undriven data lines
    }

    _write(addr, val) {
        for (const w of this._mmio) {
            if (addr >= w.start && addr <= w.end) { w.chip.write(regOf(w, addr), val); return; }
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
            if (port >= w.start && port <= w.end) return w.chip.read(regOf(w, port));
        }
        return 0xff;
    }

    _out(port, val) {
        for (const w of this._io) {
            if (port >= w.start && port <= w.end) { w.chip.write(regOf(w, port), val); return; }
        }
    }

    // ---- pins -----------------------------------------------------------
    /** @param {string} chipName @param {'a'|'b'|'c'} port @param {number} value @param {number} out */
    _portChange(chipName, port, value, out) {
        // The speaker sits on a PPI port (61h = port B): the low two bits gate
        // the timer into the cone. Route the written latch to it.
        if (this._speakers) {
            for (const s of this._speakers) {
                if (s.ppi === chipName && s.port === port) s.spk.setControl(value);
            }
        }
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

    /** A PIT counter's OUT changed. If it is the wired IRQ source, drive the PIC. */
    _pitOutput(config, channel, level) {
        const wiring = this._irqLines[config.name];
        if (wiring && wiring.channel === channel && this._pic) {
            this._pic.setIRQ(wiring.irq, level ? 1 : 0);
        }
        if (this.hooks.onPitOutput) this.hooks.onPitOutput(config.name, channel, level);
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

    /**
     * Request a non-maskable interrupt. NMI is edge-triggered, ignores the
     * interrupt flag, and always takes vector 2 — the parity-error / power-
     * fail / coprocessor line, or on a breadboard just a button. Latched
     * here and delivered before the next instruction; multiple calls before
     * delivery collapse to one edge.
     */
    nmi() { this._nmiPending = true; }

    /**
     * Deliver a pending hardware interrupt. NMI wins over INTR and ignores
     * IF; a maskable INTR is taken only when the PIC's line is asserted and
     * IF is set. Either wakes a halted CPU. Returns true if one was taken.
     */
    _serviceInterrupts() {
        if (this._nmiPending) {
            this._nmiPending = false;
            this.cpu.interrupt(2);        // NMI is vector 2, unconditional
            return true;
        }
        if (!this._pic || !this._pic.intActive) return false;
        // NOT a bare IF test: the core also holds a one-instruction shadow
        // after a segment-register load, so that `mov ss,ax` / `mov sp,imm`
        // cannot be interrupted between the two. canTakeInterrupt() is both
        // halves.
        if (!this.cpu.canTakeInterrupt()) return false;
        const vector = this._pic.acknowledge();
        this.cpu.interrupt(vector);   // pushes flags/cs/ip, clears halted
        return true;
    }

    /** Execute one instruction (or, while halted, let time pass). */
    step() {
        // A hardware interrupt is checked before the next instruction; it
        // also wakes a HLT that was waiting for the timer or the UART.
        this._serviceInterrupts();
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
