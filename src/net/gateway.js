/**
 * The real-network bridge: a host-side node that routes for its LAN, under
 * the user's egress setting (egress-policy.js).
 *
 * WHAT IT IS. Guests are told (by DHCP) that this node is their router and
 * their name server. A connection a guest opens to an address beyond the LAN
 * arrives here; the gateway asks the policy, and if the answer is yes it
 * opens the real connection through a TRANSPORT and carries bytes between
 * the two. To the guest, this end answers as the far address.
 *
 * WHAT IT IS NOT. It opens nothing by itself. bw-board contains no socket
 * code: the embedding application hands in the transport, and with none, or
 * with the setting off, every attempt is refused. Connections go outwards
 * only; nothing outside can open one into the LAN.
 *
 * THE TRANSPORT (all optional; a missing one means that kind of traffic is refused):
 *   tcp(destination, events) -> {write(bytes), end(), destroy()}
 *       destination {address, port}; events {open(), data(bytes), end(), close(errorText|null)}
 *   udp(destination, events) -> {send(bytes), close()}
 *       one per flow (guest address and port, far address and port); events {message(bytes)}
 *   resolve(name, answer)    -> answer(addressText | null)
 *   http(request, respond)   -> respond({status, headers, body})   [port 80 only]
 *       for hosts that cannot open raw TCP (a browser has fetch, not sockets).
 *       The request is the guest's own, parsed; `request.address` is the
 *       address the guest connected to and `request.headers.host` what it asked for.
 *
 * EVERYTHING IS REPORTED. `onDecision` hears every allow and refusal with the
 * policy's sentence; `connections` lists what is open, with byte counts;
 * `setSettings` to 'off' (or `closeAll()`) closes all of them.
 *
 * UDP has no end to wait for and this network has no clock, so a flow stays
 * listed until the setting or `closeAll()` closes it; at most 64 are kept and
 * the oldest is closed to make room.
 *
 * NOT CARRIED: anything beyond the LAN that is neither TCP nor UDP (counted,
 * reported, dropped), and TLS for the `http` transport (port 443 needs raw TCP).
 *
 * @module
 */
import {decide, normalize} from './egress-policy.js';
import {answerHttp} from './http.js';
import {checksum, be16, put16, put32} from './bytes.js';

const MAX_UDP_FLOWS = 64;

const text = value => [24, 16, 8, 0].map(s => (value >>> s) & 0xff).join('.');

export class Gateway {
    /**
     * @param {import('./ipv4-node.js').Ipv4Node} node the node guests use as router
     * @param {object} [opts]
     * @param {object} [opts.settings] {mode, allowLocalNetwork}; default off
     * @param {object} [opts.transport] {tcp, resolve, http}
     * @param {(event: object) => void} [opts.onDecision]
     */
    constructor (node, opts = {}) {
        this.node = node;
        this.settings = normalize(opts.settings);
        this.transport = opts.transport || {};
        this.onDecision = opts.onDecision || (() => {});
        /** Open connections: {id, guest, address, port, via, bytesUp, bytesDown}. */
        this.connections = [];
        this.closers = new Map();
        this.nextId = 1;
        this.counters = {allowed: 0, refused: 0, notCarried: 0};
        /** UDP flows by "guest:port>address:port". */
        this.flows = new Map();
        node.router = {other: (proto, body, src, dst) => (proto === 17 ? this.udp(body, src, dst) : this.other(proto, src, dst))};
        node.tcp.intercept = (dstIp, dstPort, srcIp) => this.intercept(dstIp, dstPort, srcIp);
    }

    /** Change the user's setting. Whatever the new setting would refuse is closed now. */
    setSettings (settings) {
        this.settings = normalize(settings);
        for (const c of this.connections.slice()) {
            const protocol = c.via === 'udp' ? 'udp' : 'tcp';
            if (!decide(this.settings, {address: c.address, port: c.port, protocol}).allow) this.closers.get(c.id)();
        }
    }

    closeAll () { for (const c of this.connections.slice()) this.closers.get(c.id)(); }

    /** Resolve a name for a guest, for `node.serveDns(records, {resolve: gateway.resolver})`. */
    get resolver () {
        return (name, answer) => {
            // With the bridge off, no question about a name leaves either.
            if (this.settings.mode === 'off' || !this.transport.resolve) return answer(null);
            return this.transport.resolve(name, answer);
        };
    }

    other (proto, src, dst) {
        this.counters.notCarried++;
        this.onDecision({allow: false, guest: text(src), address: text(dst), port: null,
            protocol: `ip-protocol-${proto}`, reason: 'Only TCP and UDP are carried beyond the simulated network.'});
    }

    /** A guest's datagram for an address beyond the LAN. The decision is made once per flow. */
    udp (p, src, dst) {
        if (p.length < 8) return;
        const length = be16(p, 4);
        if (length < 8 || length > p.length) return;
        // A checksum of zero means the sender made none; a wrong one means a damaged datagram.
        if (be16(p, 6) !== 0 && checksum([...put32(src), ...put32(dst), 0, 17, ...put16(length), ...p.subarray(0, length)]) !== 0) return;
        const guestPort = be16(p, 0), port = be16(p, 2);
        const payload = Uint8Array.from(p.subarray(8, length));
        const address = text(dst), guest = text(src);
        const key = `${guest}:${guestPort}>${address}:${port}`;
        let flow = this.flows.get(key);
        if (!flow) {
            const verdict = decide(this.settings, {address, port, protocol: 'udp'});
            const allow = verdict.allow && !!this.transport.udp;
            this.counters[allow ? 'allowed' : 'refused']++;
            this.onDecision({allow, guest, address, port, protocol: 'udp', via: allow ? 'udp' : undefined,
                reason: verdict.allow && !allow ? 'This application has no way to open that kind of connection.' : verdict.reason});
            if (!allow) return;
            if (this.flows.size >= MAX_UDP_FLOWS) this.closers.get(this.flows.values().next().value.entry.id)();
            let far = null;
            const entry = this.track(guest, address, port, 'udp', () => {
                this.flows.delete(key);
                this.forget(entry);
                if (far) far.close();
            });
            far = this.transport.udp({address, port}, {
                // An answer reaches the guest as coming from the far address and port.
                message: bytes => this.node.run(() => {
                    if (!this.flows.has(key)) return;
                    entry.bytesDown += bytes.length;
                    this.node.udpSend(src, guestPort, port, Array.from(bytes), {src: dst});
                }),
            });
            flow = {entry, far};
            this.flows.set(key, flow);
        }
        flow.entry.bytesUp += payload.length;
        flow.far.send(payload);
    }

    /** A guest opens a TCP connection to an address beyond the LAN: allow it (a handler) or refuse it (null). */
    intercept (dstIp, dstPort, srcIp) {
        const address = text(dstIp), guest = text(srcIp);
        const verdict = decide(this.settings, {address, port: dstPort, protocol: 'tcp'});
        const viaHttp = !this.transport.tcp && dstPort === 80 && !!this.transport.http;
        const report = (allow, reason, via) => {
            this.counters[allow ? 'allowed' : 'refused']++;
            this.onDecision({allow, reason, guest, address, port: dstPort, protocol: 'tcp', via});
        };
        if (!verdict.allow) { report(false, verdict.reason); return null; }
        if (!this.transport.tcp && !viaHttp) {
            report(false, 'This application has no way to open that kind of connection.');
            return null;
        }
        report(true, verdict.reason, viaHttp ? 'http' : 'tcp');
        return connection => (viaHttp ? this.carryHttp(connection, guest, address, dstPort) :
            this.carryTcp(connection, guest, address, dstPort));
    }

    track (guest, address, port, via, close) {
        const entry = {id: this.nextId++, guest, address, port, via, bytesUp: 0, bytesDown: 0};
        this.connections.push(entry);
        this.closers.set(entry.id, close);
        return entry;
    }

    forget (entry) {
        this.connections = this.connections.filter(c => c !== entry);
        this.closers.delete(entry.id);
    }

    carryTcp (connection, guest, address, port) {
        let remote = null, open = false, over = false;
        const early = [];
        const entry = this.track(guest, address, port, 'tcp', () => { if (remote) remote.destroy(); connection.abort(); });
        const finish = () => { if (!over) { over = true; this.forget(entry); } };
        connection.on('data', data => {
            entry.bytesUp += data.length;
            if (open) remote.write(data); else early.push(data);
        });
        connection.on('end', () => { if (open) remote.end(); else early.push(null); });
        connection.on('close', () => { if (remote && !over) remote.destroy(); finish(); });
        // What the guest sent before the far side was open goes first, in order.
        const flush = () => { for (const data of early.splice(0)) { if (data) remote.write(data); else remote.end(); } };
        remote = this.transport.tcp({address, port}, {
            open: () => { open = true; if (remote) flush(); },
            data: bytes => this.node.run(() => {
                if (connection.state === 'CLOSED') return;
                entry.bytesDown += bytes.length;
                connection.write(bytes);
            }),
            end: () => this.node.run(() => connection.end()),
            close: () => this.node.run(() => {
                // The far side is gone. If the guest has not finished too, it is told with a reset.
                if (connection.state !== 'CLOSED' && !connection.finQueued) connection.abort();
                finish();
            }),
        });
        // A transport may report "open" before it has returned its handle.
        if (open) flush();
    }

    carryHttp (connection, guest, address, port) {
        const entry = this.track(guest, address, port, 'http', () => connection.abort());
        connection.on('close', () => this.forget(entry));
        answerHttp(connection, (request, respond) => {
            entry.bytesUp += request.body.length;
            this.transport.http({...request, address, guest}, response => this.node.run(() => {
                const body = response && response.body !== undefined ? response.body : '';
                entry.bytesDown += body.length;
                respond(response || {status: 502, body: '502 Bad Gateway\n'});
            }));
        });
    }
}

export default Gateway;
