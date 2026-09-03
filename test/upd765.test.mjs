import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    UPD765, DOR, MSR, ST0, ST1, ST2, ST3,
    FDC_PORT_BASE, GEOMETRIES, chsToLba, imageSize, resolveGeometry,
} from '../src/upd765.js';

// Register offsets from 3F0h, spelled out so the tests read like a driver.
const R_DOR = 2;
const R_MSR = 4;
const R_DATA = 5;
const R_DIR = 7;

// DOR bytes a driver actually writes. Drive 0 selected, controller out of
// reset, motor 0 running; the DMA/IRQ gate is the bit that gets forgotten.
const DOR_PIO = 0x14;   // select 0 | /RESET | motor 0
const DOR_DMA = 0x1c;   // ... | DMA+IRQ gate

const CMD = {
    SPECIFY: 0x03,
    SENSE_DRIVE: 0x04,
    WRITE_DATA: 0x45,        // MT=0, MFM=1
    READ_DATA: 0x46,         // MT=0, MFM=1
    READ_DATA_MT: 0xc6,      // MT=1, MFM=1
    RECALIBRATE: 0x07,
    SENSE_INT: 0x08,
    READ_ID: 0x4a,
    FORMAT: 0x4d,
    SEEK: 0x0f,
    READ_TRACK: 0x42,        // real command, not modelled here
};

/**
 * A synthetic 360K image whose every byte says where it came from, so a read
 * that lands one sector out is caught by the data and not only by the result
 * bytes. Byte i of an LBA sector holds (lba*7 + i) & 0xff.
 */
function makeImage(name = '360k') {
    const geom = GEOMETRIES[name];
    const img = new Uint8Array(imageSize(geom));
    for (let lba = 0; lba * geom.bytesPerSector < img.length; lba++) {
        const off = lba * geom.bytesPerSector;
        for (let i = 0; i < geom.bytesPerSector; i++) img[off + i] = (lba * 7 + i) & 0xff;
    }
    return { geom, img };
}

function sectorBytes(geom, c, h, s) {
    const lba = chsToLba(geom, c, h, s);
    return Array.from({ length: geom.bytesPerSector }, (_, i) => (lba * 7 + i) & 0xff);
}

/** Write a command the way firmware does: poll RQM/DIO before every byte. */
function command(fdc, bytes) {
    for (const b of bytes) {
        const msr = fdc.read(R_MSR);
        assert.equal(msr & MSR.RQM, MSR.RQM, 'RQM must be set before a command byte');
        assert.equal(msr & MSR.DIO, 0, 'DIO must say CPU-to-FDC before a command byte');
        fdc.write(R_DATA, b);
    }
}

/** Drain the result phase the way firmware does, and stop when it ends. */
function result(fdc) {
    const out = [];
    for (let guard = 0; guard < 32; guard++) {
        const msr = fdc.read(R_MSR);
        if ((msr & (MSR.RQM | MSR.DIO)) !== (MSR.RQM | MSR.DIO)) break;
        out.push(fdc.read(R_DATA));
    }
    return out;
}

/** Command, then result, in one breath -- for commands that have one. */
function exchange(fdc, bytes) {
    command(fdc, bytes);
    return result(fdc);
}

/**
 * Releasing the DOR reset line queues four ready-change statuses, so every
 * BIOS opens with four SENSE INTERRUPT STATUS commands to drain them. The
 * fixtures do the same, or the first real seek would read drive 0s C0h.
 */
function drainResetStatuses(fdc) {
    for (let i = 0; i < 4; i++) exchange(fdc, [CMD.SENSE_INT]);
}

/** Seek drive 0 to a cylinder and drain the interrupt it raises. */
function seekTo(fdc, cyl, drive = 0) {
    command(fdc, [CMD.SEEK, drive, cyl]);
    return exchange(fdc, [CMD.SENSE_INT]);
}

/** A controller with a disk in drive 0 and no DMA wired (so: PIO mode). */
function pioMachine(geomName = '360k') {
    const { geom, img } = makeImage(geomName);
    const fdc = new UPD765();
    fdc.insert(0, img, geomName);
    fdc.write(R_DOR, DOR_PIO);
    drainResetStatuses(fdc);
    return { fdc, geom, img };
}

/**
 * A controller with a fake DMA channel of `count` bytes on the other end.
 * The channel behaves the way an 8237 does: it accepts the byte that takes
 * it to terminal count and asserts TC *during* that transfer, exactly as
 * i8237.js's onTerminalCount hook would.
 */
function dmaMachine(count, { geomName = '360k', sentinel = false } = {}) {
    const { geom, img } = makeImage(geomName);
    const memory = [];
    let left = count;
    const feed = [];
    const fdc = new UPD765({
        onDmaRequest(dir, byte) {
            if (left <= 0) {
                // A masked or exhausted channel moves nothing. The sentinel
                // return is the other half of the TC contract.
                if (sentinel) return false;
                fdc.terminalCount();
                return false;
            }
            let v = true;
            if (dir === 'write') memory.push(byte);
            else { v = feed.length ? feed.shift() : 0x00; }
            if (--left === 0 && !sentinel) fdc.terminalCount();
            return v;
        },
    });
    fdc.insert(0, img, geomName);
    fdc.write(R_DOR, DOR_DMA);
    drainResetStatuses(fdc);
    return { fdc, geom, img, memory, feed };
}

// ===================================================================== glue

test('the port base and the CHS arithmetic are the numbers the rest of the machine needs', () => {
    assert.equal(FDC_PORT_BASE, 0x3f0, 'the XT decodes the FDC at 3F0h');
    const g = GEOMETRIES['360k'];
    assert.equal(chsToLba(g, 0, 0, 1), 0, 'sector 1 of cylinder 0 head 0 is LBA 0 -- sectors are ONE-based');
    assert.equal(chsToLba(g, 0, 1, 1), 9, 'head 1 starts after head 0s nine sectors');
    assert.equal(chsToLba(g, 1, 0, 1), 18, 'cylinder 1 starts after both heads of cylinder 0');
    assert.equal(imageSize(g), 368640, 'a 360K disk is 368640 bytes');
});

test('a geometry is inferred from the image length when no one names one', () => {
    assert.deepEqual(resolveGeometry(undefined, 368640), GEOMETRIES['360k'],
        '368640 bytes can only be a 360K disk');
    assert.deepEqual(resolveGeometry('1.44M', 0), GEOMETRIES['1.44m'],
        'a geometry name is matched case-insensitively');
    assert.throws(() => resolveGeometry(undefined, 12345), /cannot infer/,
        'an unrecognisable length must be refused, not guessed at');
    assert.throws(() => resolveGeometry({ cylinders: 40, heads: 0, sectors: 9 }), /heads/,
        'a zero-headed geometry is a caller bug and must say so');
});

// ============================================================ phase machine

test('an idle controller says RQM, not DIO: it is waiting for a command byte', () => {
    const fdc = new UPD765();
    const msr = fdc.read(R_MSR);
    assert.equal(msr & MSR.RQM, MSR.RQM, 'RQM is set when the data register is free');
    assert.equal(msr & MSR.DIO, 0, 'DIO clear means the chip expects the CPU to write');
    assert.equal(msr & MSR.CB, 0, 'CB is clear with no command in the FIFO');
});

test('a result byte CANNOT be read while the controller is expecting a command', () => {
    const { fdc } = pioMachine();
    // Mid-command: three of a nine-byte READ DATA are in the FIFO.
    fdc.write(R_DATA, CMD.READ_DATA);
    fdc.write(R_DATA, 0x00);
    fdc.write(R_DATA, 0x00);
    const msr = fdc.read(R_MSR);
    assert.equal(msr & MSR.DIO, 0, 'DIO must still say CPU-to-FDC in the middle of a command');
    assert.equal(msr & MSR.CB, MSR.CB, 'CB rises on the first command byte, not at execution');
    assert.equal(fdc.read(R_DATA), 0xff,
        'reading 3F5h while DIO says CPU-to-FDC must return the floating bus, not a result byte');
    assert.equal(fdc.stats.badReads, 1, 'the illegal read is counted, never silently tolerated');
    assert.equal(fdc.cmdBuf.length, 3,
        'and it must not advance the command FIFO -- the chip is not driving the bus at all');
});

test('a command byte written during the result phase is dropped, not appended', () => {
    const { fdc } = pioMachine();
    command(fdc, [CMD.SENSE_DRIVE, 0x00]);
    const msr = fdc.read(R_MSR);
    assert.equal(msr & MSR.DIO, MSR.DIO, 'DIO points FDC-to-CPU while a result is waiting');
    fdc.write(R_DATA, CMD.RECALIBRATE);
    assert.equal(fdc.stats.badWrites, 1, 'the write is counted as a driver desynchronisation');
    const bytes = result(fdc);
    assert.equal(bytes.length, 1, 'SENSE DRIVE STATUS still returns exactly its one ST3 byte');
});

test('draining the last result byte returns the chip to the command phase', () => {
    const { fdc } = pioMachine();
    command(fdc, [CMD.SENSE_DRIVE, 0x00]);
    fdc.read(R_DATA);
    const msr = fdc.read(R_MSR);
    assert.equal(msr & MSR.DIO, 0, 'DIO drops back to CPU-to-FDC as the result phase ends');
    assert.equal(msr & MSR.CB, 0, 'CB drops with it: the command is over');
    assert.equal(msr & MSR.RQM, MSR.RQM, 'RQM stays up -- the chip is ready for the next command');
});

test('ports the XT card does not decode read back as a floating bus', () => {
    const fdc = new UPD765();
    for (const reg of [0, 1, 3, 6]) {
        assert.equal(fdc.read(reg), 0xff, `3F${reg}h is not decoded and must float high`);
    }
    fdc.write(R_MSR, 0x00);
    assert.equal(fdc.read(R_MSR) & MSR.RQM, MSR.RQM, 'the MSR is read-only: a write to it changes nothing');
});

// ============================================================ invalid commands

test('an opcode that is not a command answers ST0=80h at once, consuming nothing', () => {
    const fdc = new UPD765();
    const bytes = exchange(fdc, [0x01]);
    assert.deepEqual(bytes, [0x80],
        'an invalid command produces a ONE-byte result phase holding IC=invalid');
    assert.equal(fdc.refusals, 1, 'the refusal is recorded so a driver leaves evidence');
    assert.equal(fdc.irq, false, 'an invalid command raises NO interrupt on real silicon');
    assert.equal(fdc.read(R_MSR) & MSR.RQM, MSR.RQM,
        'and the chip is immediately ready again -- an unknown opcode must never hang it');
});

test('a real command this model does not implement swallows its parameters, then answers 80h', () => {
    const { fdc } = pioMachine();
    // READ TRACK takes eight parameter bytes. The byte count is a property of
    // the silicon, and swallowing them is what keeps the FIFO in step -- so
    // the chip must keep asking for them and must NOT answer early.
    command(fdc, [CMD.READ_TRACK, 0, 0, 0, 1, 2, 9, 0x1b]);
    assert.equal(fdc.read(R_MSR) & MSR.DIO, 0,
        'eight of the nine bytes are in: the chip is still in the command phase');
    fdc.write(R_DATA, 0xff);
    assert.deepEqual(result(fdc), [0x80],
        'READ TRACK is refused with IC=invalid after its parameters are consumed');
    assert.match(fdc.lastRefusal, /READ TRACK/, 'and the refusal names itself');
});

test('a refusal leaves the FIFO aligned, so the very next command still works', () => {
    const { fdc, geom } = pioMachine();
    exchange(fdc, [0x1e]);   // not a command
    const st3 = exchange(fdc, [CMD.SENSE_DRIVE, 0x00]);
    assert.equal(st3.length, 1, 'the next command is parsed from a clean FIFO');
    assert.equal(st3[0] & ST3.RDY, ST3.RDY, 'and it sees the drive that is really there');
    assert.ok(geom);
});

// ============================================================ SPECIFY / sense

test('SPECIFY has no result phase and raises no interrupt -- it only loads constants', () => {
    const fdc = new UPD765();
    command(fdc, [CMD.SPECIFY, 0xdf, 0x02]);
    const msr = fdc.read(R_MSR);
    assert.equal(msr & MSR.DIO, 0, 'there is nothing to read back after SPECIFY');
    assert.equal(msr & MSR.CB, 0, 'and the chip is not busy');
    assert.equal(fdc.irq, false, 'SPECIFY does not interrupt');
    assert.equal(fdc.srt, 0xd, 'step rate is the top nibble of the first byte');
    assert.equal(fdc.hut, 0xf, 'head unload time is the bottom nibble');
    assert.equal(fdc.hlt, 1, 'head load time is bits 7..1 of the second byte');
    assert.equal(fdc.nonDma, false, 'and bit 0 clear selects DMA execution');
});

test('SPECIFY bit 0 selects non-DMA execution even when an 8237 is wired', () => {
    const { fdc } = dmaMachine(512);
    command(fdc, [CMD.SPECIFY, 0xdf, 0x03]);
    assert.equal(fdc.nonDma, true, 'ND set means the host moves the bytes itself');
});

test('SENSE DRIVE STATUS reports the drive pins, and interrupts nobody', () => {
    const { fdc } = pioMachine();
    fdc.setWriteProtect(0, true);
    const [st3] = exchange(fdc, [CMD.SENSE_DRIVE, 0x00]);
    assert.equal(st3 & ST3.RDY, ST3.RDY, 'a drive with an image is ready');
    assert.equal(st3 & ST3.T0, ST3.T0, 'the head starts over track 0');
    assert.equal(st3 & ST3.TS, ST3.TS, 'a 360K disk is two-sided');
    assert.equal(st3 & ST3.WP, ST3.WP, 'and write protect is reported from the drive, not the medium');
    assert.equal(fdc.irq, false, 'SENSE DRIVE STATUS is a pure interrogation: no interrupt');

    const [empty] = exchange(fdc, [CMD.SENSE_DRIVE, 0x01]);
    assert.equal(empty & ST3.RDY, 0, 'an empty drive is not ready');
    assert.equal(empty & 3, 1, 'and the unit number comes back in the bottom two bits');
});

test('SENSE INTERRUPT STATUS with nothing queued answers 80h, and that is not a refusal', () => {
    const fdc = new UPD765();
    assert.deepEqual(exchange(fdc, [CMD.SENSE_INT]), [0x80],
        'an unsolicited sense returns IC=invalid, which is how a BIOS knows the queue is empty');
    assert.equal(fdc.refusals, 0,
        'but it is DEFINED behaviour, not an unimplemented command, so it must not be counted as one');
});

// ============================================================ seek family

test('RECALIBRATE drives the head to track 0 and reports seek end through SENSE INTERRUPT', () => {
    const { fdc } = pioMachine();
    seekTo(fdc, 12);
    command(fdc, [CMD.RECALIBRATE, 0x00]);
    assert.equal(fdc.read(R_MSR) & MSR.DIO, 0,
        'RECALIBRATE has NO result phase -- the host has to ask with SENSE INTERRUPT STATUS');
    assert.equal(fdc.read(R_MSR) & 0x01, 0x01, 'drive 0 is marked in seek mode until it is sensed');
    const [st0, pcn] = exchange(fdc, [CMD.SENSE_INT]);
    assert.equal(st0, ST0.SE, 'ST0 is seek end, IC normal, drive 0, head 0');
    assert.equal(pcn, 0, 'and the present cylinder number is track 0');
    assert.equal(fdc.read(R_MSR) & 0x01, 0, 'sensing the interrupt clears the drive-busy bit');
});

test('RECALIBRATE gives up after 77 step pulses with EQUIPMENT CHECK, part of the way home', () => {
    const { fdc } = pioMachine('1.44m');   // 80 cylinders: far enough to matter
    seekTo(fdc, 79);
    command(fdc, [CMD.RECALIBRATE, 0x00]);
    const [st0, pcn] = exchange(fdc, [CMD.SENSE_INT]);
    assert.equal(st0 & ST0.IC_MASK, ST0.IC_ABNORMAL, 'not reaching track 0 is an abnormal termination');
    assert.equal(st0 & ST0.EC, ST0.EC, 'EC means exactly this: RECALIBRATE never saw the track-0 sensor');
    assert.equal(pcn, 2, 'and the head stopped 77 pulses short, at cylinder 2 -- hence the double recalibrate');
});

test('SENSE INTERRUPT STATUS after a SEEK returns seek end and the cylinder that was asked for', () => {
    const { fdc } = pioMachine();
    const [st0, pcn] = seekTo(fdc, 17);
    assert.equal(st0 & ST0.SE, ST0.SE, 'SE is the bit that says a seek finished');
    assert.equal(st0 & ST0.IC_MASK, ST0.IC_NORMAL, 'a seek inside the disk is a normal termination');
    assert.equal(st0 & 0x03, 0, 'the unit number rides in the bottom two bits of ST0');
    assert.equal(pcn, 17, 'PCN is the second result byte and holds the cylinder actually reached');
});

test('SEEK reports the head number it was given', () => {
    const { fdc } = pioMachine();
    command(fdc, [CMD.SEEK, 0x04, 3]);   // HDS bit 2 = head 1
    const [st0] = exchange(fdc, [CMD.SENSE_INT]);
    assert.equal(st0 & ST0.HD, ST0.HD, 'ST0 bit 2 mirrors the head selected by the command');
});

test('a seek past the last cylinder terminates abnormally, parks the head, and keeps PCN', () => {
    const { fdc } = pioMachine();   // 360K: 40 cylinders, so 39 is the last
    const [st0, pcn] = seekTo(fdc, 45);
    assert.equal(st0 & ST0.SE, ST0.SE, 'the seek still ENDED: SE is set either way');
    assert.equal(st0 & ST0.IC_MASK, ST0.IC_ABNORMAL,
        'seeking off the end of the medium is an abnormal termination');
    assert.equal(st0 & ST0.EC, 0,
        'but NOT equipment check -- EC means RECALIBRATE missed track 0, and reusing it here would be a lie');
    assert.equal(pcn, 45,
        'PCN is the chips own step counter and reaches the requested cylinder even though the head cannot');
    assert.equal(fdc.drives[0].track, 39, 'the head itself is parked against the stop at the last cylinder');
});

test('after an over-run seek the follow-up read fails with no-data and wrong-cylinder', () => {
    const { fdc } = pioMachine();
    seekTo(fdc, 45);
    const res = exchange(fdc, [CMD.READ_DATA, 0x00, 45, 0, 1, 2, 9, 0x2a, 0xff]);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_ABNORMAL, 'the read cannot succeed with the head parked');
    assert.equal(res[1] & ST1.ND, ST1.ND, 'ST1 no-data: the ID field asked for never came round');
    assert.equal(res[2] & ST2.WC, ST2.WC,
        'ST2 wrong-cylinder: the ID under the head says 39 and the command said 45');
});

test("seekBeyondEnd:'silent' takes the datasheet literally and calls the same seek normal", () => {
    const { geom, img } = makeImage();
    const fdc = new UPD765({}, { seekBeyondEnd: 'silent' });
    fdc.insert(0, img, '360k');
    fdc.write(R_DOR, DOR_PIO);
    drainResetStatuses(fdc);
    const [st0, pcn] = seekTo(fdc, 45);
    assert.equal(st0 & ST0.IC_MASK, ST0.IC_NORMAL,
        'read literally the chip counts out its pulses and reports success');
    assert.equal(pcn, 45, 'PCN is the same under either policy');
    assert.equal(fdc.drives[0].track, geom.cylinders - 1, 'and so is the parked head');
});

test('the chip does not seek for you: READ DATA with the wrong C is refused, not helped', () => {
    const { fdc } = pioMachine();
    const res = exchange(fdc, [CMD.READ_DATA, 0x00, 5, 0, 1, 2, 9, 0x2a, 0xff]);
    assert.equal(res[1] & ST1.ND, ST1.ND,
        'the head is still on cylinder 0, so cylinder 5s ID field is never found');
    assert.equal(res[2] & ST2.WC, ST2.WC, 'and the mismatch is named as wrong-cylinder');
});

// ============================================================ READ ID

test('READ ID hands back an ID field from the track the head is really on', () => {
    const { fdc } = pioMachine();
    seekTo(fdc, 3);
    const res = exchange(fdc, [CMD.READ_ID, 0x04]);
    assert.equal(res.length, 7, 'READ ID has the same seven-byte result as a data command');
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_NORMAL, 'a formatted track has address marks');
    assert.equal(res[3], 3, 'C is the cylinder the head is on, not the one the driver hoped for');
    assert.equal(res[4], 1, 'H is the head the command selected');
    assert.equal(res[6], 2, 'N=2 is a 512-byte sector');
    const second = exchange(fdc, [CMD.READ_ID, 0x04]);
    assert.notEqual(second[5], res[5], 'the disk turns: the next ID field to pass the head is a different sector');
});

test('READ ID on an empty drive reports not-ready and a missing address mark', () => {
    const fdc = new UPD765();
    fdc.write(R_DOR, DOR_PIO);
    const res = exchange(fdc, [CMD.READ_ID, 0x00]);
    assert.equal(res[0] & ST0.NR, ST0.NR, 'no medium means the drive is not ready');
    assert.equal(res[1] & ST1.MA, ST1.MA, 'and there is no address mark to be found');
});

// ============================================================ READ DATA, PIO

test('READ DATA in non-DMA mode hands the host the right sector, byte for byte', () => {
    const { fdc, geom } = pioMachine();
    seekTo(fdc, 2);
    command(fdc, [CMD.READ_DATA, 0x04, 2, 1, 5, 2, 5, 0x2a, 0xff]);

    const msr = fdc.read(R_MSR);
    assert.equal(msr & MSR.NDM, MSR.NDM, 'NDM marks a non-DMA execution phase');
    assert.equal(msr & MSR.RQM, MSR.RQM, 'RQM is up: the host moves every byte itself');
    assert.equal(msr & MSR.DIO, MSR.DIO, 'DIO points FDC-to-CPU for a read');
    fdc.write(R_DATA, 0x00);
    assert.equal(fdc.stats.badWrites, 1, 'and writing 3F5h while the chip is talking is refused');

    const got = [];
    for (let i = 0; i < geom.bytesPerSector; i++) got.push(fdc.read(R_DATA));
    assert.deepEqual(got, sectorBytes(geom, 2, 1, 5),
        'cylinder 2, head 1, sector 5 must come back, and nothing one sector either side of it');
});

test('a read that runs off the end of the track without a TC sets EN and terminates abnormally', () => {
    const { fdc, geom } = pioMachine();
    // EOT = R: the driver wants one sector and expects a TC that never comes.
    command(fdc, [CMD.READ_DATA, 0x00, 0, 0, 1, 2, 1, 0x2a, 0xff]);
    for (let i = 0; i < geom.bytesPerSector; i++) fdc.read(R_DATA);
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_ABNORMAL,
        'trying for the sector after EOT is an abnormal termination, not a normal one');
    assert.equal(res[1] & ST1.EN, ST1.EN,
        'ST1 bit 7 (end of cylinder) is exactly the symptom of a driver that forgot to size its DMA count');
    assert.equal(res[3], 1, 'and C has been bumped to the next cylinder by the attempt');
});

test('terminal count during the last byte of a non-DMA read ends the command normally', () => {
    const { fdc, geom } = pioMachine();
    command(fdc, [CMD.READ_DATA, 0x00, 0, 0, 1, 2, 9, 0x2a, 0xff]);
    for (let i = 0; i < geom.bytesPerSector - 1; i++) fdc.read(R_DATA);
    fdc.terminalCount();          // asserted DURING the final transfer
    fdc.read(R_DATA);             // ... which still moves
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_NORMAL, 'a TC-terminated read is a NORMAL termination');
    assert.equal(res[1], 0, 'with nothing at all in ST1 -- no end-of-cylinder, no overrun');
    assert.equal(res[5], 2, 'and R names the sector that would have come next');
});

test('a read from an empty drive reports not ready rather than a buffer of zeros', () => {
    const fdc = new UPD765();
    fdc.write(R_DOR, DOR_PIO);
    const res = exchange(fdc, [CMD.READ_DATA, 0x00, 0, 0, 1, 2, 9, 0x2a, 0xff]);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_ABNORMAL, 'there is nothing to read');
    assert.equal(res[0] & ST0.NR, ST0.NR, 'and NR says why');
    assert.equal(fdc.read(R_MSR) & MSR.NDM, 0, 'no execution phase was ever entered');
});

test('a sector-size code that does not match the medium is refused as no-data', () => {
    const { fdc } = pioMachine();
    const res = exchange(fdc, [CMD.READ_DATA, 0x00, 0, 0, 1, 3, 9, 0x2a, 0xff]);
    assert.equal(res[1] & ST1.ND, ST1.ND, 'N=3 is a 1024-byte sector and this disk has none');
});

// ============================================================ READ DATA, DMA

test('READ DATA over DMA moves the sector through the hook and interrupts when it is done', () => {
    const { fdc, geom, memory } = dmaMachine(512);
    seekTo(fdc, 1);
    let irqs = 0;   // hooked AFTER the seek, whose own interrupt is tested elsewhere
    fdc.hooks.onIrqChange = (level) => { if (level) irqs++; };
    command(fdc, [CMD.READ_DATA, 0x00, 1, 0, 1, 2, 9, 0x2a, 0xff]);
    assert.deepEqual(memory, sectorBytes(geom, 1, 0, 1),
        'exactly one sector reached memory, and it is the one that was asked for');
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_NORMAL, 'terminal count ends a read normally');
    assert.equal(res[5], 2, 'R points at the sector after the last one transferred');
    assert.equal(irqs, 1, 'and the completion raised IRQ6 exactly once');
});

test('a multi-sector read stops where TC said, not at the end of the track', () => {
    // THE TEST THIS CHIP EXISTS FOR. EOT is 9, so without a terminal count
    // the controller would read nine sectors and then set end-of-cylinder.
    // The DMA channel is programmed for two.
    const { fdc, geom, memory } = dmaMachine(2 * 512);
    command(fdc, [CMD.READ_DATA, 0x00, 0, 0, 1, 2, 9, 0x2a, 0xff]);
    assert.equal(memory.length, 1024,
        'TC after 1024 bytes must stop the transfer there -- not run on to the 4608 the track holds');
    assert.deepEqual(memory.slice(0, 512), sectorBytes(geom, 0, 0, 1), 'sector 1 came first');
    assert.deepEqual(memory.slice(512), sectorBytes(geom, 0, 0, 2), 'sector 2 came second');
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_NORMAL, 'a TC-terminated multi-sector read is normal');
    assert.equal(res[1] & ST1.EN, 0, 'and end-of-cylinder must NOT be set -- the chip never reached EOT');
    assert.equal(res[5], 3, 'R is 3: the sector the chip would have read next');
});

test('a DMA channel that refuses a byte says terminal count just as loudly', () => {
    const { fdc, memory } = dmaMachine(2 * 512, { sentinel: true });
    command(fdc, [CMD.READ_DATA, 0x00, 0, 0, 1, 2, 9, 0x2a, 0xff]);
    assert.equal(memory.length, 1024, 'a false return from the hook is the other half of the TC contract');
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_NORMAL, 'and it terminates the command normally too');
    assert.equal(res[5], 3, 'stopping at a sector boundary leaves R on the next sector');
});

test('TC in the middle of a sector still advances the reported address', () => {
    const { fdc, memory } = dmaMachine(512 + 100);
    command(fdc, [CMD.READ_DATA, 0x00, 0, 0, 1, 2, 9, 0x2a, 0xff]);
    assert.equal(memory.length, 612, 'the transfer stops mid-sector, on the byte TC arrived with');
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_NORMAL, 'still a normal termination');
    assert.equal(res[5], 3,
        'the chip reports the sector it would have done NEXT, not the one it was interrupted in');
});

test('a multi-track read crosses to head 1 at EOT instead of ending the command', () => {
    const { fdc, geom, memory } = dmaMachine(2 * 512);
    // Start on the LAST sector of head 0 with MT set: the next sector is
    // sector 1 of head 1, on the same cylinder.
    command(fdc, [CMD.READ_DATA_MT, 0x00, 0, 0, 9, 2, 9, 0x2a, 0xff]);
    assert.deepEqual(memory.slice(0, 512), sectorBytes(geom, 0, 0, 9), 'head 0s last sector came first');
    assert.deepEqual(memory.slice(512), sectorBytes(geom, 0, 1, 1),
        'and then MT carried the transfer across to sector 1 of head 1');
    const res = result(fdc);
    assert.equal(res[4], 1, 'H in the result has followed the head across');
});

test('DMA execution with the DOR gate shut overruns, because DRQ never leaves the card', () => {
    const { fdc, memory } = dmaMachine(512);
    fdc.write(R_DOR, DOR_PIO);   // same drive and motor, but bit 3 cleared
    const res = exchange(fdc, [CMD.READ_DATA, 0x00, 0, 0, 1, 2, 9, 0x2a, 0xff]);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_ABNORMAL, 'nobody moved the bytes, so the command failed');
    assert.equal(res[1] & ST1.OR, ST1.OR, 'ST1 overrun is the exact symptom of a DOR write missing bit 3');
    assert.equal(memory.length, 0, 'and not one byte was transferred');
    assert.equal(fdc.stats.overruns, 1, 'the fault is counted');
    assert.match(fdc.lastFault, /DOR bit 3/, 'and named, so it is not a mystery');
});

// ============================================================ WRITE / FORMAT

test('WRITE DATA puts the hosts bytes into the image at the right offset', () => {
    const { fdc, geom, img, feed } = dmaMachine(512);
    for (let i = 0; i < 512; i++) feed.push((0xa0 + i) & 0xff);
    seekTo(fdc, 4);
    command(fdc, [CMD.WRITE_DATA, 0x04, 4, 1, 6, 2, 9, 0x2a, 0xff]);
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_NORMAL, 'the write completed on terminal count');
    const off = chsToLba(geom, 4, 1, 6) * 512;
    assert.equal(img[off], 0xa0, 'the first byte landed at the start of cylinder 4, head 1, sector 6');
    assert.equal(img[off + 511], (0xa0 + 511) & 0xff, 'and the last byte at the end of it');
    assert.notEqual(img[off - 1], 0xa0, 'the sector before it is untouched');
    assert.notEqual(img[off + 512], 0xa0, 'and so is the sector after');
});

test('terminal count mid-sector still commits the sector, zero-filled to the end', () => {
    const { fdc, geom, img, feed } = dmaMachine(100);
    for (let i = 0; i < 100; i++) feed.push(0x5a);
    command(fdc, [CMD.WRITE_DATA, 0x00, 0, 0, 1, 2, 9, 0x2a, 0xff]);
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_NORMAL, 'a short write is a normal termination');
    const off = chsToLba(geom, 0, 0, 1) * 512;
    assert.equal(img[off + 99], 0x5a, 'the hundred bytes the host supplied are there');
    assert.equal(img[off + 100], 0x00,
        'and the rest of the data field is written as ZEROS -- the chip cannot abandon a field half laid down');
});

test('a write to a protected disk is refused before a single byte moves', () => {
    const { fdc, img, feed } = dmaMachine(512);
    feed.push(0xff);
    fdc.setWriteProtect(0, true);
    const before = img[0];
    const res = exchange(fdc, [CMD.WRITE_DATA, 0x00, 0, 0, 1, 2, 9, 0x2a, 0xff]);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_ABNORMAL, 'a protected disk fails the command');
    assert.equal(res[1] & ST1.NW, ST1.NW, 'ST1 not-writable is the reason');
    assert.equal(img[0], before, 'and the image is untouched');
});

test('FORMAT TRACK takes four ID bytes per sector and fills the data fields with D', () => {
    const { fdc, geom, img, feed } = dmaMachine(4 * 9);
    for (let s = 1; s <= 9; s++) feed.push(6, 0, s, 2);   // C, H, R, N
    seekTo(fdc, 6);
    command(fdc, [CMD.FORMAT, 0x00, 2, 9, 0x50, 0xe5]);
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_NORMAL, 'nine sectors formatted cleanly');
    const off = chsToLba(geom, 6, 0, 1) * 512;
    assert.equal(img[off], 0xe5, 'the filler byte D fills the data field');
    assert.equal(img[off + 9 * 512 - 1], 0xe5, 'all the way to the end of the ninth sector');
    assert.notEqual(img[off - 1], 0xe5, 'and the track before it is left alone');
});

test('FORMAT cannot reshape the medium: an ID outside the geometry fails with no-data', () => {
    const { fdc, feed } = dmaMachine(4 * 2);
    feed.push(0, 0, 1, 2);
    feed.push(0, 0, 30, 2);   // sector 30 does not exist on a nine-sector track
    command(fdc, [CMD.FORMAT, 0x00, 2, 2, 0x50, 0xe5]);
    const res = result(fdc);
    assert.equal(res[0] & ST0.IC_MASK, ST0.IC_ABNORMAL, 'the format cannot be honoured');
    assert.equal(res[1] & ST1.ND, ST1.ND, 'ST1 no-data, rather than silently inventing a sector');
    assert.equal(res[5], 30, 'and R names the ID field that could not be laid down');
});

// ============================================================ DOR / reset / IRQ

test('DOR bit 3 gates the interrupt onto the bus: an ungated completion is invisible', () => {
    const { fdc } = pioMachine();
    const seen = [];
    fdc.hooks.onIrqChange = (l) => seen.push(l);
    fdc.write(R_DOR, DOR_PIO);            // gate SHUT
    command(fdc, [CMD.SEEK, 0x00, 5]);
    assert.equal(fdc.irq, false, 'the seek finished but DOR bit 3 keeps IRQ6 off the bus');
    fdc.write(R_DOR, DOR_DMA);            // gate OPEN
    assert.equal(fdc.irq, true, 'and opening the gate lets the pending interrupt straight through');
    assert.deepEqual(seen, [true], 'the machine layer is told once, on the edge');
    exchange(fdc, [CMD.SENSE_INT]);
    assert.equal(fdc.irq, false, 'sensing the interrupt drops the line again');
});

test('taking the DOR reset line low clears the FIFO and every queued interrupt', () => {
    const { fdc } = pioMachine();
    fdc.write(R_DOR, DOR_DMA);
    command(fdc, [CMD.SEEK, 0x00, 9]);
    fdc.write(R_DATA, CMD.READ_DATA);     // start a second command
    fdc.write(R_DOR, DOR_DMA & ~DOR.NRESET);
    assert.equal(fdc.cmdBuf.length, 0, 'the half-written command is gone');
    assert.equal(fdc.irq, false, 'and so is the interrupt the seek had raised');
    assert.equal(fdc.drives[0].track, 9, 'but a reset pulse does not move a head');
});

test('coming out of reset queues four ready-change statuses, one per drive', () => {
    const { fdc } = pioMachine();
    fdc.write(R_DOR, 0x00);               // held in reset
    fdc.write(R_DOR, DOR_DMA);            // released
    assert.equal(fdc.irq, true, 'the release raises the interrupt every BIOS reset path waits for');
    for (let i = 0; i < 4; i++) {
        const [st0, pcn] = exchange(fdc, [CMD.SENSE_INT]);
        assert.equal(st0, ST0.IC_READY_CHANGE | i,
            `drive ${i} reports C${i}h -- IC=ready-change with its own unit number`);
        assert.equal(pcn, i === 0 ? 0 : 0, 'with the drives present cylinder alongside it');
    }
    assert.deepEqual(exchange(fdc, [CMD.SENSE_INT]), [0x80],
        'the fifth sense finds the queue empty, which is how the BIOS knows to stop');
    assert.equal(fdc.irq, false, 'and the line has dropped');
});

test('reset() while IRQ6 is asserted tells the machine layer the line went away', () => {
    const seen = [];
    const { geom, img } = makeImage();
    const fdc = new UPD765({ onIrqChange: (l) => seen.push(l) });
    fdc.insert(0, img, '360k');
    fdc.write(R_DOR, DOR_DMA);
    drainResetStatuses(fdc);
    command(fdc, [CMD.SEEK, 0x00, 5]);
    assert.equal(seen.at(-1), true, 'the seek asserted IRQ6');
    fdc.reset();
    assert.equal(seen.at(-1), false,
        'and a reset must ANNOUNCE the de-assertion, or the 8259 keeps a phantom interrupt latched for ever');
    assert.ok(geom);
});

test('the digital input register latches disk change until a step pulse clears it', () => {
    const { fdc } = pioMachine();
    assert.equal(fdc.read(R_DIR) & 0x80, 0x80, 'a freshly inserted disk asserts DISK CHANGE');
    seekTo(fdc, 1);
    assert.equal(fdc.read(R_DIR) & 0x80, 0, 'and moving the head is what clears the latch');
    fdc.eject(0);
    assert.equal(fdc.read(R_DIR) & 0x80, 0x80, 'ejecting sets it again');
});

test('a data command against a stopped motor is counted, not failed', () => {
    const { fdc, geom } = pioMachine();
    fdc.write(R_DOR, DOR.NRESET);         // selected, out of reset, motor OFF
    command(fdc, [CMD.READ_DATA, 0x00, 0, 0, 1, 2, 9, 0x2a, 0xff]);
    for (let i = 0; i < geom.bytesPerSector; i++) fdc.read(R_DATA);
    assert.equal(fdc.stats.motorOff, 1,
        'there is no spin-up model here, so the access is recorded rather than punished');
});

test('the motor hook fires on the edges of the DOR motor bits', () => {
    const seen = [];
    const fdc = new UPD765({ onMotorChange: (d, on) => seen.push([d, on]) });
    fdc.write(R_DOR, 0x1c);
    fdc.write(R_DOR, 0x1c);
    fdc.write(R_DOR, 0x0c);
    assert.deepEqual(seen, [[0, true], [0, false]],
        'only transitions are reported -- a re-write of the same DOR is not an edge');
});

// ============================================================ state

test('state round-trips everything except the media, which the caller owns', () => {
    const { fdc, img } = pioMachine();
    seekTo(fdc, 7);
    command(fdc, [CMD.SPECIFY, 0xdf, 0x03]);
    const snap = JSON.parse(JSON.stringify(fdc.getState()));

    const other = new UPD765();
    other.insert(0, img, '360k');
    other.setState(snap);
    assert.equal(other.drives[0].track, 7, 'the head position is controller state and comes back');
    assert.equal(other.nonDma, true, 'so do the SPECIFY constants');
    assert.equal(other.dor, DOR_PIO, 'and the DOR');
    const res = exchange(other, [CMD.READ_ID, 0x00]);
    assert.equal(res[3], 7, 'and the restored controller reads the track it was left on');
});

test('every command the table claims to model is actually dispatched, not refused', () => {
    // REGRESSION GUARD. The command table marks REFUSED commands with
    // `modelled: false`, so the implemented ones carry no such key. Testing
    // that flag for truthiness instead of `=== false` makes every implemented
    // command look unimplemented, and the chip answers 80h to the entire
    // instruction set while an invalid-command test still passes happily.
    // That is the bug this file was written to catch, so it is pinned here.
    const params = {
        [CMD.SPECIFY]: [0xdf, 0x02],
        [CMD.SENSE_DRIVE]: [0x00],
        [CMD.WRITE_DATA]: [0x00, 0, 0, 1, 2, 1, 0x2a, 0xff],
        [CMD.READ_DATA]: [0x00, 0, 0, 1, 2, 1, 0x2a, 0xff],
        [CMD.RECALIBRATE]: [0x00],
        [CMD.SENSE_INT]: [],
        [CMD.READ_ID]: [0x00],
        [CMD.FORMAT]: [2, 0, 0x50, 0xe5],
        [CMD.SEEK]: [0x00, 1],
    };
    for (const [opcode, tail] of Object.entries(params)) {
        const { fdc } = pioMachine();
        // A seek is outstanding for SENSE INTERRUPT STATUS to find.
        if (Number(opcode) === CMD.SENSE_INT) command(fdc, [CMD.SEEK, 0x00, 1]);
        command(fdc, [Number(opcode), ...tail]);
        const first = fdc.read(R_MSR) & MSR.DIO ? fdc.read(R_DATA) : null;
        assert.notEqual(first, 0x80,
            `opcode ${Number(opcode).toString(16)}h is in the table as modelled and must not answer IC=invalid`);
        assert.equal(fdc.refusals, 0,
            `opcode ${Number(opcode).toString(16)}h must not be counted as a refusal`);
    }
});
