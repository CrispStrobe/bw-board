import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gradeAtDosAcceptance} from '../scripts/lib/at-dos-acceptance.mjs';

const evidence=JSON.parse(fs.readFileSync(new URL('./fixtures/at-dos-persistence-evidence.json',import.meta.url)));
const sha=path=>createHash('sha256').update(fs.readFileSync(new URL(`../${path}`,import.meta.url))).digest('hex');
const expectedText='at-boot-ok\r\n';

test('source-bound AT DOS receipts prove write then fresh-remount read without replaying creation',()=>{
    const {write,reboot}=evidence;
    assert.equal(write.keyboardScript.requested,'\r\recho at-boot-ok>atboot.txt\rtype atboot.txt\r');
    assert.equal(reboot.keyboardScript.requested,'\r\rtype atboot.txt\r');
    assert.doesNotMatch(reboot.keyboardScript.requested,/echo/i);
    const outputHash=write.input.floppy.output.sha256;
    assert.equal(reboot.input.floppy.sha256,outputHash);
    assert.deepEqual(reboot.persistence,{priorOutputMediaSha256:outputHash,linked:true});
    for(const receipt of [write,reboot]) {
        assert.equal(receipt.fullBootAccepted,true);
        assert.deepEqual(receipt.reset,{cs:0xf000,ip:0xfff0,pc:0xfffff0,fetchPhysical:0xfffff0});
        assert.equal(receipt.memory.baseRamBytes,640<<10);
        assert.equal(receipt.guestFile.size,12);
        assert.deepEqual(receipt.guestFile.bytes,[...Buffer.from(expectedText)]);
        assert.equal(receipt.executionRevision,'c5a4b86cf39801c705ee1d61cf73dad3208333ee');
        assert.match(receipt.originalReportSha256,/^[0-9a-f]{64}$/);
        for(const [file,hash] of Object.entries(receipt.sourceSha256))
            assert.equal(hash,sha(file),`${file} source binding`);
    }
    assert.equal(gradeAtDosAcceptance(write,{expectedText,
        inputBootSectorSha256:write.input.floppy.bootSectorSha256,
        inputMediaSha256:write.input.floppy.sha256}),true);
    assert.equal(gradeAtDosAcceptance(reboot,{expectedText,
        inputBootSectorSha256:reboot.input.floppy.bootSectorSha256,
        inputMediaSha256:reboot.input.floppy.sha256,priorOutputMediaSha256:outputHash}),true);

    const mutations=[
        pair=>pair.reboot.guestFile.text='wrong\r\n',
        pair=>pair.reboot.screenText[pair.reboot.screenText.findIndex(line=>line==='at-boot-ok')]='missing',
        pair=>pair.reboot.executionBoundaries.bootSector.devices.primaryDma.status=0,
        pair=>pair.reboot.keyboardScript.injected=[],
        pair=>pair.reboot.input.floppy.sha256='0'.repeat(64),
    ];
    for(const mutate of mutations) {
        const pair=structuredClone(evidence);mutate(pair);
        const linked=pair.write.input.floppy.output.sha256;
        assert.equal(gradeAtDosAcceptance(pair.reboot,{expectedText,
            inputBootSectorSha256:pair.reboot.input.floppy.bootSectorSha256,
            inputMediaSha256:pair.reboot.input.floppy.sha256,priorOutputMediaSha256:linked}),false);
    }
});
