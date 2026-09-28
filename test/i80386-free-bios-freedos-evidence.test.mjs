import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assertI80386HistoricalSourceBindings} from
  './lib/i80386-historical-source-binding.mjs';

// Reproducible, ROM-FREE 80386 gate.
//
// scripts/run-i80386-free-bios-freedos.mjs boots FreeDOS 1.4 on the experimental
// 80386 AT machine using ONLY the vendored LGPL Bochs BIOS + LGPL VGABios (zero
// proprietary ROM), declines the installer to A:\>, and mounts an ATA disk as C:.
// This dated FreeDOS result is checked against the exact source revision that
// executed it. Current-source qualification is a separate gate; changing a
// historical receipt hash to match HEAD would misstate the observed boot.
const receipt = JSON.parse(fs.readFileSync(
  new URL('../docs/receipts/2026-09-28-i80386-free-bios-freedos.json', import.meta.url)));
const browserReceipt = JSON.parse(fs.readFileSync(
  new URL('../docs/receipts/2026-09-28-i80386-browser-target-freedos.json', import.meta.url)));
const current224m = JSON.parse(fs.readFileSync(
  new URL('../docs/receipts/2026-09-28-xv6-stock-224m-3b-budget.json', import.meta.url)));
const sha = file => createHash('sha256')
  .update(fs.readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex');

// The superset edits this gate exists to protect against silent drift. Each MUST
// be bound by the receipt: an anti-vacuity guard so the source loop can never be
// hollowed out by dropping a file. (A declaration list cannot see an absence.)
const REQUIRED_BOUND = [
  'src/experimental/i80386.js',   // LOCK 0xF0 accept + BSWAP 0F C8..CF
  'src/at-8042-a20.js',           // PS/2 aux + keyboard-init commands
  'src/upd765.js',                // 82077 implied seek
  'src/experimental/ata16.js',    // IDENTIFY word 5 = 512
];

test('free-BIOS 386 receipt uses zero proprietary ROM and boots FreeDOS to A:\\> with C: mounted', () => {
  assert.equal(receipt.schema, 'astra.i80386-free-bios-freedos.v1');
  assert.equal(receipt.executionRevision,
    '46de3726abe68cb8ff106ddb4131f5d0b7bd7578');
  assert.equal(receipt.freeBios, true);
  assert.equal(receipt.proprietaryRomUsed, false);
  assert.equal(receipt.passed, true);

  // No proprietary ROM bytes were used: the copyrighted IBM 5170 system ROM
  // and proprietary VGA ROM shas must appear nowhere in the evidence.
  const blob = JSON.stringify(receipt);
  const IBM_AT_ROM_SHA = '74e7b36b4ec0adc5ac3277a887579996c1d2aa755b9892ef3afe7485c10ce04f';
  const IBM_VGA_ROM_SHA = '90f59d96821517d6bfac2b24eab96eb875e13ae164e8e0008ac93ae558bc6a9a';
  assert.ok(!blob.includes(IBM_AT_ROM_SHA), 'free-BIOS receipt must not use the IBM AT ROM');
  assert.ok(!blob.includes(IBM_VGA_ROM_SHA), 'free-BIOS receipt must not use the proprietary VGA ROM');

  // Reset vector: 386 high reset, far-jump first opcode.
  assert.deepEqual(receipt.reset, {cs: 0xf000, ip: 0xfff0, pc: 0xfffffff0, firstByte: 0xea});

  // Vendored free firmware, bound by sha to what ships in the repo.
  assert.equal(receipt.firmware.bios.license, 'LGPL');
  assert.equal(receipt.firmware.vgaBios.license, 'LGPL');
  assert.equal(receipt.firmware.bios.sha256, sha(receipt.firmware.bios.path));
  assert.equal(receipt.firmware.vgaBios.sha256, sha(receipt.firmware.vgaBios.path));
  assert.equal(receipt.firmware.bios.path, 'roms/free-at-bios/BIOS-bochs-legacy');
  assert.equal(receipt.firmware.vgaBios.path, 'roms/free-at-bios/vgabios-lgpl.bin');

  // Boot outcome flags.
  assert.equal(receipt.installerDeclined, true);
  assert.equal(receipt.reachedDosPrompt, true);
  assert.equal(receipt.cMounted, true);

  // Screen evidence: bare A:\> prompt, and the C: directory listing of the
  // in-script-built FAT16 disk (its marker file + free-space summary).
  const screen = receipt.screenText.join('\n');
  assert.match(screen, /(^|\n)A:\\>/, 'reached the bare A:\\> shell prompt');
  assert.match(screen, /installation of FreeDOS .* has been aborted/i);
  assert.match(screen, /Volume in drive C/i);
  assert.match(screen, /CMOUNTOK\s+TXT/i, 'C: shows the disk marker file');
  assert.match(screen, /bytes free/i, 'C: reports free space (partition mounted)');
  assert.equal(receipt.input.hdd.markerFile.name, 'CMOUNTOK.TXT');

  assertI80386HistoricalSourceBindings(receipt,REQUIRED_BOUND);
});

test('free-BIOS 386 gate rejects a one-byte source drift (mutation control)', () => {
  // A changed source file must break the binding: prove the loop is live by
  // checking the stored sha differs from a deliberately wrong recomputation.
  const [file, hash] = Object.entries(receipt.sourceSha256)[0];
  const committed=execFileSync('git',
    ['show',`${receipt.executionRevision}:${file}`],
    {cwd:new URL('../',import.meta.url)});
  const mutated = createHash('sha256')
    .update(committed)
    .update(Buffer.from([0])).digest('hex');
  assert.notEqual(hash, mutated, 'binding would catch a one-byte change');
  const altered=structuredClone(receipt);
  altered.sourceSha256[file]=mutated;
  assert.throws(()=>assertI80386HistoricalSourceBindings(altered,REQUIRED_BOUND),
    /source binding at/);
});

test('current 386 sources remain pinned after the 224 MiB board change',()=>{
  // Only these two source files changed after the dated FreeDOS runs. Their
  // current bytes are independently bound by the later source-bound xv6
  // receipt; all other FreeDOS-bound bytes must still match their old pins.
  // This is a current-source drift gate, not a claim that FreeDOS was rebooted.
  const changed=['src/i8086-machine.js',
    'src/experimental/i80386-at-machine.js'];
  assert.equal(current224m.completedSteps,3_000_000_000);
  assert.equal(current224m.fullUsertestsPassed,false);
  assert.equal(current224m.sourceSha256[changed[0]],
    '7cf7fdf4e6de451071809e32e128aa0ac663524eaf8b2e08581780b0ec4f167c');
  assert.equal(current224m.sourceSha256[changed[1]],
    '6c5f12cc92ba7219ed4b53f6237622f6ce58269402ee14770791e04c68f93cb0');
  for(const historical of [receipt,browserReceipt]){
    for(const [file,oldHash] of Object.entries(historical.sourceSha256)){
      const expected=changed.includes(file)?current224m.sourceSha256[file]:oldHash;
      assert.equal(sha(file),expected,`${file} current-source drift gate`);
    }
  }
});
