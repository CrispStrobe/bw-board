#!/usr/bin/env node
/**
 * badapple-proof — run NormalLuser's Bad Apple decoder (GPL-3,
 * run-local-only, NEVER vendored) on the composable 6502 machine.
 *
 * The claim under test: the machine gaps named by the roadmap are
 * closed — 5 MHz clock, SD over bit-banged VIA SPI (MISO on the other
 * port's bit 7), and the shared-RAM framebuffer at $2000. Their
 * UNMODIFIED player binary must boot, stream its own SD image through
 * our card model, and paint recognizably-changing frames.
 *
 * Usage: node scripts/badapple-proof.mjs [player.bin] [sd-image.bin]
 * Defaults to ~/code/Ben-Eater-Bad-Apple's BadApple37FPS.bin +
 * BApple-Intro-Single-SD.bin.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { M6502Machine } from '../src/m6502-machine.js';
import { applyMedia, parseIhex } from '../src/machine-media.js';

const repo = join(homedir(), 'code', 'Ben-Eater-Bad-Apple');
const playerPath = process.argv[2] || join(repo, 'BadApple37FPS.bin');
const sdPath = process.argv[3] || join(repo, 'BApple-Intro-Single-SD.bin');
let player = readFileSync(playerPath);
let playerAt = 0x1800;
if (player[0] === 0x3a) {   // ':' — the repo's .bin files are Intel HEX text
    const parsed = parseIhex(player.toString('latin1'));
    player = parsed.bytes; playerAt = parsed.origin;
}
const sdImage = readFileSync(sdPath);
console.log(`player: ${playerPath.split('/').pop()} (${player.length} bytes)`);
console.log(`sd:     ${sdPath.split('/').pop()} (${(sdImage.length / 1e6).toFixed(1)} MB)`);

const config = {
    clockHz: 5_000_000,
    regions: [
        { kind: 'ram', start: 0x0000, end: 0x3fff },
        { kind: 'rom', start: 0x8000, end: 0xffff },
    ],
    chips: [
        { kind: 'via', name: 'via1', at: 0x6000 },
        // BadApple37FPS.asm: "Leave Port A empty except for MISO" — SPI
        // control (CS=$20 SCK=$10 MOSI=$08) bangs on PORT B ($6000),
        // MISO comes back on PA0. Cross-port, mirrored from their other
        // reader variant.
        { kind: 'sdcard', name: 'sd1', via: 'via1', pins: { cs: 5, sck: 'ca2', mosi: 3, port: 'b', miso: 0, misoPort: 'a' } },
        // The world's-worst-video-card window: writes $2000-$3FFF.
        { kind: 'framebuffer', name: 'vga', at: 0x2000, size: 0x2000 },
    ],
};

const m = new M6502Machine(config, {});
const { errors } = applyMedia({ machine: m, kind: 'eater6502' }, { 'sd-image': sdImage });
if (errors.length) throw new Error(JSON.stringify(errors));

// The player is a RAM program (.ORG $1800) — the real bench gets it via
// wozmon; the proof loads it straight and jumps.
// BENCH PRECONDITION, found the honest way: the player never writes
// DDRB — on the real build a prior program (the Wozmon-era loader
// session) leaves port B configured as outputs, and with DDRB=0 a real
// 6522 drives nothing and a real card hears no clocks either. The
// loader emulates what the bench state provides:
m._write(0x6002, 0xff); // DDRB: port B all outputs
m.mem.set(player, playerAt);
m.cpu.pc = playerAt;
console.log(`loaded at $${playerAt.toString(16)}, entry there`);

const fb = m.chips.vga;
const sd = m.chips.sd1;

function ascii(buf) {
    // Display is 100x64 mapped into 128-byte rows; sample every 2nd
    // column/row → 50x32 characters.
    const rows = [];
    for (let y = 0; y < 64; y += 2) {
        let line = '';
        for (let x = 0; x < 100; x += 2) {
            const v = buf[y * 128 + x];
            line += v > 0x20 ? '#' : v > 0 ? '+' : '.';
        }
        rows.push(line);
    }
    return rows.join('\n');
}

let lastWrites = 0;
const snapshots = [];
for (let sec = 1; sec <= 6; sec++) {
    m.advanceToMs(sec * 1000);
    const writes = fb.frame;
    const litPixels = fb.buf.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    console.log(`t=${sec}s  fb-writes=${writes} (+${writes - lastWrites})  lit=${litPixels}  pc=$${m.cpu.pc.toString(16)}`);
    lastWrites = writes;
    if (sec === 2 || sec === 4 || sec === 6) snapshots.push({ sec, art: ascii(fb.buf) });
}

console.log('\n=== frame @2s ===\n' + snapshots[0].art);
console.log('\n=== frame @6s ===\n' + snapshots[2].art);
const changed = snapshots[0].art !== snapshots[2].art;
console.log(`\nframes differ over time: ${changed}`);
console.log(changed && lastWrites > 100_000
    ? 'PROOF: the GPL demo streams SD through our VIA-SPI card and paints the worst-video-card window.'
    : 'NOT PROVEN — investigate.');
