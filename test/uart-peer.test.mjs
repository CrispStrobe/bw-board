// UART edge engine + HC-05 goldens: the harness bit-bangs 8N1 exactly
// as SoftwareSerial does (one pin write per bit at the baud interval),
// and samples the module's TXD the same way.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerUartPeer, createUartRx, buildUartFrame, airReset } from '../src/devices/uart-peer.js';

registerUartPeer();
let airSeq = 0;
const freshAir = () => { const id = `t${airSeq++}`; airReset(id); return id; };

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
    params = { air: freshAir(), ...params };
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

    it('the full tutorial dance: settings, inquiry, pair, link, STATE pin', () => {
        const nearby = [{ addr: '1234:56:abcdef', name: 'RoboPeer', class: '1F00' }];
        const r = rig({ nearby }, true);
        r.board.setPin('P1.0', 'pushpull', true);
        r.idle(1_000_000n);
        const ask = (cmd, maxBytes, ns = 60_000_000n) => {
            r.sendText(`${cmd}\r\n`);
            return String.fromCharCode(...r.readReply(maxBytes, ns));
        };

        assert.equal(ask('AT+INIT', 4), 'OK\r\n');
        assert.equal(ask('AT+NAME=Rover', 4), 'OK\r\n');
        assert.match(ask('AT+NAME?', 14), /\+NAME:Rover/);
        assert.match(ask('AT+PSWD?', 13), /\+PSWD:1234/);
        assert.match(ask('AT+STATE?', 22), /\+STATE:INITIALIZED/);
        assert.match(ask('AT+INQ', 40), /\+INQ:1234:56:abcdef,1F00/);
        assert.equal(ask('AT+PAIR=1234,56,abcdef,20', 4), 'OK\r\n');
        assert.match(ask('AT+ADCN?', 12), /\+ADCN:1/);
        assert.equal(ask('AT+LINK=1234,56,abcdef', 4), 'OK\r\n');
        assert.match(ask('AT+STATE?', 20), /\+STATE:CONNECTED/);
        r.board.setPin('P1.2', 'input', false);
        // The STATE terminal is not wired in this rig's netlist, so read
        // the device's own drive instead: linked → high.
        assert.ok(r.board.getDeviceState('BT').linked, 'link is up');
        assert.match(ask('AT+DISC', 20), /\+DISC:SUCCESS/);
        assert.equal(r.board.getDeviceState('BT').linked, null);
        assert.equal(ask('AT+ORGL', 4), 'OK\r\n');
        assert.match(ask('AT+NAME?', 14), /\+NAME:HC-05/, 'factory reset restored the name');
    });

    it('two robots, one air: discover, link, drop to data mode, BRIDGE both ways', () => {
        airReset('pairAir');
        const board = new BoardImpl(5.0);
        board.setNetlist([
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'BTA', kind: 'hc05', params: { air: 'pairAir', name: 'RoverA', addr: 'aa:aa:aaaaaa' }, terminals: ['vcc', 'gnd', 'rxd', 'txd', 'key', 'state'] },
            { id: 'BTB', kind: 'hc05', params: { air: 'pairAir', name: 'RoverB', addr: 'bb:bb:bbbbbb' }, terminals: ['vcc', 'gnd', 'rxd', 'txd', 'key', 'state'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P2.0', 'P2.1', 'P3.0', 'P3.1'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['BTA', 'vcc'], ['BTB', 'vcc']),
            net('ng', ['GND', 'gnd'], ['BTA', 'gnd'], ['BTB', 'gnd'], ['BTB', 'key']),
            net('nk', ['MCU', 'P3.1'], ['BTA', 'key']),
            net('na1', ['MCU', 'P1.0'], ['BTA', 'rxd']),
            net('na2', ['MCU', 'P1.1'], ['BTA', 'txd']),
            net('nb1', ['MCU', 'P2.0'], ['BTB', 'rxd']),
            net('nb2', ['MCU', 'P2.1'], ['BTB', 'txd']),
            net('nst', ['MCU', 'P3.0'], ['BTB', 'state']),
        ]);
        let t = 0n;
        const to = (nt) => { t = nt; board.advanceTo(t); };
        const bitAt = (baud) => BigInt(Math.round(1e9 / baud));
        const send = (pin, text, baud) => {
            const bit = bitAt(baud);
            for (const ch of text) {
                const b = ch.charCodeAt(0);
                board.setPin(pin, 'pushpull', false); to(t + bit);
                for (let i = 0; i < 8; i++) { board.setPin(pin, 'pushpull', !!((b >> i) & 1)); to(t + bit); }
                board.setPin(pin, 'pushpull', true); to(t + bit);
            }
        };
        const drain = (pin, maxBytes, baud, deadline) => {
            const rx = createUartRx(baud);
            const out = [];
            const step = bitAt(baud) / 4n;
            const stop = t + deadline;
            while (t < stop && out.length < maxBytes) {
                to(t + step);
                const lvl = board.readAnalog(pin) > 2.5 ? 1 : 0;
                for (const byte of rx.feed(lvl, t)) out.push(byte);
            }
            return String.fromCharCode(...out);
        };
        board.setPin('P1.0', 'pushpull', true);
        board.setPin('P2.0', 'pushpull', true);
        board.setPin('P1.1', 'input', false);
        board.setPin('P3.0', 'input', false);
        board.setPin('P3.1', 'pushpull', true);        // A: AT mode
        to(t + 1_000_000n);

        send('P1.0', 'AT+INQ\r\n', 38400);
        const inq = drain('P1.1', 40, 38400, 60_000_000n);
        assert.match(inq, /\+INQ:bb:bb:bbbbbb/, `B appears in A's inquiry: ${inq}`);
        send('P1.0', 'AT+LINK=bb,bb,bbbbbb\r\n', 38400);
        assert.equal(drain('P1.1', 4, 38400, 60_000_000n), 'OK\r\n');
        to(t + 1_000_000n);
        assert.ok(board.readAnalog('P3.0') > 2.5, "B's STATE pin rose — the link is symmetric");

        // A drops KEY: both ends in data mode at 9600. Bridge both ways.
        // The bridge emits on A's TXD WHILE B is still sending, so the
        // sampler must run concurrently — feed the edge decoder at every
        // bit step of the send, then finish draining.
        board.setPin('P3.1', 'pushpull', false);
        to(t + 2_000_000n);
        const rxA = createUartRx(9600);
        const outA = [];
        const sample = () => { for (const b of rxA.feed(board.readAnalog('P1.1') > 2.5 ? 1 : 0, t)) outA.push(b); };
        const bit96 = bitAt(9600);
        // Quarter-bit sub-steps: A's bridged frames are phase-shifted
        // against B's send, and the edge decoder quantizes edges to
        // sample instants — coarse sampling misplaces edges by a bit.
        const wait1 = () => { for (let q = 0; q < 4; q++) { to(t + bit96 / 4n); sample(); } };
        for (const ch of 'ping') {
            const b = ch.charCodeAt(0);
            board.setPin('P2.0', 'pushpull', false); wait1();
            for (let i = 0; i < 8; i++) { board.setPin('P2.0', 'pushpull', !!((b >> i) & 1)); wait1(); }
            board.setPin('P2.0', 'pushpull', true); wait1();
        }
        const stopA = t + 100_000_000n;
        while (t < stopA && outA.length < 4) { to(t + bit96 / 4n); sample(); }
        const fromB = String.fromCharCode(...outA);
        assert.equal(fromB, 'ping', "B's MCU bytes emerge from A's TXD");
        // Reverse: A's MCU sends, the bytes emerge from B's TXD for B's
        // MCU to read (received logs each module's OWN MCU only).
        board.setPin('P2.1', 'input', false);
        const rxB = createUartRx(9600);
        const outB = [];
        const sampleB = () => { for (const b of rxB.feed(board.readAnalog('P2.1') > 2.5 ? 1 : 0, t)) outB.push(b); };
        const wait1b = () => { for (let q = 0; q < 4; q++) { to(t + bit96 / 4n); sampleB(); } };
        for (const ch of 'pong') {
            const b = ch.charCodeAt(0);
            board.setPin('P1.0', 'pushpull', false); wait1b();
            for (let i = 0; i < 8; i++) { board.setPin('P1.0', 'pushpull', !!((b >> i) & 1)); wait1b(); }
            board.setPin('P1.0', 'pushpull', true); wait1b();
        }
        const stopB = t + 100_000_000n;
        while (t < stopB && outB.length < 4) { to(t + bit96 / 4n); sampleB(); }
        assert.equal(String.fromCharCode(...outB), 'pong', "A's MCU bytes emerge from B's TXD");
        const gotA = board.getDeviceState('BTA').received.map((b) => String.fromCharCode(b)).join('');
        assert.ok(gotA.includes('pong'), `A logged its own MCU's bytes: "${gotA}"`);
    });

    it('five modules on one air all see each other', () => {
        airReset('swarmAir');
        const board = new BoardImpl(5.0);
        const bts = Array.from({ length: 5 }, (_, i) => (
            { id: `BT${i}`, kind: 'hc05', params: { air: 'swarmAir' }, terminals: ['vcc', 'gnd', 'rxd', 'txd', 'key', 'state'] }));
        board.setNetlist([
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            ...bts,
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
        ], [
            net('nv', ['VCC', 'vcc'], ...bts.map((b) => [b.id, 'vcc']), ['BT0', 'key']),
            net('ng', ['GND', 'gnd'], ...bts.map((b) => [b.id, 'gnd'])),
            net('nr', ['MCU', 'P1.0'], ['BT0', 'rxd']),
            net('nt', ['MCU', 'P1.1'], ['BT0', 'txd']),
        ]);
        let t = 0n;
        const to = (nt) => { t = nt; board.advanceTo(t); };
        const bit = BigInt(Math.round(1e9 / 38400));
        board.setPin('P1.0', 'pushpull', true);
        to(t + 1_000_000n);
        for (const ch of 'AT+INQ\r\n') {
            const b = ch.charCodeAt(0);
            board.setPin('P1.0', 'pushpull', false); to(t + bit);
            for (let i = 0; i < 8; i++) { board.setPin('P1.0', 'pushpull', !!((b >> i) & 1)); to(t + bit); }
            board.setPin('P1.0', 'pushpull', true); to(t + bit);
        }
        board.setPin('P1.1', 'input', false);
        const rx = createUartRx(38400);
        const out = [];
        const stop = t + 120_000_000n;
        while (t < stop && out.length < 160) {
            to(t + bit / 4n);
            for (const byte of rx.feed(board.readAnalog('P1.1') > 2.5 ? 1 : 0, t)) out.push(byte);
        }
        const text = String.fromCharCode(...out);
        const hits = (text.match(/\+INQ:/g) || []).length;
        assert.equal(hits, 4, `BT0 sees the other four (auto-unique addrs): ${text}`);
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
