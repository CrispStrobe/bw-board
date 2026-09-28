import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const browser = JSON.parse(fs.readFileSync(new URL(
  '../docs/receipts/2026-09-28-i80386-browser-target-freedos.json', import.meta.url)));
const ordinary = JSON.parse(fs.readFileSync(new URL(
  '../docs/receipts/2026-09-28-i80386-free-bios-freedos.json', import.meta.url)));
const sha = file => createHash('sha256').update(fs.readFileSync(new URL(
  `../${file}`, import.meta.url))).digest('hex');

test('headless browser target replays the pinned free-BIOS FreeDOS shell and C: mount', () => {
  assert.equal(browser.schema, 'astra.i80386-browser-target-freedos.v1');
  assert.equal(browser.passed, true);
  assert.equal(browser.executionRevision, 'e96cee7bdbafa289cd03c70a75ac9bf1bb167520');
  assert.deepEqual(browser.adapter, {profile:'freedos-vga',
    mediaApplied:['bios','vga-rom','hdd','floppy'],
    debuggerRunFor:true,keyboardViaTarget:true,frameViaTarget:true});
  assert.equal(browser.stepCalls, ordinary.steps);
  assert.equal(browser.stopReason, ordinary.stopReason);
  assert.equal(browser.installerDeclined, true);
  assert.equal(browser.reachedDosPrompt, true);
  assert.equal(browser.cMounted, true);
  assert.equal(browser.guestMatch, true);
  assert.deepEqual(browser.screenText, ordinary.screenText);
  assert.deepEqual(browser.media, {
    biosSha256:ordinary.firmware.bios.sha256,
    vgaSha256:ordinary.firmware.vgaBios.sha256,
    floppySha256:ordinary.input.floppy.sha256,
    hddSha256:ordinary.input.hdd.sha256,
  });
  assert.deepEqual(browser.frame, {width:720,height:400,mode:3,
    why:'386 VGA text planes',unsupported:null});
});

test('browser-target receipt binds the executed adapter, debugger, media and 386 sources', () => {
  for (const file of ['src/debug-target-factory.js','src/i80386-adapter.js',
    'src/i8086-debug.js','src/machine-media.js','src/i8259.js',
    'src/i8237.js','src/machine-checkpoint.js',
    'src/experimental/i80386-at-machine.js',
    'scripts/run-i80386-browser-target-freedos.mjs'])
    assert.ok(file in browser.sourceSha256, `${file} must be bound`);
  for (const [file, hash] of Object.entries(browser.sourceSha256))
    assert.equal(hash, sha(file), `${file} source binding`);
});
