#!/usr/bin/env node
/**
 * Run a compiled ELKS program on a REAL booted ELKS kernel and capture its
 * output — the ELKS sibling of the DOS `run-dos` path.
 *
 * WHAT THIS IS. Given an ELKS a.out (Linux-8086, magic 0x0301 — e.g. from
 * `ia16-elf-gcc -mcmodel=small -melks-libc -mtune=i8086 -Os prog.c -o prog`,
 * built with the GPL-2 ELKS toolchain in the DEV phase, not shipped) and an
 * ELKS FAT floppy image (GPL-2, run as a black-box workload, never vendored),
 * this injects the program into the image, tells the kernel to exec it as init
 * via /bootopts, boots the whole thing on PCXT8086, and returns the screen text.
 *
 * THE THREE PIECES, and why each is where it is:
 *   1. INJECT — src/dos-fat-inject.js drops the a.out into the FAT root. ELKS
 *      FAT is the same FAT12 the DOS injector already writes; nothing new.
 *   2. AUTO-RUN — /bootopts carries `init=<path>`, so the kernel execs the
 *      injected file as PID 1. No interactive login/keyboard needed to prove a
 *      program ran. A program that RETURNS makes the kernel panic "no init", so
 *      a dev program meant to be run this way should not exit (pause/loop).
 *   3. DRIVE TYPE — the pinned XT-shaped ROM never returns INT 13h AH=08h's
 *      floppy drive type in BL, which ELKS needs (see i8086-elks-boot.test.mjs
 *      installFloppyDriveType for the full why). Supplied here as an opt-in
 *      onInterrupt hook, so no core/ROM/receipt-bound file is touched.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { injectFile, name83 } from '../src/dos-fat-inject.js';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { buildBios } from './build-bios.mjs';

const GEOM = { cylinders: 80, heads: 2, sectors: 18, bytesPerSector: 512 };

// Minimal in-place /bootopts editor: append a line, keeping the file within its
// existing cluster chain (ELKS bootopts is small; init= adds a dozen bytes).
function bpb(img) { const u = (o) => img[o] | (img[o + 1] << 8);
    return { sec: u(11), spc: img[13], rsvd: u(14), fats: img[16], rootEntries: u(17), spf: u(22) }; }
function layout(b) { const fatStart = b.rsvd, rootStart = fatStart + b.fats * b.spf,
    dataStart = rootStart + Math.ceil(b.rootEntries * 32 / b.sec); return { ...b, fatStart, rootStart, dataStart }; }
const fat12Get = (fat, n) => { const o = n + (n >> 1), v = fat[o] | (fat[o + 1] << 8); return (n & 1) ? (v >> 4) : (v & 0xfff); };

export function appendBootopts(image, line) {
    const out = image.slice(); const lay = layout(bpb(out));
    const fat = out.subarray(lay.fatStart * lay.sec, (lay.fatStart + lay.spf) * lay.sec);
    const rootOff = lay.rootStart * lay.sec, want = name83('BOOTOPTS');
    let ent = -1;
    for (let i = 0; i < lay.rootEntries; i++) { const o = rootOff + i * 32;
        if (out[o] === 0) break;
        if (String.fromCharCode(...out.subarray(o, o + 11)) === want) { ent = o; break; } }
    if (ent < 0) throw new Error('/bootopts not found in image root');
    let clus = out[ent + 26] | (out[ent + 27] << 8);
    const size = out[ent + 28] | (out[ent + 29] << 8) | (out[ent + 30] << 16) | (out[ent + 31] << 24);
    const chain = []; while (clus >= 2 && clus < 0xff8) { chain.push(clus); clus = fat12Get(fat, clus); }
    const cap = chain.length * lay.spc * lay.sec; const buf = Buffer.alloc(cap); let p = 0;
    for (const c of chain) { const lba = lay.dataStart + (c - 2) * lay.spc;
        out.subarray(lba * lay.sec, lba * lay.sec + lay.spc * lay.sec).forEach((b) => { buf[p++] = b; }); }
    const nw = buf.subarray(0, size).toString('latin1').replace(/\s*$/, '') + '\n' + line + '\n';
    const nb = Buffer.from(nw, 'latin1');
    if (nb.length > cap) throw new Error(`/bootopts would exceed its clusters (${nb.length} > ${cap})`);
    p = 0; for (const c of chain) { const lba = lay.dataStart + (c - 2) * lay.spc;
        for (let k = 0; k < lay.spc * lay.sec; k++) { out[lba * lay.sec + k] = p < nb.length ? nb[p] : 0; p++; } }
    out[ent + 28] = nb.length & 0xff; out[ent + 29] = (nb.length >> 8) & 0xff;
    out[ent + 30] = (nb.length >> 16) & 0xff; out[ent + 31] = (nb.length >> 24) & 0xff;
    return out;
}

/** The AT floppy drive-type-in-BL hook the XT-shaped ROM omits (see boot test). */
export function installFloppyDriveType(machine) {
    const prior = machine.hooks.onInterrupt;
    machine.hooks.onInterrupt = (ev) => {
        if (ev.vector === 0x13 && ev.source === 'int') {
            const cpu = machine.cpu;
            if (cpu.ah === 0x08 && cpu.dl < 0x80) {
                const geom = machine.chips.fdc1?.drives?.[cpu.dl & 3]?.geom;
                if (geom) { const cyl = geom.cylinders | 0, spt = geom.sectors | 0;
                    cpu.bl = cyl <= 40 ? 1 : spt >= 36 ? 5 : spt >= 18 ? 4 : spt >= 15 ? 2 : 3; }
            }
        }
        if (prior) prior(ev);
    };
}

const screenText = (m) => {
    const v = m.mem.subarray(0xb8000, 0xb8000 + 80 * 25 * 2); const lines = [];
    for (let r = 0; r < 25; r++) { let t = '';
        for (let c = 0; c < 80; c++) { const ch = v[(r * 80 + c) * 2]; t += (ch >= 32 && ch < 127) ? String.fromCharCode(ch) : ' '; }
        lines.push(t.replace(/\s+$/, '')); }
    return lines;
};

/**
 * @param {Uint8Array} image  an ELKS FAT floppy image
 * @param {Uint8Array} aout   an ELKS a.out (magic 0x0301)
 * @param {{name?:string, steps?:number, variant?:string}} [opts]
 * @returns {{screen:string[], image:Uint8Array}}
 */
export function runElksProgram(image, aout, opts = {}) {
    const name = opts.name || 'PROG';
    let img = injectFile(image, name, aout);
    img = appendBootopts(img, `init=/${name.toLowerCase()}`);
    const m = new I8086Machine(opts.variant ? { ...PCXT8086, variant: opts.variant } : PCXT8086);
    installFloppyDriveType(m);
    m.loadRom(buildBios().bytes);
    m.chips.fdc1.insert(0, img, GEOM);
    m.reset();
    for (let i = 0, n = opts.steps || 9_000_000; i < n; i++) m.step();
    return { screen: screenText(m), image: img };
}

// CLI: node scripts/run-elks-program.mjs <image.img> <prog.aout> [name]
if (import.meta.url === `file://${process.argv[1]}`) {
    const [imgPath, progPath, name] = process.argv.slice(2);
    if (!imgPath || !progPath) { console.error('usage: run-elks-program.mjs <elks-fat.img> <prog.aout> [name]'); process.exit(2); }
    const { screen } = runElksProgram(readFileSync(imgPath), readFileSync(progPath), { name });
    console.log(screen.filter((l) => l.trim()).join('\n'));
}
export default runElksProgram;
