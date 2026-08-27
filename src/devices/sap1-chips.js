/**
 * SAP-1 (Ben Eater 8-bit TTL computer) chip family — the 74-series
 * ICs that make the whole computer wireable and runnable in the
 * circuit engine.
 *
 * Each chip: own code, register-level behavior from the standard TI
 * datasheets (facts, not code). Truth tables hand-computed.
 *
 *   74LS173  4-bit D register — /OE, /G enables, rising-edge clock
 *   74LS161  4-bit synchronous counter — carry, load, count, clear
 *   74LS189  16×4 static RAM — inverted outputs (the classic trap)
 *   74LS157  quad 2:1 multiplexer — /G enable, S select
 *   74LS107  dual JK flip-flop — falling-edge clock, active-low /CLR
 *   74LS193  4-bit up/DOWN counter — two clocks, async load, /CO and /BO
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_INPUT = 1e6;
const R_OFF = 1e9;

export function registerSAP1Chips() {

    // ─── 74LS173: 4-bit D register with 3-state outputs ──────────
    // Rising-edge clock, active-low /G1 /G2 (data enable), active-low
    // /OE1 /OE2 (output enable). Stores D0-D3 on CLK↑ when both
    // /G1 and /G2 are low. Outputs high-Z when either /OE is high.
    // Clear is active-high (MR).
    registerDevice('74ls173', {
        terminals: ['d0', 'd1', 'd2', 'd3', 'q0', 'q1', 'q2', 'q3',
                    'clk', 'g1b', 'g2b', 'oe1b', 'oe2b', 'mr', 'vcc', 'gnd'],

        init() {
            return {
                drives: {
                    q0: { vTh: 0, rTh: R_OFF }, q1: { vTh: 0, rTh: R_OFF },
                    q2: { vTh: 0, rTh: R_OFF }, q3: { vTh: 0, rTh: R_OFF },
                },
                _reg: 0,
                _lastClk: false,
            };
        },

        stamp(ctx) {
            for (const t of ['d0', 'd1', 'd2', 'd3', 'clk', 'g1b', 'g2b', 'oe1b', 'oe2b', 'mr']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const clk = read('clk') > th;
            const mr = read('mr') > th;
            let changed = false;

            // Clear
            if (mr) { state._reg = 0; }
            // Rising edge: latch data when both /G low
            else if (clk && !state._lastClk) {
                const g1 = read('g1b') > th;
                const g2 = read('g2b') > th;
                if (!g1 && !g2) {
                    let d = 0;
                    for (let i = 0; i < 4; i++) if (read(`d${i}`) > th) d |= (1 << i);
                    state._reg = d;
                }
            }
            state._lastClk = clk;

            // Output enable: both /OE low → drive, else high-Z
            const oeActive = !(read('oe1b') > th) && !(read('oe2b') > th);
            for (let i = 0; i < 4; i++) {
                const bit = (state._reg >> i) & 1;
                const want = oeActive
                    ? { vTh: bit ? vcc : 0, rTh: R_OUT }
                    : { vTh: 0, rTh: R_OFF };
                if (state.drives[`q${i}`].vTh !== want.vTh || state.drives[`q${i}`].rTh !== want.rTh) {
                    state.drives[`q${i}`] = want;
                    changed = true;
                }
            }
            return changed;
        },
    });

    // ─── 74LS161: 4-bit synchronous binary counter ────────────────
    // Rising-edge clock. /CLR (async clear), /LOAD (sync parallel load),
    // ENP + ENT (count enables), D0-D3 parallel input, Q0-Q3 outputs,
    // RCO (ripple carry = ENT · Q3·Q2·Q1·Q0, for cascading).
    registerDevice('74ls161', {
        terminals: ['d0', 'd1', 'd2', 'd3', 'q0', 'q1', 'q2', 'q3',
                    'clk', 'clrb', 'loadb', 'enp', 'ent', 'rco', 'vcc', 'gnd'],

        init() {
            return {
                drives: {
                    q0: { vTh: 0, rTh: R_OUT }, q1: { vTh: 0, rTh: R_OUT },
                    q2: { vTh: 0, rTh: R_OUT }, q3: { vTh: 0, rTh: R_OUT },
                    rco: { vTh: 0, rTh: R_OUT },
                },
                _count: 0,
                _lastClk: false,
            };
        },

        stamp(ctx) {
            for (const t of ['d0', 'd1', 'd2', 'd3', 'clk', 'clrb', 'loadb', 'enp', 'ent']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const clk = read('clk') > th;
            const clr = !(read('clrb') > th); // active-low
            let changed = false;

            // Async clear
            if (clr) {
                state._count = 0;
            } else if (clk && !state._lastClk) {
                const load = !(read('loadb') > th); // active-low
                if (load) {
                    let d = 0;
                    for (let i = 0; i < 4; i++) if (read(`d${i}`) > th) d |= (1 << i);
                    state._count = d;
                } else {
                    const enp = read('enp') > th;
                    const ent = read('ent') > th;
                    if (enp && ent) {
                        state._count = (state._count + 1) & 0x0f;
                    }
                }
            }
            state._lastClk = clk;

            // Outputs
            for (let i = 0; i < 4; i++) {
                const bit = (state._count >> i) & 1;
                const want = { vTh: bit ? vcc : 0, rTh: R_OUT };
                if (state.drives[`q${i}`].vTh !== want.vTh) {
                    state.drives[`q${i}`] = want;
                    changed = true;
                }
            }
            // RCO = ENT · (count == 15)
            const ent = read('ent') > th;
            const rco = ent && state._count === 0x0f ? vcc : 0;
            if (state.drives.rco.vTh !== rco) {
                state.drives.rco = { vTh: rco, rTh: R_OUT };
                changed = true;
            }
            return changed;
        },
    });

    // ─── 74LS193: 4-bit synchronous up/DOWN binary counter ───────
    // The counter a stack pointer needs, and the reason it is here: a
    // 74LS161 counts one way, so CALL can push and RET can never pop.
    //
    // Two separate clocks, which is the part that surprises people. There
    // is no up/down MODE pin: you clock the UP input to count up and the
    // DOWN input to count down, and the idle one must be held HIGH. Tie
    // both low and the chip simply stops.
    //
    // Its LOAD is ASYNCHRONOUS, unlike the 74LS161 next door whose load
    // waits for a clock edge. /LOAD low loads immediately, no edge
    // involved — worth knowing before wiring the two the same way.
    // CLEAR is asynchronous too and active HIGH, and it beats load.
    //
    // /CO and /BO are the cascade outputs and they are NOT simply
    // "count == 15" and "count == 0": each is gated by its own clock
    // being LOW, so what comes out is a PULSE that can drive the next
    // stage's clock input. /CO of one chip into UP of the next is the
    // whole of a multi-digit counter.
    registerDevice('74ls193', {
        terminals: ['d0', 'd1', 'd2', 'd3', 'q0', 'q1', 'q2', 'q3',
                    'up', 'down', 'loadb', 'clr', 'cob', 'bob', 'vcc', 'gnd'],

        init() {
            return {
                drives: {
                    q0: { vTh: 0, rTh: R_OUT }, q1: { vTh: 0, rTh: R_OUT },
                    q2: { vTh: 0, rTh: R_OUT }, q3: { vTh: 0, rTh: R_OUT },
                    cob: { vTh: 0, rTh: R_OUT }, bob: { vTh: 0, rTh: R_OUT },
                },
                _count: 0,
                _lastUp: false,
                _lastDown: false,
            };
        },

        stamp(ctx) {
            for (const t of ['d0', 'd1', 'd2', 'd3', 'up', 'down', 'loadb', 'clr']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const up = read('up') > th;
            const down = read('down') > th;
            const clr = read('clr') > th;          // active HIGH
            const load = !(read('loadb') > th);    // active LOW, asynchronous
            let changed = false;

            if (clr) {
                state._count = 0;                  // clear beats load
            } else if (load) {
                let d = 0;
                for (let i = 0; i < 4; i++) if (read(`d${i}`) > th) d |= (1 << i);
                state._count = d;
            } else {
                // Count on the rising edge of one clock while the other is
                // held high. Both clocks rising in the same pass is not a
                // thing a real board does; taking UP first is arbitrary and
                // the tests do not rely on it.
                if (up && !state._lastUp && down) {
                    state._count = (state._count + 1) & 0x0f;
                } else if (down && !state._lastDown && up) {
                    state._count = (state._count - 1) & 0x0f;
                }
            }
            state._lastUp = up;
            state._lastDown = down;

            for (let i = 0; i < 4; i++) {
                const bit = (state._count >> i) & 1;
                const v = bit ? vcc : 0;
                if (state.drives[`q${i}`].vTh !== v) {
                    state.drives[`q${i}`] = { vTh: v, rTh: R_OUT };
                    changed = true;
                }
            }
            // Active LOW, and gated by the clock that would advance past the
            // end: /CO pulses low only while UP is low AND the count is 15.
            const co = (state._count === 0x0f && !up) ? 0 : vcc;
            const bo = (state._count === 0x00 && !down) ? 0 : vcc;
            if (state.drives.cob.vTh !== co) {
                state.drives.cob = { vTh: co, rTh: R_OUT };
                changed = true;
            }
            if (state.drives.bob.vTh !== bo) {
                state.drives.bob = { vTh: bo, rTh: R_OUT };
                changed = true;
            }
            return changed;
        },
    });

    // ─── 74LS189: 16×4 static RAM with INVERTED outputs ──────────
    // Address A0-A3 (4 bits = 16 words), data D0-D3 (4 bits),
    // /CS (chip select), /WE (write enable).
    // Read: /CS low, /WE high → outputs O0-O3 = INVERTED stored data.
    // Write: /CS low, /WE low → data D0-D3 written to addressed word.
    // THE CLASSIC TRAP: outputs are ACTIVE-LOW (inverted).
    registerDevice('74ls189', {
        terminals: ['a0', 'a1', 'a2', 'a3', 'd0', 'd1', 'd2', 'd3',
                    'o0', 'o1', 'o2', 'o3', 'csb', 'web', 'vcc', 'gnd'],

        init() {
            return {
                drives: {
                    o0: { vTh: 5, rTh: R_OUT }, o1: { vTh: 5, rTh: R_OUT },
                    o2: { vTh: 5, rTh: R_OUT }, o3: { vTh: 5, rTh: R_OUT },
                },
                _mem: new Uint8Array(16), // 16 × 4-bit words
            };
        },

        stamp(ctx) {
            for (const t of ['a0', 'a1', 'a2', 'a3', 'd0', 'd1', 'd2', 'd3', 'csb', 'web']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const cs = !(read('csb') > th); // active-low
            const we = !(read('web') > th); // active-low
            let changed = false;

            let addr = 0;
            for (let i = 0; i < 4; i++) if (read(`a${i}`) > th) addr |= (1 << i);

            if (cs && we) {
                // Write
                let d = 0;
                for (let i = 0; i < 4; i++) if (read(`d${i}`) > th) d |= (1 << i);
                state._mem[addr] = d & 0x0f;
            }

            if (cs && !we) {
                // Read: outputs are INVERTED
                const val = state._mem[addr] & 0x0f;
                for (let i = 0; i < 4; i++) {
                    const bit = (val >> i) & 1;
                    // INVERTED: stored 1 → output LOW, stored 0 → output HIGH
                    const want = { vTh: bit ? 0 : vcc, rTh: R_OUT };
                    if (state.drives[`o${i}`].vTh !== want.vTh) {
                        state.drives[`o${i}`] = want;
                        changed = true;
                    }
                }
            } else if (!cs) {
                // Deselected: outputs HIGH (all inverted zeros = all high)
                for (let i = 0; i < 4; i++) {
                    if (state.drives[`o${i}`].vTh !== vcc) {
                        state.drives[`o${i}`] = { vTh: vcc, rTh: R_OUT };
                        changed = true;
                    }
                }
            }
            return changed;
        },
    });

    // ─── 74LS157: quad 2:1 multiplexer ────────────────────────────
    // S (select): low = A inputs, high = B inputs.
    // /G (enable): low = outputs follow selected input, high = all LOW.
    // Four independent channels: 1A/1B→1Y, 2A/2B→2Y, 3A/3B→3Y, 4A/4B→4Y.
    registerDevice('74ls157', {
        terminals: ['1a', '1b', '1y', '2a', '2b', '2y', '3a', '3b', '3y',
                    '4a', '4b', '4y', 's', 'gb', 'vcc', 'gnd'],

        init() {
            return {
                drives: {
                    '1y': { vTh: 0, rTh: R_OUT }, '2y': { vTh: 0, rTh: R_OUT },
                    '3y': { vTh: 0, rTh: R_OUT }, '4y': { vTh: 0, rTh: R_OUT },
                },
            };
        },

        stamp(ctx) {
            for (const t of ['1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b', 's', 'gb']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const enabled = !(read('gb') > th); // active-low
            const sel = read('s') > th; // low=A, high=B
            let changed = false;

            for (let ch = 1; ch <= 4; ch++) {
                let out = 0;
                if (enabled) {
                    const pin = sel ? `${ch}b` : `${ch}a`;
                    out = read(pin) > th ? vcc : 0;
                }
                const key = `${ch}y`;
                if (state.drives[key].vTh !== out) {
                    state.drives[key] = { vTh: out, rTh: R_OUT };
                    changed = true;
                }
            }
            return changed;
        },
    });

    // ─── 74LS107: dual JK flip-flop ──────────────────────────────
    // FALLING-edge clock (unlike the generic jkff which is rising-edge).
    // Active-LOW /CLR (no preset). Each flip-flop: J, K, CLK, /CLR, Q, /Q.
    // Two independent flip-flops: 1J/1K/1CLK/1CLRB/1Q/1QB, 2J/2K/2CLK/2CLRB/2Q/2QB.
    registerDevice('74ls107', {
        terminals: ['1j', '1k', '1clk', '1clrb', '1q', '1qb',
                    '2j', '2k', '2clk', '2clrb', '2q', '2qb', 'vcc', 'gnd'],

        init() {
            return {
                drives: {
                    '1q': { vTh: 0, rTh: R_OUT }, '1qb': { vTh: 5, rTh: R_OUT },
                    '2q': { vTh: 0, rTh: R_OUT }, '2qb': { vTh: 5, rTh: R_OUT },
                },
                _q: [0, 0],
                _lastClk: [true, true], // idle high (falling edge trigger)
            };
        },

        stamp(ctx) {
            for (const t of ['1j', '1k', '1clk', '1clrb', '2j', '2k', '2clk', '2clrb']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            let changed = false;

            for (let ff = 0; ff < 2; ff++) {
                const n = ff + 1;
                const clk = read(`${n}clk`) > th;
                const clr = !(read(`${n}clrb`) > th); // active-low
                let q = state._q[ff];

                if (clr) {
                    q = 0;
                } else if (!clk && state._lastClk[ff]) { // FALLING edge
                    const j = read(`${n}j`) > th ? 1 : 0;
                    const k = read(`${n}k`) > th ? 1 : 0;
                    if (j && k) q = q ? 0 : 1; // toggle
                    else if (j) q = 1;
                    else if (k) q = 0;
                }
                state._lastClk[ff] = clk;

                if (q !== state._q[ff]) {
                    state._q[ff] = q;
                    state.drives[`${n}q`] = { vTh: q ? vcc : 0, rTh: R_OUT };
                    state.drives[`${n}qb`] = { vTh: q ? 0 : vcc, rTh: R_OUT };
                    changed = true;
                }
            }
            return changed;
        },
    });
}

export default registerSAP1Chips;
