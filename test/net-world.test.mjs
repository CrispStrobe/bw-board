/**
 * The assembled network: a guest that knows nothing gets an address, finds a
 * simulated host by name and fetches a page from it; the bridge is off.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLanWorld, Ipv4Node, DEFAULT_EGRESS} from '../src/net/world.js';

const text = s => Array.from(Buffer.from(s));

test('a new world is closed to the real network and says what is on it', () => {
    const world = createLanWorld();
    assert.deepEqual(world.describe(), {router: '10.0.0.1', egress: {...DEFAULT_EGRESS}, hosts: [], leases: [], members: 1, connections: []});
    const printer = world.addHost('printer');
    world.addHost('files.example', '10.0.0.77');
    assert.deepEqual(world.describe().hosts, [{name: 'printer.lan', address: '10.0.0.2'}, {name: 'files.example', address: '10.0.0.77'}]);
    assert.throws(() => world.addHost('Printer'), /already exists/);
    assert.throws(() => world.serveHttp('nobody', () => ({})), /no host named nobody/);
    assert.equal(printer.via, world.router.ip, 'hosts send beyond the subnet through the router');
    world.setEgress({mode: 'web'});
    assert.deepEqual(world.describe().egress, {mode: 'web', allowLocalNetwork: false});
});

test('a guest gets its address from the router, resolves a host by name and fetches a page from it', () => {
    const world = createLanWorld({router: '192.168.7.1'});
    world.addHost('museum');
    world.serveHttp('museum', req => ({headers: {'content-type': 'text/plain'}, body: `welcome to ${req.headers.host}${req.path}`}));

    // The guest starts with no address: it asks by DHCP, as a booting machine does.
    const guestMac = [0x02, 0, 0, 0, 0, 0x0a];
    const probe = world.lan.attach({deliver: f => probe.frames.push(f), frames: []});
    const dhcp = (type, extra = []) => {
        const m = new Array(240).fill(0);
        m[0] = 1; m[1] = 1; m[2] = 6; m[7] = 9;
        guestMac.forEach((b, i) => { m[28 + i] = b; });
        [0x63, 0x82, 0x53, 0x63].forEach((b, i) => { m[236 + i] = b; });
        m.push(53, 1, type, ...extra, 255);
        const udp = [0, 68, 0, 67, (8 + m.length) >> 8, (8 + m.length) & 255, 0, 0, ...m];      // no UDP checksum
        const h = [0x45, 0, (20 + udp.length) >> 8, (20 + udp.length) & 255, 0, 1, 0, 0, 64, 17, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255];
        let s = 0; for (let i = 0; i < 20; i += 2) s += (h[i] << 8) | h[i + 1];
        while (s > 0xffff) s = (s & 0xffff) + (s >>> 16);
        h[10] = (~s >> 8) & 255; h[11] = ~s & 255;
        world.lan.send(Uint8Array.from([255, 255, 255, 255, 255, 255, ...guestMac, 8, 0, ...h, ...udp]), probe);
        const reply = probe.frames.pop().subarray(14 + 20 + 8);
        const options = {};
        for (let i = 240; reply[i] !== 255; i += 2 + reply[i + 1]) options[reply[i]] = Array.from(reply.subarray(i + 2, i + 2 + reply[i + 1]));
        return {yiaddr: Array.from(reply.subarray(16, 20)).join('.'), options};
    };
    const offer = dhcp(1);
    assert.deepEqual([offer.yiaddr, offer.options[3], offer.options[6]], ['192.168.7.100', [192, 168, 7, 1], [192, 168, 7, 1]]);
    const ack = dhcp(3, [50, 4, 192, 168, 7, 100, 54, 4, 192, 168, 7, 1]);
    assert.deepEqual([ack.options[53], ack.yiaddr], [[5], '192.168.7.100']);
    world.lan.detach(probe);

    // With that address the guest is a node like any other.
    const guest = world.lan.attach(new Ipv4Node({mac: guestMac, ip: offer.yiaddr, via: '192.168.7.1'}));
    let museum = null;
    guest.udpBind(5300, payload => { museum = Array.from(payload.subarray(payload.length - 4)).join('.'); });
    const q = [0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 6, ...text('museum'), 3, ...text('lan'), 0, 0, 1, 0, 1];
    guest.udpSend('192.168.7.1', 53, 5300, q);
    assert.equal(museum, '192.168.7.2');
    let page = '';
    guest.tcp.connect(museum, 80, c => {
        c.on('open', () => c.write(text('GET /hall HTTP/1.1\r\nHost: museum.lan\r\n\r\n')));
        c.on('data', d => { page += Buffer.from(d).toString(); });
        c.on('end', () => c.end());
    });
    assert.match(page, /^HTTP\/1\.1 200 OK\r\n/);
    assert.match(page, /\r\n\r\nwelcome to museum\.lan\/hall$/);
    assert.deepEqual(world.describe().leases, [{mac: '02:00:00:00:00:0a', address: '192.168.7.100'}]);

    // And the real network is not there: a far address is refused, a far name unknown.
    const far = [];
    guest.tcp.connect('93.184.216.34', 80, c => c.on('close', o => far.push(o)));
    assert.deepEqual(far, ['refused']);
});
