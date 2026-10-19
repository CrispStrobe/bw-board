import assert from 'node:assert/strict';
import test from 'node:test';
import {gradeFreeDosAtAcceptance} from '../scripts/lib/freedos-at-acceptance.mjs';

const original='1'.repeat(64),saved='2'.repeat(64),bootHash='3'.repeat(64);
const expectedRequested='n\rtype fdboot.txt\r';
const expectedInjectedKeys=[...'n\rtype fdboot.txt\r'];
const evidence={passed:true,final:{halted:false,shutdown:false},
  executionBoundaries:{int19:{},unexpectedInterrupt:null,bootSector:{sha256:bootHash,devices:{primaryDma:{
    status:4,channels:[{},{},{page:0,baseAddr:0x7c00,baseCount:0x1ff,curAddr:0x7e00,curCount:0xffff}],
  }}}},keyboardScript:{installerDeclined:true,commandQueued:true,
    commandPrompt:{step:10,row:24,column:3,line:'A:\\>'},requested:expectedRequested,
    remaining:[],injected:expectedInjectedKeys.map(key=>({key}))},guestFile:{text:'fd-boot-ok\r\n'},
  screenText:['fd-boot-ok','A:\\>']};
const options={expectedText:'fd-boot-ok\r\n',inputBootSectorSha256:bootHash,
  inputMediaSha256:saved,originalMediaSha256:original,priorOutputMediaSha256:saved,
  expectedRequested,expectedInjectedKeys};

test('FreeDOS acceptance binds decline, exact keys, DMA, file, prompt and prior media',()=>{
  assert.equal(gradeFreeDosAtAcceptance(evidence,options),true);
  for(const mutate of [
    e=>e.keyboardScript.injected=[],
    e=>e.keyboardScript.requested='n\recho bad>fdboot.txt\r',
    e=>e.keyboardScript.installerDeclined=false,
    e=>e.keyboardScript.commandPrompt.column=0,
    e=>e.executionBoundaries.bootSector.devices.primaryDma.status=0,
    e=>e.guestFile.text='wrong\r\n',
    e=>e.screenText=['fd-boot-ok','not a prompt'],
  ]) { const copy=structuredClone(evidence);mutate(copy);assert.equal(gradeFreeDosAtAcceptance(copy,options),false); }
  assert.equal(gradeFreeDosAtAcceptance(evidence,{...options,inputMediaSha256:'4'.repeat(64)}),false);
});
