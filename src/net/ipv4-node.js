/**
 * A host-side IPv4 node: the part of a simulated network that is not an
 * emulated machine.
 *
 * A guest that brings up its card and its TCP/IP stack needs someone to talk
 * to: something that answers ARP, hands out an address, resolves a name,
 * answers a ping, echoes a datagram. This is that someone. A test or an
 * application creates a node, attaches it to a `Lan`, and switches services
 * on.
 *
 * WRITTEN FROM THE RFCs, and only as far as stated:
 *   ARP        RFC 826   Ethernet/IPv4 requests and replies, a learning cache
 *   IPv4       RFC 791   20-byte headers and options skipped on receive;
 *                        NO fragmentation: a fragment is dropped and counted,
 *                        and nothing longer than one frame is sent
 *   ICMP       RFC 792   echo request -> echo reply; nothing else
 *   UDP        RFC 768   bind / send, checksum made and (when present) checked
 *   DHCP       RFC 2131  server: DISCOVER/OFFER, REQUEST/ACK|NAK, RELEASE;
 *                        one address per client for as long as the node lives
 *   DNS        RFC 1035  server: A records from a table, NXDOMAIN otherwise
 * TCP is not here yet. There is no routing: the node talks to its own subnet.
 *
 * NOTHING HERE TOUCHES A REAL NETWORK, and time does not pass: there are no
 * retransmissions, lease timers or cache expiry.
 *
 * @module
 */

const ETH_ARP = 0x0806, ETH_IPV4 = 0x0800;
const PROTO_ICMP = 1, PROTO_UDP = 17;
const BROADCAST_MAC = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/** "10.0.0.1" -> 0x0a000001 (unsigned). Throws on anything else. */
export function ip (text) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(text));
    if (!m || m.slice(1).some(p => Number(p) > 255)) throw new Error(`not an IPv4 address: ${text}`);
    return ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
}

/** 0x0a000001 -> "10.0.0.1". */
export function ipText (value) {
    return [24, 16, 8, 0].map(s => (value >>> s) & 0xff).join('.');
}

/** "02:00:00:00:00:01" or six numbers -> six numbers. */
export function mac (value) {
    const bytes = Array.isArray(value) || value instanceof Uint8Array ? Array.from(value).slice(0, 6) :
        String(value).split(':').map(h => parseInt(h, 16));
    if (bytes.length !== 6 || bytes.some(b => !(b >= 0 && b <= 255))) throw new Error(`not a MAC address: ${value}`);
    return bytes;
}

export const macText = bytes => Array.from(bytes).slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join(':');

/** The Internet checksum (RFC 1071) of `bytes`, optionally continuing from `sum`. */
export function checksum (bytes, sum = 0) {
    for (let i = 0; i + 1 < bytes.length; i += 2) sum += (bytes[i] << 8) | bytes[i + 1];
    if (bytes.length & 1) sum += bytes[bytes.length - 1] << 8;
    while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
    return (~sum) & 0xffff;
}

const be16 = (b, at) => (b[at] << 8) | b[at + 1];
const be32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const put16 = v => [(v >>> 8) & 0xff, v & 0xff];
const put32 = v => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

export class Ipv4Node {
    /**
     * @param {object} opts
     * @param {string|number[]} opts.mac
     * @param {string} opts.ip        this node's address
     * @param {string} [opts.netmask] default 255.255.255.0
     * @param {string} [opts.name]    for traces
     */
    constructor (opts) {
        this.mac = mac(opts.mac);
        this.ip = ip(opts.ip);
        this.netmask = ip(opts.netmask || '255.255.255.0');
        this.name = opts.name || ipText(this.ip);
        this.link = null;
        /** IPv4 address -> MAC, learned from ARP. */
        this.arp = new Map();
        /** Packets waiting for an address to be resolved, by destination. */
        this.waiting = new Map();
        this.udpPorts = new Map();
        this.identification = 1;
        this.counters = {arpRequests: 0, arpReplies: 0, echoReplies: 0, udpIn: 0, udpOut: 0,
            badChecksum: 0, fragments: 0, notForMe: 0, unhandled: 0};
        this.dhcp = null;
        this.dns = null;
    }

    get broadcast () { return ((this.ip & this.netmask) | ~this.netmask) >>> 0; }

    /** Is `address` on this node's subnet? */
    onLink (address) { return ((address ^ this.ip) & this.netmask) === 0; }

    // ── the wire ────────────────────────────────────────────────────────────

    transmit (dstMac, etherType, payload) {
        if (!this.link) throw new Error(`${this.name}: not attached to a LAN`);
        this.link.send(Uint8Array.from([...dstMac, ...this.mac, ...put16(etherType), ...payload]), this);
    }

    /** A frame from the LAN. The node is its own address filter, as a card is. */
    deliver (frame) {
        if (frame.length < 14) return;
        const mine = this.mac.every((b, i) => frame[i] === b);
        const group = (frame[0] & 1) === 1;
        if (!mine && !group) { this.counters.notForMe++; return; }
        const type = be16(frame, 12);
        const payload = frame.subarray(14);
        if (type === ETH_ARP) this.receiveArp(payload);
        else if (type === ETH_IPV4) this.receiveIpv4(payload, Array.from(frame.subarray(6, 12)));
        else this.counters.unhandled++;
    }

    // ── ARP ─────────────────────────────────────────────────────────────────

    receiveArp (p) {
        // Ethernet (1) / IPv4 (0x0800), 6-byte and 4-byte addresses, or not ours to answer.
        if (p.length < 28 || be16(p, 0) !== 1 || be16(p, 2) !== ETH_IPV4 || p[4] !== 6 || p[5] !== 4) return;
        const op = be16(p, 6);
        const senderMac = Array.from(p.subarray(8, 14));
        const senderIp = be32(p, 14);
        const targetIp = be32(p, 24);
        // RFC 826: update the cache from any packet whose sender we already know or that is for us.
        if (senderIp !== 0 && (this.arp.has(senderIp) || targetIp === this.ip)) this.learn(senderIp, senderMac);
        if (op === 1 && targetIp === this.ip) {
            this.counters.arpReplies++;
            this.transmit(senderMac, ETH_ARP, [0, 1, 8, 0, 6, 4, 0, 2,
                ...this.mac, ...put32(this.ip), ...senderMac, ...put32(senderIp)]);
        }
    }

    learn (address, hardware) {
        this.arp.set(address, hardware);
        const queued = this.waiting.get(address);
        if (!queued) return;
        this.waiting.delete(address);
        for (const packet of queued) this.transmit(hardware, ETH_IPV4, packet);
    }

    // ── IPv4 ────────────────────────────────────────────────────────────────

    /** Send `payload` as protocol `proto` to `dst`, resolving its address first if need be. */
    sendIpv4 (dst, proto, payload, opts = {}) {
        if (20 + payload.length > 1500) throw new Error(`${this.name}: ${payload.length} bytes do not fit one frame, and fragmentation is not provided`);
        const src = opts.src === undefined ? this.ip : opts.src;
        const header = [0x45, 0, ...put16(20 + payload.length), ...put16(this.identification++ & 0xffff), 0, 0,
            opts.ttl || 64, proto, 0, 0, ...put32(src), ...put32(dst)];
        const sum = checksum(header);
        header[10] = sum >>> 8; header[11] = sum & 0xff;
        const packet = [...header, ...payload];
        if (opts.dstMac) return this.transmit(opts.dstMac, ETH_IPV4, packet);
        if (dst === 0xffffffff || dst === this.broadcast) return this.transmit(BROADCAST_MAC, ETH_IPV4, packet);
        if (!this.onLink(dst)) throw new Error(`${this.name}: ${ipText(dst)} is not on this subnet, and there is no router`);
        const known = this.arp.get(dst);
        if (known) return this.transmit(known, ETH_IPV4, packet);
        if (!this.waiting.has(dst)) this.waiting.set(dst, []);
        this.waiting.get(dst).push(packet);
        this.counters.arpRequests++;
        return this.transmit(BROADCAST_MAC, ETH_ARP, [0, 1, 8, 0, 6, 4, 0, 1,
            ...this.mac, ...put32(this.ip), 0, 0, 0, 0, 0, 0, ...put32(dst)]);
    }

    receiveIpv4 (p, fromMac) {
        if (p.length < 20 || (p[0] >> 4) !== 4) return;
        const headerLength = (p[0] & 15) * 4;
        const total = be16(p, 2);
        if (headerLength < 20 || total < headerLength || total > p.length) return;
        if (checksum(p.subarray(0, headerLength)) !== 0) { this.counters.badChecksum++; return; }
        // More-fragments flag or a fragment offset: a piece of something bigger.
        if ((be16(p, 6) & 0x3fff) !== 0) { this.counters.fragments++; return; }
        const src = be32(p, 12), dst = be32(p, 16);
        if (dst !== this.ip && dst !== 0xffffffff && dst !== this.broadcast) { this.counters.notForMe++; return; }
        const body = p.subarray(headerLength, total);
        if (p[9] === PROTO_ICMP) this.receiveIcmp(body, src);
        else if (p[9] === PROTO_UDP) this.receiveUdp(body, src, dst, fromMac);
        else this.counters.unhandled++;
    }

    // ── ICMP ────────────────────────────────────────────────────────────────

    receiveIcmp (p, src) {
        if (p.length < 8 || checksum(p) !== 0) { if (p.length >= 8) this.counters.badChecksum++; return; }
        if (p[0] !== 8 || p[1] !== 0) { this.counters.unhandled++; return; }
        const reply = Array.from(p);
        reply[0] = 0; reply[2] = 0; reply[3] = 0;
        const sum = checksum(reply);
        reply[2] = sum >>> 8; reply[3] = sum & 0xff;
        this.counters.echoReplies++;
        this.sendIpv4(src, PROTO_ICMP, reply);
    }

    // ── UDP ─────────────────────────────────────────────────────────────────

    /**
     * Receive datagrams on `port`: `handler(payload, from, reply)` with
     * `from = {ip, port, mac}` (ip as text) and `reply(bytes)` answering the sender.
     */
    udpBind (port, handler) {
        if (this.udpPorts.has(port)) throw new Error(`${this.name}: UDP port ${port} is already bound`);
        this.udpPorts.set(port, handler);
    }

    /** Send a datagram. `opts.dstMac` skips address resolution; `opts.src` overrides the source address. */
    udpSend (dst, dstPort, srcPort, payload, opts = {}) {
        const to = typeof dst === 'string' ? ip(dst) : dst;
        const src = opts.src === undefined ? this.ip : opts.src;
        const length = 8 + payload.length;
        const datagram = [...put16(srcPort), ...put16(dstPort), ...put16(length), 0, 0, ...payload];
        // The checksum covers a pseudo-header: source, destination, zero, protocol, length.
        let sum = checksum([...put32(src), ...put32(to), 0, PROTO_UDP, ...put16(length), ...datagram]);
        if (sum === 0) sum = 0xffff;
        datagram[6] = sum >>> 8; datagram[7] = sum & 0xff;
        this.counters.udpOut++;
        this.sendIpv4(to, PROTO_UDP, datagram, opts);
    }

    receiveUdp (p, src, dst, fromMac) {
        if (p.length < 8) return;
        const length = be16(p, 4);
        if (length < 8 || length > p.length) return;
        const datagram = p.subarray(0, length);
        // A checksum of zero means the sender made none (RFC 768).
        if (be16(p, 6) !== 0 &&
            checksum([...put32(src), ...put32(dst), 0, PROTO_UDP, ...put16(length), ...datagram]) !== 0) {
            this.counters.badChecksum++;
            return;
        }
        const srcPort = be16(p, 0), dstPort = be16(p, 2);
        const handler = this.udpPorts.get(dstPort);
        if (!handler) { this.counters.unhandled++; return; }
        this.counters.udpIn++;
        const payload = Uint8Array.from(datagram.subarray(8));
        handler(payload, {ip: ipText(src), port: srcPort, mac: fromMac},
            bytes => this.udpSend(src, srcPort, dstPort, Array.from(bytes)));
    }

    // ── DHCP server ─────────────────────────────────────────────────────────

    /**
     * Hand out addresses `first`..`last` (text). `router` and `dns` default to
     * this node. A client keeps its address for as long as this node lives.
     */
    serveDhcp ({first, last, router, dns, leaseSeconds = 86400}) {
        const pool = {first: ip(first), last: ip(last)};
        if (!this.onLink(pool.first) || !this.onLink(pool.last) || pool.last < pool.first) {
            throw new Error(`${this.name}: the DHCP pool ${first}-${last} is not a range on this subnet`);
        }
        this.dhcp = {pool, router: router ? ip(router) : this.ip, dns: dns ? ip(dns) : this.ip, leaseSeconds,
            /** client MAC text -> address */ leases: new Map()};
        this.udpBind(67, (payload, from) => this.receiveDhcp(payload, from));
    }

    receiveDhcp (m, from) {
        const {dhcp} = this;
        // BOOTREQUEST over Ethernet, with the DHCP magic cookie.
        if (m.length < 240 || m[0] !== 1 || m[1] !== 1 || m[2] !== 6 || be32(m, 236) !== 0x63825363) return;
        const client = Array.from(m.subarray(28, 34));
        const options = new Map();
        for (let i = 240; i < m.length && m[i] !== 255;) {
            if (m[i] === 0) { i++; continue; }
            options.set(m[i], m.subarray(i + 2, i + 2 + m[i + 1]));
            i += 2 + m[i + 1];
        }
        const type = options.has(53) ? options.get(53)[0] : 0;
        const key = macText(client);
        const leaseFor = () => {
            if (dhcp.leases.has(key)) return dhcp.leases.get(key);
            const taken = new Set(dhcp.leases.values());
            for (let a = dhcp.pool.first; a <= dhcp.pool.last; a++) {
                if (!taken.has(a) && a !== this.ip) { dhcp.leases.set(key, a); return a; }
            }
            return null;
        };
        const answer = (messageType, yiaddr) => {
            const reply = new Array(240).fill(0);
            reply[0] = 2; reply[1] = 1; reply[2] = 6;
            for (let i = 4; i < 8; i++) reply[i] = m[i];                 // xid
            reply[10] = m[10]; reply[11] = m[11];                        // flags
            put32(yiaddr).forEach((b, i) => { reply[16 + i] = b; });
            put32(this.ip).forEach((b, i) => { reply[20 + i] = b; });    // siaddr
            for (let i = 24; i < 28; i++) reply[i] = m[i];               // giaddr
            client.forEach((b, i) => { reply[28 + i] = b; });
            put32(0x63825363).forEach((b, i) => { reply[236 + i] = b; });
            reply.push(53, 1, messageType, 54, 4, ...put32(this.ip));
            if (messageType !== 6) {
                reply.push(51, 4, ...put32(dhcp.leaseSeconds), 1, 4, ...put32(this.netmask),
                    3, 4, ...put32(dhcp.router), 6, 4, ...put32(dhcp.dns));
            }
            reply.push(255);
            // The client has no address yet: answer to the broadcast address, from ours.
            // The frame goes to the client's hardware address unless it asked for a broadcast.
            const broadcastFlag = (m[10] & 0x80) !== 0;
            this.udpSend(0xffffffff, 68, 67, reply, {dstMac: broadcastFlag || messageType === 6 ? BROADCAST_MAC : client});
        };
        if (type === 1) {                                   // DISCOVER
            const address = leaseFor();
            if (address != null) answer(2, address);        // OFFER; with the pool empty, silence
        } else if (type === 3) {                            // REQUEST
            // For another server: not ours to answer.
            if (options.has(54) && be32(options.get(54), 0) !== this.ip) return;
            const wanted = options.has(50) ? be32(options.get(50), 0) : be32(m, 12);
            const address = leaseFor();
            if (address != null && wanted === address) answer(5, address);   // ACK
            else answer(6, 0);                                               // NAK
        } else if (type === 7) {                            // RELEASE
            dhcp.leases.delete(key);
        }
        void from;
    }

    // ── DNS server ──────────────────────────────────────────────────────────

    /** Answer A queries from `records` ({name: "10.0.0.5"}); names are case-insensitive. */
    serveDns (records) {
        this.dns = new Map(Object.entries(records).map(([name, address]) => [name.toLowerCase().replace(/\.$/, ''), ip(address)]));
        this.udpBind(53, (q, from, reply) => {
            // One question, a query (QR = 0), standard opcode.
            if (q.length < 17 || (q[2] & 0xf8) !== 0 || be16(q, 4) !== 1) return;
            const labels = [];
            let at = 12;
            while (at < q.length && q[at] !== 0) {
                if (q[at] > 63) return;                      // a compressed name in a question: not answered
                labels.push(String.fromCharCode(...q.subarray(at + 1, at + 1 + q[at])));
                at += 1 + q[at];
            }
            if (at + 5 > q.length) return;
            const question = q.subarray(12, at + 5);
            const qtype = be16(q, at + 1), qclass = be16(q, at + 3);
            const address = this.dns.get(labels.join('.').toLowerCase());
            const known = address !== undefined;
            const answers = known && qtype === 1 && qclass === 1 ?
                [0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, ...put32(address)] : [];
            // Response, recursion desired copied, recursion available; NXDOMAIN (3) for a name not in the table.
            reply([q[0], q[1], 0x84 | (q[2] & 1), 0x80 | (known ? 0 : 3), 0, 1, 0, answers.length ? 1 : 0, 0, 0, 0, 0,
                ...question, ...answers]);
        });
    }
}

export default Ipv4Node;
