/**
 * TCP for the host-side IPv4 node, from RFC 793.
 *
 * WHAT IT DOES. Both ends of a connection: `listen(port, onConnection)` and
 * `connect(address, port)`. The three-way handshake, in-order data in both
 * directions, the peer's receive window, both orders of closing, resets, and
 * a reset for a segment that belongs to no connection. A SYN carries the MSS
 * option (1460); every other option is ignored.
 *
 * WHAT IT DOES NOT, said rather than faked.
 *   - NO RETRANSMISSION AND NO TIMERS. The LAN this runs on delivers every
 *     frame, in order, at once, and time does not pass in it. A segment the
 *     peer never acknowledges is never sent again; there is no TIME-WAIT
 *     delay, no keep-alive, no persist timer. A guest's own retransmissions
 *     are handled: a segment already received is acknowledged again and not
 *     delivered twice.
 *   - Out-of-order data is not kept: a segment ahead of the expected one is
 *     dropped and the expected number acknowledged again.
 *   - No congestion control, no urgent data, no window scaling, no
 *     simultaneous open.
 *   - Initial sequence numbers count up from a fixed value, so a test can
 *     state them. That is predictable on purpose and not fit for a real
 *     network; this node is never on one.
 *
 * @module
 */
import {checksum, be16, be32, put16, put32} from './bytes.js';

const PROTO_TCP = 6;
const FIN = 1, SYN = 2, RST = 4, PSH = 8, ACK = 16;
const MSS = 1460;
const WINDOW = 0xffff;

const add = (a, b) => (a + b) >>> 0;
/** a < b in sequence space. */
const before = (a, b) => ((a - b) | 0) < 0;

export class TcpConnection {
    constructor (tcp, remoteIp, remotePort, localPort, localIp = tcp.node.ip) {
        this.tcp = tcp;
        this.remoteIp = remoteIp;
        this.remotePort = remotePort;
        this.localPort = localPort;
        /** The address this end answers as: the node's own, or the one a gateway stands in for. */
        this.localIp = localIp;
        /** LISTEN is the port's, not a connection's; a connection starts in SYN-SENT or SYN-RECEIVED. */
        this.state = 'CLOSED';
        this.sndUna = 0; this.sndNxt = 0; this.sndWnd = 0;
        this.rcvNxt = 0;
        this.peerMss = 536;                 // RFC 1122's default when the peer states none
        /** Bytes accepted by write() and not yet sent. */
        this.unsent = [];
        this.finQueued = false; this.finSent = false;
        this.handlers = {data: [], end: [], close: [], open: []};
        /** Why the connection ended, once it has: 'closed' | 'reset' | 'refused'. */
        this.outcome = null;
    }

    get remote () { return {ip: [24, 16, 8, 0].map(s => (this.remoteIp >>> s) & 0xff).join('.'), port: this.remotePort}; }

    /** `event`: 'open', 'data' (Uint8Array), 'end' (the peer will send no more), 'close' (outcome). */
    on (event, handler) { this.handlers[event].push(handler); return this; }
    emit (event, value) { for (const h of this.handlers[event].slice()) h(value); }

    /** Queue bytes to send. They go out as the peer's window allows. */
    write (bytes) {
        if (this.finQueued || this.state === 'CLOSED') throw new Error('tcp: write after end');
        for (const b of bytes) this.unsent.push(b & 0xff);
        this.tcp.node.run(() => this.pump());
    }

    /** No more data from this side: a FIN follows whatever is still queued. */
    end () {
        if (this.finQueued || this.state === 'CLOSED') return;
        this.finQueued = true;
        this.tcp.node.run(() => this.pump());
    }

    /** Give up at once: the peer gets a reset. */
    abort () {
        if (this.state === 'CLOSED') return;
        this.tcp.node.run(() => {
            this.tcp.send(this, RST | ACK, this.sndNxt, []);
            this.close('reset');
        });
    }

    close (outcome) {
        if (this.state === 'CLOSED') return;
        this.state = 'CLOSED';
        this.outcome = outcome;
        this.tcp.connections.delete(this.tcp.key(this.remoteIp, this.remotePort, this.localPort, this.localIp));
        this.emit('close', outcome);
    }

    /** Send what the window allows, then the FIN if one is due. */
    pump () {
        const sending = this.state === 'ESTABLISHED' || this.state === 'CLOSE-WAIT';
        if (!sending) return;
        for (;;) {
            const inFlight = (this.sndNxt - this.sndUna) >>> 0;
            const room = this.sndWnd - inFlight;
            const n = Math.min(this.unsent.length, this.peerMss, room);
            if (n <= 0) break;
            const data = this.unsent.splice(0, n);
            this.tcp.send(this, ACK | (this.unsent.length ? 0 : PSH), this.sndNxt, data);
            this.sndNxt = add(this.sndNxt, n);
        }
        if (this.finQueued && !this.finSent && this.unsent.length === 0) {
            this.tcp.send(this, FIN | ACK, this.sndNxt, []);
            this.sndNxt = add(this.sndNxt, 1);
            this.finSent = true;
            this.state = this.state === 'ESTABLISHED' ? 'FIN-WAIT-1' : 'LAST-ACK';
        }
    }
}

export class Tcp {
    constructor (node) {
        this.node = node;
        this.listeners = new Map();
        this.connections = new Map();
        this.nextIss = 0x1000;
        this.nextPort = 49152;
        this.counters = {badChecksum: 0, resetsSent: 0, duplicates: 0, outOfOrder: 0};
        /** Set by a gateway: `(dstIp, dstPort, srcIp) => onConnection | null` for addresses beyond the LAN. */
        this.intercept = null;
    }

    key (remoteIp, remotePort, localPort, localIp = this.node.ip) { return `${remoteIp}:${remotePort}:${localIp}:${localPort}`; }

    /** Accept connections on `port`: `onConnection(connection)` is called once each is established. */
    listen (port, onConnection) {
        if (this.listeners.has(port)) throw new Error(`${this.node.name}: TCP port ${port} is already listening`);
        this.listeners.set(port, onConnection);
    }

    /**
     * Open a connection to `address` (text) and `port`. Listen for 'open', or
     * 'close' with 'refused'.
     *
     * `setup(connection)` runs before the SYN is sent, and is where handlers
     * belong: on this LAN a peer answers before `send` returns, so a whole
     * exchange can be over by the time `connect` does.
     */
    connect (address, port, setup) {
        const remoteIp = typeof address === 'number' ? address :
            address.split('.').reduce((v, p) => ((v << 8) | Number(p)) >>> 0, 0);
        let localPort = this.nextPort++;
        while (this.connections.has(this.key(remoteIp, port, localPort))) localPort = this.nextPort++;
        const c = new TcpConnection(this, remoteIp, port, localPort);
        c.sndUna = this.nextIss; c.sndNxt = add(this.nextIss, 1);
        this.nextIss = add(this.nextIss, 0x1000);
        c.state = 'SYN-SENT';
        this.connections.set(this.key(remoteIp, port, localPort), c);
        if (setup) setup(c);
        this.node.run(() => this.send(c, SYN, c.sndUna, [], true));
        return c;
    }

    /** Build and send one segment of a connection. */
    send (c, flags, seq, data, withMss = false) {
        this.segment(c.remoteIp, c.localPort, c.remotePort, seq, (flags & ACK) ? c.rcvNxt : 0, flags, data, withMss, c.localIp);
    }

    segment (dstIp, srcPort, dstPort, seq, ack, flags, data, withMss = false, srcIp = this.node.ip) {
        const options = withMss ? [2, 4, ...put16(MSS)] : [];
        const header = [...put16(srcPort), ...put16(dstPort), ...put32(seq), ...put32(ack),
            ((20 + options.length) / 4) << 4, flags, ...put16(WINDOW), 0, 0, 0, 0, ...options];
        const seg = [...header, ...data];
        const sum = checksum([...put32(srcIp), ...put32(dstIp), 0, PROTO_TCP, ...put16(seg.length), ...seg]);
        seg[16] = sum >>> 8; seg[17] = sum & 0xff;
        this.node.sendIpv4(dstIp, PROTO_TCP, seg, {src: srcIp});
    }

    /** RFC 793, "Reset Generation": answer a segment that belongs to nothing. */
    refuse (srcIp, srcPort, dstPort, seq, ack, flags, length, localIp = this.node.ip) {
        if (flags & RST) return;
        this.counters.resetsSent++;
        if (flags & ACK) this.segment(srcIp, dstPort, srcPort, ack, 0, RST, [], false, localIp);
        else this.segment(srcIp, dstPort, srcPort, 0, add(seq, length), RST | ACK, [], false, localIp);
    }

    /**
     * A TCP segment for `dstIp`: this node's own address, or, when the node
     * routes for its LAN (gateway.js), an address beyond it that this end
     * then answers as.
     */
    receive (p, srcIp, dstIp = this.node.ip) {
        if (p.length < 20) return;
        const offset = (p[12] >> 4) * 4;
        if (offset < 20 || offset > p.length) return;
        if (checksum([...put32(srcIp), ...put32(dstIp), 0, PROTO_TCP, ...put16(p.length), ...p]) !== 0) {
            this.counters.badChecksum++;
            return;
        }
        const srcPort = be16(p, 0), dstPort = be16(p, 2);
        const seq = be32(p, 4), ack = be32(p, 8), flags = p[13], window = be16(p, 14);
        const data = p.subarray(offset);
        // SYN and FIN each take one place in sequence space.
        const length = data.length + ((flags & SYN) ? 1 : 0) + ((flags & FIN) ? 1 : 0);
        let mss = null;
        for (let i = 20; i < offset && p[i] !== 0;) {
            if (p[i] === 1) { i++; continue; }
            if (p[i] === 2 && p[i + 1] === 4) mss = be16(p, i + 2);
            if (p[i + 1] < 2) break;
            i += p[i + 1];
        }
        const key = this.key(srcIp, srcPort, dstPort, dstIp);
        const c = this.connections.get(key);

        if (!c) {
            const bareSyn = (flags & (SYN | ACK | RST)) === SYN;
            // For an address beyond the LAN the gateway decides, once per connection attempt.
            const onConnection = dstIp === this.node.ip ? this.listeners.get(dstPort) :
                (bareSyn && this.intercept ? this.intercept(dstIp, dstPort, srcIp) : null);
            // Only a bare SYN opens a connection; anything else to a listening or closed port is refused.
            if (!onConnection || !bareSyn) {
                return this.refuse(srcIp, srcPort, dstPort, seq, ack, flags, length, dstIp);
            }
            const n = new TcpConnection(this, srcIp, srcPort, dstPort, dstIp);
            n.onConnection = onConnection;
            n.rcvNxt = add(seq, 1);
            n.sndUna = this.nextIss; n.sndNxt = add(this.nextIss, 1);
            this.nextIss = add(this.nextIss, 0x1000);
            n.sndWnd = window;
            if (mss) n.peerMss = mss;
            n.state = 'SYN-RECEIVED';
            this.connections.set(key, n);
            return this.send(n, SYN | ACK, n.sndUna, [], true);
        }

        if (c.state === 'SYN-SENT') {
            if ((flags & ACK) && ack !== c.sndNxt) return (flags & RST) ? undefined : this.segment(srcIp, dstPort, srcPort, ack, 0, RST, [], false, dstIp);
            if (flags & RST) return (flags & ACK) ? c.close('refused') : undefined;
            if ((flags & (SYN | ACK)) !== (SYN | ACK)) return undefined;
            c.rcvNxt = add(seq, 1);
            c.sndUna = ack;
            c.sndWnd = window;
            if (mss) c.peerMss = mss;
            c.state = 'ESTABLISHED';
            this.send(c, ACK, c.sndNxt, []);
            c.emit('open');
            return c.pump();
        }

        // Is the segment where we expect the peer to be? (RFC 793's acceptability test, without a zero window.)
        if (seq !== c.rcvNxt) {
            if (flags & RST) return undefined;
            if (before(seq, c.rcvNxt)) this.counters.duplicates++; else this.counters.outOfOrder++;
            return this.send(c, ACK, c.sndNxt, []);
        }
        if (flags & RST) return c.close('reset');
        if (flags & SYN) { this.segment(srcIp, dstPort, srcPort, c.sndNxt, 0, RST, [], false, dstIp); return c.close('reset'); }
        if (!(flags & ACK)) return undefined;

        if (c.state === 'SYN-RECEIVED') {
            if (ack !== c.sndNxt) return this.segment(srcIp, dstPort, srcPort, ack, 0, RST, [], false, dstIp);
            c.state = 'ESTABLISHED';
            c.sndUna = ack;
            c.sndWnd = window;
            c.onConnection(c);
            c.emit('open');
        } else {
            // An acknowledgement of something not yet sent is answered and otherwise ignored.
            if (before(c.sndNxt, ack)) return this.send(c, ACK, c.sndNxt, []);
            if (!before(ack, c.sndUna)) { c.sndUna = ack; c.sndWnd = window; }
        }

        const finAcked = c.finSent && c.sndUna === c.sndNxt;
        if (c.state === 'FIN-WAIT-1' && finAcked) c.state = 'FIN-WAIT-2';
        else if (c.state === 'CLOSING' && finAcked) return c.close('closed');
        else if (c.state === 'LAST-ACK' && finAcked) return c.close('closed');

        const receiving = c.state === 'ESTABLISHED' || c.state === 'FIN-WAIT-1' || c.state === 'FIN-WAIT-2';
        if (data.length && receiving) {
            c.rcvNxt = add(c.rcvNxt, data.length);
            c.emit('data', Uint8Array.from(data));
        }
        if ((flags & FIN) && c.state !== 'CLOSED') {
            c.rcvNxt = add(c.rcvNxt, 1);
            if (c.state === 'ESTABLISHED') c.state = 'CLOSE-WAIT';
            else if (c.state === 'FIN-WAIT-1') c.state = 'CLOSING';
            else if (c.state === 'FIN-WAIT-2') c.state = 'TIME-WAIT';
            this.send(c, ACK, c.sndNxt, []);
            c.emit('end');
            // No timers: the 2 MSL wait is not kept.
            if (c.state === 'TIME-WAIT') return c.close('closed');
        } else if (data.length && receiving && c.state !== 'CLOSED') {
            this.send(c, ACK, c.sndNxt, []);
        }
        if (c.state !== 'CLOSED') c.pump();
        return undefined;
    }
}

export default Tcp;
