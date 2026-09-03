// The BIOS floppy driver, on a real uPD765 with a real 8237 behind it.
//
// test/bios-rom.test.mjs runs the ROM on a machine with NO disk hardware and
// checks that INT 13h fails in bounded time. This file is the other half: the
// controller and the DMA controller are on the bus, a disk is in the drive,
// and every assertion below is about bytes that actually moved through
// 3F0h-3F7h and channel 2.
//
// WHAT IS BEING TESTED IS THE HANDSHAKE, not the arithmetic. src/upd765.js
// counts every access made at the wrong moment -- a read of 3F5h while the
// chip is listening, a write while it is talking -- in `stats`, and never
// fails one. So a driver that gets the RQM/DIO poll wrong still returns
// plausible answers here, and the only witness is that counter. It is
// asserted at zero after every sequence in this file, and that is the single
// most load-bearing assertion in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { assembleRaw } from '../src/i8086-asm.js';
import { buildBios } from '../scripts/build-bios.mjs';

/**
 * The XT with its disk hardware: 8237 at 00h, its page latch at 80h, the
 * uPD765 at 3F0h on IRQ6.
 *
 * `dma: 'dma1'` ON THE FDC IS THE WIRE, and leaving it out is the easiest
 * way to get a mystery. Without it the machine builds both chips and
 * connects neither, src/upd765.js falls back to non-DMA execution on its
 * own, and the controller raises RQM waiting for a host that never comes.
 */
const XTDISK = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x9ffff },
        { kind: 'ram', start: 0xb8000, end: 0xbffff },
        { kind: 'rom', start: 0xf0000, end: 0xfffff },
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },
        { kind: 'ppi', name: 'ppi1', at: 0x60 },
        { kind: 'dma', name: 'dma1', at: 0x00 },
        { kind: 'dmapage', name: 'page', at: 0x80, dma: 'dma1' },
        { kind: 'fdc', name: 'fdc1', at: 0x3f0, irq: 6, dma: 'dma1' },
        { kind: 'cga', name: 'cga1', at: 0x3d0 },
    ],
});

/** The 360K format the BIOS's diskette parameter table describes. */
const GEOM = { cylinders: 40, heads: 2, sectors: 9, bytesPerSector: 512 };
const SECTORS = GEOM.cylinders * GEOM.heads * GEOM.sectors;   // 720
const IMAGE_BYTES = SECTORS * GEOM.bytesPerSector;            // 368,640

const rom = buildBios();
const BDA = 0x400;
const PROG = 0x0600;

/** LBA of a CHS address, in the order the controller lays a disk out. */
const lba = (c, h, r) => (c * GEOM.heads + h) * GEOM.sectors + (r - 1);

/**
 * An image in which every sector is identifiable. Byte i of sector n is
 * n*31 + i, so a sector read off the wrong track, the wrong head or the
 * wrong side of a DMA wrap is recognisably the WRONG sector rather than
 * merely different.
 */
function testImage() {
    const img = new Uint8Array(IMAGE_BYTES);
    for (let n = 0; n < SECTORS; n++) {
        for (let i = 0; i < 512; i++) img[n * 512 + i] = (n * 31 + i) & 0xff;
    }
    img[510] = 0x55; img[511] = 0xaa;      // sector 0 is a (nonsense) boot sector
    return img;
}
const sectorBytes = (img, c, h, r) =>
    img.subarray(lba(c, h, r) * 512, (lba(c, h, r) + 1) * 512);

/**
 * SHIM -- and it is a shim for a defect in src/i8086-machine.js, not for
 * anything in this lane. See the test immediately below, which pins the
 * defect: the machine's DMA pump calls dma.transfer() without ever asserting
 * the channel's DREQ, and I8237.transfer() serves only a channel that is
 * requesting, so the pump moves zero bytes.
 *
 * The uPD765's call to onDmaRequest IS the DRQ pulse, so translating it into
 * dma.dreq() is what the pump should do. Asserting it here as well is
 * harmless the moment the pump does it itself -- dreq() is idempotent -- so
 * this helper keeps working across the fix and does not have to be removed
 * in a hurry.
 */
function wireDreq(m, { fdc = 'fdc1', dma = 'dma1', channel = 2 } = {}) {
    const chip = m.chips[fdc], ctrl = m.chips[dma];
    const inner = chip.hooks.onDmaRequest;
    assert.equal(typeof inner, 'function',
        `the machine did not wire ${fdc}'s DMA request at all -- the fdc config needs dma: '${dma}'`);
    chip.hooks.onDmaRequest = (dir, byte) => {
        ctrl.dreq(channel, true);
        const r = inner(dir, byte);
        ctrl.dreq(channel, false);
        return r;
    };
    return m;
}

/**
 * A machine that has run POST and is sitting at the top of INT 19h -- the
 * interrupt table written, the BDA initialised, the PIC and PIT programmed,
 * and nothing booted yet. Stopping there rather than letting it boot is what
 * makes the machine reusable for injected programs.
 */
function ready({ image = testImage(), dreq = true, writeProtect = false } = {}) {
    const m = new I8086Machine(XTDISK);
    m.loadRom(rom.bytes);
    if (dreq) wireDreq(m);
    if (image) m.chips.fdc1.insert(0, image, GEOM);
    m.chips.fdc1.setWriteProtect(0, writeProtect);
    m.reset();
    const int19 = rom.symbols.get('int19').value;
    let n = 0;
    while (n < 3_000_000 && !(m.cpu.cs === 0xf000 && m.cpu.ip === int19)) { m.step(); n++; }
    assert.ok(n < 3_000_000, 'POST never reached INT 19h');
    m.image = image;
    return m;
}

/** Run a fragment as an ordinary program, entered with a stack, to its HLT. */
function run(m, source, cap = 3_000_000) {
    const code = assembleRaw(`${source}\n hlt\n`, 0);
    m.mem.set(code, PROG);
    m.cpu.cs = 0; m.cpu.ip = PROG;
    m.cpu.ss = 0; m.cpu.sp = 0x7000;
    m.cpu.ds = 0; m.cpu.es = 0;
    m.cpu.halted = false;
    m.cpu.flags |= 0x0200;
    let n = 0;
    while (n < cap && !m.cpu.halted) { m.step(); n++; }
    assert.ok(m.cpu.halted, `the injected program did not reach its HLT in ${cap} steps`);
    return n;
}

/** AH, AL and CF as the caller sees them, from a fragment that pushes FLAGS. */
const CALL13 = (regs) => ` ${regs}\n int 13h\n pushf\n pop si`;
const result = (m) => ({ ah: m.cpu.ax >> 8, al: m.cpu.ax & 0xff, cf: m.cpu.si & 1 });

/** The one assertion that catches a wrong handshake, which nothing else does. */
function handshakeWasClean(m, what) {
    const s = m.chips.fdc1.stats;
    assert.equal(s.badReads, 0,
        `${what}: ${s.badReads} reads of 3F5h while the controller was NOT driving the bus. `
        + 'Each returned 0FFh and advanced nothing -- the chip does not object, so this counter '
        + 'is the only place it shows.');
    assert.equal(s.badWrites, 0,
        `${what}: ${s.badWrites} writes to 3F5h while the controller was talking. The silicon `
        + 'drops those bytes; the command that comes out wrong is the NEXT one.');
    assert.equal(s.overruns, 0, `${what}: a transfer ran with DOR bit 3 clear, so DRQ never `
        + 'reached the 8237');
    assert.equal(m.chips.fdc1.refusals, 0,
        `${what}: the controller refused a command -- ${m.chips.fdc1.lastRefusal}`);
}

// ---------------------------------------------------------------------------
// The defect this file has to work around, pinned so it is not mistaken for
// something in the BIOS.
// ---------------------------------------------------------------------------

test('MACHINE DEFECT: the DMA pump never asserts DREQ, so it moves nothing', () => {
    // src/i8086-machine.js wires fdc.hooks.onDmaRequest -> dma.transfer(),
    // but I8237.transfer() runs pendingChannel(), and a channel is pending
    // only when `swRequest || (dreqLevel && !masked)`. Nothing sets
    // dreqLevel: the pump never calls dma.dreq(). So transfer() returns 0,
    // the pump returns false, and the uPD765 reads that as terminal count.
    //
    // The result is the WORST shape a disk bug has: READ DATA reports a
    // completely normal termination -- ST0/ST1/ST2 all zero, an interrupt
    // raised, a full result phase -- having moved zero bytes.
    const m = ready({ dreq: false });                  // the machine as it ships
    m.mem.fill(0xee, 0x5000, 0x5200);
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));

    assert.equal(m.chips.dma1.channels[2].curCount, 0x01ff,
        'the 8237 word counter never moved: not one byte was transferred');
    assert.equal(m.mem[0x5001], 0xee, 'and the buffer still holds what was in it');
    // The controller's own result phase says the command went fine. Byte 5
    // is the sector it would do NEXT, and it is still the one it started on
    // -- the single trace in the whole result, and no BIOS reads it.
    assert.equal(m.mem[BDA + 0x42], 0x00, 'ST0 says normal termination');
    assert.equal(m.mem[BDA + 0x42 + 5], 0x01, 'and R never advanced past sector 1');

    // The BIOS catches it anyway, by asking the 8237 whether its terminal
    // count ever fired. Without that check this read returns CF=0, AH=00h.
    const r = result(m);
    assert.equal(r.cf, 1, 'the BIOS refused the transfer');
    assert.equal(r.ah, 0x08, 'AH=08h, DMA overrun: the transfer did not complete');

    // WHEN THIS TEST FAILS, the pump has been fixed. The fix is one line in
    // the pump -- dma.dreq(dmaChannel, true) before transfer() -- and when
    // it lands this test should be replaced by its opposite and wireDreq()
    // above becomes a no-op that can be deleted.
});

// ---------------------------------------------------------------------------
// Reading, which is what boots a machine.
// ---------------------------------------------------------------------------

test('INT 13h AH=02h reads a sector through the controller and the 8237', () => {
    const m = ready();
    m.mem.fill(0xee, 0x5000, 0x5200);
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));

    const r = result(m);
    assert.equal(r.cf, 0, 'CF clear');
    assert.equal(r.ah, 0x00, 'AH = 0');
    assert.equal(r.al, 1, 'AL = the number of sectors transferred');
    assert.equal(m.mem[BDA + 0x41], 0x00, '0040:0041 records the success, not just failures');

    const want = sectorBytes(m.image, 0, 0, 1);
    for (let i = 0; i < 512; i++) {
        assert.equal(m.mem[0x5000 + i], want[i],
            `byte ${i} of cylinder 0 head 0 sector 1 is not what is on the disk`);
    }
    handshakeWasClean(m, 'a single-sector read');
});

test('the seven result bytes are read out, and the controller takes another command', () => {
    // A result phase left half-drained does not break the command that
    // produced it. It breaks the NEXT one, whose first byte is swallowed as
    // the tail of this one -- so the only way to see it is to issue two.
    const m = ready();
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));
    assert.equal(m._in(0x3f4) & 0xd0, 0x80,
        'after the read the main status register shows RQM alone: not busy, not talking, '
        + 'ready for a command');
    assert.deepEqual([...m.mem.subarray(BDA + 0x42, BDA + 0x49)],
        [0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x02],
        'ST0/ST1/ST2 clear, then the address the controller would have done next: '
        + 'cylinder 0, head 0, SECTOR 2, size code 2');

    // ...and now the second one, which is the actual test.
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0002h\n xor dx, dx\n mov bx, 5200h'));
    assert.equal(result(m).cf, 0, 'the second read works, so nothing was left in the FIFO');
    const want = sectorBytes(m.image, 0, 0, 2);
    assert.equal(m.mem[0x5200], want[0]);
    assert.equal(m.mem[0x53ff], want[511]);
    handshakeWasClean(m, 'two reads in succession');
});

test('a multi-sector read crosses from head 0 to head 1 of the same cylinder', () => {
    // The command sets MT, so the controller runs on to the other side of
    // the cylinder by itself. Nine sectors from sector 6 of head 0 lands the
    // last four on head 1 -- and getting the head wrong reads real data off
    // the wrong side, which compares as garbage rather than as zeros.
    const m = ready();
    run(m, CALL13(' mov ax, 0209h\n mov cx, 0006h\n xor dx, dx\n mov bx, 5000h'), 4_000_000);
    assert.equal(result(m).cf, 0, 'nine sectors read');

    const want = [];
    for (let r = 6; r <= 9; r++) want.push(sectorBytes(m.image, 0, 0, r));
    for (let r = 1; r <= 5; r++) want.push(sectorBytes(m.image, 0, 1, r));
    for (let s = 0; s < 9; s++) {
        for (let i = 0; i < 512; i += 97) {
            assert.equal(m.mem[0x5000 + s * 512 + i], want[s][i],
                `sector ${s} of the run, byte ${i}: the multi-track step landed wrong`);
        }
    }
    handshakeWasClean(m, 'a nine-sector multi-track read');
});

test('reading a far cylinder really moves the head, and the driver checks it did', () => {
    const m = ready();
    run(m, CALL13(' mov ax, 0201h\n mov cx, 2503h\n mov dx, 0100h\n mov bx, 5000h'));
    // CH=25h=37, CL=3, DH=1, DL=0
    assert.equal(result(m).cf, 0, 'cylinder 37, head 1, sector 3');
    assert.equal(m.chips.fdc1.drives[0].track, 37,
        'the head is physically at cylinder 37, so a SEEK really was issued');
    const want = sectorBytes(m.image, 37, 1, 3);
    for (let i = 0; i < 512; i += 61) assert.equal(m.mem[0x5000 + i], want[i]);
    handshakeWasClean(m, 'a seek and a read');
});

test('the head is recalibrated ONCE per drive, not before every access', () => {
    // RECALIBRATE steps the head all the way home. Doing it before every
    // read would be correct and unusably slow; not doing it at all leaves
    // the first SEEK relative to a head position the chip is only guessing
    // at. 0040:003E bit 0 is the record that it has been done.
    const m = ready();
    assert.equal(m.mem[BDA + 0x3e] & 1, 0, 'nothing is calibrated after POST');
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0A01h\n xor dx, dx\n mov bx, 5000h'));
    assert.equal(m.mem[BDA + 0x3e] & 1, 1, 'drive 0 is now recalibrated');
    assert.equal(m.chips.fdc1.drives[0].track, 10, 'and the head went where it was told');

    // A second access to a DIFFERENT cylinder must seek, and must not go
    // home again on the way.
    run(m, CALL13(' mov ax, 0201h\n mov cx, 1401h\n xor dx, dx\n mov bx, 5000h'));
    assert.equal(m.chips.fdc1.drives[0].track, 20);
    assert.equal(m.mem[BDA + 0x3e] & 1, 1, 'still calibrated: the flag is not cleared by a read');

    // ...and a reset DOES clear it, because a reset is the one thing that
    // makes the chip's idea of the head position untrustworthy again.
    run(m, ` xor ax, ax\n xor dx, dx\n int 13h`);
    assert.equal(m.chips.fdc1.drives[0].track, 0, 'AH=00h brought the head home');
});

// ---------------------------------------------------------------------------
// The 64K DMA boundary.
// ---------------------------------------------------------------------------

test('a transfer that would straddle a 64K page is refused with AH=09h', () => {
    // ES:BX = 1FE0:0000 is physical 1FE00h: page 1, offset FE00h. Two
    // sectors is 1024 bytes, so the last byte wants offset 101FFh -- 200h
    // past the top of the page.
    const m = ready();
    m.mem.fill(0x5a, 0x10000, 0x10200);          // a sentinel at the page BOTTOM
    m.mem.fill(0xee, 0x1fe00, 0x20000);
    const before = m.chips.dma1.channels[2].baseCount;

    run(m, CALL13(' mov ax, 0202h\n mov cx, 0001h\n xor dx, dx\n'
        + ' mov bx, 1FE0h\n mov es, bx\n xor bx, bx'));

    const r = result(m);
    assert.equal(r.cf, 1, 'CF set');
    assert.equal(r.ah, 0x09, 'AH = 09h, DMA boundary crossed');
    assert.equal(m.mem[BDA + 0x41], 0x09, 'and 0040:0041 says so');

    // Refused BEFORE anything was touched: no channel programmed, no motor
    // started, nothing written anywhere.
    assert.equal(m.chips.dma1.channels[2].baseCount, before,
        'the 8237 was never programmed, so the refusal costs nothing to undo');
    assert.equal(m.mem[0x1fe00], 0xee, 'the destination is untouched');
    for (let i = 0; i < 0x200; i++) {
        assert.equal(m.mem[0x10000 + i], 0x5a,
            `the page bottom is intact at +${i}: nothing wrapped onto it`);
    }
});

test('...and the wrap it refuses is REAL: driven by hand, it clobbers the page bottom', () => {
    // A refusal nobody can show is a refusal of nothing. This programs the
    // 8237 and the controller exactly as the BIOS would have if fd_xfer had
    // not checked -- same channel, same mode, same address, same count --
    // and watches the erratum happen.
    const m = ready();
    m.mem.fill(0x5a, 0x10000, 0x10200);
    const fdc = m.chips.fdc1;

    m._out(0x3f2, 0x1c);                          // DOR: drive 0, motor, /reset, DMA gate
    for (const b of [0x03, 0xdf, 0x02]) m._out(0x3f5, b);      // SPECIFY, ND clear
    m._out(0x0a, 0x06);                           // mask channel 2
    m._out(0x0c, 0x00);                           // clear the flip-flop
    m._out(0x0b, 0x46);                           // write to memory, single, increment
    m._out(0x04, 0x00); m._out(0x04, 0xfe);       // offset FE00h
    m._out(0x81, 0x01);                           // page 1 -> physical 1FE00h
    m._out(0x05, 0xff); m._out(0x05, 0x03);       // count 1023 -> 1024 bytes
    m._out(0x0a, 0x02);                           // unmask
    // READ DATA, cylinder 0 head 0 sector 1, two sectors' worth of count.
    for (const b of [0xe6, 0x00, 0x00, 0x00, 0x01, 0x02, 0x09, 0x2a, 0xff]) m._out(0x3f5, b);
    while ((m._in(0x3f4) & 0xf0) === 0xd0) m._in(0x3f5);        // drain the result phase

    const want = sectorBytes(m.image, 0, 0, 1);
    assert.equal(m.mem[0x1fe00], want[0], 'the first half landed at the top of the page');
    assert.equal(m.mem[0x1ffff], want[511], 'up to the last byte of it');
    // ...and then the 8237's sixteen-bit counter rolled FFFFh -> 0000h in
    // the SAME page, because there is no carry into the page latch.
    const want2 = sectorBytes(m.image, 0, 0, 2);
    assert.equal(m.mem[0x10000], want2[0],
        'the second sector wrapped to the BOTTOM of the same page and overwrote the sentinel');
    assert.equal(m.mem[0x101ff], want2[511], 'all the way to the end of it');
    assert.equal(m.mem[0x20000], 0x00,
        'and it did NOT carry into the next page, which is the whole erratum');
    assert.equal(fdc.stats.badReads + fdc.stats.badWrites, 0);
});

test('a transfer ending exactly ON the last byte of a page is allowed', () => {
    // The boundary check must be `>` and not `>=`: 1FE00h + 512 bytes ends
    // at 1FFFFh, the last byte of page 1, and nothing wraps. Refusing it
    // would make every buffer in the top 512 bytes of a page unusable.
    const m = ready();
    m.mem.fill(0x5a, 0x10000, 0x10200);
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n'
        + ' mov bx, 1FE0h\n mov es, bx\n xor bx, bx'));
    assert.equal(result(m).cf, 0, 'the exact fit is not a boundary crossing');
    const want = sectorBytes(m.image, 0, 0, 1);
    assert.equal(m.mem[0x1fe00], want[0]);
    assert.equal(m.mem[0x1ffff], want[511], 'the last byte of the page is the last byte read');
    assert.equal(m.mem[0x10000], 0x5a, 'and the page bottom was not touched');
});

test('a request larger than a whole page is a boundary error by definition', () => {
    const m = ready();
    run(m, CALL13(' mov ax, 02FFh\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));
    const r = result(m);
    assert.equal(r.cf, 1);
    assert.equal(r.ah, 0x09, '255 sectors is 130,560 bytes and no page is that big');
});

// ---------------------------------------------------------------------------
// Writing, verifying, and the failures.
// ---------------------------------------------------------------------------

test('INT 13h AH=03h writes a sector, and it is there when it is read back', () => {
    const m = ready();
    for (let i = 0; i < 512; i++) m.mem[0x5000 + i] = (i * 3 + 17) & 0xff;
    run(m, CALL13(' mov ax, 0301h\n mov cx, 0205h\n mov dx, 0100h\n mov bx, 5000h'));
    assert.equal(result(m).cf, 0, 'the write reported success');

    // In the image, which is the medium.
    const on = sectorBytes(m.image, 2, 1, 5);
    for (let i = 0; i < 512; i++) {
        assert.equal(on[i], (i * 3 + 17) & 0xff, `byte ${i} did not reach the disk`);
    }
    // ...and back out again through a read, which is the round trip that
    // proves the DMA went the other way for real rather than the write
    // having quietly been a no-op that left the image alone.
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0205h\n mov dx, 0100h\n mov bx, 6000h'));
    assert.equal(result(m).cf, 0);
    for (let i = 0; i < 512; i++) assert.equal(m.mem[0x6000 + i], (i * 3 + 17) & 0xff);
    handshakeWasClean(m, 'a write and a read back');
});

test('a write to a protected disk is refused with AH=03h and changes nothing', () => {
    const m = ready({ writeProtect: true });
    const before = [...sectorBytes(m.image, 0, 0, 3)];
    m.mem.fill(0x99, 0x5000, 0x5200);
    run(m, CALL13(' mov ax, 0301h\n mov cx, 0003h\n xor dx, dx\n mov bx, 5000h'));
    const r = result(m);
    assert.equal(r.cf, 1);
    assert.equal(r.ah, 0x03, 'AH = 03h, write protected -- decoded from ST1 bit 1');
    assert.deepEqual([...sectorBytes(m.image, 0, 0, 3)], before, 'the sector is unchanged');
});

test('INT 13h AH=04h verifies without writing to the buffer at all', () => {
    // The 8237 is put in verify mode: the counters run, no bus cycle is
    // driven, and ES:BX is never touched. The sectors are still read off
    // the disk, so a sector that is not there still fails.
    const m = ready();
    m.mem.fill(0xee, 0x5000, 0x5400);
    run(m, CALL13(' mov ax, 0402h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));
    assert.equal(result(m).cf, 0, 'two sectors verified');
    for (let i = 0; i < 0x400; i++) {
        assert.equal(m.mem[0x5000 + i], 0xee, `the buffer was written at +${i}`);
    }
    handshakeWasClean(m, 'a verify');

    // ...and it is not a rubber stamp: a sector past the end of the track
    // fails the same way a read would.
    run(m, CALL13(' mov ax, 0401h\n mov cx, 000Bh\n xor dx, dx\n mov bx, 5000h'));
    const r = result(m);
    assert.equal(r.cf, 1);
    assert.equal(r.ah, 0x04, 'sector 11 does not exist on a nine-sector track');
});

test('a sector that is not on the track comes back as AH=04h, not as zeros', () => {
    const m = ready();
    m.mem.fill(0xee, 0x5000, 0x5200);
    run(m, CALL13(' mov ax, 0201h\n mov cx, 000Ch\n xor dx, dx\n mov bx, 5000h'));
    const r = result(m);
    assert.equal(r.cf, 1);
    assert.equal(r.ah, 0x04, 'AH = 04h, sector not found -- ST1 bit 2');
    assert.equal(m.mem[0x5000], 0xee, 'and nothing was transferred');
});

test('an empty drive answers AH=80h, which is what invites a retry', () => {
    const m = ready({ image: null });
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));
    const r = result(m);
    assert.equal(r.cf, 1);
    assert.equal(r.ah, 0x80, 'AH = 80h: ST0 said the drive never came ready');
});

test('a second floppy drive that is not there says so instead of pretending', () => {
    const m = ready();
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n mov dx, 0001h\n mov bx, 5000h'));
    const r = result(m);
    assert.equal(r.cf, 1);
    assert.equal(r.ah, 0x80, 'the equipment word declares one drive, and DL=1 is not it');
});

test('a zero sector count is refused rather than being read as 65,536 bytes', () => {
    // AL=0 into the byte-count arithmetic would be 0*512-1 = FFFFh, which
    // the 8237 would happily run as a full 64K transfer.
    const m = ready();
    m.mem.fill(0xee, 0x5000, 0x5200);
    run(m, CALL13(' mov ax, 0200h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));
    const r = result(m);
    assert.equal(r.cf, 1);
    assert.equal(r.ah, 0x01, 'AH = 01h, a request the controller cannot be given');
    assert.equal(m.mem[0x5000], 0xee);
});

test('a request that runs off the end of the cylinder is not a disk error', () => {
    // A uPD765 stops at the last sector of a cylinder. It will not step to
    // the next one, and asked for more it sets ST1 bit 7 (end of cylinder)
    // and terminates abnormally. Twenty sectors from head 1 sector 5 leaves
    // it five short.
    //
    // This is why our boot sector and our IO.SYS both read ONE sector per
    // INT 13h call. It is also the shape a driver bug takes when the DMA
    // byte count and the sector count disagree, which is why the status is
    // "controller failure" and not something that points at the medium.
    const m = ready();
    run(m, CALL13(' mov ax, 0214h\n mov cx, 0005h\n mov dx, 0100h\n mov bx, 5000h'),
        4_000_000);
    const r = result(m);
    assert.equal(r.cf, 1);
    assert.equal(r.ah, 0x20, 'AH = 20h, controller failure');
    assert.equal(m.mem[BDA + 0x43] & 0x80, 0x80,
        'ST1 bit 7 (end of cylinder) is what it was decoded from');
    // The five sectors that WERE on the cylinder still arrived, which is
    // what makes this a partial transfer rather than a refusal.
    const want = sectorBytes(m.image, 0, 1, 5);
    assert.equal(m.mem[0x5000], want[0], 'the sectors that existed were still read');
});

// ---------------------------------------------------------------------------
// The status decode, driven directly.
//
// Two of its branches CANNOT be reached through this controller: src/upd765.js
// computes no CRC, so ST1's data-error bit never sets, and it only ever sets
// the missing-address-mark bit together with ST0's not-ready bit, which is
// caught earlier. A branch nothing can reach is a branch nothing tests, and
// deleting it is not the answer -- a real uPD765 sets both, and folding them
// into "controller failure" would report a scratched disk as broken hardware.
//
// So the routine is called directly with the result bytes staged in
// 0040:0042, which is exactly the interface it reads. Every branch, driven.
// ---------------------------------------------------------------------------

/**
 * Call a near procedure in the ROM with DS = 0040h, and a return address
 * that lands on the ROM's own halt loop so the CPU stops when it returns.
 */
function callRomProc(m, name) {
    const at = rom.symbols.get(name).value;
    const back = rom.symbols.get('post_dead').value;
    m.cpu.ss = 0; m.cpu.sp = 0x6ffe;
    m.mem[0x6ffe] = back & 0xff;
    m.mem[0x6fff] = (back >> 8) & 0xff;
    m.cpu.cs = 0xf000; m.cpu.ip = at;
    m.cpu.ds = 0x0040;
    m.cpu.flags &= ~0x0201;             // interrupts off, carry clear
    m.cpu.halted = false;
    let n = 0;
    while (n < 100_000 && !m.cpu.halted) { m.step(); n++; }
    assert.ok(m.cpu.halted, `${name} never returned`);
    return { al: m.cpu.ax & 0xff, cf: m.cpu.flags & 1 };
}

test('every branch of the ST0/ST1 decode produces its documented status', () => {
    const m = ready();
    const CASES = [
        { st0: 0x00, st1: 0x00, st2: 0x00, ah: 0x00, why: 'IC=00, a normal termination' },
        { st0: 0x48, st1: 0x01, st2: 0x00, ah: 0x80, why: 'ST0 NR: no disk in the drive' },
        { st0: 0x40, st1: 0x02, st2: 0x00, ah: 0x03, why: 'ST1 NW: write protected' },
        { st0: 0x40, st1: 0x20, st2: 0x20, ah: 0x10, why: 'ST1 DE: a CRC error in the data field' },
        { st0: 0x40, st1: 0x10, st2: 0x00, ah: 0x08, why: 'ST1 OR: the transfer overran' },
        { st0: 0x40, st1: 0x04, st2: 0x10, ah: 0x04, why: 'ST1 ND: the sector was not there' },
        { st0: 0x40, st1: 0x01, st2: 0x00, ah: 0x02, why: 'ST1 MA: no address mark at all' },
        { st0: 0x40, st1: 0x80, st2: 0x00, ah: 0x20, why: 'ST1 EN: past the end of the cylinder' },
        { st0: 0x80, st1: 0x00, st2: 0x00, ah: 0x20, why: 'ST0 IC=invalid: no such command' },
        { st0: 0x40, st1: 0x00, st2: 0x00, ah: 0x20, why: 'abnormal with nothing in ST1 to say why' },
    ];
    for (const c of CASES) {
        m.mem[BDA + 0x42] = c.st0;
        m.mem[BDA + 0x43] = c.st1;
        m.mem[BDA + 0x44] = c.st2;
        const r = callRomProc(m, 'fd_status');
        assert.equal(r.al, c.ah,
            `ST0=${c.st0.toString(16)}h ST1=${c.st1.toString(16)}h (${c.why}) should decode `
            + `to AH=${c.ah.toString(16).padStart(2, '0')}h, not ${r.al.toString(16)}h`);
        assert.equal(r.cf, c.ah === 0 ? 0 : 1, `and CF must agree with it for ${c.why}`);
    }
});

test('the decode is by SPECIFICITY: ST1 is read before ST0 is believed', () => {
    // Every failure has ST0's abnormal bits set, so a decode that looked at
    // ST0 first would report a write-protected disk, a missing sector and a
    // CRC error as the same thing and the caller would retry all three.
    const m = ready();
    const same = { st0: 0x40 };
    const seen = new Set();
    for (const st1 of [0x02, 0x20, 0x10, 0x04, 0x01, 0x80]) {
        m.mem[BDA + 0x42] = same.st0;
        m.mem[BDA + 0x43] = st1;
        m.mem[BDA + 0x44] = 0;
        seen.add(callRomProc(m, 'fd_status').al);
    }
    assert.equal(seen.size, 6,
        `six different ST1 values collapsed to ${seen.size} statuses. They must stay six: `
        + 'write-protected, CRC, overrun, not-found, no-address-mark and end-of-cylinder are '
        + 'six different things to do about a failed read.');
});

// ---------------------------------------------------------------------------
// The motor, and the countdown that has been in this ROM since before there
// was anything to spin.
// ---------------------------------------------------------------------------

test('the motor is started, waited for, and left on a countdown', () => {
    const m = ready();
    assert.equal(m.mem[BDA + 0x3f], 0, 'no motor is running after POST');
    const ticksBefore = m.mem[BDA + 0x6c] | (m.mem[BDA + 0x6d] << 8);

    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));

    assert.equal(m.mem[BDA + 0x3f] & 1, 1, "drive 0's motor is recorded as running");
    assert.ok(m.chips.fdc1.motorOn(0), 'and the controller agrees: DOR bit 4 is set');
    assert.equal(m.mem[BDA + 0x40], 0x25,
        'the motor-off countdown is loaded from the diskette parameter table');

    // The spin-up wait is real time, measured on the tick the BIOS itself
    // maintains. The table says eight eighths of a second, which is about
    // seventeen ticks.
    const ticksAfter = m.mem[BDA + 0x6c] | (m.mem[BDA + 0x6d] << 8);
    assert.ok(ticksAfter - ticksBefore >= 17,
        `only ${ticksAfter - ticksBefore} ticks passed: the spin-up wait did not happen. `
        + 'It costs nothing on a model with no rotational latency, which is exactly why '
        + 'leaving it out would never be noticed.');
});

test('a second access inside the window does NOT pay for spin-up again', () => {
    const m = ready();
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));
    const t0 = m.mem[BDA + 0x6c] | (m.mem[BDA + 0x6d] << 8);
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0002h\n xor dx, dx\n mov bx, 5000h'));
    const t1 = m.mem[BDA + 0x6c] | (m.mem[BDA + 0x6d] << 8);
    assert.ok(t1 - t0 < 17,
        `the second read waited ${t1 - t0} ticks. The motor was already up; waiting again `
        + 'would make every DOS directory listing a second longer than it needs to be.');
});

test('the countdown expiring really STOPS the motor', () => {
    // The half that is easy to leave out and impossible to see: the
    // countdown reaches zero, nothing happens, and because 0040:003F still
    // says the motor is up the spin-up wait is skipped for ever after.
    const m = ready();
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));
    assert.ok(m.chips.fdc1.motorOn(0));

    // Let the timer run 0040:0040 down. Nothing else is executing: the CPU
    // sits in a HLT and INT 08h does the work.
    m.cpu.halted = false;
    const code = assembleRaw(` l: jmp l\n`, 0);
    m.mem.set(code, PROG);
    m.cpu.cs = 0; m.cpu.ip = PROG; m.cpu.flags |= 0x200;
    // Run until the motor actually stops, not until the counter reads zero:
    // the DEC that reaches zero and the OUT that acts on it are different
    // instructions, and stopping between them would test the counter rather
    // than the thing it is a counter for.
    let n = 0;
    while (n < 5_000_000 && m.chips.fdc1.motorOn(0)) { m.step(); n++; }
    assert.equal(m.mem[BDA + 0x40], 0, 'the countdown reached zero');

    assert.equal(m.chips.fdc1.motorOn(0), false, 'the motor was switched off through the DOR');
    assert.equal(m.mem[BDA + 0x3f], 0, 'and 0040:003F agrees, so the next access spins up again');
    // ...and the controller is still awake: a motor timeout is not a reset.
    assert.equal(m._in(0x3f4) & 0x80, 0x80, 'RQM: it is still ready for a command');
});

// ---------------------------------------------------------------------------
// Reset, and the four answers the chip owes afterwards.
// ---------------------------------------------------------------------------

test('AH=00h drains all FOUR ready-change statuses the reset queues', () => {
    // Coming out of reset the chip queues one status per drive: C0h, C1h,
    // C2h, C3h. Sense it once and three stay queued -- and the next
    // command's SENSE INTERRUPT STATUS then reports a stale drive instead
    // of its own, so the seek after it is validated against the wrong answer.
    const m = ready();
    run(m, ` xor ax, ax\n xor dx, dx\n int 13h\n pushf\n pop si`);
    assert.equal(result(m).cf, 0, 'the reset succeeded');
    assert.equal(m.chips.fdc1.pendingInt.length, 0,
        `${m.chips.fdc1.pendingInt.length} interrupt statuses were left queued`);
    assert.equal(m.chips.fdc1.driveBusy, 0,
        'and no drive is left marked as seeking, which only sensing clears');
    handshakeWasClean(m, 'a reset');

    // The proof that SPECIFY was reissued: a reset clears the ND bit along
    // with the timings, and a read that ran non-DMA afterwards would find
    // nobody moving its bytes.
    assert.equal(m.chips.fdc1.nonDma, false,
        'SPECIFY was reissued with ND clear, so the execution phase is still the 8237\'s');
    run(m, CALL13(' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h'));
    assert.equal(result(m).cf, 0, 'and a read still works after the reset');
});

test('AH=00h on a fixed disk is refused, because there is not one', () => {
    const m = ready();
    run(m, ` mov ax, 0000h\n mov dx, 0080h\n int 13h\n pushf\n pop si`);
    const r = result(m);
    assert.equal(r.cf, 1);
    assert.equal(r.ah, 0x01);
});

// ---------------------------------------------------------------------------
// The whole point.
// ---------------------------------------------------------------------------

test('INT 19h boots the machine off the real controller', () => {
    // Reset to boot sector, with nothing in the test doing anything except
    // putting a disk in the drive. Every byte of the 512 came off the
    // uPD765 through DMA channel 2.
    const image = testImage();
    const sector = assembleRaw(` mov ax, 0BEEFh\n mov [7000h], ax\n mov [7002h], dx\n hlt\n`, 0);
    image.set(sector, 0);
    image[510] = 0x55; image[511] = 0xaa;

    const m = new I8086Machine(XTDISK);
    m.loadRom(rom.bytes);
    wireDreq(m);
    m.chips.fdc1.insert(0, image, GEOM);
    m.reset();
    let n = 0;
    while (n < 5_000_000 && !m.cpu.halted) { m.step(); n++; }

    assert.ok(m.cpu.halted, `the machine never reached the boot sector's HLT in ${n} steps`);
    assert.equal(m.mem[0x7c00], image[0], 'the sector really landed at 0000:7C00');
    assert.equal(m.mem[0x7dfe] | (m.mem[0x7dff] << 8), 0xaa55, 'signature and all');
    assert.equal(m.mem[0x7000] | (m.mem[0x7001] << 8), 0xbeef,
        'and it executed: only the boot sector writes that');
    assert.equal(m.mem[0x7002], 0x00, 'DL carries the drive it booted from');
    handshakeWasClean(m, 'an unattended boot');
});
