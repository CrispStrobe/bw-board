/**
 * UART frame-protocol devices — modules that speak structured byte
 * frames over a pin-level UART link.  Each device rides the same
 * createUartRx / buildUartFrame engine that the HC-05 proved; the
 * difference is the FRAME LAYER on top of the decoded bytes.
 *
 * DFPlayer Mini — the ubiquitous serial MP3 module. 9600 8N1,
 * 10-byte frames: 0x7E VER LEN CMD FEEDBACK PAR1 PAR2 CHKHI CHKLO 0xEF.
 * The checksum is the two's complement of the sum of bytes 1..6
 * (VER+LEN+CMD+FEEDBACK+PAR1+PAR2).
 *
 * Commands modeled: play (0x0D), pause (0x0E), next (0x01), prev (0x02),
 * volume (0x06), playTrack (0x03), reset (0x0C), queryStatus (0x42),
 * queryVolume (0x43), queryTrackCount (0x48), queryCurrentTrack (0x4C).
 * State: currentTrack, volume, playing, busy pin.
 *
 * ZE08-CH2O — Winsen formaldehyde sensor. 9600 8N1, periodic 9-byte
 * frames: 0xFF 0x17 0x04 DFH DFL THICKH THICKL checksum. The sensor
 * autonomously emits readings at ~1 Hz; params.ch2o_ppb controls the
 * stimulus.  The second rider proving the UART-frame pattern generalizes.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { createUartRx, buildUartFrame } from './uart-peer.js';

const R_OUT = 50;
const R_INPUT = 1e6;

// ─── DFPlayer checksum ────────────────────────────────────────────
function dfChecksum(cmd, feedback, par1, par2) {
    const sum = 0xff + 0x06 + cmd + feedback + par1 + par2;
    const neg = (-sum) & 0xffff;
    return [neg >> 8, neg & 0xff];
}

function dfBuildFrame(cmd, feedback, par1, par2) {
    const [chkH, chkL] = dfChecksum(cmd, feedback, par1, par2);
    return [0x7e, 0xff, 0x06, cmd, feedback, par1, par2, chkH, chkL, 0xef];
}

function dfValidateFrame(bytes) {
    if (bytes.length !== 10) return null;
    if (bytes[0] !== 0x7e || bytes[9] !== 0xef) return null;
    if (bytes[1] !== 0xff || bytes[2] !== 0x06) return null;
    const [chkH, chkL] = dfChecksum(bytes[3], bytes[4], bytes[5], bytes[6]);
    if (bytes[7] !== chkH || bytes[8] !== chkL) return null;
    return { cmd: bytes[3], feedback: bytes[4], par1: bytes[5], par2: bytes[6] };
}

// ─── DFPlayer Mini ────────────────────────────────────────────────

export function registerUartFrame() {

    registerDevice('dfplayer_mini', {
        terminals: ['vcc', 'gnd', 'rx', 'tx', 'busy'],

        init(part) {
            const totalTracks = part.params?.tracks ?? 10;
            return {
                drives: {
                    tx: { vTh: 5, rTh: R_OUT },     // idle high
                    busy: { vTh: 5, rTh: R_OUT },    // HIGH = not busy (active-low)
                },
                volume: part.params?.volume ?? 15,    // 0-30, default 15
                currentTrack: 0,                       // 0 = nothing selected
                playing: false,
                totalTracks,
                errors: [],                            // checksum / framing errors
                commandLog: [],                        // decoded commands for test
                _rx: null,
                _frameBuf: [],
                _txEdges: [], _txIdx: 0,
            };
        },

        stamp(ctx) {
            ctx.conductance('rx', null, 1 / R_INPUT);
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            let changed = false;

            if (!state._rx) state._rx = createUartRx(9600);

            // Decode bytes from the MCU's TX → our RX
            const level = read('rx') > th ? 1 : 0;
            for (const byte of state._rx.feed(level, tNs)) {
                state._frameBuf.push(byte);
                // Hunt for a complete 10-byte frame
                while (state._frameBuf.length >= 10) {
                    // Find start byte
                    const startIdx = state._frameBuf.indexOf(0x7e);
                    if (startIdx < 0) { state._frameBuf = []; break; }
                    if (startIdx > 0) { state._frameBuf.splice(0, startIdx); continue; }
                    if (state._frameBuf.length < 10) break;
                    const frame = state._frameBuf.splice(0, 10);
                    const parsed = dfValidateFrame(frame);
                    if (!parsed) {
                        state.errors.push('checksum');
                        continue;
                    }
                    state.commandLog.push(parsed);
                    const reply = this._handleCmd(state, parsed, tNs, vcc);
                    if (reply) {
                        queueDfReply(state, reply, tNs);
                        changed = true;
                    }
                }
            }

            // Play TX schedule
            while (state._txIdx < state._txEdges.length
                && tNs >= state._txEdges[state._txIdx].t) {
                const e = state._txEdges[state._txIdx++];
                state.drives.tx = { vTh: e.level ? vcc : 0, rTh: R_OUT };
                changed = true;
            }
            if (state._txIdx >= state._txEdges.length && state._txEdges.length) {
                state._txEdges = []; state._txIdx = 0;
            }

            // BUSY pin: active-low when playing
            const busyLevel = state.playing ? 0 : vcc;
            if (state.drives.busy.vTh !== busyLevel) {
                state.drives.busy = { vTh: busyLevel, rTh: R_OUT };
                changed = true;
            }

            return changed;
        },

        _handleCmd(state, { cmd, feedback, par1, par2 }, tNs, vcc) {
            const param = (par1 << 8) | par2;
            switch (cmd) {
                case 0x01: // NEXT
                    if (state.currentTrack < state.totalTracks) state.currentTrack++;
                    else state.currentTrack = 1;
                    state.playing = true;
                    break;
                case 0x02: // PREV
                    if (state.currentTrack > 1) state.currentTrack--;
                    else state.currentTrack = state.totalTracks;
                    state.playing = true;
                    break;
                case 0x03: // PLAY TRACK (param = track number)
                    if (param >= 1 && param <= state.totalTracks) {
                        state.currentTrack = param;
                        state.playing = true;
                    }
                    break;
                case 0x06: // VOLUME (param = 0-30)
                    state.volume = Math.min(30, Math.max(0, param));
                    break;
                case 0x0c: // RESET
                    state.currentTrack = 0;
                    state.volume = 15;
                    state.playing = false;
                    if (feedback) return dfBuildFrame(0x41, 0, 0, 0x02); // init complete: source = SD
                    return null;
                case 0x0d: // PLAY (resume)
                    if (state.currentTrack > 0) state.playing = true;
                    break;
                case 0x0e: // PAUSE
                    state.playing = false;
                    break;
                case 0x42: // QUERY STATUS
                    return dfBuildFrame(0x42, 0, 0, state.playing ? 0x01 : 0x02);
                case 0x43: // QUERY VOLUME
                    return dfBuildFrame(0x43, 0, 0, state.volume);
                case 0x48: // QUERY TRACK COUNT (SD)
                    return dfBuildFrame(0x48, 0, (state.totalTracks >> 8) & 0xff, state.totalTracks & 0xff);
                case 0x4c: // QUERY CURRENT TRACK
                    return dfBuildFrame(0x4c, 0, (state.currentTrack >> 8) & 0xff, state.currentTrack & 0xff);
                default: break;
            }
            // If feedback requested, send ACK
            if (feedback) return dfBuildFrame(0x41, 0, 0, cmd);
            return null;
        },
    });

    // ─── ZE08-CH2O ────────────────────────────────────────────────────
    // Winsen ZE08-CH2O formaldehyde sensor.  Periodic 9-byte frames at
    // 9600 baud, emitted at ~1 Hz.  Stimulus: params.ch2o_ppb.
    registerDevice('ze08_ch2o', {
        terminals: ['vcc', 'gnd', 'tx', 'rx'],

        init(part) {
            return {
                drives: {
                    tx: { vTh: 5, rTh: R_OUT },     // idle high
                },
                ch2o_ppb: part.params?.ch2o_ppb ?? 0,
                _txEdges: [], _txIdx: 0,
                _lastEmitNs: null,
                _emitIntervalNs: 1_000_000_000n,     // ~1 Hz
            };
        },

        stamp(ctx) {
            ctx.conductance('rx', null, 1 / R_INPUT);
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            let changed = false;

            // Update stimulus from params
            state.ch2o_ppb = part.params?.ch2o_ppb ?? state.ch2o_ppb;

            // Periodic emission
            if (state._lastEmitNs === null || tNs - state._lastEmitNs >= state._emitIntervalNs) {
                state._lastEmitNs = tNs;
                const frame = ze08BuildFrame(state.ch2o_ppb);
                const start = state._txEdges.length
                    ? state._txEdges[state._txEdges.length - 1].t + 1_000_000n
                    : tNs + 100_000n;
                state._txEdges = state._txEdges.concat(buildUartFrame(frame, start, 9600));
                changed = true;
            }

            // Play TX schedule
            while (state._txIdx < state._txEdges.length
                && tNs >= state._txEdges[state._txIdx].t) {
                const e = state._txEdges[state._txIdx++];
                state.drives.tx = { vTh: e.level ? vcc : 0, rTh: R_OUT };
                changed = true;
            }
            if (state._txIdx >= state._txEdges.length && state._txEdges.length) {
                state._txEdges = []; state._txIdx = 0;
            }

            return changed;
        },
    });
}

function queueDfReply(state, bytes, tNs) {
    const start = state._txEdges.length
        ? state._txEdges[state._txEdges.length - 1].t + 1_000_000n
        : tNs + 500_000n;
    state._txEdges = state._txEdges.concat(buildUartFrame(bytes, start, 9600));
}

// ─── ZE08-CH2O frame builder ──────────────────────────────────────
// 9-byte frame: 0xFF 0x17 0x04 DFH DFL THICKH THICKL SUM 0x??
// Checksum: ~(sum of bytes 1..6) + 1 = two's complement, one byte.
// Actually the ZE08 uses: checksum = (~(sum of bytes 1..6)) & 0xFF + 1
// which is simply (-sum) & 0xFF.
export function ze08BuildFrame(ppb) {
    const conc = Math.max(0, Math.min(0xffff, Math.round(ppb)));
    const dfH = (conc >> 8) & 0xff;
    const dfL = conc & 0xff;
    // "Full range" output in the thick fields (same value for this sensor)
    const thH = dfH, thL = dfL;
    const sum = 0x17 + 0x04 + dfH + dfL + thH + thL;
    const chk = (-(sum)) & 0xff;
    return [0xff, 0x17, 0x04, dfH, dfL, thH, thL, chk, 0x00];
}

// Re-export frame helpers for tests
export { dfBuildFrame, dfValidateFrame, dfChecksum };

export default registerUartFrame;
