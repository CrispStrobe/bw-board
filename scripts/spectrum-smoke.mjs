#!/usr/bin/env node
/**
 * The ZX Spectrum 48K boots on our Z80 — the Spectrum arc's first stone.
 *
 * ROM: the ORIGINAL, assembled byte-perfect (md5 4c42a2f0752123...) from
 * z00m128/zxs-rom's annotated source; Amstrad has given written
 * permission for redistribution of unmodified ROMs for emulator use
 * (zxs-rom LICENSE.md carries the statement). Machine: Z80Machine with
 * the ULA (config.ula) — 50 Hz frame INT, port $FE keyboard/border,
 * interleaved bitmap + attributes.
 *
 * Acceptance: the ROM's own life signs — FRAMES (sysvar $5C78)
 * counting at 50/s proves the IM 1 interrupt chain end to end; the
 * boot message paints pixels; a keypress leaves the (c) screen for
 * BASIC's K-cursor state, changing the screen.
 *
 * Rebuild recipe: clone z00m128/zxs-rom + z00m128/sjasmplus
 * (--recursive), rename the ABS label (operator-keyword collision,
 * changes no bytes), sjasmplus zx-spectrum-rom.asm.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Z80Machine } from '../src/z80-machine.js';

const romPath = process.env.ZX_ROM || join(homedir(), 'code', 'zxs-rom', '48.ROM');
if (!existsSync(romPath)) {
    console.error('SKIP (loudly): 48.ROM not found — see header for the recipe');
    process.exit(2);
}

const m = new Z80Machine({
    clockHz: 3_500_000,
    regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }],
    ula: true,
});
m.load(readFileSync(romPath), 0);
m.cpu.pc = 0;

const checks = [];
const expect = (what, ok) => { checks.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const frames = () => m.mem[0x5c78] | (m.mem[0x5c79] << 8) | (m.mem[0x5c7a] << 16);

m.advanceToMs(4000); // RAM test + boot to the (c) screen
const f1 = frames();
m.advanceToMs(5000);
const f2 = frames();
expect(`FRAMES sysvar counts at ~50/s via IM 1 (${f2 - f1} in 1s)`, f2 - f1 >= 48 && f2 - f1 <= 52);

const frame = m.ula.renderFrame();
const lit = frame.indices.reduce((n, p, i) => n + (p !== 7 && p !== m.ula.border ? 1 : 0), 0);
expect(`the boot screen paints (${lit} non-paper pixels)`, lit > 100);

const snap = Array.from(frame.indices);
m.ula.setKeys(['b']);
m.advanceToMs(5300);
m.ula.setKeys([]);
m.advanceToMs(5600);
const after = m.ula.renderFrame().indices;
let delta = 0;
for (let i = 0; i < snap.length; i++) if (snap[i] !== after[i]) delta++;
expect(`a keypress leaves the (c) screen (${delta} pixels changed)`, delta > 50);

console.log(`border=${m.ula.border} frame=${m.ula.frame}`);
process.exit(checks.every(Boolean) ? 0 : 1);
