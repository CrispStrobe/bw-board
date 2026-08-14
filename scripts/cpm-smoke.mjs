#!/usr/bin/env node
/**
 * CP/M 2.2 booting on our vector-complete Z80 core — the REAL thing:
 * our own BIOS (MC6850 console, host-side RAM-disk), Digital Research's
 * CCP+BDOS assembled for 64K, and R.T. Russell's BBC BASIC (Z80) on
 * top.  No BDOS shim, no instruction traps, just a working computer.
 *
 * The BIOS uses ports $10–$15 for a host-side RAM-disk controller:
 *   $10 drive, $11 track, $12 sector, $13/$14 DMA lo/hi, $15 command.
 * On OUT $15 the host transfers 128 bytes between Z80 memory and the
 * disk image.  The MC6850 ACIA at $80/$81 provides the console.
 *
 * Setup:
 *   git clone --depth 1 https://github.com/rtrussell/BBCZ80 ~/code/BBCZ80
 *   (bin/cpm/BBCBASIC.COM is prebuilt — zlib, shippable.)
 *
 * CP/M CCP+BDOS binary: roms/cpm/cpm22-64k.bin (see roms/cpm/PROVENANCE
 * for the Caldera/DRDOS license grant that makes this redistributable).
 * BIOS: roms/cpm/bios.bin (MIT, our own).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { Z80Machine, CPM64K } from '../src/z80-machine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const romDir = join(__dirname, '..', 'roms', 'cpm');

// ── Locate binaries ─────────────────────────────────────────────
const ccpPath  = join(romDir, 'cpm22-64k.bin');
const biosPath = join(romDir, 'bios.bin');
const comPath  = process.env.BBCZ80_COM
    || join(homedir(), 'code', 'BBCZ80', 'bin', 'cpm', 'BBCBASIC.COM');

if (!existsSync(ccpPath) || !existsSync(biosPath)) {
    console.error('SKIP (loudly): CP/M binaries not found at', romDir);
    process.exit(2);
}
if (!existsSync(comPath)) {
    console.error('SKIP (loudly): BBCBASIC.COM not found — see header for clone recipe');
    process.exit(2);
}

const ccpBdos = readFileSync(ccpPath);     // CCP+BDOS+stubs, loads at E400h
const bios    = readFileSync(biosPath);     // our BIOS, loads at FA00h
const bbcCom  = readFileSync(comPath);      // BBCBASIC.COM

// ── Constants ───────────────────────────────────────────────────
const CCP   = 0xe400;
const BIOS  = 0xfa00;
const SPT   = 26;          // sectors per track
const BLS   = 1024;        // block size
const OFS   = 2;           // reserved tracks
const DISK_SIZE = 77 * SPT * 128;   // ~250 KB RAM-disk

// ── Build the machine ───────────────────────────────────────────
let out = '';
const machine = new Z80Machine(CPM64K, {
    onSerial: (b) => { out += String.fromCharCode(b); },
});

// Load CCP+BDOS at E400h (first 0x1600 bytes — exclude BIOS stubs)
machine.load(ccpBdos.subarray(0, 0x1600), CCP);
// Load our BIOS at FA00h
machine.load(bios, BIOS);

// ── Build RAM-disk image ────────────────────────────────────────
const disk = new Uint8Array(DISK_SIZE);

// System tracks (0–1): CCP+BDOS for warm-boot reload.
// BIOS warm boot reads 44 sectors starting at track 0 sector 1.
// Physical sectors are 1-based; data starts at byte (0*26 + 0)*128 = 0.
disk.set(ccpBdos.subarray(0, 0x1600), 0);

// Fill directory area with E5 (empty entries).
// Directory is at the start of the data area (track OFS).
// Physical sector 1 of track OFS = disk byte (OFS * SPT + 0) * 128.
const dirBase = OFS * SPT * 128;
for (let i = dirBase; i < dirBase + 2 * BLS; i++) disk[i] = 0xe5;

// Write BBCBASIC.COM to the disk.
const comRecords = Math.ceil(bbcCom.length / 128);
const comBlocks  = Math.ceil(bbcCom.length / BLS);

// Extent 0: up to 16 blocks (16 KB = 128 records)
const e0 = new Uint8Array(32);
e0[0] = 0;                                    // user 0
e0.set([0x42,0x42,0x43,0x42,0x41,0x53,0x49,0x43], 1);  // BBCBASIC
e0.set([0x43,0x4f,0x4d], 9);                  // COM
e0[12] = 0;                                   // EX = 0
e0[15] = Math.min(comRecords, 128);            // RC
const e0blocks = Math.min(comBlocks, 16);
for (let i = 0; i < e0blocks; i++) e0[16 + i] = 2 + i;   // blocks 2..17
disk.set(e0, dirBase);

// Extent 1 (if file > 16 KB)
if (comBlocks > 16) {
    const e1 = new Uint8Array(32);
    e1[0] = 0;
    e1.set([0x42,0x42,0x43,0x42,0x41,0x53,0x49,0x43], 1);
    e1.set([0x43,0x4f,0x4d], 9);
    e1[12] = 1;                                // EX = 1
    e1[15] = comRecords - 128;                 // RC (remaining)
    for (let i = 0; i < comBlocks - 16; i++) e1[16 + i] = 18 + i;
    disk.set(e1, dirBase + 32);
}

// Write file data starting at block 2.
// Block N starts at physical sector (N * (BLS/128)) + 1 of the data area.
// Disk byte offset = (OFS * SPT + N * (BLS/128)) * 128.
for (let b = 0; b < comBlocks; b++) {
    const diskOff = (OFS * SPT + (2 + b) * (BLS / 128)) * 128;
    const fileOff = b * BLS;
    const len = Math.min(BLS, bbcCom.length - fileOff);
    disk.set(bbcCom.subarray(fileOff, fileOff + len), diskOff);
}

// ── Host-side disk controller (ports $10–$15) ───────────────────
let dskDrive = 0, dskTrack = 0, dskSector = 1, dskDmaLo = 0x80, dskDmaHi = 0;
let dskResult = 0;

function handleDiskCmd(cmd) {
    // Sectors are 1-based (physical, after SECTRN translation).
    const diskOff = (dskTrack * SPT + (dskSector - 1)) * 128;
    const dmaAddr = dskDmaLo | (dskDmaHi << 8);
    if (diskOff < 0 || diskOff + 128 > disk.length) { dskResult = 1; return; }
    if (cmd === 0) {           // read
        for (let i = 0; i < 128; i++)
            machine.mem[(dmaAddr + i) & 0xffff] = disk[diskOff + i];
        dskResult = 0;
    } else if (cmd === 1) {    // write
        for (let i = 0; i < 128; i++)
            disk[diskOff + i] = machine.mem[(dmaAddr + i) & 0xffff];
        dskResult = 0;
    } else {
        dskResult = 1;
    }
}

// Wrap the CPU's port handlers to intercept disk ports.
const origIn  = machine.cpu.inPort;
const origOut = machine.cpu.outPort;

machine.cpu.inPort = (port) => {
    const p = port & 0xff;
    if (p === 0x15) return dskResult;
    return origIn(port);
};

machine.cpu.outPort = (port, v) => {
    const p = port & 0xff;
    switch (p) {
        case 0x10: dskDrive  = v & 0xff; return;
        case 0x11: dskTrack  = v & 0xff; return;
        case 0x12: dskSector = v & 0xff; return;
        case 0x13: dskDmaLo  = v & 0xff; return;
        case 0x14: dskDmaHi  = v & 0xff; return;
        case 0x15: handleDiskCmd(v & 0xff); return;
    }
    origOut(port, v);
};

// ── Execution harness ───────────────────────────────────────────
const acia = machine.chips.acia1;
const type = (s) => { for (const ch of s) acia.rxPush(ch.charCodeAt(0)); };

/** Run until `pattern` appears in output (after `fromIdx`) or budget
 *  exhausted.  `idleLimit` controls how many quiet steps (no output,
 *  no RX data) before declaring the machine idle.  Returns 'hit',
 *  'waiting' (idle on CONIN), or 'budget'. */
function runUntil(pattern, budget, fromIdx = 0, idleLimit = 0) {
    let steps = 0;
    let lastOutLen = out.length;
    let quietSteps = 0;
    const match = () => pattern && out.indexOf(pattern, fromIdx) >= 0;
    while (steps < budget) {
        if (match()) return 'hit';
        machine.step();
        steps++;
        if (out.length > lastOutLen) {
            lastOutLen = out.length;
            quietSteps = 0;
        } else if (idleLimit > 0) {
            quietSteps++;
            if (quietSteps > idleLimit && !acia.rdrf && acia.rx.length === 0) {
                if (match()) return 'hit';
                return 'waiting';
            }
        }
    }
    return 'budget';
}

/** Wait for the prompt, then let the CCP settle into readline
 *  before injecting keystrokes.  Returns 'ready' or reason. */
function waitForPrompt(prompt, budget, fromIdx = 0) {
    const r = runUntil(prompt, budget, fromIdx, 5000);
    if (r !== 'hit' && r !== 'waiting') return r;
    // The prompt appeared but CCP may still be in CONOUT (which
    // checks CONST and eats type-ahead).  Drain into CONIN loop.
    if (r === 'hit') runUntil(null, 50000);
    return 'ready';
}

// ── Cold-boot: start at BIOS entry ─────────────────────────────
machine.cpu.pc = BIOS;     // CBOOT entry
machine.cpu.sp = 0x80;

const checks = [];
const expect = (what, ok) => checks.push({ what, ok });

// Boot to A> prompt
let r = waitForPrompt('A>', 100_000_000);
expect('cold boot reaches A> prompt', r === 'ready');

// ── DIR should list BBCBASIC.COM ────────────────────────────────
const dirMark = out.length;
type('DIR\r');
r = waitForPrompt('A>', 50_000_000);
expect('DIR completes', r === 'ready');
expect('DIR lists BBCBASIC COM', /BBCBASIC\s+COM/i.test(out.slice(dirMark)));

// ── Launch BBC BASIC ────────────────────────────────────────────
const bbcMark = out.length;
type('BBCBASIC\r');
// No idle detection — disk loading causes long quiet stretches.
r = runUntil('>', 200_000_000, bbcMark);
expect('BBC BASIC launches', r === 'hit');
expect('identifies as BBC BASIC',
    /BBC BASIC/i.test(out.slice(bbcMark)) || /R\.?T\.?\s*Russell/i.test(out.slice(bbcMark)));

// Let BASIC settle into its input loop
if (r === 'hit') runUntil(null, 200000);

// ── PRINT 2+2 ───────────────────────────────────────────────────
const mathMark = out.length;
type('PRINT 2+2\r');
r = runUntil('>', 20_000_000, mathMark);
const mathOut = out.slice(mathMark);
expect('PRINT 2+2 produces 4', /\b4\b/.test(mathOut));

// ── Report ──────────────────────────────────────────────────────
let bad = 0;
for (const c of checks) {
    console.log(`${c.ok ? 'ok ' : 'FAIL'}  ${c.what}`);
    if (!c.ok) bad++;
}
if (bad) {
    console.log('\n--- transcript (first 600 chars) ---');
    console.log(JSON.stringify(out.slice(0, 600)));
} else {
    const mcyc = (machine.cycles / 1e6).toFixed(1);
    console.log(`\nCP/M 2.2 + BBC BASIC live on our Z80 (${mcyc}M cycles).`);
    console.log(JSON.stringify(out.slice(0, 300)));
}
process.exit(bad ? 1 : 0);
