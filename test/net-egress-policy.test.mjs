/**
 * The real-network bridge setting: every refusal the policy promises, and
 * that the safe answer is the default one.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify, decide, normalize, DEFAULT_EGRESS, EGRESS_MODES, SAFETY_NOTES} from '../src/net/egress-policy.js';

const PUBLIC = '93.184.216.34';
const tcp = (address, port = 80) => ({address, port, protocol: 'tcp'});
const udp = (address, port = 53) => ({address, port, protocol: 'udp'});

test('addresses are sorted into the places they are', () => {
    const cases = {
        'this-computer': ['127.0.0.1', '127.255.255.254'],
        'local-network': ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
            '169.254.1.1', '100.64.0.1', '100.127.255.255'],
        'public': [PUBLIC, '8.8.8.8', '172.15.255.255', '172.32.0.0', '192.167.255.255', '192.169.0.0', '100.63.255.255',
            '100.128.0.0', '169.253.255.255', '11.0.0.0', '126.255.255.255', '128.0.0.0', '223.255.255.255', '198.17.255.255', '198.20.0.0'],
        'multicast': ['224.0.0.1', '239.255.255.250'],
        'broadcast': ['255.255.255.255'],
        'unspecified': ['0.0.0.0', '0.1.2.3'],
        'reserved': ['240.0.0.1', '255.255.255.254', '192.0.2.1', '198.51.100.7', '203.0.113.9', '192.0.0.8', '198.18.0.1', '198.19.255.255'],
        'not-an-address': ['', 'localhost', '10.0.0', '10.0.0.256', '1.2.3.4.5', '::1', ' 8.8.8.8'],
    };
    for (const [kind, list] of Object.entries(cases)) for (const a of list) assert.equal(classify(a), kind, a);
});

test('the default is off, and off refuses everything', () => {
    assert.deepEqual(DEFAULT_EGRESS, {mode: 'off', allowLocalNetwork: false});
    assert.deepEqual(normalize(undefined), {mode: 'off', allowLocalNetwork: false});
    for (const settings of [undefined, {}, {mode: 'off'}, {mode: 'off', allowLocalNetwork: true}]) {
        assert.deepEqual(decide(settings, tcp(PUBLIC)), {allow: false, reason: 'The real-network bridge is switched off.'});
    }
    assert.deepEqual(EGRESS_MODES, ['off', 'web', 'all']);
    assert.throws(() => decide({mode: 'on'}, tcp(PUBLIC)), /unknown mode "on"/);
    assert.equal(normalize({mode: 'all', allowLocalNetwork: 'yes'}).allowLocalNetwork, false, 'only true allows the local network');
});

test('web mode: TCP 80 and 443 to the internet, and nothing else', () => {
    const web = {mode: 'web'};
    assert.deepEqual(decide(web, tcp(PUBLIC, 80)), {allow: true, reason: `${PUBLIC} is on the internet.`});
    assert.equal(decide(web, tcp(PUBLIC, 443)).allow, true);
    for (const d of [tcp(PUBLIC, 8080), tcp(PUBLIC, 22), udp(PUBLIC, 53), udp(PUBLIC, 443)]) {
        const r = decide(web, d);
        assert.equal(r.allow, false, JSON.stringify(d));
        assert.match(r.reason, /web only/);
    }
});

test('all mode: any TCP or UDP port to the internet, except mail', () => {
    const all = {mode: 'all'};
    for (const d of [tcp(PUBLIC, 22), tcp(PUBLIC, 6667), udp(PUBLIC, 53), udp(PUBLIC, 123), tcp(PUBLIC, 65535), tcp(PUBLIC, 1)]) {
        assert.equal(decide(all, d).allow, true, JSON.stringify(d));
    }
    for (const mode of ['web', 'all']) {
        assert.deepEqual(decide({mode, allowLocalNetwork: true}, tcp(PUBLIC, 25)),
            {allow: false, reason: 'Port 25 (sending mail directly) is never opened.'});
    }
    assert.match(decide(all, {address: PUBLIC, port: 80, protocol: 'icmp'}).reason, /Only TCP and UDP/);
    for (const port of [0, 65536, -1, 80.5, NaN, '80', undefined]) assert.equal(decide(all, {address: PUBLIC, port, protocol: 'tcp'}).allow, false, String(port));
});

test('your own network is closed until it is allowed separately, in every mode', () => {
    for (const address of ['192.168.1.1', '10.0.0.5', '172.20.3.4', '169.254.9.9', '100.64.1.1']) {
        for (const mode of ['web', 'all']) {
            assert.deepEqual(decide({mode}, tcp(address)), {allow: false, reason: `${address} is on your own network. Reaching it is switched off.`});
            assert.deepEqual(decide({mode, allowLocalNetwork: true}, tcp(address)),
                {allow: true, reason: `${address} is on your own network, which you have allowed.`});
        }
    }
});

test('this computer, multicast, broadcast and impossible addresses are refused whatever is allowed', () => {
    const open = {mode: 'all', allowLocalNetwork: true};
    assert.match(decide(open, tcp('127.0.0.1')).reason, /this computer itself/);
    assert.match(decide(open, tcp('127.9.9.9', 443)).reason, /this computer itself/);
    assert.match(decide(open, udp('224.0.0.251', 5353)).reason, /many machines at once/);
    assert.match(decide(open, udp('255.255.255.255', 67)).reason, /many machines at once/);
    assert.match(decide(open, tcp('0.0.0.0')).reason, /not an address a connection can be made to/);
    assert.match(decide(open, tcp('240.1.1.1')).reason, /not an address a connection can be made to/);
    assert.match(decide(open, tcp('router.local')).reason, /not an IPv4 address/);
    for (const a of ['127.0.0.1', '224.0.0.1', '255.255.255.255', '0.0.0.0', '240.0.0.1', 'localhost']) assert.equal(decide(open, tcp(a)).allow, false, a);
    assert.equal(decide(open, undefined).allow, false);
});

test('the notes a user is shown say the things that matter', () => {
    assert.equal(SAFETY_NOTES.length, 7);
    assert.ok(Object.isFrozen(SAFETY_NOTES));
    const all = SAFETY_NOTES.join(' ');
    for (const must of [/your real internet connection/, /your computer and your network address/, /made by someone else/,
        /cannot encrypt/, /your own network/, /never reachable/, /switching the setting off closes them all/]) assert.match(all, must);
    for (const note of SAFETY_NOTES) assert.ok(note.length < 220 && /\.$/.test(note), note);
});
