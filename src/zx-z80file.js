/**
 * .Z80 — the archive's dominant Spectrum snapshot format, all three
 * header generations, 48K machines only (stated: 128K pages refuse
 * with the hardware mode named, they don't half-load).
 *
 * v1: 30-byte header, then the whole 48K ($4000-$FFFF), optionally
 *     ED-ED run-compressed, terminated by 00 ED ED 00.
 * v2/v3: header PC == 0 flags an extra header (length word at 30,
 *     real PC at 32, hardware mode at 34), then PAGES: each is
 *     [len:word][page#][data], len $FFFF meaning 16384 bytes stored
 *     uncompressed. 48K page numbers: 8 → $4000, 4 → $8000, 5 → $C000.
 *
 * Compression, both directions: ED ED nn vv = nn repeats of vv. A run
 * is only encoded at length 5+, EXCEPT runs of ED which encode from
 * length 2 (two literal EDs would read as a run marker); a single
 * literal ED forces the following byte literal, per the spec.
 *
 * loadZ80/saveZ80 mirror zx-sna.js: registers onto machine.cpu, RAM
 * into machine.mem, border to the ULA. saveZ80 writes v1 compressed —
 * every emulator since 1989 reads that.
 */

const RAM_BASE = 0x4000;
const RAM_LEN = 49152;

/** ED-ED run compression (v1 body rules). */
export function compressZ80(data) {
    const out = [];
    let i = 0;
    while (i < data.length) {
        const v = data[i];
        let run = 1;
        while (i + run < data.length && data[i + run] === v && run < 255) run++;
        if (v === 0xed && run >= 2) {
            out.push(0xed, 0xed, run, v);
            i += run;
        } else if (v === 0xed) {
            out.push(v);
            i++;
            if (i < data.length) { out.push(data[i]); i++; } // literal after lone ED
        } else if (run >= 5) {
            out.push(0xed, 0xed, run, v);
            i += run;
        } else {
            for (let k = 0; k < run; k++) out.push(v);
            i += run;
        }
    }
    return Uint8Array.from(out);
}

/** @param {Uint8Array} buf @param {Uint8Array} out fills out, returns bytes consumed
 *  @param {boolean} v1End stop at the 00 ED ED 00 end marker */
function decompress(buf, start, out, v1End) {
    let i = start; let o = 0;
    while (i < buf.length && o < out.length) {
        if (v1End && buf[i] === 0x00 && buf[i + 1] === 0xed && buf[i + 2] === 0xed && buf[i + 3] === 0x00) {
            i += 4; break;
        }
        if (buf[i] === 0xed && buf[i + 1] === 0xed) {
            const n = buf[i + 2]; const v = buf[i + 3];
            for (let k = 0; k < n && o < out.length; k++) out[o++] = v;
            i += 4;
        } else {
            out[o++] = buf[i++];
        }
    }
    return i - start;
}

const V2_PAGE_AT = { 8: 0x0000, 4: 0x4000, 5: 0x8000 }; // offsets into the 48K block

/** Parse a .z80 of any version into { regs, border, mem48k }. */
export function parseZ80(buf) {
    if (buf.length < 30) throw new Error('not a .z80 file: shorter than the v1 header');
    const r16 = (o) => buf[o] | (buf[o + 1] << 8);
    let flags12 = buf[12];
    if (flags12 === 0xff) flags12 = 1; // spec: 255 means 1 (ancient files)
    const regs = {
        a: buf[0], f: buf[1], bc: r16(2), hl: r16(4), pc: r16(6), sp: r16(8),
        i: buf[10], r: (buf[11] & 0x7f) | ((flags12 & 1) << 7),
        de: r16(13), bc_: r16(15), de_: r16(17), hl_: r16(19),
        af_: (buf[21] << 8) | buf[22],
        iy: r16(23), ix: r16(25),
        iff1: buf[27] ? 1 : 0, iff2: buf[28] ? 1 : 0, im: buf[29] & 0x03,
    };
    const border = (flags12 >> 1) & 0x07;
    const mem48k = new Uint8Array(RAM_LEN);

    if (regs.pc !== 0) {
        // v1: one block, compressed when flags bit 5 says so.
        if (flags12 & 0x20) decompress(buf, 30, mem48k, true);
        else mem48k.set(buf.subarray(30, 30 + RAM_LEN));
        return { version: 1, regs, border, mem48k };
    }

    // v2/v3: extra header, then pages.
    const extra = r16(30);
    regs.pc = r16(32);
    const hw = buf[34];
    const version = extra === 23 ? 2 : 3;
    const ok48 = version === 2 ? [0, 1] : [0, 1, 3];
    if (!ok48.includes(hw)) {
        throw new Error(`.z80 hardware mode ${hw} is not a 48K machine — 128K snapshots are a stated later step`);
    }
    let i = 32 + extra;
    while (i + 3 <= buf.length) {
        const len = r16(i); const page = buf[i + 2];
        i += 3;
        const at = V2_PAGE_AT[page];
        if (at === undefined) { i += (len === 0xffff ? 16384 : len); continue; } // ROM copies etc: skip
        const dst = mem48k.subarray(at, at + 16384);
        if (len === 0xffff) { dst.set(buf.subarray(i, i + 16384)); i += 16384; }
        else { decompress(buf, i, dst, false); i += len; }
    }
    return { version, regs, border, mem48k };
}

/** Restore a .z80 onto a 48K machine (ROM already loaded). */
export function loadZ80(machine, buf) {
    const { regs, border, mem48k } = parseZ80(buf);
    const cpu = machine.cpu;
    for (const [k, v] of Object.entries(regs)) cpu[k] = v;
    cpu.halted = 0;
    cpu.eiLatch = 0;
    if (machine.ula) machine.ula.border = border;
    machine.mem.set(mem48k, RAM_BASE);
}

/** Serialize a running 48K machine as v1 compressed. */
export function saveZ80(machine) {
    const cpu = machine.cpu;
    const h = new Uint8Array(30);
    const w16 = (o, v) => { h[o] = v & 0xff; h[o + 1] = (v >> 8) & 0xff; };
    h[0] = cpu.a; h[1] = cpu.f;
    w16(2, cpu.bc); w16(4, cpu.hl); w16(6, cpu.pc); w16(8, cpu.sp);
    h[10] = cpu.i; h[11] = cpu.r & 0x7f;
    h[12] = ((cpu.r >> 7) & 1) | (((machine.ula ? machine.ula.border : 0) & 7) << 1) | 0x20;
    w16(13, cpu.de); w16(15, cpu.bc_); w16(17, cpu.de_); w16(19, cpu.hl_);
    h[21] = (cpu.af_ >> 8) & 0xff; h[22] = cpu.af_ & 0xff;
    w16(23, cpu.iy); w16(25, cpu.ix);
    h[27] = cpu.iff1 ? 1 : 0; h[28] = cpu.iff2 ? 1 : 0; h[29] = cpu.im & 0x03;
    const body = compressZ80(machine.mem.subarray(RAM_BASE, RAM_BASE + RAM_LEN));
    const out = new Uint8Array(30 + body.length + 4);
    out.set(h, 0);
    out.set(body, 30);
    out.set([0x00, 0xed, 0xed, 0x00], 30 + body.length);
    return out;
}

export default { parseZ80, loadZ80, saveZ80, compressZ80 };
