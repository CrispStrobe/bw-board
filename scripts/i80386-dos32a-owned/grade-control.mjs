import assert from 'node:assert/strict';
import {evaluate,prompt,retainFailure} from './grade.mjs';
import {SUCCESS,EXIT_OK,RETURN,FIRST_COMMAND,SECOND_COMMAND} from './media.mjs';
import {encode} from './keyboard.mjs';

const valid={
  witness:{entry:{linear:0x212000,cr0:1,csDefault32:true,ssDefault32:true,ssWritable:true},
    cmp:{eax:0x23456789},branch:{zero:true},print:{ah:9,edx:0x212000+57},exit:{ax:0x4c00}},
  files:{output:{text:SUCCESS+'\r\n'},ok:{text:EXIT_OK+'\r\n'},fail:null,returned:{text:RETURN+'\r\n'}},
  screen:['A:\\>'],returned:true,shutdown:false,steps:50_000_000,
  keyboard:{pending:0,injected:[...encode(FIRST_COMMAND+'\r'),...encode(SECOND_COMMAND+'\r')]
    .map((event,step)=>({...event,step:step*5000,accepted:true}))},
};
assert.equal(evaluate(valid).passed,true);
assert.equal(prompt(['A:\\>','BW-LE-BATCH-RUNNING']),false);
const failed={firstFailure:'guest step: first fault',witness:{entry:{linear:0x20000}}};
retainFailure(failed,'later final FAT parse failure');
assert.equal(failed.firstFailure,'guest step: first fault');
assert.equal(failed.secondaryFailure,'later final FAT parse failure');
assert.equal(failed.witness.entry.linear,0x20000);
const preflight={firstFailure:null};
retainFailure(preflight,'input digest mismatch');
assert.equal(preflight.firstFailure,'input digest mismatch');
const changed=(field,value)=>({ ...valid,[field]:value });
for(const broken of [
  changed('steps',120_000_000),changed('shutdown',true),changed('returned',false),
  changed('screen',['BW-LE-BATCH-DONE']),
  changed('screen',['A:\\>','BW-LE-BATCH-RUNNING']),
  changed('files',{...valid.files,output:{text:SUCCESS+' '+ 'BW-DOS32-LE-ARITH-FAIL'}}),
  changed('files',{...valid.files,ok:null}),
  changed('files',{...valid.files,fail:{text:'BW-LE-EXIT-1'}}),
  changed('files',{...valid.files,returned:null}),
  changed('witness',{...valid.witness,entry:{...valid.witness.entry,csDefault32:false}}),
  changed('witness',{...valid.witness,entry:{...valid.witness.entry,ssWritable:false}}),
  changed('witness',{...valid.witness,cmp:{eax:0x23456788}}),
  changed('witness',{...valid.witness,branch:{zero:false}}),
  changed('witness',{...valid.witness,print:{ah:9,edx:0x212000+58}}),
  changed('witness',{...valid.witness,exit:{ax:0x4c01}}),
  changed('keyboard',{...valid.keyboard,pending:1}),
  changed('keyboard',{...valid.keyboard,injected:valid.keyboard.injected.slice(0,-1)}),
]) assert.equal(evaluate(broken).passed,false);
console.log('PASS protected-entry, arithmetic, DOS call, exit, files and shell-return adversaries');
