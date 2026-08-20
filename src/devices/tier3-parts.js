/**
 * Tier-3 glue — the logic the inert-part audit found DRAWING on real
 * benches while taking no part in MNA:
 *
 *   74hc595   serial-in/parallel-out shift register with a separate
 *             storage register (DIP-16). 10 gallery parts.
 *   74hc125   quad tri-state buffer, per-gate active-LOW /OE. 1 part.
 *   74hc34    hex non-inverting buffer, no enable at all. 1 part.
 *   74hc4050  hex non-inverting buffer / level shifter, tolerant of
 *             inputs ABOVE its own Vcc — which is the entire reason it
 *             is on those boards. 23 parts (see the naming note below).
 *
 * All clean-room from the TI/Nexperia datasheets.
 *
 * ─── 74HC595 vs the engine's built-in `shift_register` ──────────────────
 *
 * They are the SAME SILICON. board.js's hardcoded `shift_register` case
 * is commented "74HC595" in mna.js and implements its shift/latch/OE
 * behaviour. But they are NOT interchangeable as kinds, and registering
 * one as a bare alias of the other would not have worked:
 *
 *   - Disjoint terminal namespaces. `shift_register` speaks an ABSTRACT
 *     one — data / clock / latch / q0..q7 — and terminal validation is
 *     case- and spelling-exact. A part wired `ser` / `srclk` / `rclk`
 *     (what bw-circuit-ui's own 74hc595 sidecar declares, and what the
 *     datasheet calls them) validates against none of it.
 *   - `shift_register` has NO vcc/gnd terminals. The gallery's 74hc595
 *     parts wire both.
 *   - `shift_register` has no /SRCLR and no QH' cascade output, so a
 *     two-chip 16-bit chain cannot be expressed in it at all.
 *
 * So this is a real model, not an alias, and it accepts BOTH namespaces
 * because both are in the wild in our own corpus:
 *     08-led-chaser-595       kind 74hc595       Q0..Q7 (UPPER), data/clock/latch, vcc, gnd
 *     20-shift-register-binary kind shift_register q0..q7 (lower), data/clock/latch, oe
 * — the same both-spellings treatment stc15_mcu already gets in
 * board-kinds.js, and for the same reason: the corpus is not ours to
 * rewrite.
 *
 * The built-in `shift_register` kind is deliberately LEFT ALONE. It is
 * load-bearing for board.js's digital fast path (`_shiftRegisters`,
 * `_settleShiftRegister`, the `_gatherSourcesInner` case) and rewiring
 * that is a bigger change than this audit called for.
 *
 * ─── The "74hc405" in the audit is a TRUNCATED NAME, not a part ─────────
 *
 * The audit reports 23 inert `74hc405` parts. There is no such device.
 * Every one of them carries `params._value` of "74HC4050D" or
 * "74HC4050PWR" — the importer is cutting the name short. The chip is a
 * 74HC4050, registered here under its REAL name. `74hc405` is not
 * registered: modelling it would enshrine a parser bug as a part number.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;        // push-pull output impedance
const R_OFF = 1e9;       // tri-stated / disabled output
const R_INPUT = 1e6;     // CMOS input: draws nothing, but is not a break

export function registerTier3Parts() {

    // ─── 74HC595 ───────────────────────────────────────────────────────
    // DIP-16 physical pin order: QB QC QD QE QF QG QH GND | QH' /SRCLR
    // SRCLK RCLK /OE SER QA VCC. Abstract aliases follow the package pins
    // so the physical order still reads off the front of the array.
    //
    // Bit mapping matches the built-in shift_register exactly: SER shifts
    // in at QA, so after eight clocks the FIRST bit entered sits at QH.
    // qa/q0 = bit 0 … qh/q7 = bit 7, and QH' is bit 7 of the SHIFT
    // register (pre-latch), which is what makes cascading work.
    const Q_LETTERS = ['qa', 'qb', 'qc', 'qd', 'qe', 'qf', 'qg', 'qh'];

    registerDevice('74hc595', {
        terminals: [
            // DIP-16, pins 1..16 in package order.
            'qb', 'qc', 'qd', 'qe', 'qf', 'qg', 'qh', 'gnd',
            'qh_s', 'srclr', 'srclk', 'rclk', 'oe', 'ser', 'qa', 'vcc',
            // Abstract namespace, as used by the gallery benches.
            'data', 'clock', 'latch',
            'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7',
            'Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7',
        ],

        init() {
            const drives = { qh_s: { vTh: 0, rTh: R_OUT } };
            for (let i = 0; i < 8; i++) {
                drives[Q_LETTERS[i]] = { vTh: 0, rTh: R_OUT };
                drives[`q${i}`] = { vTh: 0, rTh: R_OUT };
                drives[`Q${i}`] = { vTh: 0, rTh: R_OUT };
            }
            return { drives, shiftReg: 0, latchReg: 0, _clk: false, _rclk: false, _oe: true };
        },

        stamp(ctx) {
            for (const t of ['ser', 'data', 'srclk', 'clock', 'rclk', 'latch', 'oe', 'srclr']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const vih = vcc * 0.7;
            const vil = vcc * 0.3;
            // Either spelling may be the wired one; an unwired terminal
            // reads 0 V, so OR-ing the HIGH tests picks up whichever is
            // actually driven without the dead one forcing a LOW.
            const hi = (...ts) => ts.some((t) => read(t) > vih);

            const clk = hi('srclk', 'clock');
            const rclk = hi('rclk', 'latch');
            const ser = hi('ser', 'data') ? 1 : 0;
            // /OE is active LOW and UNWIRED READS 0 V — which is exactly
            // the enabled state a bench without an OE wire wants.
            const oe = read('oe') < vil;

            let shiftReg = state.shiftReg;
            let latchReg = state.latchReg;

            // /SRCLR is async and active LOW, so an unwired one would read
            // 0 V and hold the register cleared FOREVER — every gallery
            // bench in the abstract namespace (which has no srclr wire at
            // all) would shift zeros and every LED would stay dark. So it
            // is honoured only when the part actually DECLARES the pin.
            const declared = part._declaredTerminals
                || (part._declaredTerminals = new Set(part.terminals || []));
            if (declared.has('srclr') && read('srclr') < vil) {
                shiftReg = 0;
            } else if (clk && !state._clk) {
                shiftReg = ((shiftReg << 1) | ser) & 0xff;
            }
            if (rclk && !state._rclk) latchReg = shiftReg;

            const unchanged = shiftReg === state.shiftReg
                && latchReg === state.latchReg && oe === state._oe;
            state._clk = clk;
            state._rclk = rclk;
            if (unchanged) return false;

            state.shiftReg = shiftReg;
            state.latchReg = latchReg;
            state._oe = oe;

            for (let i = 0; i < 8; i++) {
                const bit = (latchReg >> i) & 1;
                const d = oe ? { vTh: bit ? vcc : 0, rTh: R_OUT }
                    : { vTh: 0, rTh: R_OFF };       // tri-stated
                state.drives[Q_LETTERS[i]] = d;
                state.drives[`q${i}`] = d;
                state.drives[`Q${i}`] = d;
            }
            // QH' is the cascade tap off the SHIFT register and is NOT
            // tri-stated by /OE on a real '595.
            state.drives.qh_s = { vTh: ((shiftReg >> 7) & 1) ? vcc : 0, rTh: R_OUT };
            return true;
        },
    });

    // ─── 74HC125 ───────────────────────────────────────────────────────
    // Quad bus buffer, per-gate active-LOW output enable. DIP-14 pin
    // order: 1OE 1A 1Y 2OE 2A 2Y GND | 3Y 3A 3OE 4Y 4A 4OE VCC.
    registerDevice('74hc125', {
        terminals: [
            '1oeb', '1a', '1y', '2oeb', '2a', '2y', 'gnd',
            '3y', '3a', '3oeb', '4y', '4a', '4oeb', 'vcc',
        ],

        init() {
            const drives = {};
            for (let g = 1; g <= 4; g++) drives[`${g}y`] = { vTh: 0, rTh: R_OFF };
            return { drives, _sig: '' };
        },

        stamp(ctx) {
            for (let g = 1; g <= 4; g++) {
                ctx.conductance(`${g}a`, null, 1 / R_INPUT);
                ctx.conductance(`${g}oeb`, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const vih = vcc * 0.7, vil = vcc * 0.3;
            const next = [];
            for (let g = 1; g <= 4; g++) {
                const en = read(`${g}oeb`) < vil;          // active LOW
                const a = read(`${g}a`) > vih;
                next.push(en ? (a ? 'H' : 'L') : 'Z');
            }
            const sig = next.join('');
            if (sig === state._sig) return false;
            state._sig = sig;
            for (let g = 1; g <= 4; g++) {
                const s = next[g - 1];
                state.drives[`${g}y`] = s === 'Z'
                    ? { vTh: 0, rTh: R_OFF }
                    : { vTh: s === 'H' ? vcc : 0, rTh: R_OUT };
            }
            return true;
        },
    });

    // ─── 74HC34 / 74HC4050 ─────────────────────────────────────────────
    // Both are hex NON-inverting buffers with no enable pin, so one
    // update body serves both; only the pinout differs.
    //
    //   74HC34   DIP-14: 1A 1Y 2A 2Y 3A 3Y GND | 4Y 4A 5Y 5A 6Y 6A VCC
    //   74HC4050 DIP-16: VCC 1Y 1A 2Y 2A 3Y 3A GND | 4A 4Y 5A 5Y NC NC 6A 6Y
    //
    // The '4050's point is that its inputs tolerate voltages ABOVE its
    // own Vcc — it is the classic 5 V→3.3 V level shifter, which is why
    // it sits on 23 boards in the corpus. So its output level is its OWN
    // vcc, never the input's: that down-shift is the whole function, and
    // a model that echoed the input voltage would be modelling a wire.
    const hexBuffer = (terminals, pairs) => ({
        terminals,
        init() {
            const drives = {};
            for (const [, y] of pairs) drives[y] = { vTh: 0, rTh: R_OUT };
            return { drives, _sig: '' };
        },
        stamp(ctx) {
            for (const [a] of pairs) ctx.conductance(a, null, 1 / R_INPUT);
        },
        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const vih = vcc * 0.7;
            const next = pairs.map(([a]) => (read(a) > vih ? 1 : 0));
            const sig = next.join('');
            if (sig === state._sig) return false;
            state._sig = sig;
            pairs.forEach(([, y], i) => {
                state.drives[y] = { vTh: next[i] ? vcc : 0, rTh: R_OUT };
            });
            return true;
        },
    });

    const HEX_PAIRS = [['1a', '1y'], ['2a', '2y'], ['3a', '3y'],
                       ['4a', '4y'], ['5a', '5y'], ['6a', '6y']];

    registerDevice('74hc34', hexBuffer([
        '1a', '1y', '2a', '2y', '3a', '3y', 'gnd',
        '4y', '4a', '5y', '5a', '6y', '6a', 'vcc',
    ], HEX_PAIRS));

    registerDevice('74hc4050', hexBuffer([
        'vcc', '1y', '1a', '2y', '2a', '3y', '3a', 'gnd',
        '4a', '4y', '5a', '5y', 'nc1', 'nc2', '6a', '6y',
    ], HEX_PAIRS));
}
