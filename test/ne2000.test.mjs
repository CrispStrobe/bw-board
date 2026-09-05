// THE NE2000, AND WHAT "TESTING AN ETHERNET CARD" MEANS WITH NO NETWORK.
//
// There is nothing to connect to, so the claim under test is not "it talks to
// the internet" — it is that the REGISTER FILE and the RING behave the way a
// driver written from the datasheet expects. Every test here drives the chip
// the way a driver does: through the command register, remote DMA and the
// ring, never by reaching into its fields.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NE2000, LoopbackLink, HubLink} from '../src/ne2000.js';

const CR = 0x00, PSTART = 0x01, PSTOP = 0x02, BNRY = 0x03, TPSR = 0x04,
    TBCR0 = 0x05, TBCR1 = 0x06, ISR = 0x07, RSAR0 = 0x08, RSAR1 = 0x09,
    RBCR0 = 0x0a, RBCR1 = 0x0b, RCR = 0x0c, TCR = 0x0d, DCR = 0x0e, IMR = 0x0f;
const CURR = 0x07, PAR0 = 0x01;
const DATA = 0x10;

/** Bring a card up the way a driver does, and leave it started. */
function boot (card, {mac = null, rcr = 0x04} = {}) {
    card.write(CR, 0x21);                 // page 0, stop, abort DMA
    card.write(DCR, 0x49);                // word mode, loopback off
    card.write(RBCR0, 0); card.write(RBCR1, 0);
    card.write(RCR, rcr);
    card.write(TCR, 0x02);                // internal loopback while we set up
    card.write(PSTART, 0x46);
    card.write(PSTOP, 0x80);
    card.write(BNRY, 0x46);
    card.write(ISR, 0xff);
    card.write(IMR, 0x0b);                // PRX | PTX | RXE
    card.write(CR, 0x61);                 // page 1
    if (mac) for (let i = 0; i < 6; i++) card.write(PAR0 + i, mac[i]);
    card.write(CURR, 0x47);
    card.write(CR, 0x21);                 // back to page 0, still stopped
    card.write(TCR, 0x00);                // normal operation
    card.write(CR, 0x22);                 // START
    return card;
}

/** Push a frame into the card's buffer through remote DMA, as a driver does. */
function loadTx (card, frame, page = 0x40) {
    // 0x22, NOT 0x21. Both abort a remote DMA, but 0x21 carries CR_STOP and
    // 0x22 carries CR_START -- so the tidy-looking one takes the NIC off the
    // wire. A driver stops the chip during initialisation and never again;
    // the first version of this helper stopped it before every access, and
    // the card silently went deaf between frames.
    card.write(CR, 0x22);
    card.write(RSAR0, 0); card.write(RSAR1, page);
    card.write(RBCR0, frame.length & 0xff);
    card.write(RBCR1, (frame.length >> 8) & 0xff);
    card.write(CR, 0x12);                 // remote WRITE, start
    for (const b of frame) card.write(DATA, b);
    card.write(TPSR, page);
    card.write(TBCR0, frame.length & 0xff);
    card.write(TBCR1, (frame.length >> 8) & 0xff);
}

/**
 * Read one frame out of the receive ring, header and all, as a driver does.
 *
 * PSTART AND PSTOP ARE PASSED IN, NOT READ BACK, and that is the datasheet
 * rather than a shortcut: on page 0 those registers are WRITE-ONLY -- reading
 * register 1 gives CLDA0, not the ring bottom. A real driver keeps its own
 * copy of the ring bounds, and the first version of this helper read them
 * back, got zero, and computed a negative frame length.
 */
function readRx (card, pstart = 0x46, pstop = 0x80) {
    card.write(CR, 0x61);
    const curr = card.read(CURR);
    card.write(CR, 0x22);                             // page 0, still STARTED
    const bnry = card.read(BNRY);
    const page = (bnry + 1) >= pstop ? pstart : bnry + 1;
    if (page === curr) return null;                   // ring empty
    card.write(RSAR0, 0); card.write(RSAR1, page);
    card.write(RBCR0, 4); card.write(RBCR1, 0);
    card.write(CR, 0x0a);                             // remote READ, start
    const status = card.read(DATA), next = card.read(DATA);
    const lo = card.read(DATA), hi = card.read(DATA);
    const total = lo | (hi << 8);
    const len = total - 4;
    card.write(RSAR0, 4); card.write(RSAR1, page);
    card.write(RBCR0, len & 0xff); card.write(RBCR1, (len >> 8) & 0xff);
    card.write(CR, 0x0a);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = card.read(DATA);
    card.write(BNRY, next === pstart ? pstop - 1 : next - 1);
    return {status, next, len, frame: out};
}

const MAC_A = [0x02, 0x00, 0x00, 0x00, 0x00, 0x0a];
const MAC_B = [0x02, 0x00, 0x00, 0x00, 0x00, 0x0b];
const mkFrame = (dst, src, payload) =>
    Uint8Array.from([...dst, ...src, 0x08, 0x00, ...payload]);

test('the card comes up STOPPED, because the datasheet says so', () => {
    // A driver's first job is to stop the NIC and configure it. A model that
    // came up running would let a driver that forgets appear to work here and
    // fail on hardware.
    const c = new NE2000();
    assert.equal(c.read(CR) & 0x01, 0x01, 'CR_STOP is set at reset');
    assert.equal(c.read(ISR) & 0x80, 0x80, 'and the reset bit is in ISR');
});

test('the PROM identifies a 16-bit card, with each MAC octet doubled', () => {
    // How a driver tells an NE2000 from an NE1000: read 32 bytes from address
    // 0 and look for 'WW' at 28-29. The doubling is the 8-bit read of a
    // 16-bit PROM, and a driver takes every other byte to get the MAC.
    const c = new NE2000({mac: MAC_A});
    c.write(CR, 0x21);
    c.write(RSAR0, 0); c.write(RSAR1, 0);
    c.write(RBCR0, 32); c.write(RBCR1, 0);
    c.write(CR, 0x0a);
    const prom = [];
    for (let i = 0; i < 32; i++) prom.push(c.read(DATA));
    assert.deepEqual(prom.slice(0, 12).filter((_, i) => i % 2 === 0), MAC_A);
    assert.equal(prom[28], 0x57);
    assert.equal(prom[29], 0x57, "'WW' is what marks it 16-bit");
});

test('remote DMA is the only path to the buffer, and RDC says when it is done', () => {
    const c = new NE2000();
    c.write(CR, 0x21);
    c.write(DCR, 0x48);                  // BYTE mode, so one byte per access
    c.write(RSAR0, 0x00); c.write(RSAR1, 0x40);
    c.write(RBCR0, 4); c.write(RBCR1, 0);
    c.write(CR, 0x12);
    for (const b of [0xde, 0xad, 0xbe, 0xef]) c.write(DATA, b);
    assert.equal(c.read(ISR) & 0x40, 0x40, 'RDC is raised when the count hits zero');
    c.write(ISR, 0xff);
    c.write(RSAR0, 0x00); c.write(RSAR1, 0x40);
    c.write(RBCR0, 4); c.write(RBCR1, 0);
    c.write(CR, 0x0a);
    assert.deepEqual([c.read(DATA), c.read(DATA), c.read(DATA), c.read(DATA)],
        [0xde, 0xad, 0xbe, 0xef], 'what went in comes back out');
});

test('ISR is write-1-to-CLEAR, not a store', () => {
    // The bug this guards is a driver acknowledging one interrupt and
    // silently clearing every other pending bit -- or worse, setting bits by
    // writing the state it wanted to keep.
    const c = new NE2000();
    c.write(CR, 0x21);
    c.write(RBCR0, 1); c.write(RBCR1, 0);
    c.write(CR, 0x12);
    c.write(DATA, 0);                    // raises RDC
    const before = c.read(ISR);
    assert.ok(before & 0x40);
    c.write(ISR, 0x40);                  // acknowledge RDC only
    assert.equal(c.read(ISR) & 0x40, 0, 'the bit written is cleared');
    assert.equal(c.read(ISR) & 0x80, before & 0x80, 'and the others are untouched');
});

test('a frame goes out and comes back on a loopback link', () => {
    const c = boot(new NE2000({mac: MAC_A, link: new LoopbackLink()}), {mac: MAC_A});
    const frame = mkFrame(MAC_A, MAC_A, [1, 2, 3, 4]);
    loadTx(c, frame);
    c.write(CR, 0x26);                   // START | TXP
    assert.equal(c.read(ISR) & 0x02, 0x02, 'PTX: the transmit finished');
    const rx = readRx(c);
    assert.ok(rx, 'and it arrived in the ring');
    assert.equal(rx.status & 0x01, 0x01, 'marked received-OK');
    // The wire pads to 60 bytes, so the frame comes back longer than it went.
    assert.ok(rx.len >= 60, `padded to the minimum (${rx.len})`);
    assert.deepEqual(Array.from(rx.frame.slice(0, 14)), Array.from(frame.slice(0, 14)));
});

test('TWO MACHINES ON ONE WIRE — the whole point of the chip', () => {
    const hub = new HubLink();
    const a = boot(hub.attach(new NE2000({mac: MAC_A})), {mac: MAC_A});
    const b = boot(hub.attach(new NE2000({mac: MAC_B})), {mac: MAC_B});
    loadTx(a, mkFrame(MAC_B, MAC_A, [0xaa, 0xbb]));
    a.write(CR, 0x26);
    const got = readRx(b);
    assert.ok(got, 'B received the frame A sent');
    assert.deepEqual(Array.from(got.frame.slice(0, 6)), MAC_B, 'addressed to B');
    assert.deepEqual(Array.from(got.frame.slice(6, 12)), MAC_A, 'from A');
    assert.equal(readRx(a), null, 'and A did not hear its own transmission');
});

test('the MAC filter is what makes a frame yours', () => {
    // A hub is a REPEATER: everyone hears everything and the card decides.
    // If this ever passes without the filter, the lesson is gone.
    const hub = new HubLink();
    const a = boot(hub.attach(new NE2000({mac: MAC_A})), {mac: MAC_A});
    const b = boot(hub.attach(new NE2000({mac: MAC_B})), {mac: MAC_B});
    loadTx(a, mkFrame([0x02, 0, 0, 0, 0, 0xcc], MAC_A, [1]));
    a.write(CR, 0x26);
    assert.equal(readRx(b), null, 'not addressed to B, so B ignored it');

    loadTx(a, mkFrame([0xff, 0xff, 0xff, 0xff, 0xff, 0xff], MAC_A, [2]));
    a.write(CR, 0x26);
    assert.ok(readRx(b), 'broadcast IS accepted, because RCR_AB is set');
});

test('promiscuous mode hears everything, which is what a sniffer is', () => {
    const hub = new HubLink();
    const a = boot(hub.attach(new NE2000({mac: MAC_A})), {mac: MAC_A});
    const b = boot(hub.attach(new NE2000({mac: MAC_B})), {mac: MAC_B}, );
    b.write(CR, 0x21);
    b.write(RCR, 0x14);                  // PRO | AB
    b.write(CR, 0x22);
    loadTx(a, mkFrame([0x02, 0, 0, 0, 0, 0xcc], MAC_A, [3]));
    a.write(CR, 0x26);
    assert.ok(readRx(b), 'B heard a frame addressed to nobody it knows');
});

test('the ring FILLS rather than overwrites, and says so', () => {
    // THE FAILURE THIS FORBIDS: overwriting a frame the host has not read
    // produces a corruption a driver cannot diagnose. A full ring must drop
    // and set OVW, which a driver can see.
    const hub = new HubLink();
    const a = boot(hub.attach(new NE2000({mac: MAC_A})), {mac: MAC_A});
    const b = boot(hub.attach(new NE2000({mac: MAC_B})), {mac: MAC_B});
    const big = mkFrame(MAC_B, MAC_A, new Array(1000).fill(0x5a));
    let sent = 0;
    for (let i = 0; i < 100; i++) {
        loadTx(a, big);
        a.write(CR, 0x26);
        sent++;
        if (b.read(ISR) & 0x10) break;   // OVW
    }
    assert.ok(b.read(ISR) & 0x10, `the ring reported overflow after ${sent} frames`);
    // And the frames already in it are still readable — nothing was clobbered.
    const first = readRx(b);
    assert.ok(first);
    assert.equal(first.frame[14], 0x5a, 'the first frame survived the overflow');
});

test('a STOPPED card receives nothing', () => {
    const hub = new HubLink();
    const a = boot(hub.attach(new NE2000({mac: MAC_A})), {mac: MAC_A});
    const b = boot(hub.attach(new NE2000({mac: MAC_B})), {mac: MAC_B});
    b.write(CR, 0x21);                   // STOP
    loadTx(a, mkFrame(MAC_B, MAC_A, [9]));
    a.write(CR, 0x26);
    assert.equal(readRx(b), null, 'a stopped NIC is deaf, as the datasheet says');
});

test('the interrupt line follows ISR & IMR, both ways', () => {
    let level = null;
    const c = boot(new NE2000({mac: MAC_A, link: new LoopbackLink(),
        onIRQ: (l) => { level = l; }}), {mac: MAC_A});
    loadTx(c, mkFrame(MAC_A, MAC_A, [1]));
    c.write(CR, 0x26);
    assert.equal(level, 1, 'a received frame raises IRQ, because PRX is unmasked');
    c.write(ISR, 0xff);
    assert.equal(level, 0, 'and acknowledging it drops the line');
});
