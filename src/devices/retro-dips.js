/**
 * Retro DIP pin surfaces, and the crystal.
 *
 * ─── Why an unmodelled part is not a harmless one ───────────────────────
 *
 * The audit calls these kinds "inert", which undersells it. An
 * unregistered kind is not quietly ignored by the engine — validateNetlist
 * REJECTS it, and setNetlist throws:
 *
 *     Unknown part kind "crystal" for part "X1"
 *
 * That takes down the WHOLE bench, not just the one part. So there is no
 * such thing as a "schematic-only" part here: anything a user can place
 * and wire must be registered or every circuit containing it fails to
 * load. (bw-circuit-ui hides this today by collapsing unknown kinds to
 * the generic `mcu` surface in engineKindFor(), which loads but throws
 * the part's identity away — that is the "inert" the audit measured.)
 *
 * ─── What these models claim, and what they do NOT ──────────────────────
 *
 * The 6502/Z80 family here are PIN SURFACES, in the same sense as
 * board-kinds.js's attiny88/attiny85/stc15_mcu: real datasheet pinouts,
 * CMOS input loading, GPIO that follows pin states, and no supply of
 * their own (a bare DIP has no regulator, so vcc/vdd/vss are consumers).
 *
 * They deliberately do NOT execute anything. bw-board already emulates
 * these chips at MACHINE level — w65c02.js, w65c22.js, w65c51.js, z80.js,
 * mc6850.js, tms9918.js are real cores, and m6502-extract/z80-extract
 * read a hand-built computer's wiring to configure them. Those extractors
 * key off part kinds in the CIRCUIT, not off this registry, so they are
 * unaffected by registration. What was missing was only the board half:
 * somewhere for a probe to read, and a pinout for the designer to
 * validate wires against.
 *
 * Terminal order is the sidecar's, which is physical package order, and
 * matches bw-circuit-ui's parts-data byte for byte.
 *
 * ─── The crystal: an honest answer ─────────────────────────────────────
 *
 * A crystal in a digital schematic really is mostly documentation, and it
 * gets no oscillator model here — this engine's clocks come from the MCU
 * adapters (avr8js, rp2040js, emu8051), never from a placed part, and a
 * model that "generated" a frequency would be inventing a mechanism that
 * has no consumer.
 *
 * But it is registered anyway, and its electrical model is not a nothing:
 * a quartz resonator is an OPEN CIRCUIT AT DC. The series L-C-R arm is
 * blocked by its own motional capacitance and only the few-pF shunt C0
 * remains. So `a` and `b` are two pins with no DC path between them, and
 * that is a real, checkable claim — it is exactly what distinguishes a
 * crystal from the short an importer would produce by collapsing it, and
 * it is what stops XTAL1 and XTAL2 being tied together.
 *
 * params.frequency (or the importer's _value, e.g. "32.768", "8MHz") is
 * carried as documentation and asserted by nothing.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;      // CMOS input: draws nothing, but is not a break
const R_OPEN = 1e12;      // a quartz resonator at DC

/**
 * A bare DIP pin surface. No power drives: the bench supplies vcc/vdd.
 * Identical in spirit to board-kinds.js's bareChipModel, kept separate
 * because these chips also stamp input loading on every signal pin.
 */
function dipSurface(terminals, chipVcc) {
    const POWER = new Set(['vcc', 'vdd', 'gnd', 'vss', 'nc', 'nc1', 'nc2']);
    const signals = terminals.filter((t) => !POWER.has(t));
    return {
        terminals,
        init() { return { drives: {} }; },
        stamp(ctx) {
            for (const t of signals) ctx.conductance(t, null, 1 / R_INPUT);
        },
        update() { return false; },
        gpioFollowsPinStates: true,
        vcc: chipVcc,
    };
}

const W65C02 = [   // DIP-40
    'vpb', 'rdy', 'phi1o', 'irqb', 'mlb', 'nmib', 'sync', 'vdd',
    'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
    'a8', 'a9', 'a10', 'a11', 'resb', 'phi2o', 'sob', 'phi2',
    'be', 'nc', 'rwb', 'd0', 'd1', 'd2', 'd3', 'd4',
    'd5', 'd6', 'd7', 'a15', 'a14', 'a13', 'a12', 'vss',
];
const W65C22 = [   // DIP-40
    'vss', 'pa0', 'pa1', 'pa2', 'pa3', 'pa4', 'pa5', 'pa6',
    'pa7', 'pb0', 'pb1', 'pb2', 'pb3', 'pb4', 'pb5', 'pb6',
    'pb7', 'cb1', 'cb2', 'vdd', 'ca1', 'ca2', 'rs0', 'rs1',
    'rs2', 'rs3', 'resb', 'd0', 'd1', 'd2', 'd3', 'd4',
    'd5', 'd6', 'd7', 'phi2', 'cs1', 'cs2b', 'rwb', 'irqb',
];
const W65C51 = [   // DIP-28
    'vss', 'cs0', 'cs1b', 'resb', 'rwb', 'irqb', 'phi2', 'd0',
    'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'vdd', 'xtli',
    'xtlo', 'dcdb', 'dsrb', 'rxd', 'dtrb', 'ctsb', 'rtsb', 'nc',
    'txd', 'rs1', 'rs0', 'd7',
];
const Z80 = [   // DIP-40
    'a11', 'a12', 'a13', 'a14', 'a15', 'clk', 'd4', 'd3',
    'd5', 'd6', 'vcc', 'd2', 'd7', 'd0', 'd1', 'intb',
    'nmib', 'haltb', 'mreqb', 'iorqb', 'a10', 'a9', 'a8', 'a7',
    'a6', 'a5', 'a4', 'a3', 'a2', 'a1', 'a0', 'gnd',
    'rfshb', 'm1b', 'resetb', 'busrqb', 'waitb', 'busakb', 'wrb', 'rdb',
];
const MC6850 = [   // DIP-24
    'vss', 'rxd', 'rxclk', 'txclk', 'rtsb', 'txd', 'irqb', 'cs0',
    'cs2b', 'cs1', 'rs', 'vcc', 'ctsb', 'dcdb', 'd0', 'd1',
    'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'e', 'rw',
];
const TMS9918 = [   // DIP-40
    'nc1', 'xtal1', 'xtal2', 'cpuclk', 'intb', 'gromclk', 'comvid', 'd7',
    'd6', 'd5', 'd4', 'd3', 'd2', 'd1', 'd0', 'rw',
    'mode', 'csrb', 'cswb', 'gnd', 'nc2', 'vdd', 'rd7', 'rd6',
    'rd5', 'rd4', 'rd3', 'rd2', 'rd1', 'rd0', 'ad7', 'ad6',
    'ad5', 'ad4', 'ad3', 'ad2', 'ad1', 'ad0', 'cas', 'ras',
];

export function registerRetroDips() {
    registerDevice('w65c02', dipSurface(W65C02, 5.0));
    registerDevice('w65c22', dipSurface(W65C22, 5.0));
    registerDevice('w65c51', dipSurface(W65C51, 5.0));
    registerDevice('z80', dipSurface(Z80, 5.0));
    registerDevice('mc6850', dipSurface(MC6850, 5.0));
    registerDevice('tms9918', dipSurface(TMS9918, 5.0));

    // Two-terminal quartz resonator. ['a', 'b'] is what bw-circuit-ui's
    // terminalsForKind() falls back to for this kind, so the two agree.
    registerDevice('crystal', {
        terminals: ['a', 'b'],
        init() { return { drives: {} }; },
        stamp(ctx) {
            // No DC path a-to-b. The tiny conductance to ground on each
            // side stands in for the shunt C0 and keeps each pin a real
            // node rather than a floating one the solver has to guess at.
            ctx.conductance('a', null, 1 / R_OPEN);
            ctx.conductance('b', null, 1 / R_OPEN);
        },
        update() { return false; },
    });
}
