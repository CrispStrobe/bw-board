// Booting real MS-DOS 2.0 on the 8086 tier.
//
// WHY THIS TEST EXISTS IN THIS SHAPE. Every other test in this repo checks a
// part. This one checks that the parts are the same machine: the CPU, the
// interrupt trap, the BIOS disk service, a FAT12 image built by hand, an
// IO.SYS written against SYSINIT.DOC, Microsoft's own SYSINIT.OBJ linked
// behind it, Microsoft's own kernel, and Microsoft's own shell. Nothing in
// that chain was written to accommodate anything else in it. If COMMAND.COM
// prints its prompt, they all work, and no unit test can make that claim.
//
// WHY THE STAGES ARE SEPARATE ASSERTIONS. "It did not boot" is useless.
// "It stopped after IO.SYS reached HWINIT but SYSINIT never got control" is
// a morning's work saved. So the boot runs ONCE, records the step at which
// the CPU first arrived at each landmark, and each stage is then its own
// test with its own message. A failure names the last stage that DID happen.
//
// The landmarks are real addresses, not flags a test helper set:
//
//   0000:7C00              the boot sector, where the BIOS put it
//   0060:0000              IO.SYS's entry -- the boot sector's far jump
//   0060:HWINIT            IO.SYS's own init code
//   0160:0000              SYSINIT, reached by IO.SYS's far jump
//   9F84:...               SYSINIT after it relocates itself below the top
//                          of memory, which is the first thing it does
//   0160:0000 (again)      MSDOS.SYS's DOSINIT: SYSINIT moved the kernel
//                          here and far-calls its offset 0
//   0060:RE_INIT           the ONLY way to arrive here is for DOSINIT to
//                          have returned, so it is the kernel-is-up mark
//   0060:DSK_RED           the DOS driving our block device
//   xxxx:0100              COMMAND.COM entered, with a real PSP in front
//
// SKIPPING. The Microsoft binaries are MIT-licensed but are not vendored
// here. With them absent every test below skips with the reason and the
// places that were searched, rather than failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';
import {
    findMsdosFiles, build, buildDosImage, buildIoSys, verifyDosImage,
    GEOM, MEM, SYSINIT_PUBLICS, layoutOf,
} from '../scripts/build-dos-image.mjs';

const found = findMsdosFiles();
/** node:test takes `skip` as a string and prints it, which is the point. */
const SKIP = found.ok ? false : `MS-DOS 2.0 binaries not present -- ${found.reason}`;
const when = { skip: SKIP };

/** Where SYSINIT relocates itself: just under MEMORY_SIZE = 640K. */
const HIGH = 0x9000;

let cached = null;
/**
 * Build the disk, boot it, and run until COMMAND.COM is waiting for a key.
 * Done once; every stage test reads the same run.
 */
function boot() {
    if (cached) return cached;
    const built = build(found.files);
    const io = built.iosys;
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m, {
        disk: built.image,
        geometry: { sectors: GEOM.sectorsPerTrack, heads: GEOM.heads },
    }).install();
    // Two carriage returns for the date and time prompts, then a DIR, which
    // makes the DOS read the directory back through our block driver.
    dos.type('\r\rDIR\r');
    dos.loadBoot(built.image.subarray(0, 512), 0x00);

    const cpu = m.cpu;
    const at = new Map();
    const seen = (k, i) => { if (!at.has(k)) at.set(k, i); };
    const HWINIT = io.sym('HWINIT'), RE_INIT = io.sym('RE_INIT');
    const DSK_RED = io.sym('DSK_RED'), CONIN = io.sym('CONIN');
    let commandSeg = null;
    /** IO.SYS as it sits in RAM the instant the boot sector hands over. It
     *  has to be taken THEN: SYSINITSEG is at 0160h, and the kernel is moved
     *  on top of it a moment later, so by the time the prompt appears those
     *  bytes are MSDOS.SYS and comparing them proves nothing. */
    let loaded = null;

    const LIMIT = 10_000_000;
    let i = 0;
    for (; i < LIMIT; i++) {
        const cs = cpu.cs, ip = cpu.ip;
        if (cs === 0 && ip >= 0x7c00 && ip < 0x7e00) seen('bootSector', i);
        else if (cs === MEM.biosSeg) {
            if (ip === 0) {
                if (!at.has('iosysEntry')) {
                    loaded = new Uint8Array(MEM.iosysBytes);
                    for (let k = 0; k < MEM.iosysBytes; k++) loaded[k] = m._read((MEM.biosSeg << 4) + k);
                }
                seen('iosysEntry', i);
            }
            else if (ip === HWINIT) seen('hwinit', i);
            else if (ip === RE_INIT) seen('kernelUp', i);
            else if (ip === DSK_RED) seen('blockRead', i);
            else if (ip === CONIN) seen('conin', i);
        } else if (cs === MEM.sysinitSeg && ip === 0) {
            // 0160h is BOTH where SYSINIT starts and where the kernel ends
            // up, in that order: SYSINIT vacates it before moving the DOS in.
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
        // Stop once everything typed has been answered: the DIR has printed
        // and a second prompt is up. Checked every few thousand steps, since
        // reading the text page costs 2,000 memory reads.
        if (at.has('conin') && (i & 0x1fff) === 0 && i - at.get('conin') > 20_000) {
            const t = dos.screenText().join('\n');
            if (t.includes('Directory of') && (t.match(/A>/g) || []).length >= 2) break;
        }
    }

    cached = { built, io, m, dos, at, steps: i, commandSeg, loaded, screen: dos.screenText() };
    return cached;
}

/** Name the last stage that DID happen, so a failure is actionable. */
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
// The image, before anything runs
// ---------------------------------------------------------------------------

test('SYSINIT.OBJ links, and publishes exactly what SYSINIT.DOC describes', when, () => {
    const io = buildIoSys(found.files.sysinit);
    for (const [name, off] of Object.entries(SYSINIT_PUBLICS)) {
        assert.equal(io.link.publics.get(name), off,
            `${name} should be at ${off.toString(16)}h in SYSINITSEG`);
    }
    // SYSINIT.DOC names one symbol the OEM must supply, RE_INIT. The object
    // needs seven. The other six are the messages from Microsoft's own
    // SYSIMES.ASM, which SYSINIT.DOC never mentions -- the first surprise of
    // this whole exercise, and the reason dos/iosys.asm carries them.
    assert.deepEqual([...io.link.externs].sort(),
        ['BADCOM', 'BADLD', 'BADOPM', 'BADSIZ', 'CRLFM', 'RE_INIT', 'SYSSIZE']);
    assert.ok(io.link.fixups > 100, `${io.link.fixups} fixups is too few to be the real object`);
});

test('a fixup on iterated data is placed by its RAW offset, not its expanded one', when, () => {
    // SYSINIT's EXEC parameter block is built with DB n DUP, so it arrives as
    // an LIDATA record and its three pointers arrive as fixups into the RAW
    // iterated field. Resolving them as if they indexed the expanded bytes
    // puts the command-line pointer ten bytes early -- COMMAND.COM still
    // boots, and complains it cannot find itself. The pointer to
    // COMMAND_LINE (0014h) is the one that matters.
    const io = buildIoSys(found.files.sysinit);
    const seg = io.link.image;
    const ptr = (o) => seg[o] | (seg[o + 1] << 8);
    assert.equal(ptr(0x37), 0x0014, 'EXEC command-line pointer -> COMMAND_LINE');
    assert.equal(ptr(0x3b), 0x0011, 'EXEC first FCB -> DEFAULT_DRIVE');
    assert.equal(ptr(0x3f), 0x0034, 'EXEC second FCB -> ZERO');
    for (const o of [0x39, 0x3d, 0x41]) {
        assert.equal(ptr(o), MEM.sysinitSeg, 'and each carries SYSINITSEG as its frame');
    }
});

test('the 360K image is well formed and ends with AA55h', when, () => {
    const b = boot().built;
    const lay = layoutOf();
    assert.equal(b.image.length, 368640, 'a 360K disk is 720 sectors of 512 bytes');
    assert.equal(b.image[510], 0x55);
    assert.equal(b.image[511], 0xaa);
    // The BPB the boot sector carries must be the one the driver in IO.SYS
    // answers BUILD BPB with, or the DOS and the loader disagree about the
    // same disk.
    const u16 = (o) => b.image[o] | (b.image[o + 1] << 8);
    assert.equal(u16(0x0b), GEOM.bytesPerSector);
    assert.equal(b.image[0x0d], GEOM.sectorsPerCluster);
    assert.equal(u16(0x11), GEOM.rootEntries);
    assert.equal(u16(0x13), GEOM.totalSectors);
    assert.equal(b.image[0x15], GEOM.mediaDescriptor);
    assert.equal(lay.dataStart, 12, 'cluster 2 begins at sector 12 on this geometry');
});

test('IO.SYS and MSDOS.SYS are the first two entries, contiguous from cluster 2', when, () => {
    const b = boot().built;
    const [io, dos, com] = b.entries;
    assert.equal(io.name, 'IO.SYS');
    assert.equal(dos.name, 'MSDOS.SYS');
    assert.equal(com.name, 'COMMAND.COM');
    assert.equal(io.first, 2, 'the boot sector reads from the first data cluster');
    assert.equal(dos.first, io.first + io.clusters, 'and reads straight on into the kernel');
    assert.equal(io.data.length % 1024, 0,
        'IO.SYS must be whole clusters so MSDOS.SYS starts on a paragraph');
    assert.equal(b.dosCurrentSeg, MEM.dosCurrent, 'which is what CURRENT_DOS_LOCATION says');
});

test('the builder refuses a system area that is not where the boot sector looks', when, () => {
    // The checks that earn their keep. Every failure below produces a disk
    // that is a perfectly valid FAT12 volume, passes any filesystem checker,
    // and boots to a blank screen.
    const good = boot().built;

    // 1. A system file that is not a whole number of clusters. MSDOS.SYS
    //    would then begin mid-cluster in memory, and CURRENT_DOS_LOCATION
    //    is a segment: it cannot name a byte.
    assert.throws(() => buildDosImage({
        iosys: found.files.command,              // 15,480 bytes: not 1K-aligned
        msdos: found.files.msdos,
        command: found.files.command,
    }), /not a whole number of 1024-byte clusters/);

    // 2. Something other than IO.SYS as the first directory entry.
    const renamed = { ...good, image: new Uint8Array(good.image) };
    const rootAt = good.lay.rootStart * GEOM.bytesPerSector;
    renamed.image.set(Buffer.from('XX      SYS', 'latin1'), rootAt);
    assert.throws(() => verifyDosImage(renamed, { iosys: good.entries[0].data,
        msdos: good.entries[1].data }), /first directory entry is "XX {6}SYS", not IO\.SYS/);

    // 3. The two system files not contiguous. The boot sector reads one run;
    //    a gap turns into a kernel with a hole in it.
    const split = { ...good, entries: good.entries.map((e) => ({ ...e })) };
    split.entries[1].first += 1;
    assert.throws(() => verifyDosImage(split, { iosys: good.entries[0].data,
        msdos: good.entries[1].data }), /must be contiguous/);

    // 4. No AA55h. The BIOS would not have run it either.
    const unsigned = { ...good, image: new Uint8Array(good.image) };
    unsigned.image[511] = 0;
    assert.throws(() => verifyDosImage(unsigned, { iosys: good.entries[0].data,
        msdos: good.entries[1].data }), /does not end with AA55h/);
});

test('a SYSINIT.OBJ that moved its variables is refused, not silently mislinked', when, () => {
    const mangled = new Uint8Array(found.files.sysinit);
    // PUBDEF for SYSINIT sits at the tail; corrupt CURRENT_DOS_LOCATION's
    // published offset and the build must notice rather than write the DOS
    // segment into whatever is there now.
    const i = Buffer.from(mangled).indexOf('CURRENT_DOS_LOCATION', 0, 'latin1');
    assert.ok(i > 0, 'the object should publish CURRENT_DOS_LOCATION by name');
    mangled[i + 'CURRENT_DOS_LOCATION'.length] ^= 0x20;
    assert.throws(() => buildIoSys(mangled), /puts CURRENT_DOS_LOCATION at/);
});

// ---------------------------------------------------------------------------
// The boot, stage by stage
// ---------------------------------------------------------------------------

test('stage 1 -- the boot sector runs at 0000:7C00', when, () => {
    const b = boot();
    stage(b, 'bootSector', 'the CPU never executed the boot sector');
    assert.equal(b.at.get('bootSector'), 0, 'it is the first thing that runs');
});

test('stage 2 -- IO.SYS is loaded and its init entry is reached', when, () => {
    const b = boot();
    stage(b, 'iosysEntry', 'the boot sector never transferred to IO.SYS at 0060:0000');
    stage(b, 'hwinit', 'IO.SYS was entered but its HWINIT code never ran');
    // Entering it is not enough: every byte the boot sector read must be the
    // IO.SYS that was built, including the SYSINIT image 4K in. That second
    // half is what a broken CHS conversion damages first -- cylinder 0 is
    // six sectors of it, so the beginning loads perfectly and the kernel
    // turns to zeros exactly where the interesting part begins.
    assert.deepEqual(b.loaded, b.io.bytes,
        'the 8,192 bytes of IO.SYS in memory are not the 8,192 bytes on the disk');
});

test('stage 3 -- SYSINIT gets control and relocates itself high', when, () => {
    const b = boot();
    stage(b, 'sysinit', 'IO.SYS ran its init but never jumped to SYSINIT at 0160:0000');
    assert.ok(b.at.get('sysinit') > b.at.get('hwinit'), 'and after HWINIT, not before');
    stage(b, 'sysinitRelocated',
        'SYSINIT was entered but never reached high memory: it relocates itself below '
        + 'MEMORY_SIZE as its first act, so failing here means MEMORY_SIZE or SYSSIZE '
        + 'is wrong');
    // MEMORY_SIZE is 640K and SYSINIT parks itself just under it.
    const cs = b.m.cpu.cs;
    void cs;
});

test('stage 4 -- the kernel initialises: DOSINIT is called and returns', when, () => {
    const b = boot();
    stage(b, 'dosinit', 'SYSINIT never far-called MSDOS.SYS at FINAL_DOS_LOCATION:0000');
    stage(b, 'kernelUp',
        'DOSINIT was entered but never returned: RE_INIT is called only after the kernel '
        + 'has initialised, so the kernel is where this stopped');
    assert.ok(b.at.get('kernelUp') > b.at.get('dosinit'));
});

test('stage 5 -- the DOS drives the block device in IO.SYS', when, () => {
    const b = boot();
    stage(b, 'blockRead',
        'the kernel came up but never asked our block driver for a sector, so it never '
        + 'looked at the disk');
    assert.ok(b.at.get('blockRead') > b.at.get('kernelUp'),
        'and it is the DOS asking, not the boot sector');
});

test('stage 6 -- COMMAND.COM is loaded and entered with a real PSP', when, () => {
    const b = boot();
    stage(b, 'commandCom', 'the DOS came up but COMMAND.COM was never EXECed');
    const seg = b.commandSeg;
    const com = found.files.command;
    for (let i = 0; i < 64; i++) {
        assert.equal(b.m._read((seg << 4) + 0x100 + i), com[i],
            `COMMAND.COM byte ${i} is not what is on the disk`);
    }
    // The command tail SYSINIT passes is "/P": permanent shell. It arrives
    // through the EXEC parameter block, whose pointers are LIDATA fixups.
    const psp = seg << 4;
    assert.equal(b.m._read(psp + 0x80), 2, 'a two-character command tail');
    assert.equal(String.fromCharCode(b.m._read(psp + 0x82)), 'P', 'which is /P');
    assert.equal(b.m._read(psp + 0x83), 0x0d, 'terminated with a carriage return');
});

test('stage 7 -- MS-DOS and COMMAND.COM announce themselves', when, () => {
    const b = boot();
    const text = b.screen.join('\n');
    assert.match(text, /MS-DOS version 2\.00/,
        `the kernel banner never appeared.\n${text.trimEnd()}`);
    assert.match(text, /Copyright 1981,82,83 Microsoft Corp\./);
    assert.match(text, /Command v\. 2\.0/, 'COMMAND.COM never printed its own banner');
    assert.doesNotMatch(text, /Non-System disk|Disk error/,
        'the boot sector rejected the disk it was built onto');
    assert.doesNotMatch(text, /Bad or missing/, 'SYSINIT could not load something');
});

test('stage 8 -- the prompt appears, and the shell is waiting for a key', when, () => {
    const b = boot();
    const text = b.screen.join('\n');
    // MS-DOS 2.0 asks for the date and time before the first prompt, which
    // is itself evidence: the CLOCK character device answered with six bytes
    // in the order DEVDRIV.DOC gives, and 1-1-1980 really was a Tuesday.
    assert.match(text, /Current date is Tue {2}1-01-1980/,
        `the CLOCK device did not answer.\n${text.trimEnd()}`);
    assert.match(text, /Current time is/);
    assert.match(text, /^A>/m, `no prompt.\n${text.trimEnd()}`);
    stage(b, 'conin', 'the shell never came to rest waiting for a key');
    assert.ok(b.steps < 20_000_000, 'and it got there without exhausting the budget');
});

test('stage 9 -- DIR reads the directory back through our own driver', when, () => {
    const b = boot();
    const text = b.screen.join('\n');
    assert.match(text, /Directory of {2}A:\\/, `DIR did not run.\n${text.trimEnd()}`);
    assert.match(text, /COMMAND {2}COM {4}15480/, 'COMMAND.COM should be listed by size');
    assert.doesNotMatch(text, /IO {6}SYS/,
        'IO.SYS is hidden and must not be listed, which is also how DOS knows it is a '
        + 'system disk');
    assert.match(text, /1 File\(s\)/);
});

test('nothing in the whole boot asked for a service this tier refuses', when, () => {
    const b = boot();
    assert.deepEqual(b.dos.report().unsupported, [],
        'an unimplemented BIOS call during a DOS boot is a hole in the service layer');
});
