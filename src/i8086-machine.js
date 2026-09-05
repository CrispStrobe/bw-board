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
import { ADC0809 } from './adc0809.js';
import { DAC0832 } from './dac0832.js';
import { HerculesCard } from './hercules-card.js';
import { VGACard } from './vga-card.js';
import { EGACard } from './ega-card.js';
import { I8237 } from './i8237.js';
import { UPD765 } from './upd765.js';
import { SBDSP } from './sb-dsp.js';
import { YM3812 } from './ym3812.js';
import { AudioBus } from './audio-bus.js';

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
 * @property {'8086'|'80186'} [variant] which chip the core is. Default
 *   '8086'. '80186' adds the fifteen opcodes the 186 put in the holes the
 *   8086 left as decode aliases and masks shift counts to five bits, which
 *   is the one difference a program can SEE on an instruction both parts
 *   have. A breadboard 80188 is the reason this exists: same ISA, eight-bit
 *   bus, and nothing else in this file changes.
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
    // THE CHANNEL IS AN ADDRESS, NOT A DATA BYTE. A0-A2 drive the 0809's mux
    // select lines, so eight ports select eight channels; the ninth reads
    // End-Of-Conversion, which is the only way to know a result is ready on a
    // bench with no PIC to deliver an interrupt.
    adc0809: 9,
    // FOUR PORTS FOR A ONE-BYTE CHIP, because the 0832's two latches are its
    // feature: 310h loads and transfers, 311h stages, 312h is the XFER strobe.
    // A card that tied XFER low would need one port and could not move two
    // converters at the same instant.
    dac0832: 4,
    pic: 2,          // A0 selects command/status vs data/mask
    usart8251: 2,    // C/D selects data vs control/status
    cga: 16,         // the 3D0h-3DFh block (mode 3D8h, colour 3D9h, status 3DAh)
    hercules: 16,    // the 3B0h-3BFh block (mode 3B8h, status 3BAh, config 3BFh)
    vga: 32,         // the 3C0h-3DFh block (attr/seq/gc/crtc/dac/misc + status)
    ega: 32,         // the 3C0h-3DFh register block (framebuffer at A0000 is a second, mem window)
    dma: 16,         // the 8237's 00h-0Fh: four channels, then the command block
    // THE PAGE LATCH IS NOT PART OF THE 8237. The chip counts sixteen bits of
    // address and the XT needs twenty, so IBM bolted a separate 74LS670 latch
    // file at 80h-8Fh to supply A16-A19. It is a second decoded window onto the
    // same chip, which is why it is its own kind rather than a wider span: the
    // two blocks are 0x70 ports apart and nothing decodes the gap.
    dmapage: 16,
    fdc: 8,          // the uPD765 card's 3F0h-3F7h (DOR 3F2h, MSR 3F4h, data 3F5h)
    // The Sound Blaster's 2x0h-2xFh block: reset 2x6h, read 2xAh, write 2xCh,
    // read-status 2xEh. The OPL at 388h is a SEPARATE chip and a separate
    // decode, not part of this window.
    sb: 16,
    // The OPL2 is TWO ports at 388h/389h, and it is a SEPARATE chip from the
    // Sound Blaster's 2x0h block even on a card that carries both -- which is
    // why it is its own kind and its own decode rather than a wider `sb`.
    opl2: 2,
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
        { kind: 'ram', start: 0x00000, end: 0x9ffff },   // 640K conventional
        { kind: 'ram', start: 0xb8000, end: 0xbffff },   // the CGA text page (B800:0000) — the renderer reads it
        { kind: 'rom', start: 0xf0000, end: 0xfffff },   // 64K BIOS, holds the reset vector at FFFF0h
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },                       // XT: 8259 at 20-21h
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },               // XT: 8254 at 40-43h, OUT0 -> IRQ0 (18.2 Hz tick)
        { kind: 'ppi', name: 'ppi1', at: 0x60 },                       // XT: 8255 at 60-63h (keyboard scancode + config)
        { kind: 'pcspeaker', name: 'spk', ppi: 'ppi1', pit: 'pit1' },  // 61h bits 0/1 gate counter 2
        { kind: 'dma', name: 'dma1', at: 0x00 },                       // XT: 8237 at 00-0Fh
        { kind: 'dmapage', name: 'dmapg', at: 0x80, dma: 'dma1' },     // the 74LS670 page latch at 80-8Fh
        // uPD765 at 3F0-3F7h, IRQ6, DMA ch 2. The `dma: 'dma1'` field IS the
        // wire, not a label: without it the machine builds both chips and
        // connects neither, the FDC falls back to non-DMA execution, raises
        // RQM and waits forever for a host byte that never comes. The failure
        // is a silent hang with no error — anyone hand-writing this config
        // must not omit it.
        { kind: 'fdc', name: 'fdc1', at: 0x3f0, irq: 6, dma: 'dma1' },
        { kind: 'cga', name: 'cga1', at: 0x3d0 },                      // CGA at 3D0-3DFh (text page at B800:0000)
    ],
});

/**
 * The UART-shell example — the 8086's counterpart to the Z80 and 6502 serial
 * monitors. An 8086, 64K of RAM, a 32K ROM holding the reset vector, and a
 * single 16550 UART at port 10h. Load rom/serial-monitor.bin (built by
 * scripts/build-serial-monitor.mjs) and it boots itself into a shell that
 * prints a banner and echoes what you type, driving the same SerialConsole
 * the other MCUs use — no BIOS, no disk, nothing to configure.
 */
export const SERIALSHELL8086 = Object.freeze({
    clockHz: 5_000_000,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'uart16550', name: 'uart1', at: 0x10 },  // the terminal
    ],
});

/**
 * The display-shell example — the screen counterpart to SERIALSHELL8086. An
 * 8086, 64K of RAM, the CGA text page mapped at B800:0000, a CGA card at
 * 3D0-3DFh, and a 32K ROM holding the reset vector. Load rom/cga-demo.bin
 * (built by scripts/build-cga-demo.mjs) and it boots itself: it selects CGA
 * text mode and writes a message straight into the text page, which the
 * VdpScreen widget renders — a board that "boots into a screen" with no BIOS,
 * no disk, nothing to configure.
 */
export const CGADEMO8086 = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K conventional
        { kind: 'ram', start: 0xb8000, end: 0xbffff },   // the CGA text page (B800:0000) — the renderer reads it
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'cga', name: 'cga1', at: 0x3d0 },        // CGA at 3D0-3DFh (text page at B800:0000)
    ],
});

/**
 * The interrupt example — the third self-booting board, and the one that proves
 * the tier's interrupt path from a program's point of view. An 8086, 64K RAM,
 * the CGA text page, an 8259 PIC at 20h, an 8254 PIT at 40h wired OUT0->IR0,
 * and a 32K ROM. Load rom/timer-demo.bin (scripts/build-timer-demo.mjs) and it
 * hooks INT 8, programs the PIT to tick, and paints a live counter into the
 * text page every timer interrupt: 8254 OUT0 -> 8259 IR0 -> CPU INT 8 -> ISR ->
 * B800 -> EOI, the whole chain, driven only by the running program. The screen
 * shows a climbing hex counter with no BIOS and no DOS.
 */
export const TIMERDEMO8086 = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K conventional (IVT, stack, the counter)
        { kind: 'ram', start: 0xb8000, end: 0xbffff },   // the CGA text page (B800:0000)
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },         // 8259 at 20-21h (IR0 -> INT 8)
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 }, // 8254 at 40-43h, OUT0 -> IR0
        { kind: 'cga', name: 'cga1', at: 0x3d0 },        // CGA at 3D0-3DFh (text page at B800:0000)
    ],
});

/**
 * The Hercules display board — the mono-graphics member of the display-demo
 * set (ROADMAP E7.1). An 8086, 64K RAM, the HGC mono page mapped at B000:0000,
 * a Hercules card at 3B0-3BFh, and a 32K ROM. Load rom/hercules-demo.bin
 * (scripts/build-hercules-demo.mjs) and it sets HGC graphics mode and fills the
 * 720x348 mono framebuffer with vertical bars.
 *
 * NOTE (2026-09-04): the firmware and the card STATE are verified, but the
 * DOS/host renderer does NOT yet decode HGC — its videoFrame() refuses mode 6h
 * by name ("Hercules graphics is 720x348 mono at B0000h, which this renderer
 * does not draw"). So this board is not yet wired into the Machine-Loader: it
 * would show a refusal string, not a picture. It ships as verified state now,
 * ready for when the renderer's four-bank (y mod 4, 8KB banks) decode lands.
 */
export const HERCDEMO8086 = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K conventional
        { kind: 'ram', start: 0xb0000, end: 0xb7fff },   // the HGC mono page (B000:0000) — 32K, four 8K banks
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'hercules', name: 'hgc1', at: 0x3b0 },   // Hercules at 3B0-3BFh (mono page at B000:0000)
    ],
});

/**
 * The VGA display board — the 256-colour member of the display-demo set
 * (ROADMAP E7.1), and the one the DOS/host renderer already draws today (it
 * decodes mode 13h / vga8). An 8086, 64K RAM, the mode-13h framebuffer mapped
 * at A000:0000 (320x200 linear, one byte a pixel), a VGA card at 3C0-3DFh, and
 * a 32K ROM. Load rom/vga-demo.bin (scripts/build-vga-demo.mjs) and it programs
 * mode 13h, sets a DAC palette, and writes a picture into A0000 — which
 * VdpScreen renders in colour, no BIOS.
 *
 * This is the first display board besides CGA whose renderer decode ships:
 * mode 13h is a LINEAR framebuffer with no bank interleave, so it is the
 * simplest of the graphics modes to fill and the most colourful payoff.
 */
export const VGADEMO8086 = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K conventional
        { kind: 'ram', start: 0xa0000, end: 0xaffff },   // the mode-13h framebuffer (A000:0000), 64K
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'vga', name: 'vga1', at: 0x3c0 },        // VGA register block at 3C0-3DFh
    ],
});

/**
 * The keyboard board — the INPUT counterpart to the display set, proving the
 * XT keyboard hardware path end to end. An 8086, 64K RAM, the CGA text page, an
 * 8259 PIC at 20h, an 8255 PPI at 60h (the keyboard port), a CGA card, and a
 * 32K ROM. Call machine.keyIn(scancode) and it latches the byte at port A and
 * raises IRQ1; rom/keyboard-demo.bin (scripts/build-keyboard-demo.mjs) hooks
 * INT 09h, reads 0x60, acknowledges via the port-B strobe, translates set-1
 * scancodes to ASCII, echoes to the text page, and issues its own EOI.
 *
 * This is the first thing in the tier to drive the 8259's IRQ1 path for real —
 * setIRQ, priority, acknowledge, EOI — rather than calling cpu.interrupt(9)
 * directly. The demo must EOI itself (bare-metal, no BIOS) or exactly one key
 * ever arrives, the same failure the timer demo's EOI guards against.
 */
export const KBDDEMO8086 = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K conventional (IVT, stack, cursor)
        { kind: 'ram', start: 0xb8000, end: 0xbffff },   // the CGA text page (B800:0000)
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },         // 8259 at 20-21h (IR1 -> INT 9)
        { kind: 'ppi', name: 'ppi1', at: 0x60 },         // 8255 at 60-63h (keyboard: scancode at 60h, ack at 61h)
        { kind: 'cga', name: 'cga1', at: 0x3d0 },        // CGA at 3D0-3DFh (echo shows at B800:0000)
    ],
});

/**
 * The EGA display board — the 16-colour PLANAR member of the display-demo set
 * (ROADMAP E7.1), and the hardest. An 8086, 64K RAM, an EGA card at 3C0-3DFh,
 * and a 32K ROM. There is deliberately NO RAM region at A0000: the EGA card
 * mediates that window (a write is routed by the sequencer map mask into one or
 * more of the four bit planes, not stored linearly). Load rom/ega-demo.bin
 * (scripts/build-ega-demo.mjs) and it selects a planar graphics mode, sets the
 * 16-entry attribute palette, and fills the four planes with distinct patterns.
 *
 * NOTE (2026-09-04): firmware + card STATE (registers + planes) are verified,
 * but the DOS/host renderer's planar decode is the other lane's half and is not
 * written yet, so this board is NOT wired into the Machine-Loader — same
 * discipline as Hercules before its decode landed. Ships as verified state.
 */
export const EGADEMO8086 = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K conventional (NO RAM at A0000 — the EGA card owns it)
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'ega', name: 'ega1', at: 0x3c0 },        // EGA register block at 3C0-3DFh; framebuffer at A0000
    ],
});

/**
 * The capstone board — TWO interrupt sources at once. An 8086, 64K RAM, the CGA
 * text page, an 8259 PIC, an 8254 PIT wired OUT0->IR0, an 8255 keyboard port,
 * and a CGA card. Load rom/desk-demo.bin (scripts/build-desk-demo.mjs) and the
 * 8259 arbitrates both live IRQ lines: IRQ0 (the timer) updates a hex clock at
 * the top-right every tick, and IRQ1 (the keyboard) echoes what you type onto a
 * line below — concurrently, each interrupt acknowledged and EOI'd on its own.
 * The timer and keyboard demos each drive one source; this proves they compose
 * through the PIC's priority and two independent EOIs.
 */
export const DESKDEMO8086 = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K conventional
        { kind: 'ram', start: 0xb8000, end: 0xbffff },   // the CGA text page (B800:0000)
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },         // 8259: IR0 -> INT 8, IR1 -> INT 9
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 }, // 8254 OUT0 -> IR0 (the clock)
        { kind: 'ppi', name: 'ppi1', at: 0x60 },         // 8255 keyboard: scancode at 60h, ack at 61h
        { kind: 'cga', name: 'cga1', at: 0x3d0 },        // CGA text page at B800:0000
    ],
});

/**
 * The BLINK board — the smallest 8086 that is about PINS, and the one the Z80
 * and 6502 tiers have while the 8086 did not. An 8086, 64K RAM, an 8255 at 60h,
 * a 32K ROM, and nothing else: no CGA, no floppy, nothing that is not the
 * lesson, so a learner's first 8086 board is the one where a pin means an LED.
 * It is what lite's LED panel (draws 8255 port pins gated on direction) and
 * switch panel (setInput drives a bit) and pseudocode pin I/O (P1/P2/P3 ->
 * ports A/B/C) point at.
 *
 * Load rom/blink-demo.bin (scripts/build-blink-demo.mjs) and it walks a pattern
 * across the LEDs on PORT B and mirrors a switch read from PORT C. LEDs live on
 * port B, not port A, deliberately: on a PC the keyboard scancode latches into
 * this same 8255's port A, so a board that drove LEDs there would ask a question
 * about two owners of one port that a first board should never raise.
 */
export const BLINK8086 = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x0ffff },   // 64K conventional
        { kind: 'rom', start: 0xf8000, end: 0xfffff },   // 32K, holds the reset vector
    ],
    chips: [
        { kind: 'ppi', name: 'ppi1', at: 0x60 },         // 8255 GPIO: LEDs on port B (61h), switches on port C (62h)
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
        // Flattened advance schedule, built on first use. null means stale.
        // Avoid allocating Object.keys(this.chips) for every instruction.
        this._advList = null;
        // Monotonic invalidation token for the host renderer. It changes on
        // visible VRAM/register writes, not on every CPU instruction.
        this.displayRevision = 0;
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
                    variant: c.variant,   // '8253' for the original PC/XT part (no read-back)
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
            } else if (c.kind === 'adc0809') {
                chip = new ADC0809(config.clockHz, {vref: c.vref, adcClockHz: c.adcClockHz});
            } else if (c.kind === 'dac0832') {
                chip = new DAC0832({vref: c.vref});
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
            } else if (c.kind === 'opl2') {
                chip = new YM3812();
            } else if (c.kind === 'sb') {
                // The DSP counts MACHINE cycles, so it is told which clock it
                // is counting rather than guessing -- the lesson the AY's own
                // crystal taught this tier (see m6502-machine.js's ayRatio).
                chip = new SBDSP({ clockHz: config.clockHz });
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
            } else if (c.kind === 'ega') {
                chip = new EGACard(config.clockHz);
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

        // The XT keyboard sits on the first 8255: its scancode is read at port A
        // and its acknowledge is the port-B bit-7 strobe. keyIn() latches a byte
        // and raises IRQ1; the strobe (bit 7 rising, seen in _out) clears it.
        this._kbdPpi = Object.values(this.chips).find((c) => c instanceof I8255) || null;
        this._kbdStrobe = false;

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

        // The EGA framebuffer: a SECOND, memory-bus window onto the already-built
        // EGA card at A0000-AFFFF, reached through memRead/memWrite (the planar
        // path) rather than read/write (the registers). Registered as an mmio
        // window but NOT added to this.chips -- the planes live inside the card
        // and are already in its getState(). This is why EGA memory is not a plain
        // RAM region: a write there is routed by the sequencer map mask into the
        // selected planes, not stored linearly.
        for (const c of config.chips) {
            if (c.kind !== 'ega') continue;
            const ega = this.chips[c.name];
            this._mmio.push({
                name: c.name + '.fb', regs: 0x10000, stride: 1,
                chip: { read: (o) => ega.memRead(o), write: (o, v) => ega.memWrite(o, v) },
                start: 0xa0000, end: 0xaffff,
            });
        }

        // The Sound Blaster's transfer path: the same 8237 the floppy uses, on
        // its own channel (1 by convention), and an 8259 line for the
        // end-of-block interrupt. Everything hard here was already built --
        // which is why E6.8.11 calls the digital half of audio nearly free.
        for (const c of config.chips || []) {
            if (c.kind !== 'sb') continue;
            const sb = this.chips[c.name];
            const dma = c.dma ? this.chips[c.dma] : null;
            const ch = c.dmaChannel ?? 1;
            if (sb && dma) {
                sb.hooks.onDmaRequest = () => {
                    let got = null;
                    // The request IS the DRQ pulse, asserted around the single
                    // byte -- without it transfer() sees no requesting channel
                    // and moves nothing while reporting success, which is the
                    // silently-corrupt-read the FDC path documents above.
                    dma.dreq(ch, true);
                    const moved = dma.transfer(
                        (a) => (a === null ? 0x80 : this._read(a)),
                        (a, b) => { if (a === null) got = b & 0xff; },
                        1);
                    dma.dreq(ch, false);
                    return moved === 0 ? false : (got === null ? false : got);
                };
            }
            if (sb && c.irq != null && this._pic) {
                // A LEVEL, NOT AN EVENT. setIRQ takes a line state, and the
                // DSP's end-of-block is an edge, so it is raised here and
                // dropped when the driver acknowledges by reading 2xEh --
                // which is the same port read that clears `sb.irq`. A line
                // left asserted would re-enter the handler forever.
                sb.hooks.onIrq = () => this._pic.setIRQ(c.irq, 1);
                const drop = () => { if (!sb.irq) this._pic.setIRQ(c.irq, 0); };
                const origRead = sb.read.bind(sb);
                sb.read = (reg) => { const v = origRead(reg); drop(); return v; };
            }
        }

        this._buildPageTable();

        // The floppy transfer path. The FDC drives one byte per DMA request
        // (its onDmaRequest hook); the byte crosses through _read/_write — the
        // SAME memory decode the CPU uses, so a DMA write into a ROM window is
        // discarded exactly as a CPU write is, and a bad page register cannot
        // silently overwrite the BIOS. The 8237's terminal count is chained
        // back to the FDC's TC pin WITHOUT dropping the existing onDmaComplete
        // forward a UI observes — the wire that, unmade, hangs a BIOS read.
        for (const c of config.chips || []) {
            if (c.kind !== 'fdc' || !c.dma) continue;
            const fdc = this.chips[c.name];
            const dma = this.chips[c.dma];
            if (!fdc || !dma) continue;
            const dmaChannel = c.dmaChannel ?? 2;
            let fromMem = 0xff;
            fdc.hooks.onDmaRequest = (dir, byte) => {
                // The FDC's request IS the DRQ pulse — assert it around the
                // single-byte transfer, or transfer()'s pendingChannel() sees
                // no requesting channel and moves nothing while reporting
                // success (a silently corrupt read).
                dma.dreq(dmaChannel, true);
                const moved = dma.transfer(
                    (a) => (a === null ? byte : this._read(a)),
                    (a, b) => { if (a === null) fromMem = b & 0xff; else this._write(a, b); },
                    1);
                dma.dreq(dmaChannel, false);
                if (moved === 0) return false;   // masked or finished: terminal count
                return dir === 'read' ? fromMem : true;
            };
            const prevTC = dma.hooks.onTerminalCount;
            dma.hooks.onTerminalCount = (ch) => {
                if (ch === dmaChannel) fdc.terminalCount();
                if (prevTC) prevTC(ch);
            };
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

        this.variant = config.variant || '8086';
        this.cpu = new I8086({
            read: (a) => this._read(a),
            write: (a, v) => this._write(a, v),
            in: (p) => this._in(p),
            out: (p, v) => this._out(p, v),
            // Asked between REP iterations, so a long block move does not
            // starve the timer -- and so the 8086's mid-REP segment-override
            // erratum has something to happen to.
            intPending: () => !!(this._pic && this._pic.intActive),
        }, { variant: this.variant });
        // Interrupt-trap bridge (E6.8.3): a SOFTWARE INT n (INT/INT3/INTO and the
        // internal exceptions) executes inside the core, so the core emits it via
        // cpu.onInterrupt; forward it to the machine's single onInterrupt hook so
        // the debugger sees one stream — 'int' from here, 'irq'/'nmi' from
        // _serviceInterrupts. The core must emit from the opcode/exception sites,
        // NOT from its shared _interrupt(n) funnel, which the hardware path also
        // uses and which would then double-fire against 'irq'/'nmi'.
        this.cpu.onInterrupt = (ev) => { if (this.hooks.onInterrupt) this.hooks.onInterrupt(ev); };
    }

    /**
     * Can anything on this machine render samples (E6.8.11a)? Asked by the
     * debug target so `capabilities().audio` advertises 'samples' only when
     * a chip can actually produce them — the same rule that keeps 'cycle' out
     * of `steps`.
     */
    canRenderAudio() {
        for (const { spk } of this._speakers || []) {
            if (spk && typeof spk.renderAudio === 'function') return true;
        }
        for (const c of Object.values(this.chips || {})) {
            if (c && typeof c.renderAudio === 'function') return true;
        }
        return false;
    }

    /**
     * Per-voice {hz, on}, ALWAYS AN ARRAY (E6.8.11a) -- and EMPTY when this
     * machine has no speaker at all. That distinction is the reason the
     * arity matters: an empty array is "no voices", a one-element array with
     * `on: false` is "a speaker that is silent", and the old `null` conflated
     * them into a value every caller had to null-check before it could ask
     * anything useful.
     */
    audioTone() {
        // DE-DUPLICATED, because a speaker is in BOTH lists: `_speakers` holds
        // it for the 61h wiring and `chips` holds it under its config name.
        // Collecting from both without a Set reports one speaker as two
        // voices -- which the preset test caught immediately, and which would
        // have been a UI showing a phantom oscillator otherwise.
        const seen = new Set();
        const out = [];
        const take = (c) => {
            if (!c || seen.has(c) || typeof c.audioTone !== 'function') return;
            seen.add(c);
            out.push(...c.audioTone());
        };
        for (const { spk } of this._speakers || []) take(spk);
        for (const c of Object.values(this.chips || {})) take(c);
        return out;
    }

    /**
     * The shared mixer and ring (E6.8.11a), built on first use so a machine
     * nobody listens to never allocates one.
     */
    get audio() {
        if (!this._audioBus) {
            this._audioBus = new AudioBus({ sampleRate: this.audioSampleRate || 48000 });
            for (const src of this._audioSources()) this._audioBus.addSource(src);
        }
        return this._audioBus;
    }

    _audioSources() {
        // Same de-duplication as audioTone(), and it matters more here: a
        // source added to the bus twice would be MIXED twice, which is a
        // doubled amplitude and a clip counter that blames the wrong thing.
        const seen = new Set();
        for (const { spk } of this._speakers || []) {
            if (spk && typeof spk.renderAudio === 'function') seen.add(spk);
        }
        for (const c of Object.values(this.chips || {})) {
            if (c && typeof c.renderAudio === 'function') seen.add(c);
        }
        return [...seen];
    }

    /** Machine time in (fractional) milliseconds. */
    get tMs() { return this.cycles * 1000 / this.clockHz; }

    // ---- the memory bus -------------------------------------------------
    /**
     * A 4 KB page table over the 1 MB space, so the common case is one array
     * index instead of two linear scans (E6.8.4a).
     *
     * MEASURED, NOT ASSUMED. `_read()` was two `for...of` scans per BYTE, and
     * a profile of a realistic XT config over 20 M accesses said: as shipped
     * 31.9 M ops/s, with indexed loops and an empty-MMIO guard 36.2 (1.13x,
     * not worth doing), with this table 65.2 (2.04x). A raw `mem[addr]` is
     * ~201, so this recovers about half the gap and the rest is the call
     * itself. The reason it matters at all is the other half of that
     * profile: the machine layer costs about two thirds of total execution
     * time, MORE than the CPU it wraps.
     *
     * A PAGE IS FAST ONLY IF IT IS ENTIRELY ONE THING. Any page touched by an
     * MMIO window, or straddling a region boundary, or covered by more than
     * one region, is marked SLOW and falls through to the original scans —
     * which are still there, unchanged, and are still the definition of
     * correct. This is a cache in front of the decode, not a replacement for
     * it, and that is deliberate: a fast path that had to reimplement the
     * mirroring and priority rules would be a second place for them to be
     * wrong.
     */
    _buildPageTable() {
        const PAGES = 1 << 8;                        // 1 MB / 4 KB
        const t = new Uint8Array(PAGES);             // 0 unmapped, 1 ram, 2 rom, 3 slow
        for (let p = 0; p < PAGES; p++) {
            const lo = p << 12, hi = lo + 0xfff;
            let kind = 0, slow = false;
            for (const w of this._mmio) {
                if (hi >= w.start && lo <= w.end) { slow = true; break; }
            }
            if (!slow) {
                for (const r of this._mem) {
                    if (hi < r.start || lo > r.end) continue;
                    // Partial cover, or a second region: the scan decides.
                    if (lo < r.start || hi > r.end || kind !== 0) { slow = true; break; }
                    kind = r.kind === 'rom' ? 2 : 1;
                }
            }
            t[p] = slow ? 3 : kind;
        }
        this._page = t;
    }

    _read(addr) {
        const k = this._page[addr >>> 12];
        if (k === 1 || k === 2) return this.mem[addr];
        if (k === 0) return 0xff;                    // open bus reads high
        return this._readSlow(addr);
    }

    /** The original decode, unchanged, and still the definition of correct. */
    _readSlow(addr) {
        for (const w of this._mmio) {
            if (addr >= w.start && addr <= w.end) return w.chip.read(regOf(w, addr));
        }
        for (const r of this._mem) if (addr >= r.start && addr <= r.end) return this.mem[addr];
        return 0xff;   // open bus reads high, like the undriven data lines
    }

    _write(addr, val) {
        if (addr >= 0xa0000 && addr <= 0xbffff) {
            this.displayRevision = (this.displayRevision + 1) >>> 0;
        }
        const k = this._page[addr >>> 12];
        if (k === 1) { this.mem[addr] = val & 0xff; return; }
        if (k === 2 || k === 0) return;              // ROM swallows it; unmapped goes nowhere
        this._writeSlow(addr, val);
    }

    _writeSlow(addr, val) {
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
        let val = 0xff;
        for (const w of this._io) {
            if (port >= w.start && port <= w.end) { val = w.chip.read(regOf(w, port)); break; }
        }
        // Port-access trap (E6.8.3): the value handed back is the one the program
        // sees, so the hook fires AFTER the read and reports what was read. This
        // does not reopen the refusal to DUMP the port space (i8086-debug.js:22):
        // that refuses a debugger-initiated read; this observes the PROGRAM's read
        // and never performs one of its own.
        if (this.hooks.onPortAccess) this.hooks.onPortAccess({ dir: 'in', port, value: val & 0xff });
        return val;
    }

    _out(port, val) {
        if (port >= 0x3b0 && port <= 0x3df) {
            this.displayRevision = (this.displayRevision + 1) >>> 0;
        }
        for (const w of this._io) {
            if (port >= w.start && port <= w.end) {
                const reg = regOf(w, port);
                w.chip.write(reg, val);
                // XT keyboard acknowledge: a write to the keyboard 8255's port B
                // (reg 1) with bit 7 HIGH strobes the latch clear and drops IRQ1.
                // The clear happens on the RISING edge — a program that sets bit 7
                // and leaves it there has still acknowledged — so edge, not level.
                if (w.chip === this._kbdPpi && reg === 1 && this._pic) {
                    const hi = (val & 0x80) !== 0;
                    if (hi && !this._kbdStrobe) this._pic.setIRQ(1, 0);
                    this._kbdStrobe = hi;
                }
                break;
            }
        }
        // Port-access trap (E6.8.3): fires on EVERY OUT, decoded or not — a debug
        // watch on "anything touches port 61h" wants the access the program made,
        // not only the ones that hit a chip. Zero cost when no watch is set.
        if (this.hooks.onPortAccess) this.hooks.onPortAccess({ dir: 'out', port, value: val & 0xff });
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

    /**
     * Does this machine deliver a real timer interrupt TO INT 8?
     *
     * The DOS layer asks because it SYNTHESISES a BIOS tick for benches with
     * no chips, and the two must never both fire on the same vector: a
     * program would then receive INT 8 from hardware and from machine time,
     * at rates with no relationship, and nothing would say so.
     *
     * THE VECTOR IS THE QUESTION, NOT THE WIRING, and asking the wrong one
     * cost a real regression. This used to return true whenever a PIT was
     * wired to a PIC at all. But a program may reprogram the 8259's ICW2 to
     * deliver IRQ0 somewhere else — the preemptive scheduler in the
     * pseudocode back end maps it to vector 70h precisely so that INT 8 and
     * INT 1Ch stay free for the BIOS tick. On that machine the old test said
     * "hardware makes its own tick", the synthetic one stood down, and
     * nothing fired INT 8 at all: measured, 163 ticks before the change and
     * ZERO after, for a program hooking INT 1Ch under the scheduler.
     *
     * So it asks what the hardware would actually deliver. `vectorBase | irq`
     * is what the 8259 hands the CPU on acknowledge; only if that is 8 does
     * the synthetic tick have a collision to avoid. This is READ LIVE rather
     * than cached, because ICW2 is written by the program at run time and a
     * value computed at construction would describe the machine before its
     * own startup code had configured it.
     */
    hasHardwareTimerIrq() {
        if (!this._pic) return false;
        for (const [name, w] of Object.entries(this._irqLines || {})) {
            if (!(this.chips[name] instanceof I8254)) continue;
            if (((this._pic.vectorBase | w.irq) & 0xff) === 8) return true;
        }
        return false;
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
        if (base <= 0xbffff && base + bytes.length > 0xa0000) {
            this.displayRevision = (this.displayRevision + 1) >>> 0;
        }
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
        this._advList = null;
        return dev;
    }

    _buildAdvanceList() {
        const list = [];
        let anyMs = false;
        for (const name of Object.keys(this.chips)) {
            const chip = this.chips[name];
            if (chip.advanceMs) { list.push(chip, 1); anyMs = true; }
            else if (chip.advance) list.push(chip, 0);
        }
        if (this.devices) {
            for (const name of Object.keys(this.devices)) {
                const dev = this.devices[name];
                if (dev.advance) list.push(dev, 0);
            }
        }
        this._anyMs = anyMs;
        this._advList = list;
        return list;
    }

    _advanceChips(n) {
        const list = this._advList !== null ? this._advList : this._buildAdvanceList();
        if (list.length === 0) return;
        // The OPL runs on its OWN 3.58 MHz crystal and generates at
        // clock/72, so it is advanced in MILLISECONDS of emulated time rather
        // than in machine cycles -- the same distinction the AY's crystal
        // taught this fleet, expressed as a different method name so the two
        // cannot be confused at a call site.
        const ms = this._anyMs ? n * 1000 / this.clockHz : 0;
        for (let i = 0; i < list.length; i += 2) {
            if (list[i + 1] === 1) list[i].advanceMs(ms);
            else list[i].advance(n);
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
            // Interrupt trap (E6.8.3): source distinguishes the delivered lines
            // the machine drives — 'nmi' here, 'irq' below — from a software INT n
            // (source 'int'), which executes inside the core and is emitted there.
            // "break on IRQ0" and "break on INT 21h" are different questions.
            if (this.hooks.onInterrupt) this.hooks.onInterrupt({ vector: 2, source: 'nmi' });
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
        if (this.hooks.onInterrupt) this.hooks.onInterrupt({ vector, source: 'irq' });
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

    /**
     * Press a key: the XT keyboard hardware path, the counterpart to serialIn.
     * The scancode appears at the keyboard 8255's port A (read at 0x60) and the
     * keyboard raises IRQ1 on the PIC — exactly what a bare-metal INT 09h reader
     * or a BIOS both sit on. The interrupt clears when the program strobes the
     * ack (port B bit 7), handled in _out. Host widgets map key events to set-1
     * scancodes and call this; it is machine-agnostic, needing only a PPI + PIC.
     */
    /**
     * WHAT THE WORLD CAN SEE THE MACHINE DOING — the counterpart to
     * `inputPoints()`, and the half that makes an LED possible.
     *
     * Each entry is one 8255 port: what the chip DRIVES (`value`), which bits
     * it drives at all (`dir`, 1 = driven by the chip), and what the pins
     * actually carry (`pins`, the latch where it drives and the input
     * elsewhere). All three are needed and none substitutes for another --
     * `value` alone would light an LED on a bit configured as an INPUT, which
     * is a lamp for a wire the chip is not driving.
     *
     * DIRECTION IS REPORTED HERE AND NOT IN `inputPoints()`, and the asymmetry
     * is deliberate rather than an oversight. A caller writing an input asks
     * "can I drive this", which only the write can answer. A caller DRAWING an
     * output must know, this frame, which bits mean anything -- and it is
     * reading a snapshot it is about to render, so a value that is one
     * instruction stale is exactly as stale as everything else in the frame.
     */
    outputPoints() {
        const out = [];
        for (const [name, chip] of Object.entries(this.chips || {})) {
            if (typeof chip.setInput !== 'function') continue;   // an 8255-shaped chip
            for (const port of ['a', 'b', 'c']) {
                const P = port.toUpperCase();
                out.push({
                    chip: name, port, bits: 8,
                    value: chip[`out${P}`] & 0xff,
                    dir: chip[`dir${P}`] & 0xff,
                    pins: chip[`_pins${P}`] ? chip[`_pins${P}`]() & 0xff : 0xff,
                });
            }
        }
        return out;
    }

    /**
     * THE ANALOG HALF OF THE SAME PAIR, and a separate reporter rather than an
     * extra shape inside `outputPoints()`.
     *
     * A DAC's output is a VOLTAGE. It has no per-bit direction, no pin latch
     * and no notion of "driven" -- the three fields that make an 8255 entry
     * mean something are all absent, and the one field that matters here has
     * no counterpart there. Returning both shapes from one method would give
     * callers a contract they had to type-test before using, which is the
     * thing `audioTone()` already refuses to do by always returning an array.
     *
     * `counts` is reported BESIDE `volts` because they are different facts: a
     * program wrote the code, the card chose the reference, and a learner
     * debugging "why is it half what I asked for" needs to see which of the
     * two is the surprise.
     *
     * @returns {Array<{chip: string, counts: number, volts: number, vref: number}>}
     */
    analogOutputs() {
        const out = [];
        for (const [name, chip] of Object.entries(this.chips || {})) {
            if (typeof chip.volts !== 'function') continue;
            out.push({ chip: name, counts: chip.counts | 0, volts: chip.volts(), vref: chip.vref });
        }
        return out;
    }

    /**
     * WHAT THE WORLD CAN PUT INTO THE MACHINE AS A VOLTAGE -- the ADC's
     * channels, so a knob widget can find them without being told a chip name.
     *
     * The digital pair splits the same way and for the same reason:
     * `inputPoints()` reports what EXISTS and leaves the present value to the
     * write, because a channel's voltage is the world's to state and the
     * machine has no opinion about it until something says so.
     *
     * @returns {Array<{chip: string, channels: number, vref: number}>}
     */
    analogInputs() {
        const out = [];
        for (const [name, chip] of Object.entries(this.chips || {})) {
            if (typeof chip.setChannel !== 'function') continue;
            out.push({ chip: name, channels: 8, vref: chip.vref });
        }
        return out;
    }

    /**
     * WHAT A WIDGET OR A CODE BLOCK CAN CHANGE ABOUT THE WORLD.
     *
     * Every input point the machine currently has, as `{chip, port, bits}`.
     * Today that is the 8255's ports, which is where a breadboard hangs its
     * switches -- the same ports `setInput` drives from a drawn board.
     *
     * DIRECTION IS NOT REPORTED HERE, DELIBERATELY. A port's direction is a
     * mode word the PROGRAM writes and can rewrite at any instruction, so a
     * list computed once would be stale by the time anyone read it. What is
     * stable is which ports EXIST; whether a given bit is an input right now
     * is `setInput`'s answer, not this one's.
     */
    inputPoints() {
        const out = [];
        for (const [name, chip] of Object.entries(this.chips || {})) {
            if (typeof chip.setInput !== 'function') continue;
            for (const port of ['a', 'b', 'c']) out.push({ chip: name, port, bits: 8 });
        }
        return out;
    }

    /**
     * Drive one input bit, as a switch or a sensor would.
     *
     * @returns {boolean} false when there is nothing to drive, rather than
     *   silently succeeding -- a widget offered for a machine with no 8255
     *   would otherwise look connected and do nothing.
     *
     * THE HONEST LIMIT, and it is the one a caller must know: a machine
     * ATTACHED TO A DRAWN BOARD re-reads every input pin from that board on
     * each advance (`i8086-adapter.js`), so a value set here is overwritten
     * on the next step. The board is the world for such a machine, and it
     * should be -- flipping a switch in a widget while the schematic says
     * otherwise is a contradiction, not an input. Callers that want both
     * should drive the board.
     */
    setInput(chipName, port, bit, level) {
        const chip = (this.chips || {})[chipName];
        if (!chip || typeof chip.setInput !== 'function') return false;
        if (!['a', 'b', 'c'].includes(port)) return false;
        if (!(bit >= 0 && bit < 8)) return false;
        chip.setInput(port, bit, level ? 1 : 0);
        return true;
    }

    /**
     * Can this machine take a key at all? A board with no 8255 has nowhere to
     * latch a scancode and one with no 8259 has no wire to raise IRQ1 on.
     * Asked BEFORE a host offers a keyboard, so the offer matches the board.
     */
    canTakeKeys() { return !!(this._kbdPpi && this._pic); }

    keyIn(scancode) {
        if (!this._kbdPpi || !this._pic) return false;
        this._kbdPpi.setInputPort('a', scancode & 0xff);   // scancode latched at port A (0x60)
        this._pic.setIRQ(1, 1);                             // the keyboard's IRQ1
        return true;
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
        // THE VARIANT IS PART OF THE SNAPSHOT even though it is not CPU state,
        // because restoring without it fails SILENTLY and in the worst way:
        // the same bytes execute as different instructions. 60h is PUSHA on
        // one machine and JO on the other, and nothing about the restored
        // registers or memory would look wrong. See loadState().
        return { v: 1, variant: this.variant, cpu, cycles: this.cycles,
            mem: this.mem.slice(), chips };
    }

    loadState(s) {
        if (s.v !== 1) throw new Error(`unknown machine state version ${s.v}`);
        // A MISMATCHED RESTORE IS REFUSED BY NAME, following z80-machine.js:370
        // (a snapshot with a tape position and no tape inserted). A snapshot
        // is restored onto an identically-BUILT machine; the variant is a
        // construction choice, not state, so a difference here means the
        // caller built the wrong machine rather than that the state is stale.
        // Silently loading it would produce a machine that runs the restored
        // program correctly right up to the first 186 opcode and then quietly
        // takes a conditional jump instead.
        //
        // A snapshot written before the variant existed carries no `variant`
        // key at all, and those were all 8086s -- so an absent key reads as
        // '8086' rather than as "any", which keeps the old snapshots loadable
        // and still refuses to put one on a 186.
        const want = s.variant ?? '8086';
        if (want !== this.variant) {
            throw new Error(`snapshot is from a ${want} machine and this is a ${this.variant}: `
                + 'the same bytes decode differently on the two, so this would run '
                + 'silently wrong rather than fail');
        }
        for (const k of I8086Machine.CPU_STATE) if (k in s.cpu) this.cpu[k] = s.cpu[k];
        this.cycles = s.cycles;
        this.mem.set(s.mem);
        this.displayRevision = (this.displayRevision + 1) >>> 0;
        for (const [name, cs] of Object.entries(s.chips || {})) {
            const c = this.chips[name];
            if (!c) continue;
            if (typeof c.setState === 'function') c.setState(cs);
            else if (typeof c.loadState === 'function') c.loadState(cs);
        }
    }
}

export default I8086Machine;
