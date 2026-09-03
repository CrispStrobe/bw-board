import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8237 } from '../src/i8237.js';

// XT port numbers, spelled out so the tests read like a driver does.
const P_ADDR = [0x00, 0x02, 0x04, 0x06];
const P_COUNT = [0x01, 0x03, 0x05, 0x07];
const P_STATUS = 0x08;
const P_COMMAND = 0x08;
const P_REQUEST = 0x09;
const P_MASK1 = 0x0a;
const P_MODE = 0x0b;
const P_CLEARFF = 0x0c;
const P_MASTERCLEAR = 0x0d;
const P_CLEARMASK = 0x0e;
const P_ALLMASK = 0x0f;
const P_PAGE = [0x87, 0x83, 0x81, 0x82];   // channel 0,1,2,3 -- deliberately scrambled

/** Mode byte: 8237 mode register field packing. */
function modeByte(ch, { type, autoinit = false, decrement = false, mode }) {
    return (ch & 3) | ((type & 3) << 2) | (autoinit ? 0x10 : 0) |
        (decrement ? 0x20 : 0) | ((mode & 3) << 6);
}
const VERIFY = 0, TO_MEMORY = 1, FROM_MEMORY = 2;
const DEMAND = 0, SINGLE = 1, BLOCK = 2, CASCADE = 3;

/** Program one channel the way a floppy driver does, 0Ch first. */
function program(d, ch, { page, addr, count, mode }) {
    d.write(P_MASK1, 0x04 | ch);        // mask while programming
    d.write(P_CLEARFF, 0);
    d.write(P_ADDR[ch], addr & 0xff);
    d.write(P_ADDR[ch], (addr >> 8) & 0xff);
    d.write(P_CLEARFF, 0);
    d.write(P_COUNT[ch], count & 0xff);
    d.write(P_COUNT[ch], (count >> 8) & 0xff);
    d.writePage(P_PAGE[ch], page);
    d.write(P_MODE, mode);
    d.write(P_MASK1, ch);               // unmask
}

/** A 1 MB memory and the two callbacks transfer() wants. */
function bus() {
    const mem = new Uint8Array(1 << 20);
    const fromDevice = [];
    const toDevice = [];
    return {
        mem, fromDevice, toDevice,
        readByte: (addr) => (addr === null ? (fromDevice.shift() ?? 0xff) : mem[addr]),
        writeByte: (addr, b) => { if (addr === null) toDevice.push(b); else mem[addr] = b; },
    };
}

// ------------------------------------------------------------ flip-flop

test('one first/last flip-flop turns two byte writes into one 16-bit register', () => {
    const d = new I8237();
    d.write(P_CLEARFF, 0);
    d.write(P_ADDR[2], 0x34);
    d.write(P_ADDR[2], 0x12);
    assert.equal(d.channels[2].curAddr, 0x1234,
        'low byte then high byte assemble into the current address');
    assert.equal(d.channels[2].baseAddr, 0x1234,
        'base and current load together on every byte write');

    d.write(P_CLEARFF, 0);
    d.write(P_COUNT[2], 0xff);
    d.write(P_COUNT[2], 0x01);
    assert.equal(d.channels[2].curCount, 0x01ff,
        'the same flip-flop sequences the word count register');
});

test('the flip-flop is shared by the whole chip, not one per register', () => {
    const d = new I8237();
    d.write(P_CLEARFF, 0);
    d.write(P_ADDR[0], 0xaa);          // low half of channel 0 address; ff now high
    d.write(P_COUNT[3], 0xbb);         // lands in the HIGH half of channel 3 count
    assert.equal(d.channels[3].curCount, 0xbb00,
        'a write to a different register still sees the flipped flip-flop');
});

test('reading port 0Ch resets the flip-flop in the middle of a sequence', () => {
    const d = new I8237();
    d.write(P_CLEARFF, 0);
    d.write(P_ADDR[2], 0x34);          // low half in; the chip now expects the high half
    d.read(P_CLEARFF);                 // resynchronise
    d.write(P_ADDR[2], 0x78);          // must land in the LOW half again
    assert.equal(d.channels[2].curAddr, 0x0078,
        'after a read of 0Ch the next byte is the low half, not the high half');
});

test('reads of a 16-bit register are sequenced by the flip-flop too', () => {
    const d = new I8237();
    d.write(P_CLEARFF, 0);
    d.write(P_ADDR[1], 0xcd);
    d.write(P_ADDR[1], 0xab);
    d.write(P_CLEARFF, 0);
    assert.equal(d.read(P_ADDR[1]), 0xcd, 'first read returns the low half');
    assert.equal(d.read(P_ADDR[1]), 0xab, 'second read returns the high half');
});

// ------------------------------------------------------- page registers

test('the page register supplies address bits 16-19 from a separate latch', () => {
    const b = bus();
    const d = new I8237();
    b.fromDevice.push(0xde, 0xad, 0xbe, 0xef);

    program(d, 2, {
        page: 0x0a, addr: 0x1000, count: 3,      // count is N-1: four bytes
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    d.dreq(2, true);
    const moved = d.transfer(b.readByte, b.writeByte);

    assert.equal(moved, 4, 'a word count of 3 moves four bytes');
    assert.deepEqual(Array.from(b.mem.subarray(0xa1000, 0xa1004)), [0xde, 0xad, 0xbe, 0xef],
        'bytes land at page<<16 | address, i.e. 0A1000h');
    assert.equal(b.mem[0x01000], 0,
        'nothing was written at the 8237 address with the page ignored');
});

test('the XT page ports decode to the scrambled channel order', () => {
    const d = new I8237();
    d.writePage(0x87, 0x01);
    d.writePage(0x83, 0x02);
    d.writePage(0x81, 0x03);
    d.writePage(0x82, 0x04);
    assert.equal(d.channels[0].page, 0x01, '87h is channel 0');
    assert.equal(d.channels[1].page, 0x02, '83h is channel 1');
    assert.equal(d.channels[2].page, 0x03, '81h is channel 2');
    assert.equal(d.channels[3].page, 0x04, '82h is channel 3');
    d.writePage(0x80, 0x5a);
    assert.equal(d.readPage(0x80), 0x5a, '80h is a scratch latch, not a channel page');
    assert.equal(d.channels[0].page, 0x01, 'writing 80h did not disturb any channel');
});

// --------------------------------------------------- the 64K DMA boundary

test('a transfer crossing a 64K boundary WRAPS inside the page, it does not carry', () => {
    const b = bus();
    const d = new I8237();
    b.fromDevice.push(0x11, 0x22, 0x33, 0x44);

    program(d, 2, {
        page: 0x0a, addr: 0xfffe, count: 3,      // four bytes starting two from the top
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    d.dreq(2, true);
    d.transfer(b.readByte, b.writeByte);

    assert.equal(b.mem[0x0afffe], 0x11, 'first byte at 0AFFFEh');
    assert.equal(b.mem[0x0affff], 0x22, 'second byte at 0AFFFFh');
    assert.equal(b.mem[0x0a0000], 0x33,
        'third byte wrapped to the BOTTOM of the same 64K page (0A0000h)');
    assert.equal(b.mem[0x0a0001], 0x44,
        'fourth byte continued at 0A0001h');
    assert.equal(b.mem[0x0b0000], 0,
        'the 8237 has no carry into the page latch: nothing reached 0B0000h');
    assert.equal(b.mem[0x0b0001], 0,
        'nothing reached 0B0001h either -- this is the DMA boundary bug drivers work around');
    assert.equal(d.channels[2].page, 0x0a, 'the page register itself never changed');
});

test('a decrementing transfer wraps downward inside the page as well', () => {
    const b = bus();
    const d = new I8237();
    b.fromDevice.push(0x11, 0x22, 0x33);

    program(d, 1, {
        page: 0x03, addr: 0x0001, count: 2,
        mode: modeByte(1, { type: TO_MEMORY, decrement: true, mode: BLOCK }),
    });
    d.dreq(1, true);
    d.transfer(b.readByte, b.writeByte);

    assert.equal(b.mem[0x30001], 0x11, 'first byte at 30001h');
    assert.equal(b.mem[0x30000], 0x22, 'second byte at 30000h');
    assert.equal(b.mem[0x3ffff], 0x33,
        'decrementing past zero wrapped to the TOP of the same page, not into page 2');
    assert.equal(b.mem[0x2ffff], 0, 'nothing borrowed into page 2');
});

// ----------------------------------------------------------- directions

test('a memory-to-device transfer reads memory and hands bytes to the device', () => {
    const b = bus();
    const d = new I8237();
    b.mem.set([0x41, 0x42, 0x43], 0x52000);

    program(d, 2, {
        page: 0x05, addr: 0x2000, count: 2,
        mode: modeByte(2, { type: FROM_MEMORY, mode: BLOCK }),
    });
    d.dreq(2, true);
    d.transfer(b.readByte, b.writeByte);

    assert.deepEqual(b.toDevice, [0x41, 0x42, 0x43],
        'a floppy WRITE pulls memory out through the device callback');
});

test('a verify transfer runs the counters but touches neither end', () => {
    const b = bus();
    const d = new I8237();
    let reads = 0, writes = 0;

    program(d, 0, {
        page: 0x00, addr: 0x0100, count: 3,
        mode: modeByte(0, { type: VERIFY, mode: BLOCK }),
    });
    d.dreq(0, true);
    const moved = d.transfer(
        (a) => { reads++; return b.readByte(a); },
        (a, v) => { writes++; b.writeByte(a, v); },
    );

    assert.equal(moved, 4, 'verify still consumes the word count');
    assert.equal(reads, 0, 'verify drives no read cycle');
    assert.equal(writes, 0, 'verify drives no write cycle');
    assert.equal(d.channels[0].curAddr, 0x0104, 'the address counter advanced anyway');
});

// ------------------------------------------------------- masks / requests

test('a masked channel does not transfer however hard the device asks', () => {
    const b = bus();
    const d = new I8237();
    b.fromDevice.push(0xaa, 0xbb);

    program(d, 2, {
        page: 0x0a, addr: 0x1000, count: 1,
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    d.write(P_MASK1, 0x04 | 2);          // mask channel 2 again
    d.dreq(2, true);

    assert.equal(d.hrq, false, 'a masked DREQ does not raise HRQ');
    assert.equal(d.transfer(b.readByte, b.writeByte), 0, 'no bytes move');
    assert.equal(b.mem[0x0a1000], 0, 'memory is untouched');

    d.write(P_MASK1, 2);                 // unmask
    assert.equal(d.hrq, true, 'unmasking with DREQ still asserted raises HRQ');
    assert.equal(d.transfer(b.readByte, b.writeByte), 2, 'now it runs');
});

test('master clear sets the mask register, clear-mask clears it', () => {
    const d = new I8237();
    d.write(P_MASTERCLEAR, 0);
    assert.deepEqual(d.channels.map((c) => c.masked), [true, true, true, true],
        'a reset controller ignores every DREQ until software unmasks');
    d.write(P_CLEARMASK, 0);
    assert.deepEqual(d.channels.map((c) => c.masked), [false, false, false, false],
        'clear mask register unmasks all four at once');
    d.write(P_ALLMASK, 0x05);
    assert.deepEqual(d.channels.map((c) => c.masked), [true, false, true, false],
        'write-all-mask sets one bit per channel');
});

test('master clear also clears the flip-flop and the command register', () => {
    const d = new I8237();
    d.write(P_COMMAND, 0x04);
    d.write(P_ADDR[0], 0x11);           // leaves the flip-flop expecting a high byte
    d.write(P_MASTERCLEAR, 0);
    assert.equal(d.command, 0, 'command register cleared');
    d.write(P_ADDR[0], 0x22);
    assert.equal(d.channels[0].curAddr, 0x0022,
        'the next address byte after a master clear is the low half');
});

test('the controller-disable command bit stops every channel', () => {
    const b = bus();
    const d = new I8237();
    b.fromDevice.push(0x99, 0x99);
    program(d, 2, {
        page: 0, addr: 0x0400, count: 1,
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    d.write(P_COMMAND, 0x04);
    d.dreq(2, true);
    assert.equal(d.transfer(b.readByte, b.writeByte), 0,
        'command bit 2 disables the whole controller');
});

// ------------------------------------------------------- status / TC

test('terminal count sets its status bit and reading the status clears it', () => {
    const b = bus();
    const tcs = [];
    const d = new I8237({ onTerminalCount: (ch) => tcs.push(ch) });
    b.fromDevice.push(0x01, 0x02);

    program(d, 2, {
        page: 0x0a, addr: 0x1000, count: 1,
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    d.dreq(2, true);
    d.transfer(b.readByte, b.writeByte);

    assert.deepEqual(tcs, [2], 'the EOP hook fired once, for channel 2');

    const s1 = d.read(P_STATUS);
    assert.equal(s1 & 0x04, 0x04, 'status bit 2 records terminal count on channel 2');
    const s2 = d.read(P_STATUS);
    assert.equal(s2 & 0x0f, 0,
        'the TC bits are cleared by the act of reading them -- the second read sees nothing');
});

test('status bits 4-7 report which channels are asking for the bus', () => {
    const d = new I8237();
    d.write(P_CLEARMASK, 0);
    d.dreq(1, true);
    d.dreq(3, true);
    const s = d.read(P_STATUS);
    assert.equal(s & 0xf0, 0x20 | 0x80, 'DREQ pending on channels 1 and 3');
});

test('terminal count masks a non-autoinit channel so it stops asking', () => {
    const b = bus();
    const d = new I8237();
    b.fromDevice.push(0x01, 0x02, 0x03);

    program(d, 2, {
        page: 0, addr: 0x0800, count: 1,
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    d.dreq(2, true);
    d.transfer(b.readByte, b.writeByte);

    assert.equal(d.channels[2].masked, true,
        'without autoinit, terminal count sets the mask bit');
    assert.equal(d.transfer(b.readByte, b.writeByte), 0,
        'a still-asserted DREQ moves nothing once TC has masked the channel');
    assert.equal(b.mem[0x0802], 0, 'the third byte never left the device');
});

test('autoinit reloads address and count at terminal count and stays unmasked', () => {
    const b = bus();
    const d = new I8237();
    for (let i = 0; i < 6; i++) b.fromDevice.push(0x10 + i);

    program(d, 2, {
        page: 0x02, addr: 0x0300, count: 1,
        mode: modeByte(2, { type: TO_MEMORY, autoinit: true, mode: BLOCK }),
    });
    d.dreq(2, true);
    d.transfer(b.readByte, b.writeByte);

    assert.equal(d.channels[2].masked, false,
        'autoinit does not mask -- that is how the refresh channel runs forever');
    assert.equal(d.channels[2].curAddr, 0x0300, 'current address reloaded from base');
    assert.equal(d.channels[2].curCount, 0x0001, 'current count reloaded from base');

    d.transfer(b.readByte, b.writeByte);
    assert.deepEqual(Array.from(b.mem.subarray(0x20300, 0x20302)), [0x12, 0x13],
        'the second pass overwrote the first at the same reloaded address');
});

// ------------------------------------------------------------- modes

test('single mode releases the bus after each byte', () => {
    const b = bus();
    const d = new I8237();
    b.fromDevice.push(0xa0, 0xa1, 0xa2, 0xa3);

    program(d, 2, {
        page: 0, addr: 0x0900, count: 3,
        mode: modeByte(2, { type: TO_MEMORY, mode: SINGLE }),
    });
    d.dreq(2, true);
    assert.equal(d.transfer(b.readByte, b.writeByte), 1, 'one byte per call');
    assert.equal(d.transfer(b.readByte, b.writeByte), 1, 'one byte per call');
    assert.deepEqual(Array.from(b.mem.subarray(0x0900, 0x0904)), [0xa0, 0xa1, 0, 0],
        'only the two requested bytes moved');
});

test('demand mode runs while DREQ is held and stops when the device drops it', () => {
    const b = bus();
    const d = new I8237();
    for (let i = 0; i < 8; i++) b.fromDevice.push(0xb0 + i);

    program(d, 2, {
        page: 0, addr: 0x0a00, count: 7,
        mode: modeByte(2, { type: TO_MEMORY, mode: DEMAND }),
    });
    d.dreq(2, true);
    // Drop DREQ after the third byte, the way a FIFO going empty would.
    let n = 0;
    const readByte = (addr) => { if (++n === 3) d.dreq(2, false); return b.readByte(addr); };
    const moved = d.transfer(readByte, b.writeByte);
    assert.equal(moved, 3, 'demand mode stopped the cycle after DREQ went away');
    assert.equal(d.channels[2].curCount, 0x0004, 'the count kept its place for the resume');

    d.dreq(2, true);
    assert.equal(d.transfer(b.readByte, b.writeByte), 5,
        'reasserting DREQ resumes from where it stopped and runs to terminal count');
});

test('the limit argument meters a block transfer', () => {
    const b = bus();
    const d = new I8237();
    for (let i = 0; i < 64; i++) b.fromDevice.push(i);

    program(d, 2, {
        page: 0, addr: 0x0b00, count: 63,
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    d.dreq(2, true);
    assert.equal(d.transfer(b.readByte, b.writeByte, 10), 10,
        'block mode honours the caller-supplied byte budget');
    assert.equal(d.channels[2].curCount, 63 - 10, 'and leaves the rest pending');
});

test('a cascade channel requests the bus but never transfers', () => {
    const b = bus();
    const d = new I8237();
    b.fromDevice.push(0xff);

    program(d, 0, {
        page: 0, addr: 0x0c00, count: 3,
        mode: modeByte(0, { type: TO_MEMORY, mode: CASCADE }),
    });
    d.dreq(0, true);
    assert.equal(d.transfer(b.readByte, b.writeByte), 0,
        'there is no downstream controller to cascade to on an XT');
});

// ------------------------------------------------------- priority / hooks

test('priority is fixed with channel 0 highest', () => {
    const b = bus();
    const d = new I8237();
    d.write(P_CLEARMASK, 0);
    for (const ch of [0, 3]) {
        program(d, ch, {
            page: 0, addr: 0x1000 + ch, count: 0,
            mode: modeByte(ch, { type: VERIFY, mode: SINGLE }),
        });
    }
    d.dreq(3, true);
    d.dreq(0, true);
    assert.equal(d.pendingChannel().n, 0, 'channel 0 wins over channel 3');
});

test('the HRQ hook fires when the controller starts and stops wanting the bus', () => {
    const edges = [];
    const b = bus();
    const d = new I8237({ onHrq: (a) => edges.push(a) });
    b.fromDevice.push(0x77);

    program(d, 2, {
        page: 0, addr: 0x0d00, count: 0,
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    assert.equal(d.hrq, false, 'no request yet');
    d.dreq(2, true);
    assert.equal(d.hrq, true, 'DREQ on an unmasked channel raises HRQ');
    d.transfer(b.readByte, b.writeByte);
    assert.equal(d.hrq, false, 'terminal count masked the channel and dropped HRQ');
    assert.deepEqual(edges.slice(-2), [true, false], 'both edges were reported');
});

test('a software request bit drives a transfer without any DREQ', () => {
    const b = bus();
    const d = new I8237();
    b.fromDevice.push(0x5a, 0x5b);

    program(d, 2, {
        page: 0x01, addr: 0x0e00, count: 1,
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    d.write(P_REQUEST, 0x04 | 2);
    assert.equal(d.transfer(b.readByte, b.writeByte), 2,
        'the request register starts a transfer with no device asserting DREQ');
    assert.deepEqual(Array.from(b.mem.subarray(0x10e00, 0x10e02)), [0x5a, 0x5b],
        'and it went to the paged address');
});

// ------------------------------------------------------------- state

test('getState/setState round-trips a mid-transfer controller', () => {
    const b = bus();
    const d = new I8237();
    for (let i = 0; i < 8; i++) b.fromDevice.push(i);
    program(d, 2, {
        page: 0x07, addr: 0x1234, count: 7,
        mode: modeByte(2, { type: TO_MEMORY, mode: BLOCK }),
    });
    d.dreq(2, true);
    d.transfer(b.readByte, b.writeByte, 3);

    const snap = JSON.parse(JSON.stringify(d.getState()));
    const e = new I8237();
    e.setState(snap);
    assert.equal(e.channels[2].curAddr, d.channels[2].curAddr, 'address restored');
    assert.equal(e.channels[2].curCount, d.channels[2].curCount, 'count restored');
    assert.equal(e.channels[2].page, 0x07, 'page latch restored');
    assert.equal(e.channels[2].transferType, d.channels[2].transferType, 'mode restored');
});
