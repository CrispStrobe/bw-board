// The DMA transfer pump, driven through the PRODUCTION path — the FDC's
// onDmaRequest hook — and NEVER by a dreq() the test supplies itself. The
// earlier version of this file called dma.dreq(n, true) from each test, which
// is the signal the pump is responsible for asserting: the tests passed while
// the pump moved zero bytes and reported success (found in the MS-DOS boot
// differential). A test must ASSERT its precondition, not stand in for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';

function fdcMachine(hooks) {
    return new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0xeffff }, { kind: 'rom', start: 0xf0000, end: 0xfffff }],
        chips: [
            { kind: 'dma', name: 'dma1', at: 0x00 },
            { kind: 'dmapage', name: 'pg', dma: 'dma1', at: 0x80 },
            { kind: 'fdc', name: 'fdc1', at: 0x3f0, dma: 'dma1', irq: 6 },
        ],
    }, hooks);
}

// Program channel 2 (the floppy channel) for a device->memory (WRITE) transfer.
function programCh2(m, addr, page, count) {
    m._out(0x0c, 0);                                   // clear the byte-pointer flip-flop
    m._out(0x0b, 0x46);                               // ch2, write, single, increment
    m._out(0x04, addr & 0xff); m._out(0x04, (addr >> 8) & 0xff);
    m._out(0x05, count & 0xff); m._out(0x05, (count >> 8) & 0xff);
    m._out(0x81, page & 0x0f);                        // ch2 page (XT scramble: 81h = channel 2)
    m._out(0x0a, 0x02);                               // unmask channel 2
}

test('the pump asserts DREQ itself — onDmaRequest moves a byte with NO test dreq', () => {
    const m = fdcMachine();
    programCh2(m, 0x2000, 0x00, 3);
    // Drive the production path. If the pump does not assert DREQ, this moves
    // nothing and the byte never lands — the bug this test now guards.
    const r = m.chips.fdc1.hooks.onDmaRequest('write', 0x5a);
    assert.notEqual(r, false, 'the pump moved the byte (not terminal count)');
    assert.equal(m._read(0x2000), 0x5a, 'the byte landed — the pump asserted DREQ, the test did not');
});

test('a floppy transfer wraps at 64K to the page bottom and CLOBBERS it — through the pump', () => {
    const m = fdcMachine();
    programCh2(m, 0xfffe, 0x01, 3);                   // page 1, addr FFFE, 4 bytes
    m._write(0x10000, 0xee); m._write(0x10001, 0xee); // sentinels at the page bottom
    for (const b of [0x11, 0x22, 0x33, 0x44]) m.chips.fdc1.hooks.onDmaRequest('write', b);
    assert.equal(m._read(0x1fffe), 0x11);
    assert.equal(m._read(0x1ffff), 0x22);
    assert.equal(m._read(0x10000), 0x33, 'wrapped to the page bottom and clobbered the sentinel');
    assert.equal(m._read(0x10001), 0x44);
    assert.equal(m._read(0x20000), 0x00, 'it did NOT carry into the next page');
});

test('a DMA write into a ROM window is DISCARDED — a bad page cannot corrupt the BIOS', () => {
    const m = fdcMachine();
    m.mem[0xf0000] = 0xbb; m.mem[0xf0001] = 0xbb;     // the ROM image, as if loaded
    programCh2(m, 0x0000, 0x0f, 1);                   // page F -> physical F0000 (ROM), 2 bytes
    m.chips.fdc1.hooks.onDmaRequest('write', 0x55);
    m.chips.fdc1.hooks.onDmaRequest('write', 0x55);
    assert.equal(m._read(0xf0000), 0xbb, 'the ROM image survived the DMA write');
    assert.equal(m._read(0xf0001), 0xbb);
});

test('terminal count reaches the FDC TC pin AND still forwards onDmaComplete', () => {
    const done = [];
    const m = fdcMachine({ onDmaComplete: (name, ch) => done.push([name, ch]) });
    let tc = 0;
    const realTC = m.chips.fdc1.terminalCount.bind(m.chips.fdc1);
    m.chips.fdc1.terminalCount = () => { tc++; return realTC(); };

    programCh2(m, 0x3000, 0x00, 1);                   // 2 bytes -> TC on the second
    m.chips.fdc1.hooks.onDmaRequest('write', 0xa5);
    m.chips.fdc1.hooks.onDmaRequest('write', 0xa5);   // this one hits terminal count
    assert.ok(tc >= 1, 'the FDC terminalCount() pin fired on TC');
    assert.deepEqual(done.at(-1), ['dma1', 2], 'and onDmaComplete still forwarded — chained, not replaced');
    assert.equal(m._read(0x3000), 0xa5, 'and the bytes actually moved');
});

test('a DISABLED controller makes the pump report no move — the TC/failure signal', () => {
    // The paranoid BIOS reads 8237 status after a "successful" read to catch
    // exactly this: the controller said done, the transfer never happened. Use
    // the command-register DISABLE bit, NOT the channel mask — a real BIOS
    // unmasks the channel itself while programming, so a mask would be gone by
    // the time the read starts and the test would pass for the wrong reason.
    const m = fdcMachine();
    programCh2(m, 0x5000, 0x00, 3);
    m._out(0x08, 0x04);                               // command register: disable the controller
    const r = m.chips.fdc1.hooks.onDmaRequest('write', 0x33);
    assert.equal(r, false, 'a disabled 8237 moves nothing and the pump says so');
    assert.equal(m._read(0x5000), 0x00, 'and no byte landed');
});

test('a read transfer (memory->device) returns the memory byte through the pump', () => {
    const m = fdcMachine();
    m._write(0x4000, 0x7e);
    // mode for READ (memory->device): ch2, read(10), single -> 0b01001010 = 0x4A
    m._out(0x0c, 0); m._out(0x0b, 0x4a);
    m._out(0x04, 0x00); m._out(0x04, 0x40);           // addr 0x4000
    m._out(0x05, 0x00); m._out(0x05, 0x00);           // count 0 -> 1 byte
    m._out(0x81, 0x00); m._out(0x0a, 0x02);
    const got = m.chips.fdc1.hooks.onDmaRequest('read');
    assert.equal(got, 0x7e, 'the pump read memory and handed the byte to the FDC');
});
