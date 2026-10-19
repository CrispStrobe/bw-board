#!/usr/bin/env node
/**
 * Tron 0xF — the Spectrum arc's acceptance GAME.
 *
 * programandala.net's tron_0xf (GPL — LOCAL-ONLY tape, never vendored;
 * this smoke SKIPs loudly without it) is a light-cycle game written in
 * fig-Forth for Abersoft Forth. Its "compilable" TAP carries the whole
 * chain: Abersoft Forth itself, the Afera library, thirteen source
 * files, custom fonts and the title bitmap — 116 tape blocks.
 *
 * What this run proves, all through the front door:
 *  - typed LOAD "" boots Abersoft fig-Forth from the tape ($0556 trap)
 *  - typed LOADT 1 LOAD compiles the ENTIRE game from source on the
 *    emulated machine — every Afera module and game file announces
 *    itself on screen while ~100 KB of Forth goes through the
 *    dictionary. This is the heaviest workload our Z80 has run.
 *  - the menu takes its option-initial key (P = Play), the arena
 *    draws, wait-any-key starts the round, riders move (bitmap
 *    deltas), and the beeper carries the engine sound (speakerEdges).
 *
 * Screen assertions read the bitmap back as text against the ROM font
 * (zxScreenText); the game's own FUTURE.FNT cells decode as '?', which
 * is exactly the contract — we assert on the ROM-font phases (Forth
 * banner, compile log) and on bitmap/sound activity for the game.
 *
 * Rebuild the TAP: cd ~/code/tron-0xf &&
 *   PATH="$PWD/.toolbin:$(brew --prefix)/opt/coreutils/libexec/gnubin:\
 *   $(brew --prefix)/opt/make/libexec/gnubin:$PATH" make VERSION=0.3.0-dev
 * (.toolbin shims: fsb via its Vim converter, bin2code reimplemented,
 *  pbm2scr via gforth — BSD sed can't run the Makefile's VERSION grep,
 *  hence the explicit VERSION.)
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Z80Machine } from '../src/z80-machine.js';
import { zxScreenText } from '../src/zx-ula.js';

const romPath = process.env.ZX_ROM || join(homedir(), 'code', 'zxs-rom', '48.ROM');
const tapPath = process.env.TRON_TAP
    || join(homedir(), 'code', 'tron-0xf', 'target', 'tron_0xf_v0.3.0-dev_compilable.tap');
for (const [p, hint] of [[romPath, 'build zxs-rom'], [tapPath, 'see header for the make recipe']]) {
    if (!existsSync(p)) { console.error(`SKIP (loudly): ${p} missing — ${hint}`); process.exit(2); }
}

const rom = readFileSync(romPath);
const tap = readFileSync(tapPath);

const m = new Z80Machine({
    clockHz: 3_500_000,
    regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }],
    ula: true,
});
m.load(rom, 0);
m.cpu.pc = 0;
m.insertTape(tap);

// The boot + full compile is ~7 emulated minutes. Snapshot it: the
// first run pays, every later run restores to the settled menu in
// milliseconds. Keyed on ROM+TAP content; delete the file (or set
// TRON_FULL=1) to re-verify the whole path.
const cachePath = tapPath + '.bootstate.json';
const cacheKey = createHash('sha256').update(rom).update(tap).digest('hex');
const useCache = !process.env.TRON_FULL;

let t = 0;
const press = (...combos) => {
    for (const names of combos) {
        m.ula.setKeys(names); m.advanceToMs(t += 120);
        m.ula.setKeys([]); m.advanceToMs(t += 120);
    }
};
const type = (s) => {
    for (const ch of s) {
        if (ch === ' ') press(['space']);
        else if (ch === '\n') press(['enter']);
        else press([ch.toLowerCase()]);
    }
};
const bitmap = () => m.mem.slice(0x4000, 0x5800);
const delta = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

const checks = [];
const expect = (what, ok) => { checks.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

let restored = false;
if (useCache && existsSync(cachePath)) {
    const s = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (s.key === cacheKey) {
        s.state.mem = Uint8Array.from(Buffer.from(s.state.mem, 'base64'));
        m.loadState(s.state);
        t = s.tMs;
        restored = true;
        console.log('boot state restored from cache (TRON_FULL=1 re-runs the whole path)');
    }
}

if (!restored) {
    // 1. Boot BASIC, LOAD "" → Abersoft Forth.
    m.advanceToMs(t = 4200);
    press(['j'], ['sym', 'p'], ['sym', 'p'], ['enter']);
    m.advanceToMs(t += 8000);
    expect('Abersoft fig-Forth boots from the tron tape',
        zxScreenText(m.mem).some((l) => /fig-FORTH 1\.1A/.test(l)));

    // 2. LOADT 1 LOAD — compile the whole game from tape (the long haul).
    type('LOADT 1 LOAD\n');
    while (m.tape.pos < m.tape.blocks.length && t < 600_000) m.advanceToMs(t += 5000);
    expect(`all ${m.tape.blocks.length} tape blocks consumed (source + fonts + title)`,
        m.tape.pos === m.tape.blocks.length);
    m.advanceToMs(t += 30_000); // graphics load + auto-run settle on the menu

    if (useCache) {
        const state = m.saveState();
        writeFileSync(cachePath, JSON.stringify({
            key: cacheKey, tMs: t,
            state: { ...state, mem: Buffer.from(state.mem).toString('base64') },
        }));
        console.log('boot state cached for next time:', cachePath);
    }
}
const menu = bitmap();
expect('title/menu drawn (bitmap populated)', menu.reduce((n, b) => n + (b !== 0 ? 1 : 0), 0) > 500);

// 3. P = Play (menu keys are the option initials), then any-key starts.
press(['p']);
m.advanceToMs(t += 4000);
const arena = bitmap();
expect('arena drawn after P (screen changed from menu)', delta(menu, arena) > 200);
const edgesBefore = m.ula.speakerEdges.length;
press(['space']);

// 4. The round runs: riders draw walls, the beeper carries sound.
let prev = bitmap(), moving = 0;
for (let i = 0; i < 6; i++) {
    m.advanceToMs(t += 2000);
    const cur = bitmap();
    if (delta(prev, cur) > 20) moving++;
    prev = cur;
}
expect(`riders animate (${moving}/6 intervals with wall growth)`, moving >= 2);
expect(`beeper active during play (${m.ula.speakerEdges.length - edgesBefore} new edges)`,
    m.ula.speakerEdges.length - edgesBefore > 100);

console.log(`\nemulated ${(t / 1000).toFixed(0)}s, ${m.ula.frame} frames`);
process.exit(checks.every(Boolean) ? 0 : 1);
