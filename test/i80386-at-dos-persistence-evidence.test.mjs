import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gradeAtDosAcceptance} from '../scripts/lib/at-dos-acceptance.mjs';

const evidence=JSON.parse(fs.readFileSync(new URL('./fixtures/i80386-at-dos-persistence-evidence.json',import.meta.url)));
const sha=path=>createHash('sha256').update(fs.readFileSync(new URL(`../${path}`,import.meta.url))).digest('hex');
const expectedText='at-boot-ok\r\n';
const grade=(receipt,options)=>gradeAtDosAcceptance(receipt,options)&&
  receipt.guestFile.size===12&&
  Buffer.from(receipt.guestFile.bytes).equals(Buffer.from(expectedText));

test('source-bound 386 AT DOS receipts prove write and fresh-remount TYPE persistence',()=>{
  const {write,reboot}=evidence;
  assert.deepEqual(evidence.historical,{
    executionRevision:'dcaff8aa229fbccd5810a9d0269dab309c57ed53',
    writeSteps:25652224,rebootSteps:25567232,
    outputMediaSha256:'ec467c38d91d7292152b016c51dc6c2ef81f060ae7afc415418e2d17b3ca8819',
    writeReportSha256:'146ec4957c2c91a862899898c4088dc6cde28952e619d37a536036ed0962832c',
    rebootReportSha256:'a0a514bb9d909526bbe9012b94d7ca25dc62763baa7a7dfa59f8351278ad0e09',
  });
  assert.equal(evidence.current.executionRevision,'6ad41ef326d120108c640af12614a44407e6c11b');
  assert.equal(write.originalReportSha256,'64bb11f99ebeeaee01202f77628fc16d6c16b9e8c9063beadbc15924bef81fdd');
  assert.equal(reboot.originalReportSha256,'469be342127129f55daceaa1287559f79c73b7c6e3c828bfcfcd490811179795');
  assert.equal(write.steps,evidence.current.writeSteps);
  assert.equal(reboot.steps,evidence.current.rebootSteps);
  assert.equal(write.keyboardScript.requested,'\r\recho at-boot-ok>atboot.txt\rtype atboot.txt\r');
  assert.equal(reboot.keyboardScript.requested,'\r\rtype atboot.txt\r');
  assert.doesNotMatch(reboot.keyboardScript.requested,/echo/i);
  const outputHash=write.input.floppy.output.sha256;
  assert.equal(reboot.input.floppy.sha256,outputHash);
  assert.deepEqual(reboot.persistence,{priorOutputMediaSha256:outputHash,linked:true});
  for(const receipt of [write,reboot]) {
    assert.equal(receipt.fullBootAccepted,true);
    assert.deepEqual(receipt.reset,{cs:0xf000,ip:0xfff0,pc:0xfffffff0,firstByte:0xea});
    assert.deepEqual(receipt.memory,{addressSpaceBytes:16<<20,installedRamBytes:1152<<10,
      baseRamBytes:640<<10,extendedRamBytes:512<<10});
    assert.deepEqual(receipt.guestFile.bytes,[...Buffer.from(expectedText)]);
    assert.equal(receipt.guestFile.size,12);
    assert.equal(receipt.executionRevision,evidence.current.executionRevision);
    assert.match(receipt.originalReportSha256,/^[0-9a-f]{64}$/);
    for(const [file,hash] of Object.entries(receipt.sourceSha256))
      assert.equal(hash,sha(file),`${file} source binding`);
  }
  assert.equal(grade(write,{expectedText,
    inputBootSectorSha256:write.input.floppy.bootSectorSha256,
    inputMediaSha256:write.input.floppy.sha256}),true);
  assert.equal(grade(reboot,{expectedText,
    inputBootSectorSha256:reboot.input.floppy.bootSectorSha256,
    inputMediaSha256:reboot.input.floppy.sha256,priorOutputMediaSha256:outputHash}),true);

  const mutations=[
    pair=>pair.reboot.guestFile.bytes[0]^=0xff,
    pair=>pair.reboot.screenText[pair.reboot.screenText.findIndex(line=>line==='at-boot-ok')]='missing',
    pair=>pair.reboot.executionBoundaries.bootSector.devices.primaryDma.status=0,
    pair=>pair.reboot.keyboardScript.injected=[],
    pair=>pair.reboot.input.floppy.sha256='0'.repeat(64),
  ];
  for(const mutate of mutations) {
    const pair=structuredClone(evidence);mutate(pair);
    const linked=pair.write.input.floppy.output.sha256;
    assert.equal(grade(pair.reboot,{expectedText,
      inputBootSectorSha256:pair.reboot.input.floppy.bootSectorSha256,
      inputMediaSha256:pair.reboot.input.floppy.sha256,priorOutputMediaSha256:linked}),false);
  }
});
