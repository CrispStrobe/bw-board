/**
 * nRF24L01+ — the air's third kind: ADDRESSED PACKETS. Clean-room from
 * the Nordic datasheet; the part every two-robot 2.4 GHz tutorial
 * wires, and the RF24 library's target.
 *
 * SPI is FULL-DUPLEX and CSN-framed, and the chip's signature move is
 * modeled exactly: while the command byte shifts in on MOSI, STATUS
 * shifts out on MISO — every transaction's first returned byte is the
 * status, which is how RF24 reads it for free. Commands: R/W_REGISTER,
 * R_RX_PAYLOAD, W_TX_PAYLOAD, FLUSH_TX/RX, NOP. Registers modeled:
 * CONFIG (PWR_UP, PRIM_RX, mask bits), EN_AA, EN_RXADDR, SETUP_AW,
 * RF_CH, RF_SETUP, STATUS (write-1-to-clear), RX_ADDR_P0..P5 (P0/P1
 * full width, P2-5 sharing P1's prefix per datasheet), TX_ADDR,
 * RX_PW_P0..5, FIFO_STATUS.
 *
 * The radio rides the air engine: space `nrf24:${RF_CH}` (channel is
 * the band — different channels never meet), packets broadcast with
 * the TX address and matched against each receiver's ENABLED pipes in
 * the kind layer, exactly per the air contract. A CE pulse in TX mode
 * sends the FIFO head; a PRIM_RX receiver with CE high and a matching
 * pipe gets the payload, RX_DR, RX_P_NO, and its IRQ pin LOW (active
 * low, honoring the mask bits).
 *
 * Simplified, stated: auto-ack marks TX_DS when at least one receiver
 * accepted and MAX_RT when none did (EN_AA set) — the retry ladder and
 * ack payloads are not modeled; dynamic payloads (FEATURE/DYNPD) are
 * not yet. RF24's canonical begin/openPipe/write/read flow works.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { joinAir, airSend } from '../air.js';

const R_OUT = 50;
const R_OFF = 1e9;
// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.

const REG = {
    CONFIG: 0x00, EN_AA: 0x01, EN_RXADDR: 0x02, SETUP_AW: 0x03,
    SETUP_RETR: 0x04, RF_CH: 0x05, RF_SETUP: 0x06, STATUS: 0x07,
    RX_ADDR_P0: 0x0a, TX_ADDR: 0x10, RX_PW_P0: 0x11, FIFO_STATUS: 0x17,
};

export function registerNrf24() {

    registerDevice('nrf24l01', {
        terminals: ['vcc', 'gnd', 'ce', 'csn', 'sck', 'mosi', 'miso', 'irq'],

        init(part) {
            const state = {
                drives: {
                    miso: { vTh: 0, rTh: R_OFF },
                    irq: { vTh: 5, rTh: R_OUT },       // active low, idle high
                },
                regs: powerOnRegs(),
                addrs: {
                    p0: [0xe7, 0xe7, 0xe7, 0xe7, 0xe7],
                    p1: [0xc2, 0xc2, 0xc2, 0xc2, 0xc2],
                    p2: 0xc3, p3: 0xc4, p4: 0xc5, p5: 0xc6,
                    tx: [0xe7, 0xe7, 0xe7, 0xe7, 0xe7],
                },
                txFifo: [], rxFifo: [],                 // [{pipe, bytes}]
                _csn: true, _sck: false, _ce: false,
                _cmd: null, _byteIdx: 0, _inByte: 0, _bit: 0,
                _outByte: 0, _multi: [],
                _ch: null, _member: null,
            };
            joinChannel(part, state);
            return state;
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const csn = read('csn') > th;
            const sck = read('sck') > th;
            const ce = read('ce') > th;
            let changed = false;

            // Channel follows RF_CH live: retunes move the member.
            if (state._ch !== state.regs[REG.RF_CH]) joinChannel(part, state);

            if (csn && !state._csn) {                   // transaction end
                state._cmd = null;
                state.drives.miso = { vTh: 0, rTh: R_OFF };
                changed = true;
            }
            if (!csn && state._csn) {                   // transaction start
                state._cmd = null; state._byteIdx = 0; state._bit = 0; state._inByte = 0;
                state._outByte = status(state);         // STATUS rides out first
                state.drives.miso = { vTh: (state._outByte & 0x80) ? vcc : 0, rTh: R_OUT };
                changed = true;
            }

            if (!csn) {
                if (sck && !state._sck) {               // rising: sample MOSI
                    state._inByte = ((state._inByte << 1) | (read('mosi') > th ? 1 : 0)) & 0xff;
                    state._bit++;
                    if (state._bit === 8) {
                        state._bit = 0;
                        this._byte(state, state._inByte);
                        state._inByte = 0;
                    }
                }
                if (!sck && state._sck) {               // falling: next MISO bit
                    const bit = 7 - state._bit;
                    const level = (state._outByte >> bit) & 1;
                    const want = { vTh: level ? vcc : 0, rTh: R_OUT };
                    if (state.drives.miso.vTh !== want.vTh) { state.drives.miso = want; changed = true; }
                }
            }
            state._csn = csn; state._sck = sck;

            // CE rising in TX mode transmits the FIFO head.
            if (ce && !state._ce) {
                const cfg = state.regs[REG.CONFIG];
                if ((cfg & 0x02) && !(cfg & 0x01) && state.txFifo.length) {
                    transmit(part, state);
                    changed = true;
                }
            }
            state._ce = ce;

            // IRQ: active low while any unmasked flag is set.
            const st = status(state);
            const cfg = state.regs[REG.CONFIG];
            const irqActive = ((st & 0x40) && !(cfg & 0x40))
                || ((st & 0x20) && !(cfg & 0x20))
                || ((st & 0x10) && !(cfg & 0x10));
            const irqLevel = irqActive ? 0 : vcc;
            if (state.drives.irq.vTh !== irqLevel) {
                state.drives.irq = { vTh: irqLevel, rTh: R_OUT };
                changed = true;
            }
            return changed;
        },

        _byte(state, b) {
            if (state._cmd === null) {                  // command byte
                state._cmd = b; state._byteIdx = 0; state._multi = [];
                if ((b & 0xe0) === 0x00) {              // R_REGISTER
                    state._outByte = readReg(state, b & 0x1f, 0);
                } else if (b === 0x61) {                // R_RX_PAYLOAD
                    const pkt = state.rxFifo[0];
                    state._outByte = pkt ? (pkt.bytes[0] ?? 0) : 0;
                } else if (b === 0xe1) { state.txFifo = []; state._outByte = 0; }
                else if (b === 0xe2) { state.rxFifo = []; state._outByte = 0; }
                else state._outByte = 0;
                return;
            }
            const cmd = state._cmd;
            state._byteIdx++;
            if ((cmd & 0xe0) === 0x20) {                // W_REGISTER
                writeReg(state, cmd & 0x1f, state._byteIdx - 1, b);
                state._outByte = 0;
            } else if ((cmd & 0xe0) === 0x00) {         // R_REGISTER continues
                state._outByte = readReg(state, cmd & 0x1f, state._byteIdx);
            } else if (cmd === 0xa0) {                  // W_TX_PAYLOAD
                state._multi.push(b);
                if (state.txFifo.length === 0) state.txFifo.push({ bytes: [] });
                state.txFifo[state.txFifo.length - 1].bytes = [...state._multi];
                state._outByte = 0;
            } else if (cmd === 0x61) {                  // R_RX_PAYLOAD continues
                const pkt = state.rxFifo[0];
                state._outByte = pkt ? (pkt.bytes[state._byteIdx] ?? 0) : 0;
                // Datasheet: payload is removed once fully read; model:
                // remove when the last expected byte has shifted out.
                if (pkt) {
                    const width = state.regs[REG.RX_PW_P0 + pkt.pipe] || pkt.bytes.length;
                    if (state._byteIdx >= width) {
                        state.rxFifo.shift();
                        if (!state.rxFifo.length) {
                            // RX_DR remains until written clear — datasheet.
                        }
                    }
                }
            }
        },
    });
}

function powerOnRegs() {
    const r = new Array(0x18).fill(0);
    r[REG.CONFIG] = 0x08;
    r[REG.EN_AA] = 0x3f;
    r[REG.EN_RXADDR] = 0x03;
    r[REG.SETUP_AW] = 0x03;
    r[REG.SETUP_RETR] = 0x03;
    r[REG.RF_CH] = 0x02;
    r[REG.RF_SETUP] = 0x0e;
    r[REG.FIFO_STATUS] = 0x11;
    return r;
}

function status(state) {
    // Flags (RX_DR/TX_DS/MAX_RT) live in _stFlags; the pipe number
    // reflects the RX FIFO head; TX_FULL when three payloads queue.
    const pipe = state.rxFifo.length ? (state.rxFifo[0].pipe & 0x07) : 0x07;
    return (state._stFlags || 0) | (pipe << 1) | (state.txFifo.length >= 3 ? 1 : 0);
}

function readReg(state, reg, idx) {
    if (reg === REG.STATUS) return status(state);
    if (reg === REG.RX_ADDR_P0) return state.addrs.p0[idx] ?? 0;
    if (reg === REG.RX_ADDR_P0 + 1) return state.addrs.p1[idx] ?? 0;
    if (reg >= REG.RX_ADDR_P0 + 2 && reg <= REG.RX_ADDR_P0 + 5) {
        return state.addrs[`p${reg - REG.RX_ADDR_P0}`];
    }
    if (reg === REG.TX_ADDR) return state.addrs.tx[idx] ?? 0;
    if (reg === REG.FIFO_STATUS) {
        return (state.rxFifo.length ? 0 : 0x01) | (state.rxFifo.length >= 3 ? 0x02 : 0)
            | (state.txFifo.length ? 0 : 0x10) | (state.txFifo.length >= 3 ? 0x20 : 0);
    }
    return state.regs[reg] ?? 0;
}

function writeReg(state, reg, idx, b) {
    if (reg === REG.STATUS) {                           // write 1 to clear
        state._stFlags = (state._stFlags || 0) & ~(b & 0x70);
        return;
    }
    if (reg === REG.RX_ADDR_P0) { if (idx < 5) state.addrs.p0[idx] = b; return; }
    if (reg === REG.RX_ADDR_P0 + 1) { if (idx < 5) state.addrs.p1[idx] = b; return; }
    if (reg >= REG.RX_ADDR_P0 + 2 && reg <= REG.RX_ADDR_P0 + 5) {
        state.addrs[`p${reg - REG.RX_ADDR_P0}`] = b; return;
    }
    if (reg === REG.TX_ADDR) { if (idx < 5) state.addrs.tx[idx] = b; return; }
    if (idx === 0 && reg < 0x18) state.regs[reg] = b;
}

function joinChannel(part, state) {
    state._ch = state.regs[REG.RF_CH];
    state._member = joinAir(`nrf24:${state._ch}`, {
        state,
        addr: () => state.addrs.tx.map((x) => x.toString(16)).join(''),
        deliver: (pkt) => receive(state, pkt),
    });
}

function pipeAddr(state, pipe) {
    if (pipe === 0) return state.addrs.p0;
    if (pipe === 1) return state.addrs.p1;
    return [...state.addrs.p1.slice(0, 4), state.addrs[`p${pipe}`]];
}

function receive(state, pkt) {
    const cfg = state.regs[REG.CONFIG];
    if (!(cfg & 0x02) || !(cfg & 0x01) || !state._ce) return;   // not listening
    const en = state.regs[REG.EN_RXADDR];
    for (let pipe = 0; pipe < 6; pipe++) {
        if (!(en & (1 << pipe))) continue;
        const a = pipeAddr(state, pipe);
        if (a.join(',') !== pkt.to.join(',')) continue;
        if (state.rxFifo.length < 3) {
            state.rxFifo.push({ pipe, bytes: pkt.bytes });
            state._stFlags = (state._stFlags || 0) | 0x40;      // RX_DR
        }
        pkt.accepted = true;
        return;
    }
}

function transmit(part, state) {
    const payload = state.txFifo.shift();
    const pkt = { to: [...state.addrs.tx], bytes: payload.bytes, accepted: false };
    airSend(state._member, pkt);
    if (pkt.accepted) {
        state._stFlags = (state._stFlags || 0) | 0x20;          // TX_DS
    } else if (state.regs[REG.EN_AA]) {
        state._stFlags = (state._stFlags || 0) | 0x10;          // MAX_RT
    } else {
        state._stFlags = (state._stFlags || 0) | 0x20;
    }
}

export default registerNrf24;
