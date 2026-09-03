// MS-DOS 2.0 booting off a real uPD765, and the same image booting through
// the emulator's INT 13h, compared.
//
// test/dos-boot.test.mjs already boots this disk to an A> prompt running DIR.
// It does it with `createDos8086(...).install()`, which claims all 256
// vectors and answers INT 13h in JavaScript from the image array. That is a
// real boot of real Microsoft binaries, and it proves everything about the
// image, the loader and the kernel -- and NOTHING about a disk controller,
// because there is no controller in it.
//
// This file boots the SAME image on a machine where:
//
//   * the CPU starts at FFFF:0000 and enters rom/bios.asm's POST,
//   * INT 13h is the BIOS's floppy driver,
//   * behind it are src/upd765.js and src/i8237.js on the bus at 3F0h and
//     00h, moving sectors over DMA channel 2,
//   * INT 10h, INT 16h, INT 1Ah, INT 08h and INT 09h are the ROM's,
//   * and src/i8086-dos.js IS NOT INSTALLED AT ALL. Not a reduced vector
//     set: the module is not imported and nothing it provides is present.
//
// WHY THAT IS A DIFFERENT TEST AND NOT A LONGER ONE. Two independent
// implementations of "read sector N" now have to produce the same nine
// landmarks and the same screen. A fault in either shows up as a
// disagreement, and the disagreement names which one -- which is a thing
// neither run can say on its own. The classic failures of this exact code
// (a 64K page wrap at a real sector boundary, a terminal count that arrives
// a byte late, a result phase read one byte short) all corrupt data without
// reporting anything, so an assertion that the boot "succeeded" would not
// catch any of them. Two paths agreeing on 100+ sectors does.
//
// Keys reach this machine as SCANCODES through IRQ1 and the 8255's port A,
// because that is the only way in: there is no service layer to type into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';
import { buildBios } from '../scripts/build-bios.mjs';
import { findMsdosFiles, build, GEOM, MEM } from '../scripts/build-dos-image.mjs';

const found = findMsdosFiles();
const SKIP = found.ok ? false : `MS-DOS 2.0 binaries not present -- ${found.reason}`;
const when = { skip: SKIP };

const rom = buildBios();
const HIGH = 0x9000;                       // where SYSINIT relocates itself
const VRAM = 0xb8000, COLS = 80, ROWS = 25;

/** The XT with disk hardware and a text page, and no service layer anywhere. */
const XTPC = Object.freeze({
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
        // `dma: 'dma1'` is the wire. Without it the machine builds both chips
        // and connects neither, and src/upd765.js quietly falls back to
        // non-DMA execution -- where it raises RQM and waits for a host that
        // is not coming.
        { kind: 'fdc', name: 'fdc1', at: 0x3f0, irq: 6, dma: 'dma1' },
        { kind: 'cga', name: 'cga1', at: 0x3d0 },
    ],
});

/**
 * The DREQ the machine's DMA pump does not assert. See the pinned defect in
 * test/bios-fdc.test.mjs: I8237.transfer() serves only a channel that is
 * requesting, and the pump never calls dreq(), so unaided it moves zero
 * bytes while the controller still reports a normal completion. Asserting
 * DREQ here is what the pump should do and is idempotent if it starts doing
 * it, so this survives the fix.
 */
function wireDreq(m) {
    const fdc = m.chips.fdc1, dma = m.chips.dma1;
    const inner = fdc.hooks.onDmaRequest;
    fdc.hooks.onDmaRequest = (dir, byte) => {
        dma.dreq(2, true);
        const r = inner(dir, byte);
        dma.dreq(2, false);
        return r;
    };
}

/** US XT make codes for the keys this test presses. */
const SCANCODE = { '\r': 0x1c, d: 0x20, i: 0x17, r: 0x13 };

/** The text page, read from the CPU-visible buffer -- both runs write it. */
function screenOf(m) {
    const lines = [];
    for (let row = 0; row < ROWS; row++) {
        let s = '';
        for (let col = 0; col < COLS; col++) {
            s += String.fromCharCode(m._read(VRAM + (row * COLS + col) * 2) || 0x20);
        }
        lines.push(s.replace(/\s+$/, ''));
    }
    return lines;
}

/**
 * Everything from the kernel's own banner onward.
 *
 * The two runs CANNOT have identical screens and should not: this one starts
 * with the ROM's power-on banner and the other starts with a screen the
 * service layer cleared. That difference is the BIOS, not the disk. From
 * "MS-DOS version" down, every character was produced by Microsoft's code
 * reading Microsoft's files, and there the two have no licence to differ.
 */
function fromBanner(lines, what) {
    const i = lines.findIndex((l) => l.includes('MS-DOS version'));
    assert.ok(i >= 0, `${what}: the kernel banner never appeared\n${lines.join('\n').trimEnd()}`);
    return lines.slice(i).join('\n').trimEnd()
        // THE CLOCK IS THE ONE LINE THAT MUST DIFFER, and it is a result
        // rather than noise. COMMAND.COM prints the time from INT 1Ah's tick
        // count, and this boot SPENT time: a motor spin-up and a hundred-odd
        // controller commands are real 18.2 Hz ticks, where the service
        // layer's INT 13h returns in no emulated time at all. Blanking the
        // digits keeps the comparison about the disk; the assertion that
        // the hardware clock really did advance is made separately below,
        // because a hardware boot that took zero ticks would mean the
        // spin-up wait had quietly stopped happening.
        .replace(/Current time is\s+\S+/, 'Current time is <clock>');
}

/** Ticks since midnight, from the BDA the ROM maintains at 0040:006C. */
const ticksOf = (m) => (m._read(0x46c) | (m._read(0x46d) << 8)
    | (m._read(0x46e) << 16) | (m._read(0x46f) << 24)) >>> 0;

// ---------------------------------------------------------------------------
// Run 1: through the BIOS ROM and the real controller.
// ---------------------------------------------------------------------------

let hardware = null;
function bootOnHardware() {
    if (hardware) return hardware;
    const built = build(found.files);
    const io = built.iosys;

    const m = new I8086Machine(XTPC);
    m.loadRom(rom.bytes);
    wireDreq(m);
    m.chips.fdc1.insert(0, built.image, {
        cylinders: GEOM.totalSectors / (GEOM.sectorsPerTrack * GEOM.heads),
        heads: GEOM.heads,
        sectors: GEOM.sectorsPerTrack,
        bytesPerSector: GEOM.bytesPerSector,
    });
    m.reset();

    const cpu = m.cpu;
    const at = new Map();
    const seen = (k, i) => { if (!at.has(k)) at.set(k, i); };
    const HWINIT = io.sym('HWINIT'), RE_INIT = io.sym('RE_INIT');
    const DSK_RED = io.sym('DSK_RED'), CONIN = io.sym('CONIN');
    let commandSeg = null;
    let loaded = null;
    /** The 512 bytes at 0000:7C00 AS THEY LAND. They cannot be read at the
     *  end of the run: the boot sector's own stack grows down from 7C00h and
     *  the DOS puts buffers on top of it, so by the time there is a prompt
     *  those bytes are something else entirely. */
    let bootBytes = null;

    // TYPING, and the trigger took finding. The obvious one -- push a key
    // whenever the CPU is halted -- never fires: this DOS never blocks. Its
    // console device answers "is a key waiting?" with INT 16h AH=01h and the
    // kernel spins on it, so the machine is busy the whole time it is idle.
    //
    // So a key goes in when the ROM's INT 16h is ENTERED with the keyboard
    // ring empty. That is the machine asking, exactly, and it paces the keys
    // for free: the next one only goes in once the DOS has taken the last.
    const keys = [...'\r\rdir\r'];
    const INT16 = rom.symbols.get('int16').value;
    const ringEmpty = () =>
        (m._read(0x41a) | (m._read(0x41b) << 8)) === (m._read(0x41c) | (m._read(0x41d) << 8));

    const LIMIT = 60_000_000;
    let i = 0;
    for (; i < LIMIT; i++) {
        const cs = cpu.cs, ip = cpu.ip;
        if (cs === 0 && ip >= 0x7c00 && ip < 0x7e00) {
            if (!at.has('bootSector')) {
                bootBytes = new Uint8Array(512);
                for (let k = 0; k < 512; k++) bootBytes[k] = m._read(0x7c00 + k);
            }
            seen('bootSector', i);
        }
        else if (cs === MEM.biosSeg) {
            if (ip === 0) {
                if (!at.has('iosysEntry')) {
                    loaded = new Uint8Array(MEM.iosysBytes);
                    for (let k = 0; k < MEM.iosysBytes; k++) loaded[k] = m._read((MEM.biosSeg << 4) + k);
                }
                seen('iosysEntry', i);
            } else if (ip === HWINIT) seen('hwinit', i);
            else if (ip === RE_INIT) seen('kernelUp', i);
            else if (ip === DSK_RED) seen('blockRead', i);
            else if (ip === CONIN) seen('conin', i);
        } else if (cs === MEM.sysinitSeg && ip === 0) {
            if (!at.has('sysinit')) seen('sysinit', i);
            else seen('dosinit', i);
        } else if (cs >= HIGH && cs < 0xa000) seen('sysinitRelocated', i);
        else if (ip === 0x100 && cs > 0x0400 && cs < HIGH && commandSeg === null) {
            const psp = cs << 4;
            if (m._read(psp) === 0xcd && m._read(psp + 1) === 0x20) {
                commandSeg = cs;
                seen('commandCom', i);
            }
        }

        if (keys.length && cs === 0xf000 && ip === INT16 && ringEmpty()) {
            // The 8255's port A is the scancode latch and IRQ1 is the wire.
            // This is the path a key takes on the real machine, and here it
            // is the ONLY path: there is no service layer with a queue, so
            // the scancode has to go through the ROM's INT 09h, its
            // translation table and its ring buffer to become a character.
            m.chips.ppi1.setInputPort('a', SCANCODE[keys.shift()]);
            cpu.interrupt(9);
            continue;
        }
        m.step();
        if (at.has('conin') && !keys.length && (i & 0x1fff) === 0 && i - at.get('conin') > 20_000) {
            const t = screenOf(m).join('\n');
            if (t.includes('Directory of') && (t.match(/A>/g) || []).length >= 2) break;
        }
    }

    hardware = { built, io, m, at, steps: i, commandSeg, loaded, bootBytes, screen: screenOf(m) };
    return hardware;
}

// ---------------------------------------------------------------------------
// Run 2: the same image through the emulator's INT 13h, for comparison.
// ---------------------------------------------------------------------------

let service = null;
function bootOnService() {
    if (service) return service;
    const built = build(found.files);
    const io = built.iosys;
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m, {
        disk: built.image,
        geometry: { sectors: GEOM.sectorsPerTrack, heads: GEOM.heads },
    }).install();
    dos.type('\r\rdir\r');
    dos.loadBoot(built.image.subarray(0, 512), 0x00);

    const cpu = m.cpu;
    const at = new Map();
    const seen = (k, i) => { if (!at.has(k)) at.set(k, i); };
    const HWINIT = io.sym('HWINIT'), RE_INIT = io.sym('RE_INIT');
    const DSK_RED = io.sym('DSK_RED'), CONIN = io.sym('CONIN');
    let commandSeg = null;

    const LIMIT = 20_000_000;
    let i = 0;
    for (; i < LIMIT; i++) {
        const cs = cpu.cs, ip = cpu.ip;
        if (cs === 0 && ip >= 0x7c00 && ip < 0x7e00) seen('bootSector', i);
        else if (cs === MEM.biosSeg) {
            if (ip === 0) seen('iosysEntry', i);
            else if (ip === HWINIT) seen('hwinit', i);
            else if (ip === RE_INIT) seen('kernelUp', i);
            else if (ip === DSK_RED) seen('blockRead', i);
            else if (ip === CONIN) seen('conin', i);
        } else if (cs === MEM.sysinitSeg && ip === 0) {
            if (!at.has('sysinit')) seen('sysinit', i);
            else seen('dosinit', i);
        } else if (cs >= HIGH && cs < 0xa000) seen('sysinitRelocated', i);
        else if (ip === 0x100 && cs > 0x0400 && cs < HIGH && commandSeg === null) {
            const psp = cs << 4;
            if (m._read(psp) === 0xcd && m._read(psp + 1) === 0x20) {
                commandSeg = cs;
                seen('commandCom', i);
            }
        }
        dos.step();
        if (at.has('conin') && (i & 0x1fff) === 0 && i - at.get('conin') > 20_000) {
            const t = dos.screenText().join('\n');
            if (t.includes('Directory of') && (t.match(/A>/g) || []).length >= 2) break;
        }
    }
    service = { built, m, dos, at, steps: i, commandSeg, screen: dos.screenText() };
    return service;
}

const ORDER = ['bootSector', 'iosysEntry', 'hwinit', 'sysinit', 'sysinitRelocated',
    'dosinit', 'kernelUp', 'blockRead', 'commandCom', 'conin'];
function reached(b) {
    const done = ORDER.filter((k) => b.at.has(k));
    return done.length ? `got as far as ${done[done.length - 1]} (${done.join(' -> ')})`
        : 'the CPU never reached the boot sector at all';
}
const stage = (b, key, what) => assert.ok(b.at.has(key),
    `${what} -- ${reached(b)}, ${b.steps} instructions in.\nScreen:\n${b.screen.join('\n').trimEnd()}`);

// ---------------------------------------------------------------------------

test('the machine reaches the boot sector with no service layer at all', when, () => {
    const b = bootOnHardware();
    stage(b, 'bootSector',
        'the CPU never executed a boot sector. Everything before this point is the ROM: '
        + 'reset vector, POST, INT 19h, and an INT 13h that had to drive a uPD765 to get '
        + 'the 512 bytes');
    // ...and all 512 bytes are the DISK's boot sector, not something staged
    // in memory. They came off the uPD765 into DMA channel 2 before the CPU
    // had executed a single instruction outside the ROM.
    for (let k = 0; k < 512; k++) {
        assert.equal(b.bootBytes[k], b.built.image[k],
            `byte ${k} at 0000:7C00 is not byte ${k} of the disk image`);
    }
});

test('IO.SYS arrives byte for byte through the controller', when, () => {
    const b = bootOnHardware();
    stage(b, 'iosysEntry', 'the boot sector never transferred to IO.SYS at 0060:0000');
    stage(b, 'hwinit', 'IO.SYS was entered but its HWINIT code never ran');
    // Sixteen sectors, read one at a time by the boot sector's own loop, over
    // DMA channel 2. This is the assertion a page wrap or a terminal count
    // one byte early fails -- and it fails LOUDLY here, whereas in the boot
    // itself it would appear later as a kernel that behaves oddly.
    assert.deepEqual(b.loaded, b.io.bytes,
        'the 8,192 bytes of IO.SYS in memory are not the 8,192 bytes on the disk');
});

test('SYSINIT, the kernel and COMMAND.COM all come up on the real controller', when, () => {
    const b = bootOnHardware();
    stage(b, 'sysinit', 'IO.SYS ran its init but never jumped to SYSINIT');
    stage(b, 'sysinitRelocated', 'SYSINIT was entered but never reached high memory');
    stage(b, 'dosinit', 'SYSINIT never far-called MSDOS.SYS');
    stage(b, 'kernelUp', 'DOSINIT was entered but never returned');
    stage(b, 'blockRead',
        'the kernel came up but never asked our block driver for a sector -- so the '
        + 'BIOS driver was never exercised by the DOS, only by the loader');
    stage(b, 'commandCom', 'the DOS came up but COMMAND.COM was never EXECed');

    // COMMAND.COM's first 64 bytes, which are its entry code and are the
    // part it does not rewrite. Sampling further in compares against a
    // running program's own variables, not against the file.
    const com = found.files.command;
    for (let k = 0; k < 64; k++) {
        assert.equal(b.m._read((b.commandSeg << 4) + 0x100 + k), com[k],
            `COMMAND.COM byte ${k} is not what is on the disk`);
    }
    // The command tail SYSINIT passes is "/P", through the EXEC parameter
    // block -- and it arrived across a boot in which every sector of the
    // shell was fetched by the BIOS driver.
    const psp = b.commandSeg << 4;
    assert.equal(b.m._read(psp + 0x80), 2, 'a two-character command tail');
    assert.equal(String.fromCharCode(b.m._read(psp + 0x82)), 'P', 'which is /P');
});

test('the prompt appears and DIR lists the disk, typed in as scancodes', when, () => {
    const b = bootOnHardware();
    const text = b.screen.join('\n');
    stage(b, 'conin', 'the shell never came to rest waiting for a key');
    assert.match(text, /MS-DOS version 2\.00/, `no kernel banner\n${text.trimEnd()}`);
    assert.match(text, /Current date is Tue {2}1-01-1980/,
        `the CLOCK device did not answer -- it reads the ROM's INT 1Ah\n${text.trimEnd()}`);
    assert.match(text, /^A>/m, `no prompt\n${text.trimEnd()}`);
    assert.match(text, /Directory of {2}A:\\/, `DIR did not run\n${text.trimEnd()}`);
    assert.match(text, /COMMAND {2}COM {4}15480/, 'COMMAND.COM listed by size');
    assert.match(text, /1 File\(s\)/);
    assert.doesNotMatch(text, /Non-System disk|Disk error|Bad or missing/,
        `something on the disk did not load\n${text.trimEnd()}`);
    // The ROM really is the one printing: its power-on banner is still on
    // the screen above everything the DOS wrote.
    assert.match(text, /bw-board 8086 BIOS/, 'the ROM banner should still be there');
});

test('DIFFERENTIAL: both storage stacks reach all nine landmarks', when, () => {
    const hw = bootOnHardware();
    const sv = bootOnService();
    for (const k of ORDER) {
        assert.ok(sv.at.has(k), `the service-layer boot did not reach ${k} -- ${reached(sv)}`);
        assert.ok(hw.at.has(k),
            `the real-controller boot did not reach ${k} -- ${reached(hw)}.\n`
            + `The service-layer boot DID, from the same image, so the disagreement is in the `
            + `storage stack and not in the disk.\nScreen:\n${hw.screen.join('\n').trimEnd()}`);
    }
    assert.equal(hw.commandSeg, sv.commandSeg,
        'COMMAND.COM was loaded at a different segment by the two runs, which means the DOS '
        + 'saw a different amount of memory or a different file');
});

test('DIFFERENTIAL: both produce the same screen from the kernel banner down', when, () => {
    const hw = bootOnHardware();
    const sv = bootOnService();
    // The strongest single assertion in this file. Everything below the
    // banner was written by Microsoft's kernel and Microsoft's shell reading
    // Microsoft's files off a FAT12 volume -- through two completely
    // different implementations of "read sector N". A wrong byte anywhere in
    // the directory, the FAT or COMMAND.COM shows up here as a diff.
    assert.equal(fromBanner(hw.screen, 'the real-controller boot'),
        fromBanner(sv.screen, 'the service-layer boot'),
        'the two storage stacks disagree about what is on the disk');

    // ...and the difference that was normalised away is itself checked. A
    // boot that reached the prompt in zero ticks would mean the motor
    // spin-up wait is no longer happening -- which nothing else here notices,
    // because everything else works better without it.
    assert.ok(ticksOf(hw.m) >= 18,
        `the real-controller boot took only ${ticksOf(hw.m)} timer ticks. It should take at `
        + 'least a second: the motor spin-up wait alone is seventeen ticks.');
});

test('DIFFERENTIAL: the controller moved every sector cleanly', when, () => {
    const hw = bootOnHardware();
    const fdc = hw.m.chips.fdc1;
    // Over a hundred sectors went through the RQM/DIO handshake. src/upd765.js
    // never fails a mistimed access -- it counts it -- so these counters are
    // the only place a driver that reads 3F5h at the wrong moment shows up,
    // and a boot that succeeds anyway is exactly how such a driver survives.
    assert.equal(fdc.stats.badReads, 0,
        `${fdc.stats.badReads} reads of the data register while the controller was not `
        + 'driving the bus');
    assert.equal(fdc.stats.badWrites, 0,
        `${fdc.stats.badWrites} writes to the data register while the controller was talking`);
    assert.equal(fdc.stats.overruns, 0, 'a transfer ran with the DOR\'s DMA gate shut');
    assert.equal(fdc.stats.selectMismatch, 0,
        'a data command named a drive the DOR was not selecting');
    assert.equal(fdc.refusals, 0,
        `the controller refused a command: ${fdc.lastRefusal}`);
    assert.equal(hw.m._read(0x441), 0x00,
        '0040:0041 holds the status of the last INT 13h, and it should be a success');
});
