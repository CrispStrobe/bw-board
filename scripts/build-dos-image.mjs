#!/usr/bin/env node
/**
 * Build a bootable MS-DOS 2.0 360K floppy image for the bw-board 8086 tier.
 *
 * WHAT THIS PRODUCES, and why it is a better test than a unit test. The
 * output is a 368,640-byte FAT12 image holding a boot sector this script
 * writes, an IO.SYS this repo assembles from `dos/iosys.asm`, and Microsoft's
 * own MSDOS.SYS and COMMAND.COM from the MIT `microsoft/MS-DOS` release. If
 * `test/dos-boot.test.mjs` gets a COMMAND.COM prompt out of it, then the CPU,
 * the interrupt path, the DOS kernel, the device-driver interface, the FAT
 * and the disk service have all been exercised together by code that was
 * never written to accommodate them.
 *
 * THE FOUR THINGS THAT MAKE A HAND-BUILT DOS DISK FAIL SILENTLY, all of
 * which are checked here and all of which fail LOUDLY:
 *
 *   1. IO.SYS and MSDOS.SYS must be the FIRST TWO directory entries, in that
 *      order. The boot sector loads them by POSITION -- it does not walk the
 *      FAT and it does not search the directory -- which is exactly why
 *      MS-DOS's own SYS.COM refused to work on a disk that had ever held
 *      another file first.
 *   2. They must be CONTIGUOUS, starting at cluster 2, with MSDOS.SYS
 *      beginning immediately after IO.SYS ends. The boot sector reads one
 *      run of sectors; a fragmented file turns into a kernel with a hole in
 *      it and a machine that triple-faults with nothing on screen.
 *   3. IO.SYS's on-disk length must be a whole number of clusters, so that
 *      MSDOS.SYS lands on a paragraph boundary when the run is read into
 *      memory. CURRENT_DOS_LOCATION is a SEGMENT; it cannot name a byte.
 *   4. The image must end its boot sector with AA55h, or nothing will run
 *      it at all.
 *
 * THE OMF LINKER. SYSINIT.OBJ is an Intel OMF object, and Microsoft's build
 * ran MS-LINK over it together with the OEM's BIOS. There is no MS-LINK here,
 * so `linkSysinit()` below is a ~200-line linker for exactly the subset that
 * object uses: one segment, LEDATA/LIDATA, and FIXUPP records with SEGDEF and
 * EXTDEF frames and targets. It is small because the object is simple, and
 * writing it is the price of using Microsoft's init module rather than
 * reimplementing what it does.
 *
 * ASSEMBLER LIMITATIONS WORKED AROUND (src/i8086-asm.js is another worker's
 * file and was NOT edited; this list is for whoever owns it):
 *
 *   a. `MOV word ptr [mem], LABEL` is read as memory-to-memory and rejected.
 *      `OFFSET LABEL` is required where MASM infers it. The cost is not the
 *      OFFSET -- it is that the error says "MOV cannot move memory to memory",
 *      which sends you looking at the wrong operand. Five sites in
 *      dos/iosys.asm needed it.
 *   b. There is no syntax for a far jump to a LITERAL segment:offset.
 *      `JMP FAR PTR label` is refused for a flat image -- correctly, since it
 *      would need a load-time fixup -- but `JMP 0160h:0000h` needs no fixup
 *      at all and is not accepted either. Both this boot sector and
 *      dos/iosys.asm hand-assemble it as DB 0EAh / DW off / DW seg. This is
 *      the one that would be worth adding: every boot chain in the world ends
 *      with that instruction.
 *   c. `ORG` forward, from the end of one block to a much later offset, works
 *      and zero-fills. Not a limitation -- recorded because the build depends
 *      on it: it is what lets one source file carry two linkage units, the
 *      BIOS and the SYSINIT message module that must live in SYSINIT's own
 *      segment.
 *   d. Out-of-range conditional jumps are diagnosed beautifully -- the message
 *      names the distance, the target and the `longJumps` option, and says
 *      what accepting it would cost. Two were hit here and both were the
 *      code's fault, not the assembler's; both were fixed by inverting the
 *      sense around a near JMP rather than by reaching for the option.
 *
 * @module
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assemble from '../src/i8086-asm.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ---------------------------------------------------------------------------
// The geometry. 360K, 5.25", double sided, nine sectors a track: the format
// MS-DOS 2.0 was released on.
// ---------------------------------------------------------------------------
export const GEOM = Object.freeze({
    bytesPerSector: 512,
    sectorsPerCluster: 2,
    reservedSectors: 1,
    fats: 2,
    rootEntries: 112,
    totalSectors: 720,
    mediaDescriptor: 0xfd,
    sectorsPerFat: 2,
    sectorsPerTrack: 9,
    heads: 2,
    hiddenSectors: 0,
});

/** Derived sector numbers, computed once so nothing has to agree by hand. */
export function layoutOf(g = GEOM) {
    const fatStart = g.reservedSectors;
    const rootStart = fatStart + g.fats * g.sectorsPerFat;
    const rootSectors = (g.rootEntries * 32) / g.bytesPerSector;
    const dataStart = rootStart + rootSectors;
    return {
        fatStart, rootStart, rootSectors, dataStart,
        clusterBytes: g.sectorsPerCluster * g.bytesPerSector,
        imageBytes: g.totalSectors * g.bytesPerSector,
    };
}

/** Where IO.SYS is loaded and how the segments above it fall out. These are
 *  the same numbers `dos/iosys.asm` states as EQUs; `buildIoSys` checks the
 *  two agree rather than trusting them to. */
export const MEM = Object.freeze({
    biosSeg: 0x0060,        // BIOSSEG
    biosBytes: 0x1000,      // BIOSIZ -- the resident BIOS
    sysinitSeg: 0x0160,     // BIOSSEG + BIOSIZ/16
    iosysBytes: 0x2000,     // IOSYSIZ -- IO.SYS on disk, two clusters' worth
    dosCurrent: 0x0260,     // CURRENT_DOS_LOCATION
    dosFinal: 0x0160,       // FINAL_DOS_LOCATION
});

/** SYSINIT's public variables. Offsets from SYSINIT.DOC; asserted against the
 *  PUBDEF records in SYSINIT.OBJ, because a silently-moved variable is a boot
 *  that dies with the screen blank. */
export const SYSINIT_PUBLICS = Object.freeze({
    SYSINIT: 0x0000,
    CURRENT_DOS_LOCATION: 0x0005,
    FINAL_DOS_LOCATION: 0x0009,
    DEVICE_LIST: 0x000b,
    MEMORY_SIZE: 0x000f,
    DEFAULT_DRIVE: 0x0011,
    BUFFERS: 0x0012,
    FILES: 0x0013,
});

class BuildError extends Error {
    constructor(msg) { super(`build-dos-image: ${msg}`); this.name = 'BuildError'; }
}
const fail = (m) => { throw new BuildError(m); };

// ===========================================================================
// Finding the Microsoft binaries.
// ===========================================================================

/** The four names, under both the flat `v2.0_bin_X` convention a raw fetch
 *  from raw.githubusercontent.com leaves behind and the plain one. */
const WANT = {
    msdos: ['v2.0_bin_MSDOS.SYS', 'MSDOS.SYS', 'msdos.sys'],
    command: ['v2.0_bin_COMMAND.COM', 'COMMAND.COM', 'command.com'],
    sysinit: ['v2.0_bin_SYSINIT.OBJ', 'SYSINIT.OBJ', 'sysinit.obj'],
};

/**
 * Where to look. MSDOS_BIN_DIR, when set, is the ONLY place searched -- an
 * explicit answer should not be quietly second-guessed by a fallback, and it
 * is what makes the skip path testable: point it somewhere empty and the
 * suite must skip rather than find the files anyway.
 */
export function searchDirs() {
    if (process.env.MSDOS_BIN_DIR) return [process.env.MSDOS_BIN_DIR];
    return [join(REPO, 'vendor', 'msdos'), join(REPO, 'roms', 'msdos'),
        join(REPO, 'dos', 'bin'), '/tmp/msdosbin'];
}

/**
 * Load MSDOS.SYS, COMMAND.COM and SYSINIT.OBJ, or say precisely what is
 * missing and where it was looked for.
 *
 * LICENCE NOTE, and it is not a formality. Only files from the MIT-licensed
 * `microsoft/MS-DOS` release are used. That repository ALSO carries
 * `v4.0-ozzie/bin/DRDOS1_IMD.img` and `DRDOS2_IMD.img`, which are DR-DOS --
 * Digital Research's work, not Microsoft's. A repository's LICENSE file
 * covers what its uploader owned; it does not launder somebody else's
 * product. Those two files are not used here and must not be.
 *
 * @returns {{ok: true, files: {msdos: Uint8Array, command: Uint8Array,
 *             sysinit: Uint8Array}, dir: string}
 *         | {ok: false, reason: string}}
 */
export function findMsdosFiles(dirs = searchDirs()) {
    const tried = [];
    for (const dir of dirs) {
        if (!existsSync(dir)) { tried.push(`${dir} (no such directory)`); continue; }
        const found = {};
        const missing = [];
        for (const [key, names] of Object.entries(WANT)) {
            const hit = names.map((n) => join(dir, n)).find((p) => existsSync(p));
            if (hit) found[key] = new Uint8Array(readFileSync(hit));
            else missing.push(names[0]);
        }
        if (!missing.length) return { ok: true, files: found, dir };
        tried.push(`${dir} (missing ${missing.join(', ')})`);
    }
    // One line, no embedded newlines: this string is handed to node:test as a
    // skip reason and a test runner prints those on one line whatever you do.
    return {
        ok: false,
        reason: 'MSDOS.SYS, COMMAND.COM and SYSINIT.OBJ were not found. They are '
            + 'MIT-licensed, from github.com/microsoft/MS-DOS/tree/main/v2.0/bin; put '
            + 'them in one of these places or set MSDOS_BIN_DIR -- '
            + tried.join('; '),
    };
}

// ===========================================================================
// A very small Intel OMF linker, for exactly what SYSINIT.OBJ uses.
// ===========================================================================

const REC = {
    THEADR: 0x80, COMENT: 0x88, MODEND: 0x8a, EXTDEF: 0x8c, PUBDEF: 0x90,
    LNAMES: 0x96, SEGDEF: 0x98, GRPDEF: 0x9a, FIXUPP: 0x9c,
    LEDATA: 0xa0, LIDATA: 0xa2,
};

/** OMF indices are one byte under 128 and two bytes with the high bit set. */
function readIndex(b, p) {
    const v = b[p];
    return v & 0x80 ? { value: ((v & 0x7f) << 8) | b[p + 1], next: p + 2 }
        : { value: v, next: p + 1 };
}

/**
 * Expand one LIDATA iterated-data block into `out` at `off`, recording where
 * each raw byte of the record ended up.
 *
 * THE MAP IS THE POINT, and its absence cost this build an evening. A FIXUPP
 * that follows an LEDATA names a byte by its offset within that record's
 * data, which is just the segment offset less the record's own. A FIXUPP that
 * follows an LIDATA names a byte by its offset within the RAW ITERATED FIELD
 * -- repeat counts, block counts, length bytes and all -- because a fixup on
 * iterated data has to be applied to every copy the iteration makes. Treat
 * the two the same and the fixups land at plausible-looking wrong addresses.
 *
 * The symptom was superb: MS-DOS booted, COMMAND.COM ran, DIR worked, and the
 * only thing wrong was that COMMAND.COM said "Specified COMMAND search
 * directory bad", because the one structure this object patches through an
 * LIDATA is the EXEC parameter block SYSINIT uses to launch it, and its
 * command-line pointer had picked up an offset ten bytes early.
 *
 * @param {Uint8Array} b raw iterated-data field
 * @param {number} p index into it
 * @param {Uint8Array} out the segment image
 * @param {number} off where the next produced byte goes
 * @param {{raw:number, len:number, out:number}[]} emit  filled in with one
 *        entry per emitted chunk, mapping raw bytes to produced offsets
 */
function expandLidata(b, p, out, off, emit) {
    const repeat = b[p] | (b[p + 1] << 8);
    const blocks = b[p + 2] | (b[p + 3] << 8);
    p += 4;
    if (blocks === 0) {
        const len = b[p++];
        const raw = p;
        p += len;
        for (let r = 0; r < repeat; r++) {
            for (let i = 0; i < len; i++) out[off + i] = b[raw + i];
            emit.push({ raw, len, out: off });
            off += len;
        }
        return { next: p, off };
    }
    const start = p;
    let end = p;
    for (let r = 0; r < repeat; r++) {
        let q = start;
        for (let i = 0; i < blocks; i++) {
            const res = expandLidata(b, q, out, off, emit);
            q = res.next; off = res.off;
        }
        end = q;
    }
    return { next: end, off };
}

/** Where a raw byte of an LIDATA record ended up, or -1 if it is not part of
 *  any emitted chunk (a count or a length byte, which nothing can fix up). */
function lidataOutOffsets(emit, rawOffset) {
    const hits = [];
    for (const e of emit) {
        if (rawOffset >= e.raw && rawOffset < e.raw + e.len) hits.push(e.out + (rawOffset - e.raw));
    }
    return hits;
}

/**
 * Link SYSINIT.OBJ into a flat segment image.
 *
 * @param {Uint8Array} obj                    SYSINIT.OBJ
 * @param {object} o
 * @param {number} o.sysinitSeg               paragraph SYSINITSEG will live at
 * @param {Map<string,{seg:number,off:number}>} o.externs  resolution for the
 *        EXTDEF names -- SYSINIT.OBJ needs seven and SYSINIT.DOC mentions one
 * @returns {{image: Uint8Array, segLen: number, publics: Map<string,number>,
 *            externs: string[], fixups: number}}
 */
export function linkSysinit(obj, { sysinitSeg, externs }) {
    const lnames = [];
    const segdefs = [];
    const extdefs = [];
    const publics = new Map();
    let image = null;
    let segLen = 0;
    const covered = [];
    let lastData = null;       // segment offset of the data record a FIXUPP refers to
    let lastIterated = null;   // raw-to-produced map, when that record was LIDATA
    let fixups = 0;

    let p = 0;
    while (p < obj.length) {
        const type = obj[p];
        if (type === 0) break;                        // trailing padding
        const len = obj[p + 1] | (obj[p + 2] << 8);
        if (len === 0) fail(`OMF record at ${p} has length 0`);
        const body = obj.subarray(p + 3, p + 3 + len - 1);
        const recEnd = p + 3 + len;

        switch (type) {
            case REC.LNAMES: {
                let q = 0;
                while (q < body.length) {
                    const l = body[q];
                    lnames.push(Buffer.from(body.subarray(q + 1, q + 1 + l)).toString('latin1'));
                    q += 1 + l;
                }
                break;
            }
            case REC.SEGDEF: {
                const attr = body[0];
                let q = 1;
                if ((attr >> 5) === 0) q += 3;              // absolute segment
                const L = body[q] | (body[q + 1] << 8); q += 2;
                const nameI = readIndex(body, q); q = nameI.next;
                const classI = readIndex(body, q); q = classI.next;
                segdefs.push({ len: L, name: lnames[nameI.value - 1], cls: lnames[classI.value - 1] });
                break;
            }
            case REC.EXTDEF: {
                let q = 0;
                while (q < body.length) {
                    const l = body[q];
                    extdefs.push(Buffer.from(body.subarray(q + 1, q + 1 + l)).toString('latin1'));
                    q += 1 + l + 1;                         // + type index
                }
                break;
            }
            case REC.PUBDEF: {
                const grp = readIndex(body, 0);
                const seg = readIndex(body, grp.next);
                let q = seg.next;
                if (seg.value === 0) q += 2;                // base frame
                while (q < body.length) {
                    const l = body[q];
                    const name = Buffer.from(body.subarray(q + 1, q + 1 + l)).toString('latin1');
                    q += 1 + l;
                    publics.set(name, body[q] | (body[q + 1] << 8));
                    q += 2;
                    q = readIndex(body, q).next;            // type index
                }
                break;
            }
            case REC.LEDATA: {
                const seg = readIndex(body, 0);
                if (seg.value !== 1) fail(`LEDATA for segment ${seg.value}; only one segment is supported`);
                const off = body[seg.next] | (body[seg.next + 1] << 8);
                const data = body.subarray(seg.next + 2);
                if (!image) fail('LEDATA before SEGDEF');
                image.set(data, off);
                covered.push([off, off + data.length]);
                lastData = off;
                lastIterated = null;
                break;
            }
            case REC.LIDATA: {
                const seg = readIndex(body, 0);
                if (seg.value !== 1) fail(`LIDATA for segment ${seg.value}`);
                const off = body[seg.next] | (body[seg.next + 1] << 8);
                if (!image) fail('LIDATA before SEGDEF');
                const rawFrom = seg.next + 2;
                const raw = body.subarray(rawFrom);
                const emit = [];
                let q = 0, cursor = off;
                while (q < raw.length) {
                    const r = expandLidata(raw, q, image, cursor, emit);
                    q = r.next; cursor = r.off;
                }
                covered.push([off, cursor]);
                lastData = off;
                lastIterated = emit;
                break;
            }
            case REC.FIXUPP: {
                if (lastData === null) fail('FIXUPP with no preceding data record');
                let q = 0;
                while (q < body.length) {
                    const b0 = body[q++];
                    if (!(b0 & 0x80)) {
                        fail('this object uses FIXUPP THREAD subrecords, which this '
                            + 'linker does not implement -- SYSINIT.OBJ does not use them, '
                            + 'so the object being linked is not the one this was written for');
                    }
                    const rawOffset = ((b0 & 0x03) << 8) | body[q++];
                    let locOffs;
                    if (lastIterated) {
                        locOffs = lidataOutOffsets(lastIterated, rawOffset);
                        if (!locOffs.length) {
                            fail(`a fixup names byte ${rawOffset} of an LIDATA record, which is `
                                + 'not inside any of its data blocks');
                        }
                    } else {
                        locOffs = [lastData + rawOffset];
                    }
                    const segRelative = (b0 >> 6) & 1;
                    const loc = (b0 >> 2) & 0x0f;
                    const fixdat = body[q++];
                    const fThread = (fixdat >> 7) & 1;
                    const frameMethod = (fixdat >> 4) & 7;
                    const tThread = (fixdat >> 3) & 1;
                    const hasNoDisp = (fixdat >> 2) & 1;
                    const targMethod = fixdat & 3;
                    if (fThread || tThread) fail('threaded FIXUPP field in an object that should have none');
                    let frameDatum = null, targetDatum = null;
                    if (frameMethod <= 2) { const r = readIndex(body, q); frameDatum = r.value; q = r.next; }
                    { const r = readIndex(body, q); targetDatum = r.value; q = r.next; }
                    let disp = 0;
                    if (!hasNoDisp) { disp = body[q] | (body[q + 1] << 8); q += 2; }

                    // --- resolve the target -------------------------------
                    let target;
                    if (targMethod === 0) {
                        if (targetDatum !== 1) fail(`fixup target names segment ${targetDatum}`);
                        target = { seg: sysinitSeg, off: disp };
                    } else if (targMethod === 2) {
                        const name = extdefs[targetDatum - 1];
                        const e = externs.get(name);
                        if (!e) {
                            fail(`SYSINIT.OBJ needs the external symbol ${name}, which nothing `
                                + 'supplies. SYSINIT.DOC documents only RE_INIT; the message '
                                + 'symbols come from Microsoft\'s SYSIMES.ASM and are assembled '
                                + 'into SYSINITSEG by dos/iosys.asm.');
                        }
                        target = { seg: e.seg, off: e.off + disp };
                    } else {
                        fail(`fixup target method ${targMethod} is not implemented`);
                    }

                    // --- resolve the frame --------------------------------
                    let frameSeg;
                    if (frameMethod === 0) {
                        if (frameDatum !== 1) fail(`fixup frame names segment ${frameDatum}`);
                        frameSeg = sysinitSeg;
                    } else if (frameMethod === 2) {
                        const name = extdefs[frameDatum - 1];
                        const e = externs.get(name);
                        if (!e) fail(`fixup frame names unknown external ${name}`);
                        frameSeg = e.seg;
                    } else if (frameMethod === 4 || frameMethod === 5) {
                        frameSeg = frameMethod === 4 ? sysinitSeg : target.seg;
                    } else {
                        fail(`fixup frame method ${frameMethod} is not implemented`);
                    }

                    const targetLin = (target.seg << 4) + target.off;
                    const frameLin = frameSeg << 4;
                    const put16 = (at, v) => { image[at] = v & 0xff; image[at + 1] = (v >> 8) & 0xff; };

                    for (const locOff of locOffs) {
                        const locLin = (sysinitSeg << 4) + locOff;
                        if (loc === 1 || loc === 5) {
                            const v = segRelative ? targetLin - frameLin : targetLin - (locLin + 2);
                            put16(locOff, v);
                        } else if (loc === 2) {
                            put16(locOff, frameSeg);
                        } else if (loc === 3) {
                            put16(locOff, targetLin - frameLin);
                            put16(locOff + 2, frameSeg);
                        } else if (loc === 0 || loc === 4) {
                            const v = segRelative ? targetLin - frameLin : targetLin - (locLin + 1);
                            image[locOff] = (loc === 0 ? v : v >> 8) & 0xff;
                        } else {
                            fail(`fixup location type ${loc} is not implemented`);
                        }
                        fixups++;
                    }
                }
                break;
            }
            case REC.MODEND: case REC.THEADR: case REC.COMENT: case REC.GRPDEF:
                break;
            default:
                fail(`unexpected OMF record type ${type.toString(16)}h at offset ${p}`);
        }

        if (type === REC.SEGDEF && segdefs.length === 1) {
            segLen = segdefs[0].len;
            image = new Uint8Array(segLen);
        }
        p = recEnd;
    }

    if (!image) fail('SYSINIT.OBJ contains no SEGDEF record');
    if (segdefs.length !== 1) fail(`expected one segment in SYSINIT.OBJ, found ${segdefs.length}`);
    if (segdefs[0].name !== 'SYSINITSEG') {
        fail(`the segment in SYSINIT.OBJ is named ${segdefs[0].name}, not SYSINITSEG`);
    }

    // The data records must reach the end of the segment, and none may run
    // past it. They need NOT cover every byte: MASM emits nothing at all for
    // `DB n DUP (?)`, so SYSINIT.OBJ has a real eight-byte hole at 84..91 --
    // the two reserved DWORD queue links in its device request packet. A
    // linker that treated that as corruption would reject a correct object;
    // one that did not notice a record running off the end would corrupt a
    // wrong one. Both are checked, and the holes are reported.
    covered.sort((a, b) => a[0] - b[0]);
    let reach = 0;
    const holes = [];
    for (const [s, e] of covered) {
        if (e > segLen) fail(`a data record covers ${s}..${e - 1}, past the ${segLen}-byte segment`);
        if (s > reach) holes.push([reach, s - 1]);
        reach = Math.max(reach, e);
    }
    if (reach !== segLen) {
        fail(`SYSINIT.OBJ's data records stop at ${reach} of a ${segLen}-byte segment`);
    }

    return { image, segLen, publics, externs: extdefs, fixups, holes };
}

// ===========================================================================
// IO.SYS
// ===========================================================================

/**
 * Assemble `dos/iosys.asm` and drop the linked SYSINIT into the hole it
 * leaves. The result is one flat file: the resident BIOS at offset 0,
 * SYSINITSEG at BIOSIZ, and the SYSINIT message module immediately after
 * SYSINIT.OBJ's own contribution to that segment.
 */
export function buildIoSys(sysinitObj, asmPath = join(REPO, 'dos', 'iosys.asm')) {
    const source = readFileSync(asmPath, 'utf8');
    const asm = assemble(source, { format: 'com' });
    const sym = (n) => {
        const s = asm.symbols.get(n.toLowerCase());
        if (!s) fail(`dos/iosys.asm defines no symbol ${n}`);
        return s.value;
    };

    // The asm states the memory map as EQUs; this checks it says the same
    // thing this script does, so the two cannot drift apart in silence.
    const equ = (n) => {
        const s = asm.symbols.get(n.toLowerCase());
        if (!s || s.kind !== 'equ') fail(`dos/iosys.asm defines no EQU ${n}`);
        return s.value;
    };
    const wants = {
        BIOSSEG: MEM.biosSeg, BIOSIZ: MEM.biosBytes, SYSINITSEG: MEM.sysinitSeg,
        IOSYSIZ: MEM.iosysBytes, DOSCUR: MEM.dosCurrent, DOSFIN: MEM.dosFinal,
    };
    for (const [n, v] of Object.entries(wants)) {
        if (equ(n) !== v) {
            fail(`dos/iosys.asm has ${n} = ${equ(n).toString(16)}h but this script `
                + `assumes ${v.toString(16)}h. One of the two is wrong; they describe the `
                + 'same memory map.');
        }
    }

    const biosEnd = sym('BIOS_END');
    if (biosEnd > MEM.biosBytes) {
        fail(`the resident BIOS is ${biosEnd} bytes but only BIOSIZ = ${MEM.biosBytes} are `
            + 'reserved before SYSINITSEG. Raise BIOSIZ (and BIOSIZS, SYSINITSEG, DOSFIN '
            + 'with it) or shrink the BIOS.');
    }

    // Resolve SYSINIT's seven externals. Six are the messages, which live in
    // SYSINITSEG after SYSINIT.OBJ's own bytes, so their offsets are their
    // assembled address less BIOSIZ. RE_INIT is a FAR entry in the BIOS.
    const inSysinitSeg = (n) => sym(n) - MEM.biosBytes;
    const externs = new Map([
        ['BADOPM', { seg: MEM.sysinitSeg, off: inSysinitSeg('BADOPM') }],
        ['CRLFM', { seg: MEM.sysinitSeg, off: inSysinitSeg('CRLFM') }],
        ['BADSIZ', { seg: MEM.sysinitSeg, off: inSysinitSeg('BADSIZ') }],
        ['BADLD', { seg: MEM.sysinitSeg, off: inSysinitSeg('BADLD') }],
        ['BADCOM', { seg: MEM.sysinitSeg, off: inSysinitSeg('BADCOM') }],
        ['SYSSIZE', { seg: MEM.sysinitSeg, off: inSysinitSeg('SYSSIZE') }],
        ['RE_INIT', { seg: MEM.biosSeg, off: sym('RE_INIT') }],
    ]);

    const link = linkSysinit(sysinitObj, { sysinitSeg: MEM.sysinitSeg, externs });

    // The offsets `dos/iosys.asm` hardcodes for SYSINIT's variables must be
    // the offsets the object actually publishes.
    for (const [name, off] of Object.entries(SYSINIT_PUBLICS)) {
        const got = link.publics.get(name);
        if (got === undefined) fail(`SYSINIT.OBJ publishes no ${name}`);
        if (got !== off) {
            fail(`SYSINIT.OBJ puts ${name} at ${got.toString(16)}h, but SYSINIT.DOC and `
                + `dos/iosys.asm say ${off.toString(16)}h. This is a different SYSINIT.`);
        }
    }
    // And the segment length the asm reserved for it must be the real one,
    // or the message module lands in the middle of Microsoft's code.
    const declared = equ('SI_SEGLEN');
    if (declared !== link.segLen) {
        fail(`dos/iosys.asm reserves SI_SEGLEN = ${declared.toString(16)}h for SYSINIT.OBJ, `
            + `but its segment is ${link.segLen.toString(16)}h bytes. The message module `
            + 'would overlap SYSINIT itself.');
    }
    for (const name of link.externs) {
        if (!externs.has(name)) fail(`SYSINIT.OBJ needs an external ${name} that is not supplied`);
    }

    const out = new Uint8Array(MEM.iosysBytes);
    const asmEnd = sym('IOSYS_END');
    if (asmEnd > MEM.iosysBytes) {
        fail(`IO.SYS assembles to ${asmEnd} bytes, more than IOSYSIZ = ${MEM.iosysBytes}`);
    }
    out.set(asm.bytes.subarray(0, Math.min(asm.bytes.length, MEM.iosysBytes)), 0);
    out.set(link.image, MEM.biosBytes);

    return {
        bytes: out,
        symbols: asm.symbols,
        sym,
        link,
        sysinitSeg: MEM.sysinitSeg,
        /** Byte offset of SYSSIZE inside SYSINITSEG -- how much of itself
         *  SYSINIT relocates to the top of memory. */
        syssize: inSysinitSeg('SYSSIZE'),
    };
}

// ===========================================================================
// The boot sector.
// ===========================================================================

/**
 * Our own boot sector. Not copied from anywhere: it is short enough to be
 * obvious and long enough to say what went wrong.
 *
 * It does three things and refuses to do a fourth. It checks that the first
 * two directory entries really are IO.SYS and MSDOS.SYS -- which is the check
 * that turns "the machine hangs" into "Non-System disk" -- it reads one
 * contiguous run of sectors starting at the first data sector, and it jumps
 * to BIOSSEG:0000 with DL still naming the drive. It does NOT walk the FAT.
 * Neither did the real one; that is why the two files had to be first and
 * contiguous, and why this script checks that they are.
 */
export function bootSectorSource(g, lay, sysSectors, loadSeg) {
    return `
; MS-DOS 2.0 boot sector for the bw-board 8086 tier -- see build-dos-image.mjs
DIRLBA      EQU ${lay.rootStart}
DATALBA     EQU ${lay.dataStart}
SYSSECS     EQU ${sysSectors}
LOADSEG     EQU ${loadSeg.toString(16)}h
SPT         EQU ${g.sectorsPerTrack}
HEADS       EQU ${g.heads}
SPCYL       EQU ${g.sectorsPerTrack * g.heads}

            ORG 7C00h
            jmp     short BOOT
            nop
            db      'BWBOARD1'          ; OEM name and version
            dw      ${g.bytesPerSector}
            db      ${g.sectorsPerCluster}
            dw      ${g.reservedSectors}
            db      ${g.fats}
            dw      ${g.rootEntries}
            dw      ${g.totalSectors}
            db      ${g.mediaDescriptor}
            dw      ${g.sectorsPerFat}
            dw      ${g.sectorsPerTrack}
            dw      ${g.heads}
            dw      ${g.hiddenSectors}

BOOT:
            cli
            xor     ax, ax
            mov     ds, ax
            mov     es, ax
            mov     ss, ax
            mov     sp, 7C00h           ; the stack grows down away from us
            sti
            cld
            mov     [DRIVE], dl

            ; --- the first root-directory sector, to 0000:0500 -------------
            mov     ax, DIRLBA
            mov     bx, 0500h
            mov     cx, 1
            call    READ
            jc      EDISK
            mov     si, 0500h
            mov     di, offset NM_IO
            call    CMP11
            jne     ENOSYS
            mov     si, 0520h
            mov     di, offset NM_DOS
            call    CMP11
            jne     ENOSYS

            ; --- the system, BY POSITION, in one run ----------------------
            mov     ax, LOADSEG
            mov     es, ax
            xor     bx, bx
            mov     ax, DATALBA
            mov     cx, SYSSECS
            call    READ
            jc      EDISK

            mov     dl, [DRIVE]
            ; JMP FAR PTR LOADSEG:0000 -- hand-assembled, see the module
            ; header: there is no syntax for a literal seg:off far jump.
            db      0EAh
            dw      0
            dw      LOADSEG

; --- the two ways this can end badly ---------------------------------------
; These sit here, between the loader and the read routine, because every
; conditional jump on an 8086 reaches 127 bytes and no further: put them at
; the bottom of the sector and a JC from the loader cannot get there.
ENOSYS:     mov     si, offset M_NOSYS
            jmp     short SAY
EDISK:      mov     si, offset M_DISK
SAY:        lodsb
            or      al, al
            jz      HANG
            mov     ah, 0Eh
            mov     bx, 0007h
            int     10h
            jmp     short SAY
HANG:       jmp     HANG

; --- read CX sectors from LBA AX into ES:BX --------------------------------
; One INT 13h call per sector. A run of 49 sectors crosses six tracks and no
; real controller reads across a track boundary, so the loop is not
; conservatism, it is the interface.
READ:
            push    ax
            push    cx
            push    si
            mov     [LSN], ax
            mov     [LEFT], cx
RDNEXT:
            cmp     word ptr [LEFT], 0
            je      RDDONE
            mov     ax, [LSN]
            xor     dx, dx
            mov     si, SPCYL
            div     si                  ; AX = cylinder, DX = within it
            mov     [CYL], al
            mov     ax, dx
            xor     dx, dx
            mov     si, SPT
            div     si                  ; AX = head, DX = sector - 1
            mov     dh, al
            mov     cl, dl
            inc     cl                  ; sectors are 1-based on the wire
            ; The cylinder goes into CH LAST, and SI rather than CX holds the
            ; divisor, because DIV takes a whole 16-bit register: parking the
            ; cylinder in CH and then dividing by CX wipes it, every read
            ; lands on cylinder 0, and the first six sectors -- which really
            ; are on cylinder 0 -- load perfectly before the kernel turns to
            ; zeros. That was a real hour of this build.
            mov     ch, [CYL]
            mov     dl, [DRIVE]
            mov     ax, 0201h           ; read one sector
            int     13h
            jc      RDFAIL
            add     bx, ${g.bytesPerSector}
            jnc     RDNOWRAP
            mov     ax, es
            add     ax, 1000h
            mov     es, ax
RDNOWRAP:
            inc     word ptr [LSN]
            dec     word ptr [LEFT]
            jmp     short RDNEXT
RDDONE:
            pop     si
            pop     cx
            pop     ax
            clc
            ret
RDFAIL:
            pop     si
            pop     cx
            pop     ax
            stc
            ret

; --- compare 11 bytes at DS:SI with DS:DI ----------------------------------
CMP11:
            mov     cx, 11
            repe    cmpsb
            ret

NM_IO:      db      'IO      SYS'
NM_DOS:     db      'MSDOS   SYS'
M_NOSYS:    db      13,10,'Non-System disk',13,10,0
M_DISK:     db      13,10,'Disk error',13,10,0
DRIVE:      db      0
CYL:        db      0
LSN:        dw      0
LEFT:       dw      0

            END
`;
}

/** Assemble the boot sector and pad it to 512 bytes with AA55h at the end. */
export function buildBootSector(g, lay, sysSectors, loadSeg) {
    const src = bootSectorSource(g, lay, sysSectors, loadSeg);
    const r = assemble(src, { format: 'com' });
    const code = r.bytes;                    // ORG 7C00h, so bytes start there
    if (code.length > 510) {
        fail(`the boot sector assembles to ${code.length} bytes and 510 is all there is `
            + 'before the AA55h signature');
    }
    const sec = new Uint8Array(g.bytesPerSector);
    sec.set(code, 0);
    sec[510] = 0x55; sec[511] = 0xaa;
    return sec;
}

// ===========================================================================
// FAT12
// ===========================================================================

/** Write cluster `n`'s 12-bit entry. Packed three nibbles at a time, which
 *  is the format's one genuinely fiddly corner. */
function fatSet(fat, n, value) {
    const off = n + (n >> 1);
    if (n & 1) {
        fat[off] = (fat[off] & 0x0f) | ((value & 0x0f) << 4);
        fat[off + 1] = (value >> 4) & 0xff;
    } else {
        fat[off] = value & 0xff;
        fat[off + 1] = (fat[off + 1] & 0xf0) | ((value >> 8) & 0x0f);
    }
}

export function fatGet(fat, n) {
    const off = n + (n >> 1);
    const v = fat[off] | (fat[off + 1] << 8);
    return (n & 1) ? (v >> 4) & 0xfff : v & 0xfff;
}

/** An 8.3 name padded the way a directory entry wants it. */
function name83(name) {
    const [base, ext = ''] = name.split('.');
    if (base.length > 8 || ext.length > 3) fail(`${name} is not an 8.3 name`);
    return (base.padEnd(8, ' ') + ext.padEnd(3, ' ')).toUpperCase();
}

// ===========================================================================
// The image
// ===========================================================================

/**
 * Assemble the whole disk.
 *
 * @param {{iosys: Uint8Array, msdos: Uint8Array, command: Uint8Array}} files
 * @returns {{image: Uint8Array, entries: object[], sysSectors: number,
 *            dataStart: number, dosCurrentSeg: number}}
 */
export function buildDosImage(files, g = GEOM) {
    const lay = layoutOf(g);
    const image = new Uint8Array(lay.imageBytes);
    const fat = new Uint8Array(g.sectorsPerFat * g.bytesPerSector);
    fat[0] = g.mediaDescriptor; fat[1] = 0xff; fat[2] = 0xff;

    // --- the three files, in the one order that boots --------------------
    const plan = [
        { name: 'IO.SYS', attr: 0x27, data: files.iosys },       // hidden+system+r/o+archive
        { name: 'MSDOS.SYS', attr: 0x27, data: files.msdos },
        { name: 'COMMAND.COM', attr: 0x20, data: files.command },
    ];

    let cluster = 2;
    const entries = [];
    for (const f of plan) {
        const clusters = Math.ceil(f.data.length / lay.clusterBytes);
        if (clusters === 0) fail(`${f.name} is empty`);
        const first = cluster;
        for (let i = 0; i < clusters; i++) {
            const c = first + i;
            fatSet(fat, c, i === clusters - 1 ? 0xfff : c + 1);
            const lba = lay.dataStart + (c - 2) * g.sectorsPerCluster;
            const at = lba * g.bytesPerSector;
            const from = i * lay.clusterBytes;
            image.set(f.data.subarray(from, Math.min(from + lay.clusterBytes, f.data.length)), at);
        }
        cluster = first + clusters;
        entries.push({ ...f, first, clusters });
    }
    if (cluster - 2 > (g.totalSectors - lay.dataStart) / g.sectorsPerCluster) {
        fail('the three files do not fit on a 360K disk');
    }

    // --- root directory ---------------------------------------------------
    const rootAt = lay.rootStart * g.bytesPerSector;
    entries.forEach((e, i) => {
        const at = rootAt + i * 32;
        const nm = name83(e.name);
        for (let k = 0; k < 11; k++) image[at + k] = nm.charCodeAt(k);
        image[at + 11] = e.attr;
        // 1980-01-01 00:00. A real date would make the image differ run to
        // run, and a byte-identical build is worth more than a timestamp.
        image[at + 22] = 0; image[at + 23] = 0;
        image[at + 24] = 0x21; image[at + 25] = 0x00;
        image[at + 26] = e.first & 0xff; image[at + 27] = (e.first >> 8) & 0xff;
        const n = e.data.length;
        image[at + 28] = n & 0xff; image[at + 29] = (n >> 8) & 0xff;
        image[at + 30] = (n >> 16) & 0xff; image[at + 31] = (n >>> 24) & 0xff;
    });

    // --- both FATs --------------------------------------------------------
    for (let i = 0; i < g.fats; i++) {
        image.set(fat, (lay.fatStart + i * g.sectorsPerFat) * g.bytesPerSector);
    }

    // --- the boot sector, which needs to know how much to read ------------
    // IO.SYS is padded to whole clusters, so it is read in full. MSDOS.SYS
    // follows immediately, and only the sectors it actually occupies are
    // read: the slack at the end of its last cluster is nothing, and reading
    // it would cost time and prove nothing.
    const io = entries[0], dos = entries[1];
    const sysSectors = io.clusters * g.sectorsPerCluster
        + Math.ceil(dos.data.length / g.bytesPerSector);
    image.set(buildBootSector(g, lay, sysSectors, MEM.biosSeg), 0);

    const result = {
        image, entries, lay, sysSectors,
        dosCurrentSeg: MEM.biosSeg + (io.clusters * lay.clusterBytes) / 16,
    };
    verifyDosImage(result, files, g);
    return result;
}

/**
 * Everything that must be true, checked out loud. This is the half of the
 * script that earns its keep: a FAT12 image that is merely well-formed still
 * fails to boot for reasons no FAT checker looks for.
 */
export function verifyDosImage({ image, entries, lay, sysSectors, dosCurrentSeg }, files, g = GEOM) {
    if (image.length !== lay.imageBytes) {
        fail(`the image is ${image.length} bytes, not ${lay.imageBytes}`);
    }
    if (image[510] !== 0x55 || image[511] !== 0xaa) {
        fail('the boot sector does not end with AA55h, so no BIOS would execute it');
    }

    const rootAt = lay.rootStart * g.bytesPerSector;
    const nameAt = (i) => Buffer.from(image.subarray(rootAt + i * 32, rootAt + i * 32 + 11)).toString('latin1');
    if (nameAt(0) !== 'IO      SYS') {
        fail(`the first directory entry is "${nameAt(0)}", not IO.SYS. The boot sector loads `
            + 'the system by position, so the order of the first two entries is load-bearing.');
    }
    if (nameAt(1) !== 'MSDOS   SYS') {
        fail(`the second directory entry is "${nameAt(1)}", not MSDOS.SYS`);
    }

    const [io, dos] = entries;
    if (io.first !== 2) fail(`IO.SYS starts at cluster ${io.first}, not 2`);
    if (dos.first !== io.first + io.clusters) {
        fail(`MSDOS.SYS starts at cluster ${dos.first} but IO.SYS ends at ${io.first + io.clusters - 1}: `
            + 'the two must be contiguous, because the boot sector reads them as one run');
    }
    if (io.data.length % lay.clusterBytes !== 0) {
        fail(`IO.SYS is ${io.data.length} bytes, not a whole number of ${lay.clusterBytes}-byte `
            + 'clusters. MSDOS.SYS would then start mid-cluster in memory and '
            + 'CURRENT_DOS_LOCATION, which is a segment, could not name it.');
    }
    if (dosCurrentSeg !== MEM.dosCurrent) {
        fail(`MSDOS.SYS would land at segment ${dosCurrentSeg.toString(16)}h but dos/iosys.asm `
            + `tells SYSINIT ${MEM.dosCurrent.toString(16)}h`);
    }

    // The run the boot sector reads must literally be the two files.
    const runAt = lay.dataStart * g.bytesPerSector;
    const run = image.subarray(runAt, runAt + sysSectors * g.bytesPerSector);
    if (run.length < files.iosys.length + files.msdos.length) {
        fail(`the boot sector reads ${sysSectors} sectors, which is not enough for `
            + `${files.iosys.length} + ${files.msdos.length} bytes of system`);
    }
    for (let i = 0; i < files.iosys.length; i++) {
        if (run[i] !== files.iosys[i]) fail(`IO.SYS differs from the image at byte ${i}`);
    }
    const dosAt = io.clusters * lay.clusterBytes;
    for (let i = 0; i < files.msdos.length; i++) {
        if (run[dosAt + i] !== files.msdos[i]) fail(`MSDOS.SYS differs from the image at byte ${i}`);
    }
    if (run[0] !== 0xeb && run[0] !== 0xe9) {
        fail('IO.SYS does not begin with a jump; the boot sector transfers to its offset 0');
    }
    if (files.msdos[0] !== 0xe9) {
        fail('MSDOS.SYS does not begin with a near JMP. SYSINIT reaches DOSINIT by a far '
            + 'call to FINAL_DOS_LOCATION:0000, so byte 0 of the kernel is an entry point.');
    }
    return true;
}

// ===========================================================================
// Everything at once
// ===========================================================================

/** Build IO.SYS and the whole disk from a directory of Microsoft binaries. */
export function build(files) {
    const io = buildIoSys(files.sysinit);
    const img = buildDosImage({ iosys: io.bytes, msdos: files.msdos, command: files.command });
    return { ...img, iosys: io };
}

/** The whole thing, or a reason it could not be done. */
export function buildFromDisk() {
    const found = findMsdosFiles();
    if (!found.ok) return found;
    return { ok: true, dir: found.dir, files: found.files, ...build(found.files) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const out = process.argv[2] || join(REPO, 'build', 'msdos200-360k.img');
    const r = buildFromDisk();
    if (!r.ok) { console.error(r.reason); process.exit(1); }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, r.image);
    writeFileSync(join(dirname(out), 'IO.SYS'), r.iosys.bytes);
    const e = r.entries;
    console.log(`sources          ${r.dir}`);
    console.log(`IO.SYS           ${r.iosys.bytes.length} bytes  `
        + `(BIOS ${r.iosys.sym('BIOS_END')}, SYSINIT ${r.iosys.link.segLen} + messages, `
        + `${r.iosys.link.fixups} fixups)`);
    console.log(`MSDOS.SYS        ${e[1].data.length} bytes, clusters ${e[1].first}..${e[1].first + e[1].clusters - 1}`);
    console.log(`COMMAND.COM      ${e[2].data.length} bytes, clusters ${e[2].first}..${e[2].first + e[2].clusters - 1}`);
    console.log(`boot loads       ${r.sysSectors} sectors from LBA ${r.lay.dataStart} to ${MEM.biosSeg.toString(16)}h:0000`);
    console.log(`MSDOS.SYS lands  ${r.dosCurrentSeg.toString(16)}h:0000  (CURRENT_DOS_LOCATION)`);
    console.log(`image            ${r.image.length} bytes -> ${out}`);
}
