import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gradeFreeDosAtAcceptance} from '../scripts/lib/freedos-at-acceptance.mjs';

const evidence=JSON.parse(fs.readFileSync(new URL('./fixtures/freedos14-at-persistence-evidence.json',import.meta.url)));
const sha=file=>createHash('sha256').update(fs.readFileSync(new URL(`../${file}`,import.meta.url))).digest('hex');
const original='03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77';
const expectedText='fd-boot-ok\r\n';
const expand=requested=>[...requested].flatMap(key=>key==='>'?['shift-down','>','shift-up']:[key]);

test('unchanged FreeDOS write and fresh-remount TYPE evidence is exact and linked',()=>{
  const {write,reboot}=evidence;
  assert.equal(write.executionRevision,'30475e6f2dc80dfd9bd7fa8536ac0cf17980923b');
  assert.equal(reboot.executionRevision,'30475e6f2dc80dfd9bd7fa8536ac0cf17980923b');
  assert.equal(write.keyboardScript.requested,'n\recho fd-boot-ok>fdboot.txt\rtype fdboot.txt\r');
  assert.equal(reboot.keyboardScript.requested,'n\rtype fdboot.txt\r');
  assert.doesNotMatch(reboot.keyboardScript.requested,/echo/i);
  for(const receipt of [write,reboot]) {
    assert.equal(receipt.fullBootAccepted,true);
    assert.equal(receipt.input.floppy.bootSectorSha256,'02aa8525a3dce52cf544fd6acff21687973362da0bef1503428d6eb694659189');
    assert.deepEqual(receipt.guestFile.bytes,[...Buffer.from(expectedText)]);
    assert.equal(receipt.guestFile.size,12);
    assert.match(receipt.originalReportSha256,/^[0-9a-f]{64}$/);
  }
  assert.equal(write.input.floppy.sha256,original);
  const saved=write.input.floppy.output.sha256;
  assert.equal(saved,'1462a0fa85bfe9920250725bbface8c637e66d49bad17793e0da01b2e9bc9815');
  assert.equal(reboot.input.floppy.sha256,saved);
  assert.deepEqual(reboot.persistence,{priorOutputMediaSha256:saved,linked:true});
  for(const [file,hash] of Object.entries(reboot.sourceSha256))assert.equal(hash,sha(file),`${file} reboot source binding`);

  const options={expectedText,inputBootSectorSha256:reboot.input.floppy.bootSectorSha256,
    inputMediaSha256:saved,originalMediaSha256:original,priorOutputMediaSha256:saved,
    expectedRequested:reboot.keyboardScript.requested,
    expectedInjectedKeys:expand(reboot.keyboardScript.requested)};
  assert.equal(gradeFreeDosAtAcceptance(reboot,options),true);
  for(const mutate of [
    r=>r.keyboardScript.injected=[],r=>r.keyboardScript.commandPrompt.column=0,
    r=>r.guestFile.text='wrong\r\n',r=>r.executionBoundaries.bootSector.devices.primaryDma.status=0,
    r=>r.screenText[r.screenText.findIndex(line=>line==='fd-boot-ok')]='missing',
  ]) {const copy=structuredClone(reboot);mutate(copy);assert.equal(gradeFreeDosAtAcceptance(copy,options),false);}
});
