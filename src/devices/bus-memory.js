/**
 * Parallel bus memories — the 28-pin JEDEC pair that sits on every 6502
 * and Z80 breadboard machine in the corpus:
 *
 *   62256   32K x 8 static RAM   (/CS /OE /WE)
 *   28c256  32K x 8 EEPROM       (/CE /OE /WE) — same package, same
 *           bus, one pin renamed and non-volatile contents.
 *
 * Clean-room from the JEDEC 28-pin 32Kx8 pinout.
 *
 * ─── Why these were inert, and what "modelled" means here ───────────────
 *
 * The engine already understood these chips at MACHINE level: both
 * m6502-extract.js and z80-extract.js read their wiring to work out
 * which address lines and chip-selects a hand-built computer used, and
 * hand the result to an emulated machine. What did not exist was a BOARD
 * model — so on the electrical side the parts drew, wired, and stamped
 * nothing. examples-gate.test.mjs still lists them under DESIGNER_ONLY
 * for that reason.
 *
 * This adds the board half: address and control pins are real CMOS
 * loads, and the data bus is really driven during a read. That is what
 * makes a probe on D0 read a stored byte rather than a floating node.
 *
 * ─── The bidirectional data bus ────────────────────────────────────────
 *
 * D0-D7 are inputs during a write and outputs during a read, which is
 * the same hazard 74HC245 has: if the chip keeps driving as the cycle
 * turns around, the bus reads back its own stale output instead of what
 * the CPU is putting there. So this follows the '245's remedy exactly —
 * a cycle change RELEASES every data drive for one solve pass, and only
 * the pass after that samples or drives. Writes therefore need two
 * settles, which is what a real bus cycle takes anyway.
 *
 * ─── Writes are EDGE-committed, and that is not a shortcut ─────────────
 *
 * /CS, /OE and /WE are all active LOW, and an unwired terminal reads
 * 0 V. So a memory whose control pins are not yet driven — which is
 * every bench for the first solve pass, before any MCU has set a pin —
 * sees itself SELECTED with /WE ASSERTED and writes 0x00 over address 0.
 * Measured, not theorised: params.contents[0] came back as 0 while
 * contents[1] and [2] survived, because exactly one such phantom cycle
 * ran at power-on.
 *
 * The fix is also the more truthful model. A real SRAM latches the data
 * bus on the TRAILING edge of the write pulse, so this samples into a
 * pending byte for as long as the cycle lasts and commits when the cycle
 * ends. A /WE that is merely stuck low never produces a trailing edge
 * and so never writes. One more guard is needed for the power-on case,
 * where the very first cycle observed is already a write and its "end"
 * would otherwise look like a legitimate trailing edge: a write commits
 * only if the part was seen DESELECTED at some point beforehand. A chip
 * that has never been deselected has not been addressed by anything.
 *
 * ─── Contents ──────────────────────────────────────────────────────────
 *
 * params.contents = array of bytes, loaded at address 0 — the same
 * convention board-ics.js's AT24C64 uses. An unwritten 62256 powers up
 * indeterminate; we choose 0x00. An unprogrammed 28c256 reads 0xFF,
 * which is what an erased floating-gate part actually does, so the two
 * genuinely differ in their power-on fill.
 *
 * params.readOnly (28c256 only, default false) refuses /WE writes, for
 * a socketed part programmed off-board. It is NOT the default, because
 * a 28C256 in circuit really is byte-writable.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;

const SIZE = 32768;          // 32K x 8
const ADDR_BITS = 15;        // a0 .. a14
const DATA_BITS = 8;         // d0 .. d7

const ADDR = Array.from({ length: ADDR_BITS }, (_, i) => `a${i}`);
const DATA = Array.from({ length: DATA_BITS }, (_, i) => `d${i}`);

/**
 * One 32Kx8 parallel memory.
 * @param {string} selPin   'csb' (SRAM) or 'ceb' (EEPROM) — pin 20.
 * @param {string[]} terminals  physical DIP-28 order.
 * @param {number} fill     power-on byte.
 * @param {boolean} eeprom  honour params.readOnly.
 */
function parallelMemory(selPin, terminals, fill, eeprom) {
    return {
        terminals,

        init(part) {
            const mem = new Uint8Array(SIZE).fill(fill);
            const contents = part?.params?.contents;
            if (Array.isArray(contents) || ArrayBuffer.isView(contents)) {
                const n = Math.min(SIZE, contents.length);
                for (let i = 0; i < n; i++) mem[i] = contents[i] & 0xff;
            }
            return {
                drives: {}, mem, addr: 0, _cycle: '', _out: -1,
                _pending: null,     // byte sampled during the current write
                _armed: false,      // has the part ever been deselected?
            };
        },

        stamp(ctx) {
            // Address and control pins are CMOS inputs: they draw nothing
            // but they are not a break in the net either.
            for (const a of ADDR) ctx.conductance(a, null, 1 / R_INPUT);
            for (const c of [selPin, 'oeb', 'web']) ctx.conductance(c, null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;

            const selected = read(selPin) < th;      // active LOW
            const oe = read('oeb') < th;             // active LOW
            const we = read('web') < th;             // active LOW

            // /WE wins over /OE on both parts: a write cycle never drives.
            const cycle = !selected ? 'idle' : we ? 'write' : oe ? 'read' : 'idle';

            let addr = 0;
            for (let i = 0; i < ADDR_BITS; i++) {
                if (read(ADDR[i]) > th) addr |= 1 << i;
            }

            // Cycle turnaround: release the bus for one solve pass before
            // sampling or driving it, or the chip reads back its own
            // stale output as if the CPU had put it there. Leaving a write
            // cycle is also where the pending byte lands — a real SRAM
            // latches on the trailing edge of the pulse.
            if (cycle !== state._cycle) {
                const leavingWrite = state._cycle === 'write';
                state._cycle = cycle;
                state.addr = addr;
                state._out = -1;
                if (leavingWrite && state._armed && state._pending) {
                    const { a, byte } = state._pending;
                    if (!(eeprom && part?.params?.readOnly)) state.mem[a] = byte;
                }
                state._pending = null;
                if (cycle !== 'write') state._armed = true;
                if (Object.keys(state.drives).length === 0) return true;
                state.drives = {};
                return true;
            }

            if (cycle === 'idle') {
                state.addr = addr;
                state._armed = true;
                if (state._out === -1) return false;
                state._out = -1;
                state.drives = {};
                return true;
            }

            if (cycle === 'write') {
                state.addr = addr;
                let byte = 0;
                for (let i = 0; i < DATA_BITS; i++) {
                    if (read(DATA[i]) > th) byte |= 1 << i;
                }
                state._pending = { a: addr, byte };
                return false;   // a write changes storage, not any drive
            }

            // read
            const byte = state.mem[addr];
            if (addr === state.addr && byte === state._out) return false;
            state.addr = addr;
            state._out = byte;
            for (let i = 0; i < DATA_BITS; i++) {
                state.drives[DATA[i]] = {
                    vTh: ((byte >> i) & 1) ? vcc : 0, rTh: R_OUT,
                };
            }
            return true;
        },
    };
}

// JEDEC 28-pin 32Kx8, in PACKAGE order: pins 1-14 down the left, then
// pins 28-15 down the right — the order bw-circuit-ui's own sidecars
// already declare, and the order a DIP symbol renders in.
//   1 A14   2 A12   3 A7  4 A6  5 A5  6 A4  7 A3
//   8 A2    9 A1   10 A0 11 D0 12 D1 13 D2 14 GND
//  28 VCC  27 /WE  26 A13 25 A8 24 A9 23 A11 22 /OE
//  21 A10  20 /CS  19 D7 18 D6 17 D5 16 D4 15 D3
const DIP28 = (sel) => [
    'a14', 'a12', 'a7', 'a6', 'a5', 'a4', 'a3',
    'a2', 'a1', 'a0', 'd0', 'd1', 'd2', 'gnd',
    'vcc', 'web', 'a13', 'a8', 'a9', 'a11', 'oeb',
    'a10', sel, 'd7', 'd6', 'd5', 'd4', 'd3',
];

export function registerBusMemory() {
    // SRAM: volatile, powers up indeterminate — we choose 0x00.
    registerDevice('62256', parallelMemory('csb', DIP28('csb'), 0x00, false));
    // EEPROM: an erased floating-gate part reads 0xFF.
    registerDevice('28c256', parallelMemory('ceb', DIP28('ceb'), 0xff, true));
}
