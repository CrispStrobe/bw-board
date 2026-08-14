/**
 * UART at the PIN level + the HC-05 serial peer. The engine is what
 * makes bit-banged serial (SoftwareSerial sketches, hand-rolled 8051
 * routines) meet board devices with UART mouths — DFPlayer-class and
 * frame-emitting sensors ride the same two primitives later.
 *
 * createUartRx(baud): an EDGE-TIMELINE decoder. Fed (level, tNs) on
 * every observed change plus idle polls, it reconstructs 8N1 frames by
 * integer bit-widths between edges: each edge closes the previous
 * level's run, the run becomes round(duration/bit) bits, and a frame
 * assembler consumes start(0) + 8 data LSB-first + stop(1), resyncing
 * past framing errors by hunting the next low. A long high with a
 * pending frame completes it — the stop bit has no closing edge on an
 * idle line, which is THE trap in edge-driven UART decode and the
 * reason the assembler pads from time, not edges.
 *
 * buildUartFrame(bytes, t0, baud): the TX mirror — a timed edge
 * schedule (idle-high, start low, LSB-first data, stop high) that
 * update() plays out against machine time, the DHT11 pattern.
 *
 * hc05: the ubiquitous Bluetooth-SPP module AS ITS SERIAL FACE — over
 * the wire it IS a UART peer, which is all firmware can see. Data
 * mode: decoded bytes land in state.received; the remote peer speaks
 * via params.peer = {seq, text} (the params idiom — bump seq, text is
 * queued to TXD). KEY/EN high at 38400 enters the AT subset (AT,
 * AT+NAME?, AT+VERSION?, AT+UART?, else ERROR) — enough for every
 * tutorial's "check the module answers" step. Radio pairing itself is
 * out of scope, stated: the peer IS the stimulus surface.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_INPUT = 1e6;

/** @param {number} baud @returns edge-fed 8N1 decoder */
export function createUartRx(baud) {
    const bitNs = 1e9 / baud;
    return {
        _level: 1, _since: null, _bits: [],
        /** Feed the CURRENT line level at tNs; returns newly decoded bytes. */
        feed(level, tNs) {
            const out = [];
            if (this._since === null) { this._since = tNs; this._level = level; return out; }
            const closeRun = (upTo) => {
                const n = Math.round(Number(upTo - this._since) / bitNs);
                for (let i = 0; i < n && this._bits.length < 64; i++) this._bits.push(this._level);
                this._since = upTo;
            };
            if (level !== this._level) {
                closeRun(tNs);
                this._level = level;
            } else if (level === 1 && this._bits.length && this._bits[0] === 0) {
                // Idle-high completion: the stop bit never gets a closing
                // edge, and for 0xFF the WHOLE frame after the start bit is
                // one unbroken high run — so count the open run toward the
                // ten frame bits, not just what is already banked.
                const run = Math.round(Number(tNs - this._since) / bitNs);
                if (this._bits.length + run >= 10) closeRun(tNs);
            }
            // Assemble frames; resync past garbage by hunting the next low.
            while (this._bits.length) {
                if (this._bits[0] !== 0) { this._bits.shift(); continue; }   // hunt start
                if (this._bits.length < 10) break;
                const data = this._bits.slice(1, 9);
                const stop = this._bits[9];
                this._bits.splice(0, 10);
                if (stop !== 1) continue;                                    // framing error
                out.push(data.reduce((v, b, i) => v | (b << i), 0));
            }
            return out;
        },
    };
}

/** @returns {Array<{t: bigint, level: 0|1}>} timed 8N1 edge schedule */
export function buildUartFrame(bytes, t0, baud) {
    const bitNs = BigInt(Math.round(1e9 / baud));
    const edges = [];
    let t = t0;
    for (const byte of bytes) {
        edges.push({ t, level: 0 });                  // start
        t += bitNs;
        for (let i = 0; i < 8; i++) {
            edges.push({ t, level: (byte >> i) & 1 });
            t += bitNs;
        }
        edges.push({ t, level: 1 });                  // stop (and inter-byte idle)
        t += bitNs;
    }
    return edges;
}

export function registerUartPeer() {

    registerDevice('hc05', {
        terminals: ['vcc', 'gnd', 'rxd', 'txd', 'key', 'state'],

        init(part) {
            return {
                drives: {
                    txd: { vTh: 5, rTh: R_OUT },      // idle high
                    state: { vTh: 0, rTh: R_OUT },
                },
                received: [],                          // data-mode bytes from the MCU
                atLog: [],                             // AT commands seen
                _rx: null, _rxBaud: 0,
                _txEdges: [], _txIdx: 0,
                _peerSeq: 0,
                _lineBuf: [],
            };
        },

        stamp(ctx) {
            ctx.conductance('rxd', null, 1 / R_INPUT);
            ctx.conductance('key', null, 1 / R_INPUT);
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const at = read('key') > th;
            const baud = at ? 38400 : (part.params?.baud ?? 9600);
            let changed = false;

            if (!state._rx || state._rxBaud !== baud) {
                state._rx = createUartRx(baud);
                state._rxBaud = baud;
            }

            // RXD: decode what the MCU transmits.
            const level = read('rxd') > th ? 1 : 0;
            for (const byte of state._rx.feed(level, tNs)) {
                if (at) {
                    state._lineBuf.push(byte);
                    if (byte === 0x0a) {              // \n ends an AT command
                        const cmd = String.fromCharCode(...state._lineBuf).trim();
                        state._lineBuf = [];
                        state.atLog.push(cmd);
                        const reply = atReply(part, cmd);
                        this._queue(state, `${reply}\r\n`, tNs, baud);
                        changed = true;
                    }
                } else {
                    state.received.push(byte);
                }
            }

            // Peer injection: params.peer = {seq, text} — new seq queues text.
            const peer = part.params?.peer;
            if (peer && peer.seq !== state._peerSeq) {
                state._peerSeq = peer.seq;
                this._queue(state, String(peer.text ?? ''), tNs, baud);
                changed = true;
            }

            // Play the TXD schedule against machine time.
            while (state._txIdx < state._txEdges.length
                && tNs >= state._txEdges[state._txIdx].t) {
                const e = state._txEdges[state._txIdx++];
                state.drives.txd = { vTh: e.level ? vcc : 0, rTh: R_OUT };
                changed = true;
            }
            if (state._txIdx >= state._txEdges.length && state._txEdges.length) {
                state._txEdges = []; state._txIdx = 0;
            }
            return changed;
        },

        _queue(state, text, tNs, baud) {
            const bytes = [...text].map((c) => c.charCodeAt(0) & 0xff);
            const start = state._txEdges.length
                ? state._txEdges[state._txEdges.length - 1].t + 1_000_000n
                : tNs + 500_000n;                     // half a ms of turnaround
            state._txEdges = state._txEdges.concat(buildUartFrame(bytes, start, baud));
        },
    });
}

function atReply(part, cmd) {
    if (cmd === 'AT') return 'OK';
    if (cmd === 'AT+NAME?') return `+NAME:${part.params?.name ?? 'HC-05'}\r\nOK`;
    if (cmd === 'AT+VERSION?') return '+VERSION:2.0-20100601\r\nOK';
    if (cmd === 'AT+UART?') return `+UART:${part.params?.baud ?? 9600},0,0\r\nOK`;
    return 'ERROR:(0)';
}

export default registerUartPeer;
