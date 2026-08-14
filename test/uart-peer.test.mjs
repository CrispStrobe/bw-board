// UART edge engine + HC-05 goldens: the harness bit-bangs 8N1 exactly
// as SoftwareSerial does (one pin write per bit at the baud interval),
// and samples the module's TXD the same way.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerUartPeer, createUartRx, buildUartFrame } from '../src/devices/uart-peer.js';

registerUartPeer();

describe('the edge engine alone', () => {
    it('decodes frames from edge timing, pads the idle stop, resyncs past garbage', () => {
        const rx = createUartRx(9600);
        const bit = 104_167n;                      // ns at 9600
        let t = 0n;
        const feedFrame = (byte) => {
            const edges = buildUartFrame([byte], t, 9600);
            let got = [];
            for (const e of edges) got = got.concat(rx.feed(e.level, e.t));
            t = edges[edges.length - 1].t + 3n * bit;
            got = got.concat(rx.feed(1, t));       // idle poll completes the frame
            return got;
        };
        assert.deepEqual(feedFrame(0x55), [0x55]);
        assert.deepEqual(feedFrame(0x00), [0x00], 'all-zero data still frames');
        assert.deepEqual(feedFrame(0xff), [0xff], 'all-one data still frames');
        // Garbage: a half-bit glitch low, then a clean frame.
        rx.feed(0, t); t += 40_000n;
        rx.feed(1, t); t += 5n * bit;
        assert.deepEqual(feedFrame(0x41), [0x41], 'resynced after the glitch');
    });
});

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

function rig(params = {}, keyHigh = false) {
    const board = new BoardImpl(5.0);
    const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'BT', kind: 'hc05', params, terminals: ['vcc', 'gnd', 'rxd', 'txd', 'key', 'state'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
    ];
    board.setNetlist(parts, [
        net('nv', ['VCC', 'vcc'], ['BT', 'vcc'], ...(keyHigh ? [['BT', 'key']] : [])),
        net('ng', ['GND', 'gnd'], ['BT', 'gnd'], ...(keyHigh ? [] : [['BT', 'key']])),
        net('nr', ['MCU', 'P1.0'], ['BT', 'rxd']),
        net('nt', ['MCU', 'P1.1'], ['BT', 'txd']),
    ]);
    let t = 0n;
    const baud = keyHigh ? 38400 : (params.baud ?? 9600);
    const bitNs = BigInt(Math.round(1e9 / baud));
    const to = (nt) => { t = nt; board.advanceTo(t); };
    // SoftwareSerial's exact discipline: set level, wait one bit.
    const sendByte = (b) => {
        board.setPin('P1.0', 'pushpull', false); to(t + bitNs);
        for (let i = 0; i < 8; i++) {
            board.setPin('P1.0', 'pushpull', !!((b >> i) & 1)); to(t + bitNs);
        }
        board.setPin('P1.0', 'pushpull', true); to(t + bitNs);
    };
    const sendText = (s) => { for (const c of s) sendByte(c.charCodeAt(0)); };
    // Sample TXD at bit centers after hunting the start edge.
    const readReply = (maxBytes, deadlineNs) => {
        board.setPin('P1.2', 'input', false);
        const rx = createUartRx(baud);
        const out = [];
        const step = bitNs / 4n;
        const stop = t + deadlineNs;
        while (t < stop && out.length < maxBytes) {
            to(t + step);
            const lvl = board.readAnalog('P1.1') > 2.5 ? 1 : 0;
            for (const byte of rx.feed(lvl, t)) out.push(byte);
        }
        return out;
    };
    return { board, sendByte, sendText, readReply, idle: (ns) => to(t + ns), parts };
}

describe('HC-05', () => {
    it('data mode: bit-banged bytes land in received; the peer speaks back', () => {
        const r = rig();
        r.board.setPin('P1.0', 'pushpull', true);
        r.idle(1_000_000n);
        r.sendText('Hi');
        r.idle(2_000_000n);
        const st = r.board.getDeviceState('BT');
        assert.deepEqual(st.received.slice(0, 2), [0x48, 0x69], 'H i');

        r.parts[2].params = { peer: { seq: 1, text: 'ok' } };
        r.board.setControl('BT', 1);
        const reply = r.readReply(2, 10_000_000n);
        assert.deepEqual(reply, [0x6f, 0x6b], 'peer text arrives on TXD');
    });

    it('AT mode at 38400: AT answers OK, unknown answers ERROR', () => {
        const r = rig({}, true);
        r.board.setPin('P1.0', 'pushpull', true);
        r.idle(1_000_000n);
        r.sendText('AT\r\n');
        const reply = r.readReply(4, 10_000_000n);
        assert.equal(String.fromCharCode(...reply), 'OK\r\n');
        assert.deepEqual(r.board.getDeviceState('BT').atLog, ['AT']);

        r.sendText('AT+BOGUS\r\n');
        const err = r.readReply(10, 20_000_000n);
        assert.ok(String.fromCharCode(...err).startsWith('ERROR'), String.fromCharCode(...err));
    });
});
