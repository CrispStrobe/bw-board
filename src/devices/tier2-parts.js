/**
 * Tier-2 parts from the module-armada triage — the digital glue the
 * learning boards actually solder and the missing human-input dial:
 *
 *   74hc138  3-to-8 decoder/demux (active-low outputs, G1·/G2A·/G2B
 *            enables) — the A2's 7-seg digit select and the HB6502's
 *            address decode, as a wirable designer part.
 *   74hc245  octal bus transceiver (DIR, /OE) — the A2's segment
 *            driver. Direction flips release everything for one solve
 *            pass first, so the old drive never reads back as input.
 *   74hc165  parallel-in/serial-out shift register (/SH-LD async load,
 *            CLK INH, SER cascade in, QH/­/QH out) — the '595's other
 *            half. Datasheet letter inputs a..h.
 *   ky040    rotary encoder module: detented quadrature on CLK/DT with
 *            the module's own pullups, push switch on SW. Drive it with
 *            params.position (target detent, signed) and params.pressed;
 *            transitions play out over time (quarter-step per
 *            params.stepUs, default 1000), so edge-counting firmware
 *            sees real sequences, not teleports.
 *
 * All clean-room from the TI/Nexperia and module datasheets.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;
const R_MODULE_PULLUP = 10000;   // the KY-040 breakout's on-board pullups

export function registerTier2Parts() {

    // ─── 74HC138 ───────────────────────────────────────────────────────
    registerDevice('74hc138', {
        terminals: ['vcc', 'gnd', 'a', 'b', 'c', 'g1', 'g2ab', 'g2bb',
            'y0b', 'y1b', 'y2b', 'y3b', 'y4b', 'y5b', 'y6b', 'y7b'],

        init() {
            const drives = {};
            for (let i = 0; i < 8; i++) drives[`y${i}b`] = { vTh: 5, rTh: R_OUT };
            return { drives, _sel: -1 };
        },

        stamp(ctx) {
            for (const t of ['a', 'b', 'c', 'g1', 'g2ab', 'g2bb']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const enabled = read('g1') > th && read('g2ab') < th && read('g2bb') < th;
            const sel = enabled
                ? ((read('c') > th ? 4 : 0) | (read('b') > th ? 2 : 0) | (read('a') > th ? 1 : 0))
                : -1;
            if (sel === state._sel) return false;
            state._sel = sel;
            for (let i = 0; i < 8; i++) {
                state.drives[`y${i}b`] = { vTh: i === sel ? 0 : vcc, rTh: R_OUT };
            }
            return true;
        },
    });

    // ─── 74HC244 ───────────────────────────────────────────────────────
    // Octal buffer/line driver with 3-state outputs (DIP-20). Two groups
    // of 4 buffers each with separate /OE pins. When /OEn=LOW, YnX=AnX.
    registerDevice('74hc244', {
        terminals: ['vcc', 'gnd', '1oeb', '2oeb',
            '1a0', '1a1', '1a2', '1a3', '1y0', '1y1', '1y2', '1y3',
            '2a0', '2a1', '2a2', '2a3', '2y0', '2y1', '2y2', '2y3'],

        init() {
            return { drives: {}, _cfg: '' };
        },

        stamp(ctx) {
            ctx.conductance('1oeb', null, 1 / R_INPUT);
            ctx.conductance('2oeb', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const oe1 = read('1oeb') < th;
            const oe2 = read('2oeb') < th;
            const cfg = `${oe1}:${oe2}`;
            if (cfg !== state._cfg) { state._cfg = cfg; state.drives = {}; return true; }

            let changed = false;
            for (let g = 1; g <= 2; g++) {
                const en = g === 1 ? oe1 : oe2;
                for (let i = 0; i < 4; i++) {
                    const pin = `${g}y${i}`;
                    if (!en) {
                        if (state.drives[pin]) { delete state.drives[pin]; changed = true; }
                        continue;
                    }
                    const level = read(`${g}a${i}`) > th ? vcc : 0;
                    if (!state.drives[pin] || state.drives[pin].vTh !== level) {
                        state.drives[pin] = { vTh: level, rTh: R_OUT };
                        changed = true;
                    }
                }
            }
            return changed;
        },
    });

    // ─── 74HC245 ───────────────────────────────────────────────────────
    registerDevice('74hc245', {
        terminals: ['vcc', 'gnd', 'dir', 'oeb',
            'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
            'b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'],

        init() {
            return { drives: {}, _cfg: '' };
        },

        stamp(ctx) {
            ctx.conductance('dir', null, 1 / R_INPUT);
            ctx.conductance('oeb', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const oe = read('oeb') < th;
            const aToB = read('dir') > th;
            const cfg = `${oe}:${aToB}`;

            // A configuration change releases EVERYTHING for one solve pass:
            // otherwise the old drive on the new input side reads back as
            // if the bus carried it.
            if (cfg !== state._cfg) {
                state._cfg = cfg;
                state.drives = {};
                return true;
            }
            if (!oe) return false;

            const from = aToB ? 'a' : 'b';
            const to = aToB ? 'b' : 'a';
            let changed = false;
            for (let i = 0; i < 8; i++) {
                const level = read(`${from}${i}`) > th ? vcc : 0;
                const cur = state.drives[`${to}${i}`];
                if (!cur || cur.vTh !== level) {
                    state.drives[`${to}${i}`] = { vTh: level, rTh: R_OUT };
                    changed = true;
                }
            }
            return changed;
        },
    });

    // ─── 74HC165 ───────────────────────────────────────────────────────
    registerDevice('74hc165', {
        terminals: ['vcc', 'gnd', 'shldb', 'clk', 'clkinh', 'ser',
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'qh', 'qhb'],

        init() {
            return {
                drives: { qh: { vTh: 0, rTh: R_OUT }, qhb: { vTh: 5, rTh: R_OUT } },
                reg: 0, _clk: false,
            };
        },

        stamp(ctx) {
            for (const t of ['shldb', 'clk', 'clkinh', 'ser']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const clk = read('clk') > th;
            let reg = state.reg;

            if (read('shldb') < th) {
                // Async parallel load, transparent while low. A=stage 0,
                // H=stage 7; QH outputs stage 7, so H is "first out".
                reg = 0;
                const ins = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
                for (let i = 0; i < 8; i++) if (read(ins[i]) > th) reg |= 1 << i;
            } else if (clk && !state._clk && read('clkinh') < th) {
                reg = ((reg << 1) | (read('ser') > th ? 1 : 0)) & 0xff;
            }
            state._clk = clk;
            if (reg === state.reg && state.drives.qh.vTh === ((reg >> 7) & 1 ? vcc : 0)) return false;
            state.reg = reg;
            const qh = (reg >> 7) & 1;
            state.drives.qh = { vTh: qh ? vcc : 0, rTh: R_OUT };
            state.drives.qhb = { vTh: qh ? 0 : vcc, rTh: R_OUT };
            return true;
        },
    });

    // ─── 74C922 ────────────────────────────────────────────────────────
    // 16-key encoder (DIP-18). Scans a 4×4 keypad matrix (Y1-Y4 rows,
    // X1-X4 columns), outputs 4-bit binary on A-D with data-available
    // (DA). In simulation: params.key (0-15) selects the pressed key,
    // params.pressed activates it. DA goes HIGH when a key is valid;
    // /OE gates the outputs.
    registerDevice('74c922', {
        terminals: ['y1','y2','y3','y4','osc','kbm','x4','x3','vss',
                    'x2','x1','da','oeb','d','c','b','a','vcc'],

        init() {
            return {
                drives: {
                    a: { vTh: 0, rTh: R_OUT }, b: { vTh: 0, rTh: R_OUT },
                    c: { vTh: 0, rTh: R_OUT }, d: { vTh: 0, rTh: R_OUT },
                    da: { vTh: 0, rTh: R_OUT },
                },
                _key: -1,
            };
        },

        stamp(ctx) {
            ctx.conductance('oeb', null, 1 / R_INPUT);
            ctx.conductance('osc', null, 1 / R_INPUT);
            ctx.conductance('kbm', null, 1 / R_INPUT);
            for (let i = 1; i <= 4; i++) {
                ctx.conductance(`x${i}`, null, 1 / R_INPUT);
                ctx.conductance(`y${i}`, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const oe = read('oeb') < th;
            const pressed = !!part.params?.pressed;
            const key = pressed ? Math.trunc(part.params?.key ?? 0) & 0xF : -1;

            if (key === state._key && state._oe === oe) return false;
            state._key = key;
            state._oe = oe;

            const hasKey = key >= 0;
            state.drives.da = { vTh: hasKey ? vcc : 0, rTh: R_OUT };

            if (oe && hasKey) {
                state.drives.a = { vTh: (key & 1) ? vcc : 0, rTh: R_OUT };
                state.drives.b = { vTh: (key & 2) ? vcc : 0, rTh: R_OUT };
                state.drives.c = { vTh: (key & 4) ? vcc : 0, rTh: R_OUT };
                state.drives.d = { vTh: (key & 8) ? vcc : 0, rTh: R_OUT };
            } else {
                const r = oe ? R_OUT : 1e9;
                state.drives.a = { vTh: 0, rTh: r };
                state.drives.b = { vTh: 0, rTh: r };
                state.drives.c = { vTh: 0, rTh: r };
                state.drives.d = { vTh: 0, rTh: r };
            }
            return true;
        },
    });

    // ─── KY-040 ────────────────────────────────────────────────────────
    // Quadrature at rest: CLK=DT=high (detent). One CW detent walks
    // (CLK,DT): 11 → 01 → 00 → 10 → 11; CCW mirrors. The module's
    // pullups mean "open contact = pulled high", so levels are Thevenin
    // pullups, not stiff rails.
    registerDevice('ky040', {
        terminals: ['vcc', 'gnd', 'clk', 'dt', 'sw'],

        init() {
            return {
                drives: {
                    clk: { vTh: 5, rTh: R_MODULE_PULLUP },
                    dt: { vTh: 5, rTh: R_MODULE_PULLUP },
                    sw: { vTh: 5, rTh: R_MODULE_PULLUP },
                },
                position: 0,       // detent the knob currently rests at
                _phase: 0,         // 0..3 quarter-steps into a transition
                _nextStepNs: 0n,
                _pressed: false,
            };
        },

        stamp() { /* everything is driven; no passive paths */ },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            let changed = false;

            const pressed = !!part.params?.pressed;
            if (pressed !== state._pressed) {
                state._pressed = pressed;
                state.drives.sw = pressed
                    ? { vTh: 0, rTh: R_OUT }
                    : { vTh: vcc, rTh: R_MODULE_PULLUP };
                changed = true;
            }

            const target = Math.trunc(part.params?.position ?? 0);
            const stepNs = BigInt((part.params?.stepUs ?? 1000) * 1000);
            if ((target !== state.position || state._phase !== 0) && tNs >= state._nextStepNs) {
                if (state._phase === 0) state._cw = target > state.position;
                state._phase = (state._phase + 1) % 4;
                if (state._phase === 0) state.position += state._cw ? 1 : -1;
                state._nextStepNs = tNs + stepNs;
                // Gray sequence by phase: CW 11→01→00→10, CCW 11→10→00→01.
                const seq = state._cw
                    ? [[1, 1], [0, 1], [0, 0], [1, 0]]
                    : [[1, 1], [1, 0], [0, 0], [0, 1]];
                const [c, d] = seq[state._phase];
                state.drives.clk = c
                    ? { vTh: vcc, rTh: R_MODULE_PULLUP } : { vTh: 0, rTh: R_OUT };
                state.drives.dt = d
                    ? { vTh: vcc, rTh: R_MODULE_PULLUP } : { vTh: 0, rTh: R_OUT };
                changed = true;
            }
            return changed;
        },
    });
}

export default registerTier2Parts;
