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
    assert.deepEqual(evidence.historical,{
        executionRevision:'c5a4b86cf39801c705ee1d61cf73dad3208333ee',
        writeSteps:24406016,rebootSteps:24318976,
        outputMediaSha256:'6d0b480a26daeb20d8a017c20d5ab5ba09926a75c5b73f311e270211f16c8c69',
        writeReportSha256:'d92f007664b65989f45bf17cdec9d3dccb38c6a7e782ce056cfa1f477e5b5186',
        rebootReportSha256:'7baa965cf8012fc8a23a690eeae4b2468c7aafe98983cf5d7be21b04cb175687',
    });
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
        assert.equal(receipt.executionRevision,'55804422bf354dd99b92823f3f294e5cc72f7aa6');
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
