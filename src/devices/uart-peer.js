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
// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.

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
            const state = {
                drives: {
                    txd: { vTh: 5, rTh: R_OUT },      // idle high
                    state: { vTh: 0, rTh: R_OUT },     // HIGH while connected
                },
                received: [],                          // data-mode bytes from the MCU
                atLog: [],                             // AT commands seen
                config: defaultConfig(part),           // the firmware's settings
                paired: [],                            // bonded addresses
                linked: null,                          // connected peer address
                _rx: null, _rxBaud: 0,
                _txEdges: [], _txIdx: 0,
                _peerSeq: 0,
                _lineBuf: [],
            };
            // Join the AIR: every module with the same params.air shares a
            // radio neighborhood — place five, they all see each other.
            airJoin(part.params?.air ?? 'air0', state);
            return state;
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
                        const reply = atCommand(part, state, cmd);
                        this._queue(state, `${reply}\r\n`, tNs, baud);
                        changed = true;
                    }
                } else {
                    state.received.push(byte);
                    // THE BRIDGE: a live link carries data to the peer
                    // module's TXD — robot A's MCU writes, robot B's MCU
                    // reads, exactly like the paired hardware.
                    if (state.linked) {
                        const peer = airFind(state, state.linked);
                        if (peer) {
                            const peerBaud = peer.config.uart.baud;
                            queueBytes(peer, [byte], tNs, peerBaud);
                            changed = true;
                        }
                    }
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

            // The STATE pin is the module's own truth-teller: high while
            // a link is up — what tutorials wire to an LED or an interrupt.
            const stLevel = state.linked ? vcc : 0;
            if (state.drives.state.vTh !== stLevel) {
                state.drives.state = { vTh: stLevel, rTh: R_OUT };
                changed = true;
            }
            return changed;
        },

        _queue(state, text, tNs, baud) {
            queueBytes(state, [...text].map((c) => c.charCodeAt(0) & 0xff), tNs, baud);
        },
    });
}

function queueBytes(state, bytes, tNs, baud) {
    const start = state._txEdges.length
        ? state._txEdges[state._txEdges.length - 1].t + 1_000_000n
        : tNs + 500_000n;                             // half a ms of turnaround
    state._txEdges = state._txEdges.concat(buildUartFrame(bytes, start, baud));
}

// ─── The air: now the GENERAL medium engine (src/air.js) ───────────────
// The HC-05 is the bt kind's citizen: space `bt:${params.air}`, address
// from the live config (renames visible to inquirers), delivery = queue
// bytes onto the member's TXD. Symmetric-link state stays KIND
// semantics layered here, per the air contract.
import { joinAir, airOthers as genOthers, airFind as genFind, resetAir } from '../air.js';

function airJoin(id, state) {
    state._member = joinAir(`bt:${id}`, {
        state,
        addr: () => state.config.addr,
        // bt is connection-oriented: the stream bridges through kind-layer
        // state access (queueBytes on the linked peer, timed at the
        // receiving module's baud) — generic delivery is not the path.
        deliver: () => { },
    });
}

/** Test hygiene, kept under the old name for the bt kind. */
export function airReset(id) { resetAir(`bt:${id}`); }

function airOthers(state) {
    return genOthers(state._member).map((m) => m.state);
}

function airFind(state, addr) {
    const m = genFind(state._member, addr);
    return m ? m.state : null;
}

// Auto-unique default address: five placed modules must not collide, so
// the tail derives from the part id when none is declared.
function addrFor(part) {
    if (part.params?.addr) return part.params.addr;
    let h = 0;
    for (const ch of String(part.id ?? '')) h = ((h * 31) + ch.charCodeAt(0)) & 0xffffff;
    return `98d3:31:${h.toString(16).padStart(6, '0')}`;
}

function defaultConfig(part) {
    return {
        name: part.params?.name ?? 'HC-05',
        pswd: '1234',
        uart: { baud: part.params?.baud ?? 9600, stop: 0, parity: 0 },
        role: 0,                                   // 0 slave, 1 master, 2 loopback
        cmode: 0,                                  // 0 bind-only, 1 any
        clazz: 0,
        bind: '0:0:0',
        addr: addrFor(part),
    };
}

/**
 * The documented 2.0-20100601 command surface (the EGBT/HC-05 AT set):
 * settings mutate real state, ORGL restores factory, and the
 * inquiry/pair/link family answers against the STIMULUS surface —
 * params.nearby = [{addr, name, class}] scripts the radio neighborhood,
 * since the radio itself is out of scope by doctrine. Firmware that
 * does the full tutorial dance (INIT, INQ, PAIR, BIND, LINK, STATE?)
 * sees the documented behavior end to end.
 */
function atCommand(part, state, cmd) {
    const c = state.config;
    // The neighborhood = every OTHER module on this air (live configs, so
    // renames show up in inquiry) + any scripted extras from params.
    const airDevices = airOthers(state).map((s) => ({
        addr: s.config.addr, name: s.config.name, class: s.config.clazz || '1F00',
    }));
    const nearby = airDevices.concat(part.params?.nearby || []);
    const findNear = (addr) => nearby.find((d) => d.addr === addr);
    let m;

    if (cmd === 'AT') return 'OK';
    if (cmd === 'AT+INIT') return 'OK';
    if (cmd === 'AT+RESET') { state.linked = null; return 'OK'; }
    if (cmd === 'AT+ORGL') { state.config = defaultConfig({ params: {} }); state.paired = []; return 'OK';    }
    if (cmd === 'AT+VERSION?') return '+VERSION:2.0-20100601\r\nOK';
    if (cmd === 'AT+ADDR?') return `+ADDR:${c.addr}\r\nOK`;
    if (cmd === 'AT+NAME?') return `+NAME:${c.name}\r\nOK`;
    if ((m = /^AT\+NAME=(.*)$/.exec(cmd))) { c.name = m[1]; return 'OK'; }
    if (cmd === 'AT+PSWD?') return `+PSWD:${c.pswd}\r\nOK`;
    if ((m = /^AT\+PSWD=(.*)$/.exec(cmd))) { c.pswd = m[1]; return 'OK'; }
    if (cmd === 'AT+UART?') return `+UART:${c.uart.baud},${c.uart.stop},${c.uart.parity}\r\nOK`;
    if ((m = /^AT\+UART=(\d+),(\d+),(\d+)$/.exec(cmd))) {
        c.uart = { baud: Number(m[1]), stop: Number(m[2]), parity: Number(m[3]) };
        return 'OK';
    }
    if (cmd === 'AT+ROLE?') return `+ROLE:${c.role}\r\nOK`;
    if ((m = /^AT\+ROLE=([012])$/.exec(cmd))) { c.role = Number(m[1]); return 'OK'; }
    if (cmd === 'AT+CMODE?') return `+CMOD:${c.cmode}\r\nOK`;
    if ((m = /^AT\+CMODE=([01])$/.exec(cmd))) { c.cmode = Number(m[1]); return 'OK'; }
    if (cmd === 'AT+CLASS?') return `+CLASS:${c.clazz}\r\nOK`;
    if ((m = /^AT\+CLASS=(\w+)$/.exec(cmd))) { c.clazz = m[1]; return 'OK'; }
    if (cmd === 'AT+BIND?') return `+BIND:${c.bind}\r\nOK`;
    if ((m = /^AT\+BIND=(.+)$/.exec(cmd))) { c.bind = m[1].replace(/,/g, ':'); return 'OK'; }
    if (cmd === 'AT+RMAAD') { state.paired = []; return 'OK'; }
    if (cmd === 'AT+ADCN?') return `+ADCN:${state.paired.length}\r\nOK`;
    if (cmd === 'AT+STATE?') {
        const st = state.linked ? 'CONNECTED'
            : state.paired.length ? 'PAIRED' : 'INITIALIZED';
        return `+STATE:${st}\r\nOK`;
    }
    if (cmd === 'AT+INQ') {
        const lines = nearby.map((d) => `+INQ:${d.addr},${d.class ?? '1F00'},7FFF`);
        return [...lines, 'OK'].join('\r\n');
    }
    if (cmd === 'AT+INQC') return 'OK';
    if ((m = /^AT\+RNAME\?(.+)$/.exec(cmd))) {
        const d = findNear(m[1].replace(/,/g, ':'));
        return d ? `+RNAME:${d.name}\r\nOK` : 'FAIL';
    }
    if ((m = /^AT\+PAIR=(.+?),\d+$/.exec(cmd))) {
        const addr = m[1].replace(/,/g, ':');
        if (!findNear(addr)) return 'FAIL';
        if (!state.paired.includes(addr)) state.paired.push(addr);
        return 'OK';
    }
    if ((m = /^AT\+LINK=(.+)$/.exec(cmd))) {
        const addr = m[1].replace(/,/g, ':');
        if (c.cmode === 1 || state.paired.includes(addr) || findNear(addr)) {
            state.linked = addr;
            // A link is SYMMETRIC: the peer module (if it is a real air
            // member, not a scripted extra) sees the connection too — its
            // STATE pin rises and its data bridges back.
            const peer = airFind(state, addr);
            if (peer) peer.linked = c.addr;
            return 'OK';
        }
        return 'FAIL';
    }
    if (cmd === 'AT+DISC') {
        const peer = state.linked ? airFind(state, state.linked) : null;
        if (peer && peer.linked === c.addr) peer.linked = null;
        state.linked = null;
        return '+DISC:SUCCESS\r\nOK';
    }
    return 'ERROR:(0)';
}

export default registerUartPeer;
