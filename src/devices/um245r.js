/**
 * UM245R USB-parallel-FIFO module — the FTDI FT245BM behind a DIP
 * breakout. Two byte FIFOs (host→device "receive", device→host
 * "transmit") bridged to eight bidirectional data pins by a pair of
 * strobes.
 *
 * Behavioural contract (Z80-BENCH-PAINFULDIODES §8):
 *
 *   /RD LOW  → drive D0-D7 with the head of the receive FIFO;
 *              rising edge POPS.
 *   WR high→low edge latches D0-D7 into the transmit FIFO.
 *   /RXF LOW while the receive FIFO is non-empty.
 *   /TXE LOW while the transmit FIFO has room.
 *
 *   **An empty receive FIFO drives the LAST byte received, not zero.**
 *   This is the pedagogical trap: a read without checking /RXF is
 *   never self-validating. The model reproduces it exactly because
 *   reproducing it IS the point.
 *
 * Host face: params.rxData = { seq, bytes: [n, …] } injects bytes
 * into the receive FIFO (bump seq to queue a new batch). The transmit
 * FIFO is exposed as state.txOut for the UI to read and clear.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.

const RX_FIFO_CAP = 128;
const TX_FIFO_CAP = 384;

export function registerUM245R() {

    registerDevice('um245r', {
        terminals: ['d0','d1','d2','d3','d4','d5','d6','d7',
                    'rdb','wr','txeb','rxfb','resetb','vcc','gnd'],

        init() {
            return {
                drives: {
                    txeb: { vTh: 0, rTh: R_OUT },  // room to transmit → LOW
                    rxfb: { vTh: 5, rTh: R_OUT },  // empty → HIGH (no data)
                },
                rxFifo: [],
                txFifo: [],
                txOut: [],
                lastByte: 0,
                _lastRd: false,   // previous rdActive (idle = not active)
                _lastWr: false,
                _rxSeq: 0,
                _driving: false,
            };
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            let changed = false;

            // ── Host injection via params ──────────────────────────────
            const rx = part.params?.rxData;
            if (rx && rx.seq !== state._rxSeq) {
                state._rxSeq = rx.seq;
                const bytes = rx.bytes ?? [];
                for (const b of bytes) {
                    if (state.rxFifo.length < RX_FIFO_CAP) {
                        state.rxFifo.push(b & 0xFF);
                    }
                }
                changed = true;
            }

            // ── /RESET ─────────────────────────────────────────────────
            if (read('resetb') < th) {
                if (state.rxFifo.length || state.txFifo.length || state._driving) {
                    state.rxFifo = [];
                    state.txFifo = [];
                    state.lastByte = 0;
                    state._driving = false;
                    state._lastRd = false;
                    state._lastWr = false;
                    for (let i = 0; i < 8; i++) delete state.drives[`d${i}`];
                    changed = true;
                }
            }

            // ── Read strobe (/RD) ──────────────────────────────────────
            const rdActive = read('rdb') < th;
            if (rdActive && !state._driving) {
                const byte = state.rxFifo.length > 0
                    ? state.rxFifo[0]
                    : state.lastByte;  // THE TRAP: empty FIFO repeats last byte
                for (let i = 0; i < 8; i++) {
                    state.drives[`d${i}`] = { vTh: ((byte >> i) & 1) ? vcc : 0, rTh: R_OUT };
                }
                state._driving = true;
                changed = true;
            }
            if (!rdActive && state._lastRd) {
                // Rising edge of /RD (was active, now released): pop the FIFO
                if (state.rxFifo.length > 0) {
                    state.lastByte = state.rxFifo.shift();
                }
            }
            if (!rdActive && state._driving) {
                for (let i = 0; i < 8; i++) delete state.drives[`d${i}`];
                state._driving = false;
                changed = true;
            }
            state._lastRd = rdActive;

            // ── Write strobe (WR, active HIGH!) ────────────────────────
            const wrActive = read('wr') > th;
            if (!wrActive && state._lastWr) {
                if (state.txFifo.length < TX_FIFO_CAP) {
                    let byte = 0;
                    for (let i = 0; i < 8; i++) {
                        if (read(`d${i}`) > th) byte |= 1 << i;
                    }
                    state.txFifo.push(byte);
                    state.txOut.push(byte);
                    changed = true;
                }
            }
            state._lastWr = wrActive;

            // ── Status flags ───────────────────────────────────────────
            const rxfbV = state.rxFifo.length > 0 ? 0 : vcc;
            const txebV = state.txFifo.length < TX_FIFO_CAP ? 0 : vcc;

            if ((state.drives.rxfb?.vTh ?? -1) !== rxfbV) {
                state.drives.rxfb = { vTh: rxfbV, rTh: R_OUT };
                changed = true;
            }
            if ((state.drives.txeb?.vTh ?? -1) !== txebV) {
                state.drives.txeb = { vTh: txebV, rTh: R_OUT };
                changed = true;
            }

            return changed;
        },
    });
}

export default registerUM245R;
