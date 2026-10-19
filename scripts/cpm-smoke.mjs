#!/usr/bin/env node
/**
 * CP/M 2.2 booting on our vector-complete Z80 core — the REAL thing:
 * our own BIOS (MC6850 console, host-side RAM-disk), Digital Research's
 * CCP+BDOS assembled for 64K, and R.T. Russell's BBC BASIC (Z80) on
 * top.  No BDOS shim, no instruction traps, just a working computer.
 *
 * The boot itself lives in `src/cpm-system.js` (`createCpmSystem`) — the
 * browser-safe factory lite also uses — so this script is just the console
 * harness that drives it: cold boot, DIR, launch BBC BASIC, PRINT 2+2.
 *
 * Setup:
 *   git clone --depth 1 https://github.com/rtrussell/BBCZ80 ~/code/BBCZ80
 *   (bin/cpm/BBCBASIC.COM is prebuilt — zlib, shippable.)
 *
 * CP/M CCP+BDOS binary: roms/cpm/cpm22-64k.bin (see roms/cpm/PROVENANCE
 * for the Bryan Sparks / DRDOS Inc. 2022 grant that makes this
 * redistributable).  BIOS: roms/cpm/bios.bin (MIT, our own).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { Z80Machine, CPM64K } from '../src/z80-machine.js';
import { createCpmSystem } from '../src/cpm-system.js';

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

const ccpBdos = new Uint8Array(readFileSync(ccpPath));
const bios    = new Uint8Array(readFileSync(biosPath));
const bbcCom  = new Uint8Array(readFileSync(comPath));

// ── Boot a real CP/M 2.2 computer with BBCBASIC.COM on drive A: ──
let out = '';
const sys = createCpmSystem({
    ccpBdos, bios, files: { 'BBCBASIC.COM': bbcCom },
    onSerial: (b) => { out += String.fromCharCode(b); },
    Z80Machine, CPM64K
});
const type = (s) => sys.sendText(s);

// ── Execution harness ───────────────────────────────────────────
/** Run until `pattern` appears in output (after `fromIdx`) or budget
 *  exhausted.  `idleLimit` controls how many quiet steps (no output,
 *  console blocked on CONIN) before declaring the machine idle.
 *  Returns 'hit', 'waiting' (idle on CONIN), or 'budget'. */
function runUntil(pattern, budget, fromIdx = 0, idleLimit = 0) {
    let steps = 0;
    let lastOutLen = out.length;
    let quietSteps = 0;
    const match = () => pattern && out.indexOf(pattern, fromIdx) >= 0;
    while (steps < budget) {
        if (match()) return 'hit';
        sys.step();
        steps++;
        if (out.length > lastOutLen) {
            lastOutLen = out.length;
            quietSteps = 0;
        } else if (idleLimit > 0) {
            quietSteps++;
            if (quietSteps > idleLimit && sys.consoleIdle()) {
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
    if (r === 'hit') runUntil(null, 50000);
    return 'ready';
}

const checks = [];
const expect = (what, ok) => checks.push({ what, ok });

// Boot to A> prompt
let r = waitForPrompt('A>', 100_000_000);
expect('cold boot reaches A> prompt', r === 'ready');

// ── DIR should list BBCBASIC.COM ────────────────────────────────
const dirMark = out.length;
type('DIR\r');
r = waitForPrompt('A>', 50_000_000, dirMark);
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
    const mcyc = (sys.machine.cycles / 1e6).toFixed(1);
    console.log(`\nCP/M 2.2 + BBC BASIC live on our Z80 (${mcyc}M cycles).`);
    console.log(JSON.stringify(out.slice(0, 300)));
}
process.exit(bad ? 1 : 0);
