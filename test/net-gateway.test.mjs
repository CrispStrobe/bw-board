/**
 * The real-network bridge, with the real network played by a recording
 * transport: no socket is opened anywhere in this file.
 *
 * A second host-side node plays the guest: it believes the gateway is its
 * router and name server, as a guest configured by DHCP would.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Lan} from '../src/net/lan.js';
import {Ipv4Node, ip} from '../src/net/ipv4-node.js';
import {Gateway} from '../src/net/gateway.js';
import {serveHttp, parseRequest, formatResponse} from '../src/net/http.js';

const text = s => Array.from(Buffer.from(s));
const str = bytes => Buffer.from(bytes).toString('latin1');
const PUBLIC = '93.184.216.34';

/** A transport that records what it is asked and lets the test play the far side. */
function fakeTransport ({tcp = true, http = false, names = {}} = {}) {
    const t = {opened: [], resolved: [], fetched: []};
    if (tcp) {
        t.tcp = (destination, events) => {
            const far = {destination, events, written: [], ended: false, destroyed: false};
            t.opened.push(far);
            return {write: b => far.written.push(str(b)), end: () => { far.ended = true; }, destroy: () => { far.destroyed = true; }};
        };
    }
    if (http) t.http = (request, respond) => { t.fetched.push(request); respond({status: 200, headers: {'content-type': 'text/plain'}, body: `fetched ${request.headers.host}${request.path}`}); };
    t.resolve = (name, answer) => { t.resolved.push(name); answer(names[name] || null); };
    return t;
}

function world (gatewayOpts) {
    const lan = new Lan();
    const router = lan.attach(new Ipv4Node({mac: '02:00:00:00:00:01', ip: '10.0.0.1', name: 'gateway'}));
    const guest = lan.attach(new Ipv4Node({mac: '02:00:00:00:00:0a', ip: '10.0.0.50', via: '10.0.0.1', name: 'guest'}));
    const decisions = [];
    const gateway = new Gateway(router, {...gatewayOpts, onDecision: d => decisions.push(d)});
    /** The guest opens a connection and records what happens to it. */
    const dial = (address, port, onOpen) => {
        const log = [];
        const c = guest.tcp.connect(address, port, conn => {
            conn.on('open', () => { log.push('open'); if (onOpen) onOpen(conn); });
            conn.on('data', d => log.push(`data:${str(d)}`));
            conn.on('end', () => log.push('end'));
            conn.on('close', o => log.push(`close:${o}`));
        });
        return {c, log};
    };
    return {lan, router, guest, gateway, decisions, dial};
}

test('with the setting off (the default) nothing leaves, and the guest is refused at once', () => {
    const transport = fakeTransport();
    const w = world({transport});
    const {log} = w.dial(PUBLIC, 80);
    assert.deepEqual(log, ['close:refused']);
    assert.equal(transport.opened.length, 0, 'the transport was never asked');
    assert.deepEqual(w.decisions, [{allow: false, reason: 'The real-network bridge is switched off.', guest: '10.0.0.50',
        address: PUBLIC, port: 80, protocol: 'tcp', via: undefined}]);
    assert.deepEqual(w.gateway.counters, {allowed: 0, refused: 1, notCarried: 0});
});

test('web mode carries a connection to port 80 both ways and lists it while it is open', () => {
    const transport = fakeTransport();
    const w = world({transport, settings: {mode: 'web'}});
    const {c, log} = w.dial(PUBLIC, 80, conn => conn.write(text('GET / HTTP/1.0\r\n\r\n')));
    assert.equal(transport.opened.length, 1);
    const far = transport.opened[0];
    assert.deepEqual(far.destination, {address: PUBLIC, port: 80});
    assert.deepEqual(far.written, [], 'held until the far side is open');
    far.events.open();
    assert.deepEqual(far.written, ['GET / HTTP/1.0\r\n\r\n']);
    assert.deepEqual(w.gateway.connections, [{id: 1, guest: '10.0.0.50', address: PUBLIC, port: 80, via: 'tcp', bytesUp: 18, bytesDown: 0}]);
    far.events.data(text('HTTP/1.0 200 OK\r\n\r\nhi'));
    assert.deepEqual(log, ['open', 'data:HTTP/1.0 200 OK\r\n\r\nhi']);
    assert.equal(w.gateway.connections[0].bytesDown, 21);
    far.events.end();
    assert.equal(log[2], 'end', 'the far side finishing reaches the guest as the end of data');
    c.end();
    assert.equal(far.ended, true, 'and the guest finishing reaches the far side');
    far.events.close(null);
    assert.deepEqual([log[log.length - 1], w.gateway.connections.length], ['close:closed', 0]);
    assert.equal(w.decisions[0].allow, true);
    assert.equal(w.decisions[0].reason, `${PUBLIC} is on the internet.`);
});

test('what the policy refuses never reaches the transport: other ports, the user\'s network, this computer, mail', () => {
    const transport = fakeTransport();
    const w = world({transport, settings: {mode: 'web'}});
    for (const [address, port, why] of [[PUBLIC, 22, /web only/], ['192.168.1.1', 80, /your own network/],
        ['127.0.0.1', 80, /this computer itself/], ['172.16.5.5', 443, /your own network/]]) {
        assert.deepEqual(w.dial(address, port).log, ['close:refused'], `${address}:${port}`);
        assert.match(w.decisions[w.decisions.length - 1].reason, why);
    }
    w.gateway.setSettings({mode: 'all', allowLocalNetwork: true});
    assert.deepEqual(w.dial(PUBLIC, 25).log, ['close:refused']);
    assert.deepEqual(w.dial('127.0.0.1', 8080).log, ['close:refused'], 'this computer stays closed even with everything allowed');
    assert.equal(transport.opened.length, 0);
    w.dial('192.168.1.1', 80);
    w.dial(PUBLIC, 22);
    assert.deepEqual(transport.opened.map(f => `${f.destination.address}:${f.destination.port}`), ['192.168.1.1:80', `${PUBLIC}:22`],
        'allowed once the user has said so');
});

test('switching the setting off closes what is open, on both sides', () => {
    const transport = fakeTransport();
    const w = world({transport, settings: {mode: 'all'}});
    const a = w.dial(PUBLIC, 80), b = w.dial(PUBLIC, 22);
    transport.opened.forEach(f => f.events.open());
    assert.equal(w.gateway.connections.length, 2);
    w.gateway.setSettings({mode: 'web'});
    assert.deepEqual([transport.opened[0].destroyed, transport.opened[1].destroyed], [false, true], 'port 22 is no longer allowed');
    assert.deepEqual(b.log, ['open', 'close:reset']);
    assert.deepEqual(w.gateway.connections.map(c => c.port), [80]);
    w.gateway.setSettings({mode: 'off'});
    assert.equal(transport.opened[0].destroyed, true);
    assert.deepEqual(a.log, ['open', 'close:reset']);
    assert.equal(w.gateway.connections.length, 0);
});

test('a far side that fails ends the guest\'s connection with a reset', () => {
    const transport = fakeTransport();
    const w = world({transport, settings: {mode: 'all'}});
    const {log} = w.dial(PUBLIC, 80);
    transport.opened[0].events.close('connection refused');
    assert.deepEqual(log, ['open', 'close:reset']);
    assert.equal(w.gateway.connections.length, 0);
});

test('an application with no transport can open nothing, whatever the setting', () => {
    const w = world({settings: {mode: 'all'}});
    assert.deepEqual(w.dial(PUBLIC, 80).log, ['close:refused']);
    assert.equal(w.decisions[0].reason, 'This application has no way to open that kind of connection.');
});

test('names are resolved through the transport only while the bridge is on', () => {
    const transport = fakeTransport({names: {'example.org': PUBLIC}});
    const w = world({transport});
    w.router.serveDns({'printer.lan': '10.0.0.42'}, {resolve: w.gateway.resolver});
    const ask = (name) => {
        const q = [0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
        for (const label of name.split('.')) q.push(label.length, ...Buffer.from(label));
        q.push(0, 0, 1, 0, 1);
        let answer = null;
        const port = 5000 + Math.floor(Math.random() * 1000);
        w.guest.udpBind(port, payload => { answer = {rcode: payload[3] & 15, tail: Array.from(payload.subarray(payload.length - 4))}; });
        w.guest.udpSend('10.0.0.1', 53, port, q);
        return answer;
    };
    assert.deepEqual(ask('printer.lan'), {rcode: 0, tail: [10, 0, 0, 42]}, 'a name of the simulated network needs no bridge');
    assert.equal(ask('example.org').rcode, 3, 'bridge off: unknown');
    assert.deepEqual(transport.resolved, [], 'and the question did not leave');
    w.gateway.setSettings({mode: 'web'});
    assert.deepEqual(ask('example.org'), {rcode: 0, tail: [93, 184, 216, 34]});
    assert.equal(ask('nowhere.example').rcode, 3);
    assert.deepEqual(transport.resolved, ['example.org', 'nowhere.example']);
});

test('a host without raw TCP carries port 80 as HTTP requests, and cannot carry anything else', () => {
    const transport = fakeTransport({tcp: false, http: true});
    const w = world({transport, settings: {mode: 'all'}});
    const {log} = w.dial(PUBLIC, 80, conn => conn.write(text('GET /page HTTP/1.1\r\nHost: example.org\r\n\r\n')));
    assert.equal(transport.fetched.length, 1);
    assert.deepEqual([transport.fetched[0].method, transport.fetched[0].path, transport.fetched[0].headers.host, transport.fetched[0].address],
        ['GET', '/page', 'example.org', PUBLIC]);
    assert.match(log[1], /^data:HTTP\/1\.1 200 OK\r\n/);
    assert.match(log[1], /content-length: 24\r\n/);
    assert.match(log[1], /\r\n\r\nfetched example\.org\/page$/);
    assert.equal(w.decisions[0].via, 'http');
    assert.deepEqual(w.dial(PUBLIC, 443).log, ['close:refused']);
    assert.equal(w.decisions[1].reason, 'This application has no way to open that kind of connection.');
});

test('UDP: a flow is decided once, carried both ways as the far address, listed, and closed by the setting', () => {
    const transport = fakeTransport();
    const flows = [];
    transport.udp = (destination, events) => {
        const far = {destination, events, sent: [], closed: false};
        flows.push(far);
        return {send: b => far.sent.push(Array.from(b)), close: () => { far.closed = true; }};
    };
    const w = world({transport, settings: {mode: 'all'}});
    const got = [];
    w.guest.udpBind(4000, (payload, from) => got.push([Array.from(payload), from.ip, from.port]));
    w.guest.udpSend('8.8.8.8', 53, 4000, [1, 2, 3]);
    w.guest.udpSend('8.8.8.8', 53, 4000, [4]);
    assert.equal(flows.length, 1, 'one flow for the two datagrams');
    assert.deepEqual([flows[0].destination, flows[0].sent], [{address: '8.8.8.8', port: 53}, [[1, 2, 3], [4]]]);
    assert.equal(w.decisions.length, 1, 'decided once');
    assert.deepEqual([w.decisions[0].allow, w.decisions[0].protocol, w.decisions[0].via], [true, 'udp', 'udp']);
    flows[0].events.message([9, 8, 7]);
    assert.deepEqual(got, [[[9, 8, 7], '8.8.8.8', 53]], 'the answer comes from the far address and port');
    assert.deepEqual(w.gateway.connections, [{id: 1, guest: '10.0.0.50', address: '8.8.8.8', port: 53, via: 'udp', bytesUp: 4, bytesDown: 3}]);
    w.guest.udpSend('8.8.8.8', 123, 4000, [5]);
    assert.equal(flows.length, 2, 'another port is another flow');
    w.gateway.setSettings({mode: 'web'});
    assert.deepEqual([flows[0].closed, flows[1].closed, w.gateway.connections.length], [true, true, 0], 'web mode carries no UDP');
    flows[0].events.message([1]);
    assert.equal(got.length, 1, 'a late answer to a closed flow goes nowhere');
    w.guest.udpSend('8.8.8.8', 53, 4000, [6]);
    assert.equal(flows.length, 2, 'and the guest\'s next datagram is refused');
    assert.match(w.decisions[w.decisions.length - 1].reason, /web only/);
});

test('UDP: a flow to port 443 is closed when the setting becomes web only, though TCP to that port would stay', () => {
    const transport = fakeTransport();
    const flows = [];
    transport.udp = () => { const far = {closed: false}; flows.push(far); return {send () {}, close: () => { far.closed = true; }}; };
    const w = world({transport, settings: {mode: 'all'}});
    w.guest.udpSend('8.8.8.8', 443, 4000, [1]);
    const tcp = w.dial('8.8.8.8', 443);
    transport.opened[0].events.open();
    w.gateway.setSettings({mode: 'web'});
    assert.equal(flows[0].closed, true, 'web mode is TCP only');
    assert.deepEqual([transport.opened[0].destroyed, tcp.log], [false, ['open']], 'the TCP connection to the same port stays');
    assert.deepEqual(w.gateway.connections.map(c => c.via), ['tcp']);
});

test('UDP: the policy and a missing transport refuse a flow before anything is sent', () => {
    const none = world({transport: fakeTransport(), settings: {mode: 'all'}});
    none.guest.udpSend('8.8.8.8', 53, 4000, [1]);
    assert.deepEqual([none.decisions[0].allow, none.decisions[0].reason], [false, 'This application has no way to open that kind of connection.']);
    const transport = fakeTransport();
    let opened = 0;
    transport.udp = () => { opened++; return {send () {}, close () {}}; };
    const w = world({transport, settings: {mode: 'all'}});
    for (const [address, why] of [['192.168.1.1', /your own network/], ['127.0.0.1', /this computer itself/], ['224.0.0.251', /many machines at once/]]) {
        w.guest.udpSend(address, 5353, 4000, [1]);
        assert.match(w.decisions[w.decisions.length - 1].reason, why);
    }
    assert.equal(opened, 0);
    w.guest.sendIpv4(ip('8.8.8.8'), 47, [0, 0, 0, 0]);
    assert.deepEqual([w.gateway.counters.notCarried, w.decisions[w.decisions.length - 1].protocol,
        w.decisions[w.decisions.length - 1].reason], [1, 'ip-protocol-47', 'Only TCP and UDP are carried beyond the simulated network.']);
});

test('UDP: only 64 flows are kept, and the oldest is closed to make room', () => {
    const transport = fakeTransport();
    const flows = [];
    transport.udp = destination => { const far = {port: destination.port, closed: false}; flows.push(far); return {send () {}, close: () => { far.closed = true; }}; };
    const w = world({transport, settings: {mode: 'all'}});
    for (let i = 0; i < 65; i++) w.guest.udpSend('8.8.8.8', 1000 + i, 4000, [1]);
    assert.deepEqual([flows.length, flows[0].closed, flows[1].closed, w.gateway.connections.length], [65, true, false, 64]);
});

test('only what a guest sends to the gateway\'s own card is routed: a broadcast frame for a far address is not', () => {
    const transport = fakeTransport();
    const w = world({transport, settings: {mode: 'all'}});
    const before = w.router.counters.notForMe;
    w.guest.sendIpv4(ip('8.8.8.8'), 17, [0, 1, 0, 2, 0, 8, 0, 0], {dstMac: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]});
    assert.deepEqual([w.gateway.counters.allowed, w.decisions.length, w.router.counters.notForMe - before], [0, 0, 1]);
});

test('the HTTP server: a simulated service answers, and broken requests get their own refusals', () => {
    const lan = new Lan();
    const server = lan.attach(new Ipv4Node({mac: '02:00:00:00:00:01', ip: '10.0.0.1'}));
    const client = lan.attach(new Ipv4Node({mac: '02:00:00:00:00:02', ip: '10.0.0.2'}));
    serveHttp(server, 80, req => (req.path === '/hello' ? {body: `hello ${req.remote.ip} via ${req.method}`} :
        req.method === 'POST' ? {status: 200, body: `got ${Buffer.from(req.body)}`} : {status: 404, body: 'no such page'}));
    const get = raw => {
        let out = '';
        client.tcp.connect('10.0.0.1', 80, c => { c.on('open', () => c.write(text(raw))); c.on('data', d => { out += str(d); }); c.on('end', () => c.end()); });
        return out;
    };
    assert.match(get('GET /hello HTTP/1.1\r\nHost: x\r\n\r\n'), /^HTTP\/1\.1 200 OK\r\ncontent-length: 22\r\nconnection: close\r\n\r\nhello 10\.0\.0\.2 via GET$/);
    assert.match(get('GET /nope HTTP/1.0\r\n\r\n'), /^HTTP\/1\.1 404 Not Found\r\n/);
    assert.match(get('POST /x HTTP/1.1\r\nContent-Length: 4\r\n\r\nabcd'), /\r\n\r\ngot abcd$/);
    assert.match(get('NONSENSE\r\n\r\n'), /^HTTP\/1\.1 400 Bad Request\r\n/);
    assert.match(get('POST /x HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n'), /^HTTP\/1\.1 411 Length Required\r\n/);
    assert.match(get(`GET / HTTP/1.1\r\nX: ${'a'.repeat(9000)}\r\n\r\n`), /^HTTP\/1\.1 431 /);
    assert.equal(parseRequest(text('GET / HTTP/1.1\r\nHost: x\r\n')), null, 'an unfinished request is not judged yet');
    assert.equal(parseRequest(text('POST / HTTP/1.1\r\nContent-Length: 5\r\n\r\nab')), null);
    assert.deepEqual(parseRequest(text('POST / HTTP/1.1\r\nContent-Length: 2000000\r\n\r\n')), {error: 413});
    assert.match(str(formatResponse({status: 200, headers: {'Content-Length': '999', Connection: 'keep-alive'}, body: 'ab'})),
        /content-length: 2\r\nconnection: close/, 'a handler cannot misstate the length or keep the connection');
});
