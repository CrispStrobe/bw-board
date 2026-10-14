/**
 * The shared LAN and the host-side IPv4 node.
 *
 * Frames here are assembled and taken apart by this file's own few helpers,
 * byte by byte from the RFC layouts, not by the code under test: a node that
 * encodes and decodes the same mistake both ways would otherwise agree with
 * itself.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Lan} from '../src/net/lan.js';
import {Ipv4Node, ip, ipText, mac, macText, checksum} from '../src/net/ipv4-node.js';
import {NE2000, HubLink} from '../src/ne2000.js';

const GUEST_MAC = [0x02, 0, 0, 0, 0, 0x0a];
const NODE_MAC = [0x02, 0, 0, 0, 0, 0x01];
const BROADCAST = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const b16 = v => [(v >> 8) & 0xff, v & 0xff];
const b32 = v => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const r16 = (b, at) => (b[at] << 8) | b[at + 1];
const r32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** RFC 1071, written again here on purpose. */
function sum16 (bytes) {
    let s = 0;
    for (let i = 0; i < bytes.length; i += 2) s += (bytes[i] << 8) | (bytes[i + 1] ?? 0);
    while (s > 0xffff) s = (s & 0xffff) + (s >>> 16);
    return (~s) & 0xffff;
}
const eth = (dst, src, type, payload) => Uint8Array.from([...dst, ...src, ...b16(type), ...payload]);
function ipv4 (src, dst, proto, payload, {flagsFrag = 0} = {}) {
    const h = [0x45, 0, ...b16(20 + payload.length), 0x12, 0x34, ...b16(flagsFrag), 64, proto, 0, 0, ...b32(src), ...b32(dst)];
    const c = sum16(h); h[10] = c >> 8; h[11] = c & 0xff;
    return [...h, ...payload];
}
function udp (src, dst, sport, dport, payload, {noChecksum = false, corrupt = false} = {}) {
    const d = [...b16(sport), ...b16(dport), ...b16(8 + payload.length), 0, 0, ...payload];
    if (!noChecksum) {
        let c = sum16([...b32(src), ...b32(dst), 0, 17, ...b16(d.length), ...d]) || 0xffff;
        if (corrupt) c ^= 0x0101;
        d[6] = c >> 8; d[7] = c & 0xff;
    }
    return d;
}
/** A guest that is just a recorder with an address. */
function world () {
    const lan = new Lan();
    const node = lan.attach(new Ipv4Node({mac: NODE_MAC, ip: '10.0.0.1', name: 'gateway'}));
    const heard = [];
    const guest = lan.attach({deliver: f => heard.push(f)});
    const send = frame => lan.send(frame, guest);
    const take = () => heard.shift();
    return {lan, node, guest, heard, send, take};
}
const GUEST_IP = ip('10.0.0.50');
const NODE_IP = ip('10.0.0.1');

test('addresses and the checksum: the helpers say what they mean', () => {
    assert.equal(ip('10.0.0.1'), 0x0a000001);
    assert.equal(ip('255.255.255.255'), 0xffffffff);
    assert.equal(ipText(0xc0a80164), '192.168.1.100');
    assert.throws(() => ip('10.0.0.256'), /not an IPv4 address/);
    assert.throws(() => ip('10.0.0'), /not an IPv4 address/);
    assert.deepEqual(mac('02:00:00:00:00:0a'), GUEST_MAC);
    assert.equal(macText(GUEST_MAC), '02:00:00:00:00:0a');
    assert.throws(() => mac('02:00:00'), /not a MAC address/);
    // RFC 1071's worked example: 0001 f203 f4f5 f6f7 sums to ddf2, checksum 220d.
    assert.equal(checksum([0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7]), 0x220d);
    assert.equal(checksum([0xff]), 0x00ff, 'an odd byte is padded on the right');
});

test('the LAN is a hub: everyone but the sender hears a frame, taps see it, bad lengths are refused', () => {
    const lan = new Lan();
    const got = {a: [], b: [], c: []};
    const [a, b, c] = ['a', 'b', 'c'].map(k => lan.attach({deliver: f => got[k].push(f)}));
    const seen = [];
    const untap = lan.tap((f, from) => seen.push([f.length, from === a]));
    const frame = eth(BROADCAST, GUEST_MAC, 0x88b5, [1, 2, 3]);
    lan.send(frame, a);
    assert.deepEqual([got.a.length, got.b.length, got.c.length], [0, 1, 1]);
    assert.deepEqual(Array.from(got.b[0]), Array.from(frame));
    got.b[0][0] = 0;
    assert.equal(got.c[0][0], 0xff, 'each member gets its own copy');
    assert.equal(a.link, lan);
    lan.send(new Uint8Array(13), a);
    lan.send(new Uint8Array(1515), a);
    assert.deepEqual(lan.counters, {sent: 1, delivered: 2, refused: 2});
    lan.detach(c);
    untap();
    lan.send(frame, a);
    assert.deepEqual([got.b.length, got.c.length, seen.length], [2, 1, 1]);
    assert.deepEqual(seen[0], [17, true]);
    assert.equal(c.link, null);
    assert.throws(() => lan.attach({}), /needs deliver/);
});

test('ARP: the node answers for its own address and for no other', () => {
    const w = world();
    const request = target => eth(BROADCAST, GUEST_MAC, 0x0806,
        [0, 1, 8, 0, 6, 4, 0, 1, ...GUEST_MAC, ...b32(GUEST_IP), 0, 0, 0, 0, 0, 0, ...b32(target)]);
    w.send(request(ip('10.0.0.7')));
    assert.equal(w.heard.length, 0, 'not its address: silence');
    w.send(request(NODE_IP));
    const reply = w.take();
    assert.deepEqual(Array.from(reply.subarray(0, 14)), [...GUEST_MAC, ...NODE_MAC, 0x08, 0x06]);
    assert.deepEqual(Array.from(reply.subarray(14)), [0, 1, 8, 0, 6, 4, 0, 2,
        ...NODE_MAC, ...b32(NODE_IP), ...GUEST_MAC, ...b32(GUEST_IP)]);
    assert.deepEqual(w.node.arp.get(GUEST_IP), GUEST_MAC, 'and it learned who asked');
});

test('ping: an echo request comes back as an echo reply with the same data and good checksums', () => {
    const w = world();
    const data = [0xde, 0xad, 0xbe, 0xef, 1, 2, 3];
    const icmp = [8, 0, 0, 0, 0x43, 0x21, 0, 7, ...data];
    const c = sum16(icmp); icmp[2] = c >> 8; icmp[3] = c & 0xff;
    w.node.arp.set(GUEST_IP, GUEST_MAC);
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 1, icmp)));
    const reply = w.take();
    assert.deepEqual(Array.from(reply.subarray(0, 6)), GUEST_MAC);
    const packet = reply.subarray(14);
    assert.equal(sum16(packet.subarray(0, 20)), 0, 'IPv4 header checksum');
    assert.deepEqual([packet[9], r32(packet, 12), r32(packet, 16)], [1, NODE_IP, GUEST_IP]);
    const body = packet.subarray(20, r16(packet, 2));
    assert.equal(sum16(body), 0, 'ICMP checksum');
    assert.deepEqual(Array.from(body.subarray(0, 2)), [0, 0], 'echo reply');
    assert.deepEqual(Array.from(body.subarray(4)), [0x43, 0x21, 0, 7, ...data], 'identifier, sequence and data unchanged');
});

test('ping to a stranger: the node asks who it is first, then answers', () => {
    const w = world();
    const icmp = [8, 0, 0, 0, 0, 1, 0, 1];
    const c = sum16(icmp); icmp[2] = c >> 8; icmp[3] = c & 0xff;
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 1, icmp)));
    const ask = w.take();
    assert.equal(r16(ask, 12), 0x0806);
    assert.deepEqual(Array.from(ask.subarray(0, 6)), BROADCAST);
    assert.deepEqual([r16(ask, 20), r32(ask, 38)], [1, GUEST_IP], 'an ARP request for the guest');
    assert.equal(w.heard.length, 0, 'the reply waits');
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0806, [0, 1, 8, 0, 6, 4, 0, 2, ...GUEST_MAC, ...b32(GUEST_IP), ...NODE_MAC, ...b32(NODE_IP)]));
    const reply = w.take();
    assert.equal(reply[14 + 9], 1);
    assert.equal(reply[14 + 20], 0, 'the echo reply, now that the address is known');
});

test('what is not for the node, damaged, or a fragment is dropped and counted', () => {
    const w = world();
    w.node.udpBind(7, () => assert.fail('must not be delivered'));
    const good = udp(GUEST_IP, NODE_IP, 4000, 7, [1]);
    w.send(eth([0x02, 0, 0, 0, 0, 0x99], GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 17, good)));
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, ip('10.0.0.9'), 17, good)));
    assert.equal(w.node.counters.notForMe, 2, 'another card\'s frame; another host\'s packet');
    const broken = ipv4(GUEST_IP, NODE_IP, 17, good); broken[8] ^= 1;
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, broken));
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 17, udp(GUEST_IP, NODE_IP, 4000, 7, [1], {corrupt: true}))));
    assert.equal(w.node.counters.badChecksum, 2, 'IPv4 header; UDP');
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 17, good, {flagsFrag: 0x2000})));
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 17, good, {flagsFrag: 0x0010})));
    assert.equal(w.node.counters.fragments, 2, 'more-fragments; a later fragment');
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 17, udp(GUEST_IP, NODE_IP, 4000, 9, [1]))));
    assert.equal(w.node.counters.unhandled, 1, 'a port nobody bound');
    assert.equal(w.heard.length, 0);
    assert.throws(() => w.node.sendIpv4(ip('10.0.1.5'), 17, [0]), /not on this subnet/);
    assert.throws(() => w.node.sendIpv4(GUEST_IP, 17, new Array(1481).fill(0)), /do not fit one frame/);
});

test('UDP: a bound port gets the datagram and its reply goes back checked; a datagram with no checksum is accepted', () => {
    const w = world();
    w.node.arp.set(GUEST_IP, GUEST_MAC);
    const got = [];
    w.node.udpBind(7, (payload, from, reply) => { got.push([Array.from(payload), from.ip, from.port]); reply(payload.slice().reverse()); });
    assert.throws(() => w.node.udpBind(7, () => {}), /already bound/);
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 17, udp(GUEST_IP, NODE_IP, 4000, 7, [1, 2, 3]))));
    assert.deepEqual(got, [[[1, 2, 3], '10.0.0.50', 4000]]);
    const packet = w.take().subarray(14);
    const d = packet.subarray(20, r16(packet, 2));
    assert.deepEqual([r16(d, 0), r16(d, 2), r16(d, 4)], [7, 4000, 11]);
    assert.deepEqual(Array.from(d.subarray(8)), [3, 2, 1]);
    assert.equal(sum16([...b32(NODE_IP), ...b32(GUEST_IP), 0, 17, ...b16(d.length), ...d]), 0, 'UDP checksum over the pseudo-header');
    w.send(eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 17, udp(GUEST_IP, NODE_IP, 4000, 7, [9], {noChecksum: true}))));
    assert.equal(got.length, 2);
    w.send(eth(BROADCAST, GUEST_MAC, 0x0800, ipv4(GUEST_IP, ip('10.0.0.255'), 17, udp(GUEST_IP, ip('10.0.0.255'), 4000, 7, [5]))));
    assert.equal(got.length, 3, 'the subnet broadcast address reaches it too');
});

/** A DHCP client message, per RFC 2131 figure 1. */
function dhcpMessage (type, {xid = 0x11223344, requested = null, server = null, broadcast = false, ciaddr = 0} = {}) {
    const m = new Array(240).fill(0);
    m[0] = 1; m[1] = 1; m[2] = 6;
    b32(xid).forEach((b, i) => { m[4 + i] = b; });
    if (broadcast) m[10] = 0x80;
    b32(ciaddr).forEach((b, i) => { m[12 + i] = b; });
    GUEST_MAC.forEach((b, i) => { m[28 + i] = b; });
    [0x63, 0x82, 0x53, 0x63].forEach((b, i) => { m[236 + i] = b; });
    m.push(53, 1, type);
    if (requested != null) m.push(50, 4, ...b32(requested));
    if (server != null) m.push(54, 4, ...b32(server));
    m.push(255);
    return eth(BROADCAST, GUEST_MAC, 0x0800, ipv4(0, 0xffffffff, 17, udp(0, 0xffffffff, 68, 67, m)));
}
function dhcpReply (frame) {
    const packet = frame.subarray(14);
    const d = packet.subarray(20, r16(packet, 2));
    const m = d.subarray(8);
    const options = {};
    for (let i = 240; m[i] !== 255; i += 2 + m[i + 1]) options[m[i]] = Array.from(m.subarray(i + 2, i + 2 + m[i + 1]));
    return {dstMac: Array.from(frame.subarray(0, 6)), dstIp: r32(packet, 16), srcIp: r32(packet, 12),
        ports: [r16(d, 0), r16(d, 2)], op: m[0], xid: r32(m, 4), yiaddr: r32(m, 16), chaddr: Array.from(m.subarray(28, 34)),
        cookie: r32(m, 236), options};
}

test('DHCP: discover, offer, request, acknowledge; the address is stable; a wrong request is refused', () => {
    const w = world();
    w.node.serveDhcp({first: '10.0.0.100', last: '10.0.0.101'});
    w.send(dhcpMessage(1));
    const offer = dhcpReply(w.take());
    assert.deepEqual({...offer, options: undefined}, {dstMac: GUEST_MAC, dstIp: 0xffffffff, srcIp: NODE_IP, ports: [67, 68],
        op: 2, xid: 0x11223344, yiaddr: ip('10.0.0.100'), chaddr: GUEST_MAC, cookie: 0x63825363, options: undefined});
    assert.deepEqual(offer.options, {53: [2], 54: b32(NODE_IP), 51: b32(86400), 1: [255, 255, 255, 0], 3: b32(NODE_IP), 6: b32(NODE_IP)});
    w.send(dhcpMessage(3, {requested: offer.yiaddr, server: NODE_IP, broadcast: true}));
    const ack = dhcpReply(w.take());
    assert.deepEqual([ack.options[53], ack.yiaddr, ack.dstMac], [[5], ip('10.0.0.100'), BROADCAST], 'ACK, broadcast because the client asked');
    w.send(dhcpMessage(1));
    assert.equal(dhcpReply(w.take()).yiaddr, ip('10.0.0.100'), 'the same client is offered the same address');
    w.send(dhcpMessage(3, {requested: ip('10.0.0.77'), server: NODE_IP}));
    const nak = dhcpReply(w.take());
    assert.deepEqual([nak.options[53], nak.yiaddr, nak.options[51]], [[6], 0, undefined], 'NAK carries no lease');
    w.send(dhcpMessage(3, {requested: offer.yiaddr, server: ip('10.0.0.9')}));
    assert.equal(w.heard.length, 0, 'a request addressed to another server is not answered');
    w.send(dhcpMessage(7));
    assert.equal(w.node.dhcp.leases.size, 0, 'a release frees the address');
    assert.throws(() => new Ipv4Node({mac: NODE_MAC, ip: '10.0.0.1'}).serveDhcp({first: '10.0.1.1', last: '10.0.1.9'}), /not a range on this subnet/);
});

test('DHCP: a full pool stays silent rather than hand out a duplicate', () => {
    const w = world();
    w.node.serveDhcp({first: '10.0.0.100', last: '10.0.0.100'});
    w.send(dhcpMessage(1));
    assert.equal(dhcpReply(w.take()).yiaddr, ip('10.0.0.100'));
    const other = dhcpMessage(1);
    other[6 + 5] = 0x0b; other[14 + 20 + 8 + 28 + 5] = 0x0b;      // another card, another chaddr
    const d = other.subarray(14 + 20); d[6] = 0; d[7] = 0;          // the edit invalidated the UDP checksum: send none
    w.send(other);
    assert.equal(w.heard.length, 0);
});

function dnsQuery (name, {type = 1, id = 0xbeef} = {}) {
    const q = [...b16(id), 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
    for (const label of name.split('.')) q.push(label.length, ...Buffer.from(label));
    q.push(0, ...b16(type), 0, 1);
    return eth(NODE_MAC, GUEST_MAC, 0x0800, ipv4(GUEST_IP, NODE_IP, 17, udp(GUEST_IP, NODE_IP, 5353, 53, q)));
}
function dnsAnswer (frame) {
    const packet = frame.subarray(14);
    const m = packet.subarray(28, r16(packet, 2));
    return {id: r16(m, 0), response: m[2] >> 7, rcode: m[3] & 15, answers: r16(m, 6), tail: Array.from(m.subarray(m.length - 4))};
}

test('DNS: a known name resolves, case-insensitively; an unknown one is NXDOMAIN; another record type gets no answer', () => {
    const w = world();
    w.node.arp.set(GUEST_IP, GUEST_MAC);
    w.node.serveDns({'printer.lan': '10.0.0.42'});
    w.send(dnsQuery('Printer.LAN'));
    assert.deepEqual(dnsAnswer(w.take()), {id: 0xbeef, response: 1, rcode: 0, answers: 1, tail: [10, 0, 0, 42]});
    w.send(dnsQuery('nowhere.lan'));
    const missing = dnsAnswer(w.take());
    assert.deepEqual([missing.rcode, missing.answers], [3, 0]);
    w.send(dnsQuery('printer.lan', {type: 28}));
    const aaaa = dnsAnswer(w.take());
    assert.deepEqual([aaaa.rcode, aaaa.answers], [0, 0], 'the name exists, but there is no such record');
});

test('two nodes find each other and exchange a datagram', () => {
    const lan = new Lan();
    const a = lan.attach(new Ipv4Node({mac: '02:00:00:00:00:01', ip: '192.168.4.1'}));
    const b = lan.attach(new Ipv4Node({mac: '02:00:00:00:00:02', ip: '192.168.4.2'}));
    const got = [];
    b.udpBind(9000, (payload, from, reply) => { got.push(['b', String.fromCharCode(...payload), from.ip]); reply(Buffer.from('pong')); });
    a.udpBind(9001, (payload, from) => got.push(['a', String.fromCharCode(...payload), from.ip]));
    a.udpSend('192.168.4.2', 9000, 9001, Array.from(Buffer.from('ping')));
    assert.deepEqual(got, [['b', 'ping', '192.168.4.1'], ['a', 'pong', '192.168.4.2']]);
    assert.deepEqual([a.counters.arpRequests, b.counters.arpReplies, b.counters.arpRequests], [1, 1, 0],
        'one question on the wire: b learned a\'s address from it');
});

// The card, brought up the way a driver does (registers as in test/ne2000.test.mjs).
const CR = 0x00, PSTART = 0x01, PSTOP = 0x02, BNRY = 0x03, TPSR = 0x04, TBCR0 = 0x05, TBCR1 = 0x06, ISR = 0x07,
    RSAR0 = 0x08, RSAR1 = 0x09, RBCR0 = 0x0a, RBCR1 = 0x0b, RCR = 0x0c, TCR = 0x0d, DCR = 0x0e, IMR = 0x0f, DATA = 0x10;
function bootCard (card, address) {
    card.write(CR, 0x21); card.write(DCR, 0x49); card.write(RBCR0, 0); card.write(RBCR1, 0);
    card.write(RCR, 0x04); card.write(TCR, 0x02); card.write(PSTART, 0x46); card.write(PSTOP, 0x80);
    card.write(BNRY, 0x46); card.write(ISR, 0xff); card.write(IMR, 0x0b); card.write(CR, 0x61);
    for (let i = 0; i < 6; i++) card.write(0x01 + i, address[i]);
    card.write(0x07, 0x47); card.write(CR, 0x21); card.write(TCR, 0x00); card.write(CR, 0x22);
    return card;
}
function transmit (card, frame) {
    card.write(CR, 0x22); card.write(RSAR0, 0); card.write(RSAR1, 0x40);
    card.write(RBCR0, frame.length & 0xff); card.write(RBCR1, frame.length >> 8); card.write(CR, 0x12);
    for (const b of frame) card.write(DATA, b);
    card.write(TPSR, 0x40); card.write(TBCR0, frame.length & 0xff); card.write(TBCR1, frame.length >> 8);
    card.write(CR, 0x26);
}

test('an NE2000 attaches to the LAN as it does to a hub, and the node answers the card\'s ARP', () => {
    const lan = new Lan();
    const node = lan.attach(new Ipv4Node({mac: NODE_MAC, ip: '10.0.0.1'}));
    const card = bootCard(lan.attach(new NE2000({mac: GUEST_MAC})), GUEST_MAC);
    assert.equal(card.link, lan);
    assert.equal(typeof new HubLink().attach, typeof lan.attach, 'the same way in');
    const padded = [0, 1, 8, 0, 6, 4, 0, 1, ...GUEST_MAC, ...b32(GUEST_IP), 0, 0, 0, 0, 0, 0, ...b32(NODE_IP), ...new Array(18).fill(0)];
    assert.equal(card.read(ISR) & 1, 0, 'nothing received yet');
    transmit(card, eth(BROADCAST, GUEST_MAC, 0x0806, padded));
    assert.equal(node.counters.arpReplies, 1, 'the node heard the card and answered');
    assert.equal(card.read(ISR) & 1, 1, 'and the card received the answer: PRX is set');
});
