#!/usr/bin/env node
/**
 * TMS9918 differential: our chip vs vrEmuTms9918 (MIT), frame by frame.
 *
 * Scenes are staged through OUR chip's real CPU interface (byte pairs,
 * data-port writes), then the raw register + VRAM state is handed to
 * the peer, which renders through visrealm's independent implementation.
 * Every pixel of every scene must agree; the first mismatch is reported
 * with coordinates, scene name, and both palette indices.
 *
 * Peer build (recipe also in scripts/tms9918/vdppeer.c):
 *   git clone --depth 1 https://github.com/visrealm/vrEmuTms9918 ~/code/vrEmuTms9918
 *   cc -O2 -I ~/code/vrEmuTms9918/src -o scripts/tms9918/vdppeer \
 *      scripts/tms9918/vdppeer.c ~/code/vrEmuTms9918/src/vrEmuTms9918.c
 *
 * Semantics note: the peer's ScanLine emits the BACKDROP index for
 * transparent pixels, as does our renderer — indices compare directly.
 * Exits 2 loudly when the peer binary is absent.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TMS9918 } from '../src/tms9918.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PEER = join(HERE, 'tms9918', 'vdppeer');
if (!existsSync(PEER)) {
    console.error(`SKIP (loudly): peer not built at ${PEER} — see header for the recipe`);
    process.exit(2);
}

const DATA = 0, CTRL = 1;
const poke = (v, addr, bytes) => {
    v.write(CTRL, addr & 0xff); v.write(CTRL, 0x40 | ((addr >> 8) & 0x3f));
    for (const b of bytes) v.write(DATA, b);
};
const reg = (v, r, val) => { v.write(CTRL, val); v.write(CTRL, 0x80 | r); };

/** Deterministic byte stream (no Math.random — reproducible runs). */
const prng = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16 & 0xff;

const SCENES = {
    'graphics1-tiles'(v) {
        // R2=1 → name table 0x0400; R3=0x10 → colors 0x0400... collision!
        // Keep them separate: colors at 0x0200 (R3=8), patterns 0x0800.
        reg(v, 1, 0xc0); reg(v, 2, 0x01); reg(v, 3, 0x08); reg(v, 4, 0x01); reg(v, 7, 0x04);
        const rnd = prng(1);
        poke(v, 0x0800, Array.from({ length: 2048 }, rnd));       // all 256 patterns
        poke(v, 0x0200, Array.from({ length: 32 }, (_, i) => (i << 4) | ((15 - i) & 0x0f)));
        poke(v, 0x0400, Array.from({ length: 768 }, (_, i) => i & 0xff));
    },
    'text-page'(v) {
        reg(v, 1, 0xd0); reg(v, 2, 0x00); reg(v, 4, 0x01); reg(v, 7, 0xf4);
        const rnd = prng(7);
        poke(v, 0x0800, Array.from({ length: 2048 }, rnd));       // glyphs
        poke(v, 0x0000, Array.from({ length: 960 }, (_, i) => (i * 7) & 0xff));
    },
    'graphics2-bitmap'(v) {
        reg(v, 1, 0xc0); reg(v, 0, 0x02);
        reg(v, 2, 0x0e);                    // name table 0x3800
        reg(v, 3, 0x9f); reg(v, 4, 0x00);   // colors 0x2000 (mask 0x60>>5=3? 0x9f: base bit7=1 → 0x2000, mask bits5-6 = 0)
        reg(v, 7, 0x01);
        const rnd = prng(3);
        poke(v, 0x0000, Array.from({ length: 0x1800 }, rnd));     // patterns 3 banks
        poke(v, 0x2000, Array.from({ length: 0x1800 }, rnd));     // colors 3 banks
        poke(v, 0x3800, Array.from({ length: 768 }, (_, i) => i & 0xff));
    },
    'sprites-8x8'(v) {
        reg(v, 1, 0xc0); reg(v, 2, 0x01); reg(v, 5, 0x20); reg(v, 6, 0x01); reg(v, 7, 0x04);
        const rnd = prng(11);
        poke(v, 0x0800, Array.from({ length: 1024 }, rnd));       // sprite patterns share 0x0800 window
        const attrs = [];
        for (let i = 0; i < 8; i++) attrs.push(20 * i, 30 * i, i * 3, i & 0x0f);
        attrs.push(0xd0);
        poke(v, 0x1000, attrs);
    },
    'sprites-16x16-mag-ec'(v) {
        reg(v, 1, 0xc3); reg(v, 2, 0x01); reg(v, 5, 0x20); reg(v, 6, 0x01); reg(v, 7, 0x0e);
        const rnd = prng(13);
        poke(v, 0x0800, Array.from({ length: 2048 }, rnd));
        poke(v, 0x1000, [
            10, 40, 4, 0x06,
            50, 10, 8, 0x83,   // EC set
            90, 200, 12, 0x09,
            0xd0,
        ]);
    },
    'blank-screen'(v) {
        reg(v, 1, 0x80); reg(v, 7, 0x07);   // BLANK low → backdrop only
        poke(v, 0x0000, Array.from({ length: 768 }, () => 0x55));
    },
};

let failures = 0;
for (const [name, stage] of Object.entries(SCENES)) {
    const ours = new TMS9918();
    stage(ours);
    const frame = ours.renderFrame();
    const input = Buffer.concat([Buffer.from(ours.regs), Buffer.from(ours.vram)]);
    const theirs = execFileSync(PEER, { input, maxBuffer: 1 << 20 });
    if (theirs.length !== 256 * 192) { console.error(`${name}: peer emitted ${theirs.length} bytes`); failures++; continue; }
    let diff = -1;
    for (let i = 0; i < theirs.length; i++) {
        if (frame.indices[i] !== theirs[i]) { diff = i; break; }
    }
    if (diff === -1) {
        console.log(`AGREE  ${name}`);
    } else {
        failures++;
        const x = diff % 256, y = (diff / 256) | 0;
        console.error(`DIFF   ${name}: first at (${x},${y}) ours=${frame.indices[diff]} peer=${theirs[diff]}`);
    }
}
process.exit(failures ? 1 : 0);
