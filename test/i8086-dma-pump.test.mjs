// The DMA transfer pump wired into the machine: the 64K page wrap seen through
// the real memory decode (_read/_write), and the terminal-count chaining that
// must reach the FDC's TC pin WITHOUT dropping the UI's onDmaComplete forward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';

function dmaMachine(extraChips = []) {
    return new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0xfffff }],
        chips: [
            { kind: 'dma', name: 'dma1', at: 0x00 },
            { kind: 'dmapage', name: 'pg', dma: 'dma1', at: 0x80 },
            ...extraChips,
        ],
    });
}

test('a DMA transfer wraps at 64K to the page bottom and CLOBBERS it — not the next page', () => {
    const m = dmaMachine();
    const dma = m.chips.dma1;
    // Channel 0: WRITE (device->memory), BLOCK mode (so one transfer() moves
    // the whole straddle; SINGLE mode self-caps to one byte), increment,
    // address 0xFFFE, count 3 (= 4 bytes), page 1 (physical base 0x10000).
    m._out(0x0c, 0);              // clear the byte-pointer flip-flop
    m._out(0x0b, 0x84);          // ch0, write, block, increment
    m._out(0x00, 0xfe); m._out(0x00, 0xff);   // address 0xFFFE
    m._out(0x01, 0x03); m._out(0x01, 0x00);   // count 3 -> 4 bytes
    m._out(0x87, 0x01);          // ch0 page = 1 (XT scramble: 87h = channel 0)
    m._out(0x0a, 0x00);          // unmask channel 0

    // Prove the wrap CLOBBERS: pre-fill the page bottom with a sentinel.
    m._write(0x10000, 0xee); m._write(0x10001, 0xee);
    dma.dreq(0, true);
    const src = [0x11, 0x22, 0x33, 0x44];
    let i = 0;
    dma.transfer(
        (a) => (a === null ? src[i++] : m._read(a)),
        (a, b) => { if (a !== null) m._write(a, b); },
        4);

    // 0xFFFE, 0xFFFF took A,B; then the 16-bit counter rolled FFFF->0000 IN
    // THE SAME PAGE and C,D landed on top of the sentinels.
    assert.equal(m._read(0x1fffe), 0x11);
    assert.equal(m._read(0x1ffff), 0x22);
    assert.equal(m._read(0x10000), 0x33, 'wrapped to the page bottom and clobbered the sentinel');
    assert.equal(m._read(0x10001), 0x44, 'and the byte after it');
    assert.equal(m._read(0x20000), 0x00, 'it did NOT carry into the next page');
});

test('a DMA write into a ROM window is DISCARDED, exactly as a CPU write is', () => {
    // The bypass this replaced would have let a bad page register overwrite a
    // ROM image in mem[]; the faithful _write path drops it as a ROM does.
    const m = new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0x0ffff }, { kind: 'rom', start: 0xf0000, end: 0xfffff }],
        chips: [{ kind: 'dma', name: 'dma1', at: 0x00 }, { kind: 'dmapage', name: 'pg', dma: 'dma1', at: 0x80 }],
    });
    m.mem[0xf0000] = 0xbb; m.mem[0xf0001] = 0xbb;   // the ROM image, as if loaded
    const dma = m.chips.dma1;
    m._out(0x0c, 0); m._out(0x0b, 0x84);          // ch0, write, block
    m._out(0x00, 0x00); m._out(0x00, 0x00);       // address 0x0000
    m._out(0x01, 0x01); m._out(0x01, 0x00);       // count 1 -> 2 bytes
    m._out(0x87, 0x0f);                            // ch0 page = 0xF -> physical F0000 (ROM)
    m._out(0x0a, 0x00);
    dma.dreq(0, true);
    dma.transfer((a) => (a === null ? 0x55 : m._read(a)), (a, b) => { if (a !== null) m._write(a, b); }, 2);
    assert.equal(m._read(0xf0000), 0xbb, 'the ROM image survived — a bad page register cannot corrupt the BIOS');
    assert.equal(m._read(0xf0001), 0xbb);
});

test('terminal count reaches the FDC TC pin AND still forwards onDmaComplete', () => {
    const done = [];
    const m = new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0xfffff }],
        chips: [
            { kind: 'dma', name: 'dma1', at: 0x00 },
            { kind: 'dmapage', name: 'pg', dma: 'dma1', at: 0x80 },
            { kind: 'fdc', name: 'fdc1', at: 0x3f0, dma: 'dma1', irq: 6 },
        ],
    }, { onDmaComplete: (name, ch) => done.push([name, ch]) });

    // Spy the FDC's TC pin — the chained hook must still reach it.
    let tc = 0;
    const realTC = m.chips.fdc1.terminalCount.bind(m.chips.fdc1);
    m.chips.fdc1.terminalCount = () => { tc++; return realTC(); };
    // The pump wired the FDC's DMA request too.
    assert.equal(typeof m.chips.fdc1.hooks.onDmaRequest, 'function', 'the FDC DMA request is wired');

    // Program channel 2, block, write, count 1 (2 bytes), and run it to TC.
    const dma = m.chips.dma1;
    m._out(0x0c, 0); m._out(0x0b, 0x86);          // ch2, write, block
    m._out(0x04, 0x00); m._out(0x04, 0x00);       // ch2 address 0x0000
    m._out(0x05, 0x01); m._out(0x05, 0x00);       // ch2 count 1 -> 2 bytes
    m._out(0x81, 0x02);                            // ch2 page = 2 (XT scramble: 81h = channel 2)
    m._out(0x0a, 0x02);                            // unmask channel 2 (bit1=1 -> channel 2? mask reg: bits0-1=ch)
    dma.dreq(2, true);
    dma.transfer((a) => (a === null ? 0xa5 : m._read(a)), (a, b) => { if (a !== null) m._write(a, b); }, 2);

    assert.ok(tc >= 1, 'the FDC terminalCount() pin fired on TC');
    assert.deepEqual(done.at(-1), ['dma1', 2], 'and onDmaComplete still forwarded — chained, not replaced');
});
