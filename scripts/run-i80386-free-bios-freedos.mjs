#!/usr/bin/env node
// Reproducible, ROM-FREE 80386 AT qualification.
//
// Boots FreeDOS 1.4 on the experimental 80386 AT machine using ONLY free,
// redistributable firmware -- the LGPL Bochs legacy BIOS and the LGPL VGABios
// vendored under roms/free-at-bios/ -- with NO proprietary IBM 5170 ROM
// (AT_BIOS_ROM / VGA_BIOS_ROM are neither read nor required). It declines the
// installer to reach the bare A:\> prompt, attaches an in-script-built FAT16
// hard disk, and drives `dir c:` to prove the disk mounts as C:.
//
// It writes a receipt to docs/receipts/<date>-i80386-free-bios-freedos.json that
// sha-binds the executed CPU/AT-device source (the four superset edits included)
// AND the vendored free firmware. A test (test/i80386-free-bios-freedos-evidence
// .test.mjs) asserts receipt.sourceSha256[file] === sha(file): that source-drift
// gate is the new reproducible public-CI 386 gate and needs no secret input.
//
// The FreeDOS floppy image is GPL-mixed and external, so it is NOT vendored: it
// is read from FREEDOS_IMAGE (default: the pinned box path) and verified by SHA.
// When it is absent, receipt generation refuses; the committed receipt + its
// source-binding test still run in CI with no external input.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

import * as M from '../src/experimental/i80386-at-machine.js';
import {buildFat16} from './lib/i80386-free-bios-fat16.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHash = file => sha(fs.readFileSync(path.join(root, file)));

// ---- pinned, redistributable free firmware (vendored in the repo) ----
const BIOS_PATH = 'roms/free-at-bios/BIOS-bochs-legacy';
const VGA_PATH = 'roms/free-at-bios/vgabios-lgpl.bin';
const EXPECTED_BIOS_SHA = '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac';
const EXPECTED_VGA_SHA = '76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1';

// ---- external (not vendored) FreeDOS 1.4 boot floppy ----
const EXPECTED_FREEDOS_SHA =
  '03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77';
const freedosPath = process.env.FREEDOS_IMAGE ||
  '/mnt/volume1/tmp-astra/astra-external-freedos14/x86BOOT-1200.img';

if (process.env.AT_BIOS_ROM || process.env.VGA_BIOS_ROM)
  throw new Error(
    'free-BIOS qualification refuses AT_BIOS_ROM/VGA_BIOS_ROM: it must use only ' +
    'the vendored LGPL firmware so the receipt is reproducible without any ROM');

const bios = fs.readFileSync(path.join(root, BIOS_PATH));
const vga = fs.readFileSync(path.join(root, VGA_PATH));
if (bios.length !== 0x10000 || sha(bios) !== EXPECTED_BIOS_SHA)
  throw new Error('vendored Bochs legacy BIOS identity mismatch');
if (vga.length !== 38400 || sha(vga) !== EXPECTED_VGA_SHA)
  throw new Error('vendored LGPL VGABios identity mismatch');

if (!fs.existsSync(freedosPath))
  throw new Error(
    `FreeDOS image not found at ${freedosPath}; set FREEDOS_IMAGE. ` +
    'The committed receipt and its source-binding test still run with no image.');
const floppy = fs.readFileSync(freedosPath);
const floppySha = sha(floppy);
if (floppySha !== EXPECTED_FREEDOS_SHA)
  throw new Error(
    `FreeDOS image SHA-256 mismatch: expected ${EXPECTED_FREEDOS_SHA}, got ${floppySha}`);

// ---- deterministic FAT16 hard disk, built in-script (so C: is reproducible) ----
const HD_GEOM = {cylinders: 306, heads: 4, sectors: 17};
const MARKER_NAME = 'CMOUNTOKTXT';   // 8.3 -> CMOUNTOK.TXT
const MARKER_TEXT = 'FREE-BIOS 386 C: MOUNT OK\r\n';
const markerBytes = Buffer.from(MARKER_TEXT);
const {image: hddImage, info: hddInfo} = buildFat16({
  geometry: HD_GEOM,
  volLabel: 'FREEBIOSHD',
  files: [{name: MARKER_NAME, bytes: markerBytes}],
});
const hddSha = sha(hddImage);

// ---- source files bound by the receipt (the reproducible drift gate) ----
const sourcePaths = [
  'src/i8086-machine.js', 'src/i8086.js', 'src/i8086-ram-words.js',
  'src/experimental/i80386.js', 'src/experimental/i80386-at-machine.js',
  'src/experimental/ata16.js', 'src/experimental/i80286-protected.js',
  'src/at-8042-a20.js', 'src/at-system-control.js',
  'src/i8254.js', 'src/i8259.js', 'src/i8237.js', 'src/mc146818.js',
  'src/cga-card.js', 'src/upd765.js', 'src/machine-checkpoint.js',
  'src/vga-card.js', 'src/experimental/vga-memory.js',
  'scripts/lib/i80386-free-bios-fat16.mjs',
  'scripts/run-i80386-free-bios-freedos.mjs',
];
const sourceSha256 = Object.fromEntries(sourcePaths.map(f => [f, sourceHash(f)]));
let executionRevision = 'unknown';
try {
  executionRevision =
    execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
} catch { /* not a git checkout */ }

// ---- machine assembly (mirrors experimental-seabios/bochs-freedos.mjs) ----
const base = M.PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA;
// Type-47 CMOS geometry so the Bochs BIOS builds a real FDPT for drive 0 and
// FreeDOS mounts the partition. (The AT CMOS is passive RAM here.)
const hdCmos = (g => {
  const cyl = g.cylinders, heads = g.heads, spt = g.sectors;
  return [
    [0x19, 47],
    [0x1b, cyl & 0xff], [0x1c, (cyl >> 8) & 0xff],
    [0x1d, heads & 0xff],
    [0x1e, 0xff], [0x1f, 0xff],
    [0x20, heads > 8 ? 0xc8 : 0xc0],
    [0x21, cyl & 0xff], [0x22, (cyl >> 8) & 0xff],
    [0x23, spt & 0xff],
    [0x39, 0x00],
  ];
})(HD_GEOM);
const hdCmosIdx = new Set(hdCmos.map(([i]) => i));
const cfg = {
  ...base,
  functionalInstructionCycles: Number(process.env.FIC || 6),
  regions: [
    ...base.regions.filter(r => !(r.kind === 'rom' && r.start === 0xc0000)),
    {kind: 'rom', start: 0xc0000, end: 0xc9fff},
  ],
  chips: base.chips.map(chip => chip.kind === 'rtc' ? {
    ...chip,
    initialCmos: [
      ...chip.initialCmos.filter(([i]) => i !== 0x3d && i !== 0x12 && !hdCmosIdx.has(i)),
      [0x3d, 0x21], [0x12, 0xf0], ...hdCmos,
    ],
  } : chip),
};
const hooks = {ataImage: new Uint8Array(hddImage), ataGeometry: HD_GEOM};
const m = new M.ExperimentalI80386ATMachine(cfg, hooks);
m.loadRom(bios, 0xf0000);
m.loadRom(bios, 0xff0000);
m.loadRom(vga, 0xc0000);
m.chips.fdc1.insert(0, new Uint8Array(floppy),
  {cylinders: 80, heads: 2, sectors: 15, bytesPerSector: 512});
m.reset();
const cpu = m.cpu;

const reset = {
  cs: cpu.cs >>> 0, ip: cpu.eip >>> 0,
  pc: (cpu._linear ? cpu._linear(1, cpu.eip >>> 0, 1) >>> 0 : 0) >>> 0,
  firstByte: m._read386(0xffff0) & 0xff,
};

// ---- keyboard driving (decline installer, then `dir c:`) ----
const scanCodes = {a: 0x1e, b: 0x30, c: 0x2e, d: 0x20, e: 0x12, f: 0x21, g: 0x22,
  h: 0x23, i: 0x17, j: 0x24, k: 0x25, l: 0x26, m: 0x32, n: 0x31, o: 0x18, p: 0x19,
  q: 0x10, r: 0x13, s: 0x1f, t: 0x14, u: 0x16, v: 0x2f, w: 0x11, x: 0x2d, y: 0x15,
  z: 0x2c, ' ': 0x39, '\r': 0x1c, '0': 0x0b, '1': 0x02, '2': 0x03, '3': 0x04,
  '4': 0x05, '5': 0x06, '6': 0x07, '7': 0x08, '8': 0x09, '9': 0x0a, '-': 0x0c,
  '.': 0x34, '\\': 0x2b, ':': 0x27};
const encode = str => [...str].flatMap(ch => ch === ':'
  ? [{ch: 'S', scan: 0x2a}, {ch, scan: 0x27}, {ch: 's', scan: 0xaa}]
  : [{ch, scan: scanCodes[ch.toLowerCase()]}]);
const RUN_CMD = 'dir c:';

const rows = () => {
  const r = [];
  for (let y = 0; y < 25; y++) {
    let s = '';
    for (let x = 0; x < 80; x++) {
      const o = 0xb8000 + (y * 80 + x) * 2;
      let ch;
      try { ch = m._read386(o); } catch { ch = 0; }
      s += (ch >= 32 && ch <= 126) ? String.fromCharCode(ch) : ' ';
    }
    r.push(s.replace(/\s+$/, ''));
  }
  return r;
};
const ringEmpty = () =>
  (m._read(0x41a) | (m._read(0x41b) << 8)) === (m._read(0x41c) | (m._read(0x41d) << 8));

const MAX = Number(process.env.MAX || 90_000_000);
const PROG = Number(process.env.PROG || 10_000_000);
let keyScript = [], declined = false, cmdSent = false, menuKicks = 0;
const injected = [];
let stop = 'max', lastChange = 0, prevScrHash = '';
let steps = 0;

for (let s = 0; s < MAX; s++) {
  steps = s;
  if (s % 50000 === 0) {
    const scr = rows();
    const h = scr.join('\n').replace(/\s/g, '');
    if (h !== prevScrHash) { prevScrHash = h; lastChange = s; }
    const idle = s - lastChange > 1_500_000;
    if (!declined && scr.some(l => /Do you want to proceed/i.test(l))) {
      keyScript.push(...encode('n\r')); declined = true;
    } else if (!declined && keyScript.length === 0 && s - menuKicks > 800_000 &&
      scr.some(l => /press \[ENTER\]|Select from Menu/i.test(l))) {
      keyScript.push(...encode('\r')); menuKicks = s;
    } else if (declined && !cmdSent && keyScript.length === 0) {
      const promptRow = scr.findIndex(l =>
        /^[A-Z]:\\?>?\s*$/.test(l.trim()) || /^[A-Z]:\\>/.test(l.trim()));
      if (promptRow >= 0) { keyScript.push(...encode(RUN_CMD + '\r')); cmdSent = true; }
      else if (idle) { keyScript.push(...encode('\r')); }
    }
    // Stop only once the `dir c:` output is COMPLETE (the "bytes free" summary
    // line has rendered) and the screen has since settled at a stable prompt.
    const dirComplete = cmdSent && scr.some(l => /bytes free/i.test(l));
    if (dirComplete && keyScript.length === 0 && idle) { stop = 'settled'; break; }
  }
  if (keyScript.length && ringEmpty()) {
    const e = keyScript[0];
    if (m.keyIn(e.scan)) { keyScript.shift(); injected.push(e.ch); }
  }
  if (s % PROG === 0) {
    const sc = rows().join('\n').replace(/\s/g, '').length;
    process.stdout.write(
      `PROGRESS step=${s} pm=${cpu.protectedMode ? 1 : 0} declined=${declined ? 1 : 0} ` +
      `cmdSent=${cmdSent ? 1 : 0} screenChars=${sc}\n`);
  }
  try { m.step(); }
  catch (e) {
    if (/AT 8042 |MC146818 /.test(e.message)) { /* tolerate device edge */ }
    else { stop = 'threw: ' + e.message; break; }
  }
  if (cpu.shutdown) { stop = 'shutdown'; break; }
}

// ---- grade the evidence ----
const screenText = rows();
const flat = screenText.join('\n');
const installerDeclined = declined &&
  screenText.some(l => /installation of FreeDOS .* has been aborted/i.test(l));
const reachedDosPrompt = /(^|\n)A:\\>/.test(flat);
const volumeLine = screenText.find(l => /Volume in drive C/i.test(l)) || null;
const markerLine = screenText.find(l => /CMOUNTOK\s+TXT/i.test(l)) || null;
const bytesFreeLine = screenText.find(l => /bytes free/i.test(l)) || null;
const cMounted = !!(cmdSent && volumeLine && markerLine && bytesFreeLine);
const passed = installerDeclined && reachedDosPrompt && cMounted;

const receipt = {
  schema: 'astra.i80386-free-bios-freedos.v1',
  passed,
  freeBios: true,
  proprietaryRomUsed: false,
  scope: 'ROM-free 80386 AT: LGPL Bochs BIOS + LGPL VGABios boot FreeDOS 1.4 to ' +
    'A:\\>, decline installer, mount an ATA hard disk as C: (dir c:).',
  executionRevision,
  firmware: {
    bios: {path: BIOS_PATH, bytes: bios.length, sha256: sha(bios),
      id: 'Bochs 2.7 BIOS (c)2001-2021 The Bochs Project', license: 'LGPL'},
    vgaBios: {path: VGA_PATH, bytes: vga.length, sha256: sha(vga),
      id: 'Bochs VGABios (PCI) (C)2002-2021 LGPL VGABios developers Team', license: 'LGPL'},
  },
  input: {
    floppy: {path: freedosPath, bytes: floppy.length, sha256: floppySha,
      id: 'FreeDOS 1.4 x86BOOT-1200.img (external, GPL-mixed, not vendored)'},
    hdd: {geometry: HD_GEOM, bytes: hddImage.length, sha256: hddSha,
      builtInScript: true, info: hddInfo.info ?? hddInfo,
      markerFile: {name: 'CMOUNTOK.TXT', size: markerBytes.length, sha256: sha(markerBytes),
        text: MARKER_TEXT}},
  },
  reset,
  steps,
  stopReason: stop,
  installerDeclined,
  reachedDosPrompt,
  cMounted,
  keyboardScript: {requested: 'n\\r' + RUN_CMD + '\\r', injected},
  evidence: {promptLine: 'A:\\>', volumeLine, markerLine, bytesFreeLine},
  screenText,
  fidelityOracle: 'The proprietary IBM 5170 ROM is an OPTIONAL fidelity oracle only ' +
    '(AT_BIOS_ROM/VGA_BIOS_ROM). This receipt uses zero proprietary firmware.',
  sourceSha256,
  qualification: 'The commit containing this receipt is the candidate. A test asserts ' +
    'sourceSha256[file] === sha(file) for every bound source path, with no external ' +
    'input -- that is the reproducible public-CI 386 gate.',
};

const stamp = process.env.RECEIPT_DATE ||
  new Date().toISOString().slice(0, 10);
const receiptPath = path.join(root, 'docs/receipts', `${stamp}-i80386-free-bios-freedos.json`);
if (process.env.WRITE_RECEIPT !== '0') {
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  process.stdout.write(`RECEIPT ${path.relative(root, receiptPath)}\n`);
}
process.stdout.write(
  `DONE passed=${passed} declined=${installerDeclined} prompt=${reachedDosPrompt} ` +
  `cMounted=${cMounted} steps=${steps} stop=${stop} injected="${injected.join('')}"\n`);
process.stdout.write('=== FINAL SCREEN ===\n' +
  screenText.filter(r => r.trim()).map(r => '  | ' + r).join('\n') + '\n');
if (!passed) process.exitCode = 1;
