/**
 * TCP on the host-side node, against a peer this file plays by hand.
 *
 * Every segment the "guest" sends is assembled here from RFC 793's header
 * layout, and every segment the node sends is taken apart here, including
 * its checksum. Sequence and acknowledgement numbers in the assertions are
 * worked out from the exchange, not read back from the node.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Lan} from '../src/net/lan.js';
import {Ipv4Node, ip} from '../src/net/ipv4-node.js';

const GUEST_MAC = [0x02, 0, 0, 0, 0, 0x0a], NODE_MAC = [0x02, 0, 0, 0, 0, 0x01];
const GUEST_IP = ip('10.0.0.50'), NODE_IP = ip('10.0.0.1');
const FIN = 1, SYN = 2, RST = 4, PSH = 8, ACK = 16;
const b16 = v => [(v >> 8) & 0xff, v & 0xff];
const b32 = v => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const r16 = (b, at) => (b[at] << 8) | b[at + 1];
const r32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
function sum16 (bytes) {
    let s = 0;
    for (let i = 0; i < bytes.length; i += 2) s += (bytes[i] << 8) | (bytes[i + 1] ?? 0);
    while (s > 0xffff) s = (s & 0xffff) + (s >>> 16);
    return (~s) & 0xffff;
}
const text = s => Array.from(Buffer.from(s));

function world () {
    const lan = new Lan();
    const node = lan.attach(new Ipv4Node({mac: NODE_MAC, ip: '10.0.0.1'}));
    node.arp.set(GUEST_IP, GUEST_MAC);
    const heard = [];
    const guest = lan.attach({deliver: f => heard.push(f)});
    /** The guest sends one segment. */
    const send = (sport, dport, seq, ack, flags, data = [], {window = 4096, mss = null, corrupt = false} = {}) => {
        const options = mss ? [2, 4, ...b16(mss)] : [];
        const seg = [...b16(sport), ...b16(dport), ...b32(seq), ...b32(ack), ((20 + options.length) / 4) << 4, flags,
            ...b16(window), 0, 0, 0, 0, ...options, ...data];
        let c = sum16([...b32(GUEST_IP), ...b32(NODE_IP), 0, 6, ...b16(seg.length), ...seg]);
        if (corrupt) c ^= 0x00ff;
        seg[16] = c >> 8; seg[17] = c & 0xff;
        const h = [0x45, 0, ...b16(20 + seg.length), 0, 1, 0, 0, 64, 6, 0, 0, ...b32(GUEST_IP), ...b32(NODE_IP)];
        const hc = sum16(h); h[10] = hc >> 8; h[11] = hc & 0xff;
        lan.send(Uint8Array.from([...NODE_MAC, ...GUEST_MAC, 8, 0, ...h, ...seg]), guest);
    };
    /** The next segment the node sent, taken apart; its checksum is checked on the way. */
    const take = () => {
        const frame = heard.shift();
        if (!frame) return null;
        const packet = frame.subarray(14);
        assert.equal(packet[9], 6, 'a TCP segment');
        const seg = packet.subarray(20, r16(packet, 2));
        assert.equal(sum16([...b32(r32(packet, 12)), ...b32(r32(packet, 16)), 0, 6, ...b16(seg.length), ...seg]), 0, 'TCP checksum');
        const offset = (seg[12] >> 4) * 4;
        return {sport: r16(seg, 0), dport: r16(seg, 2), seq: r32(seg, 4), ack: r32(seg, 8), flags: seg[13], window: r16(seg, 14),
            options: Array.from(seg.subarray(20, offset)), data: Buffer.from(seg.subarray(offset)).toString('latin1')};
    };
    return {lan, node, heard, send, take};
}

/** Open a connection from the guest (port 4000, ISS 1000) to the node's `port`; returns the node's ISS. */
function open (w, port, opts = {}) {
    w.send(4000, port, 1000, 0, SYN, [], {mss: 536, ...opts});
    const synack = w.take();
    w.send(4000, port, 1001, synack.seq + 1, ACK, [], opts);
    return synack.seq;
}

test('a connection opens with the three-way handshake', () => {
    const w = world();
    const accepted = [];
    w.node.tcp.listen(80, c => accepted.push(c));
    assert.throws(() => w.node.tcp.listen(80, () => {}), /already listening/);
    w.send(4000, 80, 1000, 0, SYN, [], {mss: 536});
    const synack = w.take();
    assert.deepEqual({...synack, seq: 0, window: 0}, {sport: 80, dport: 4000, seq: 0, ack: 1001, flags: SYN | ACK, window: 0,
        options: [2, 4, 0x05, 0xb4], data: ''}, 'SYN+ACK acknowledging our SYN, offering MSS 1460');
    assert.equal(accepted.length, 0, 'not established until our ACK');
    w.send(4000, 80, 1001, synack.seq + 1, ACK);
    assert.equal(accepted.length, 1);
    assert.deepEqual([accepted[0].state, accepted[0].remote, accepted[0].peerMss], ['ESTABLISHED', {ip: '10.0.0.50', port: 4000}, 536]);
    assert.equal(w.heard.length, 0, 'the handshake needs no further segment');
});

test('data flows both ways, in order, each side acknowledging what it got', () => {
    const w = world();
    const got = [];
    w.node.tcp.listen(7, c => c.on('data', d => { got.push(Buffer.from(d).toString()); c.write(text(`echo:${Buffer.from(d)}`)); }));
    const iss = open(w, 7);
    w.send(4000, 7, 1001, iss + 1, ACK | PSH, text('hello'));
    assert.deepEqual(got, ['hello']);
    const reply = w.take();
    assert.deepEqual([reply.seq, reply.ack, reply.flags, reply.data], [iss + 1, 1006, ACK | PSH, 'echo:hello']);
    const ack = w.take();
    assert.deepEqual([ack.seq, ack.ack, ack.flags, ack.data], [iss + 11, 1006, ACK, ''], 'and a plain acknowledgement of our five bytes');
    w.send(4000, 7, 1006, iss + 11, ACK | PSH, text('again'));
    assert.deepEqual(got, ['hello', 'again']);
    assert.equal(w.take().data, 'echo:again');
});

test('a segment seen before is acknowledged again and not delivered twice; one from the future is dropped', () => {
    const w = world();
    const got = [];
    w.node.tcp.listen(7, c => c.on('data', d => got.push(Buffer.from(d).toString())));
    const iss = open(w, 7);
    w.send(4000, 7, 1001, iss + 1, ACK, text('one'));
    w.take();
    w.send(4000, 7, 1001, iss + 1, ACK, text('one'));              // the guest retransmits
    assert.deepEqual(got, ['one']);
    assert.deepEqual([w.take().ack, w.node.tcp.counters.duplicates], [1004, 1]);
    w.send(4000, 7, 1010, iss + 1, ACK, text('late'));             // bytes 1004..1009 are missing
    assert.deepEqual(got, ['one']);
    assert.deepEqual([w.take().ack, w.node.tcp.counters.outOfOrder], [1004, 1], 'still asking for 1004');
    w.send(4000, 7, 1004, iss + 1, ACK, text('two'), {corrupt: true});
    assert.deepEqual([got.length, w.node.tcp.counters.badChecksum, w.heard.length], [1, 1, 0], 'a damaged segment is silently dropped');
});

test('the node sends no more than the peer\'s window and MSS allow, and goes on as it is acknowledged', () => {
    const w = world();
    let conn = null;
    w.node.tcp.listen(9, c => { conn = c; });
    const iss = open(w, 9, {window: 1000});
    conn.write(new Array(1300).fill(0x61));
    const first = w.take(), second = w.take();
    assert.deepEqual([first.seq, first.data.length, second.seq, second.data.length], [iss + 1, 536, iss + 537, 464],
        'one MSS, then what is left of the 1000-byte window');
    assert.equal(w.heard.length, 0, 'and then it waits');
    w.send(4000, 9, 1001, iss + 1001, ACK, [], {window: 1000});
    const third = w.take();
    assert.deepEqual([third.seq, third.data.length, third.flags & PSH], [iss + 1001, 300, PSH], 'the rest, pushed');
});

test('the node closes first: FIN, our ACK, our FIN, its ACK', () => {
    const w = world();
    let conn = null;
    const closed = [];
    w.node.tcp.listen(80, c => { conn = c; c.on('close', o => closed.push(o)); c.on('end', () => closed.push('end')); });
    const iss = open(w, 80);
    conn.write(text('bye'));
    conn.end();
    assert.throws(() => conn.write([1]), /write after end/);
    const data = w.take(), fin = w.take();
    assert.deepEqual([data.data, fin.flags, fin.seq], ['bye', FIN | ACK, iss + 4]);
    assert.equal(conn.state, 'FIN-WAIT-1');
    w.send(4000, 80, 1001, iss + 5, ACK);
    assert.equal(conn.state, 'FIN-WAIT-2');
    w.send(4000, 80, 1001, iss + 5, FIN | ACK);
    const last = w.take();
    assert.deepEqual([last.flags, last.seq, last.ack], [ACK, iss + 5, 1002], 'our FIN took one sequence number');
    assert.deepEqual(closed, ['end', 'closed']);
    assert.equal(w.node.tcp.connections.size, 0);
});

test('both close at once: the node waits for its own FIN to be acknowledged before it is done', () => {
    const w = world();
    let conn = null;
    const closed = [];
    w.node.tcp.listen(80, c => { conn = c; c.on('close', o => closed.push(o)); });
    const iss = open(w, 80);
    conn.write(text('bye'));
    conn.end();
    w.take(); w.take();
    w.send(4000, 80, 1001, iss + 4, ACK);                 // acknowledges the data, NOT the FIN
    assert.equal(conn.state, 'FIN-WAIT-1', 'its FIN is still unacknowledged');
    w.send(4000, 80, 1001, iss + 4, FIN | ACK);           // our FIN crosses its FIN
    assert.equal(conn.state, 'CLOSING');
    assert.deepEqual([w.take().ack, closed.length], [1002, 0], 'it acknowledges our FIN and is not closed yet');
    w.send(4000, 80, 1002, iss + 4, ACK);                 // an ACK that still does not cover its FIN
    assert.deepEqual([conn.state, closed.length], ['CLOSING', 0]);
    w.send(4000, 80, 1002, iss + 5, ACK);                 // now its FIN is acknowledged
    assert.deepEqual(closed, ['closed']);
});

test('the peer closes first: its FIN is acknowledged, the node finishes and closes', () => {
    const w = world();
    const events = [];
    w.node.tcp.listen(80, c => { c.on('end', () => { events.push('end'); c.write(text('ok')); c.end(); }); c.on('close', o => events.push(o)); });
    const iss = open(w, 80);
    w.send(4000, 80, 1001, iss + 1, FIN | ACK);
    const ack = w.take(), data = w.take(), fin = w.take();
    assert.deepEqual([ack.flags, ack.ack], [ACK, 1002]);
    assert.deepEqual([data.data, data.seq, fin.flags, fin.seq], ['ok', iss + 1, FIN | ACK, iss + 3]);
    assert.deepEqual(events, ['end']);
    w.send(4000, 80, 1002, iss + 3, ACK);                 // covers the data, not its FIN
    assert.deepEqual(events, ['end'], 'still waiting for its FIN to be acknowledged');
    w.send(4000, 80, 1002, iss + 4, ACK);
    assert.deepEqual(events, ['end', 'closed']);
});

test('a port nobody listens on answers with a reset, shaped by whether the segment had an ACK', () => {
    const w = world();
    w.send(4000, 81, 1000, 0, SYN);
    const a = w.take();
    assert.deepEqual([a.flags, a.seq, a.ack], [RST | ACK, 0, 1001], 'no ACK in: RST+ACK acknowledging the SYN');
    w.send(4000, 81, 2000, 777, ACK, text('x'));
    const b = w.take();
    assert.deepEqual([b.flags, b.seq], [RST, 777], 'ACK in: RST with that number as its sequence');
    w.send(4000, 81, 2000, 777, RST);
    assert.equal(w.heard.length, 0, 'a reset is never answered');
    assert.equal(w.node.tcp.counters.resetsSent, 2);
});

test('a reset from the peer ends the connection as reset', () => {
    const w = world();
    const closed = [];
    w.node.tcp.listen(80, c => c.on('close', o => closed.push(o)));
    const iss = open(w, 80);
    w.send(4000, 80, 1001, iss + 1, RST);
    assert.deepEqual(closed, ['reset']);
    assert.equal(w.node.tcp.connections.size, 0);
});

test('the node connects out: SYN, our SYN+ACK, its ACK and queued data; a refused connection says so', () => {
    const w = world();
    const events = [];
    const c = w.node.tcp.connect('10.0.0.50', 8080);
    c.on('open', () => { events.push('open'); c.write(text('GET')); });
    const syn = w.take();
    assert.deepEqual([syn.flags, syn.dport, syn.ack, syn.options], [SYN, 8080, 0, [2, 4, 0x05, 0xb4]]);
    w.send(8080, syn.sport, 5000, syn.seq + 1, SYN | ACK, [], {mss: 1460});
    const ack = w.take(), data = w.take();
    assert.deepEqual([ack.flags, ack.seq, ack.ack], [ACK, syn.seq + 1, 5001]);
    assert.deepEqual([data.data, data.seq], ['GET', syn.seq + 1]);
    assert.deepEqual(events, ['open']);

    const r = w.node.tcp.connect('10.0.0.50', 9);
    const outcome = [];
    r.on('close', o => outcome.push(o));
    const syn2 = w.take();
    w.send(9, syn2.sport, 0, syn2.seq + 1, RST | ACK);
    assert.deepEqual(outcome, ['refused']);
});

test('two nodes talk to each other over the LAN, end to end', () => {
    const lan = new Lan();
    const server = lan.attach(new Ipv4Node({mac: '02:00:00:00:00:01', ip: '192.168.4.1'}));
    const client = lan.attach(new Ipv4Node({mac: '02:00:00:00:00:02', ip: '192.168.4.2'}));
    const log = [];
    server.tcp.listen(7000, c => {
        c.on('data', d => { log.push(`server got ${Buffer.from(d)}`); c.write(text('pong')); c.end(); });
        c.on('close', o => log.push(`server ${o}`));
    });
    // Handlers go in before the SYN: the server answers before connect() returns.
    client.tcp.connect('192.168.4.1', 7000, c => {
        c.on('open', () => c.write(text('ping')));
        c.on('data', d => log.push(`client got ${Buffer.from(d)}`));
        c.on('end', () => c.end());
        c.on('close', o => log.push(`client ${o}`));
    });
    assert.deepEqual(log.slice(0, 2), ['server got ping', 'client got pong']);
    // Both ends finish cleanly. Which of the two notices first is not TCP's business:
    // the server is done on receiving the client's FIN, the client on the ACK of it.
    assert.deepEqual(log.slice(2).sort(), ['client closed', 'server closed']);
    assert.deepEqual([server.tcp.connections.size, client.tcp.connections.size], [0, 0]);
    const big = [];
    server.tcp.listen(7001, s => s.on('data', d => big.push(...d)));
    const payload = Array.from({length: 5000}, (_, i) => i & 0xff);
    client.tcp.connect('192.168.4.1', 7001, up => up.on('open', () => up.write(payload)));
    assert.deepEqual(big, payload, '5000 bytes arrive whole and in order across several segments');
});
