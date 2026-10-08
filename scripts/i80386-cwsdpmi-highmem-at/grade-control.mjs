import assert from 'node:assert/strict';
import {EXIT_OK,RETURN,BATCH_DONE} from '../i80386-cwsdpmi-highmem-timer/media.mjs';
const SUCCESS='BW_HMT_OK\r\nBW_HMT_VALUES address=4849664 requested=4096 selector_base=4849664 selector_limit=4095 first=732237 last=732238 polls=1035 delta=1 checksum=4225408';
import {FIRST_SCANS,SECOND_SCANS,gradeBatch,gradeReturn,currentPrompt,projectOutput,
  fullVerifyEcho} from './grade.mjs';

const bytes=text=>Buffer.from(text+'\r\n','ascii');
assert.equal(projectOutput(bytes(SUCCESS)).address,4849664);
for(const bad of [
  SUCCESS.replace('address=4849664','address=1048576'),
  SUCCESS.replace('address=4849664','address=4294963201'),
  SUCCESS.replace('requested=4096','requested=4095'),
  SUCCESS.replace('selector_base=4849664','selector_base=4849665'),
  SUCCESS.replace('selector_limit=4095','selector_limit=4096'),
  SUCCESS.replace('polls=1035','polls=262145'),
  SUCCESS.replace('delta=1','delta=0'),
  SUCCESS.replace('last=732238','last=732237'),
  SUCCESS.replace('checksum=4225408','checksum=4225409'),
  SUCCESS.replace('address=4849664','address=04849664'),
  SUCCESS+'\r\n',SUCCESS+'\r\n\n',SUCCESS+' extra',SUCCESS.replace('address=4849664','address=-1'),
]) assert.equal(projectOutput(bytes(bad)),null,bad);
assert.equal(projectOutput(Buffer.concat([bytes(SUCCESS),Buffer.from([0xff])])),null);
const initial={output:null,ok:null,fail:null,returned:null};
const session={};
const batchFiles={output:bytes(SUCCESS),ok:bytes(EXIT_OK),fail:null,returned:null};
const returnFiles={...batchFiles,returned:bytes(RETURN)};
const rows=(tail='C:\\>',marker='BW-HMT-BATCH-DONE')=>
  [...Array(23).fill(''),marker,tail];
const accepted=(stream,start)=>stream.map((scan,index)=>({scan,step:start+index,
  accepted:true}));
const first=accepted(FIRST_SCANS,10),second=accepted(SECOND_SCANS,1101);
const batchInput={session,initial,cutFiles:initial,files:batchFiles,rows:rows(),accepted:first,
  boundStep:500,step:1000,pendingKeys:0};
const batch=gradeBatch(batchInput);
assert.equal(batch.passed,true);
assert.equal(gradeBatch({...batchInput,cutFiles:{...initial,output:Buffer.alloc(0)}}).passed,true);
assert.equal(currentPrompt(rows('C:\\>')),true);
assert.equal(currentPrompt(rows('Still running','A:\\>')),false);
const finalInput={session,batch,files:returnFiles,accepted:[...first,...second],
  secondQueuedStep:1100,queuedRows:rows('C:\\>',''),
  echoRows:rows('C:\\>','C:\\>c:\\verifyht.bat'),echoStep:1200,
  firstRows:rows('C:\\>','C:\\>c:\\verifyht.bat'),firstStep:1200,
  secondRows:rows('C:\\>',''),secondStep:101200,pendingKeys:0};
assert.equal(gradeReturn(finalInput).passed,true);
assert.equal(fullVerifyEcho(finalInput.echoRows),true);
const otherSuccess=bytes(SUCCESS.replaceAll('4849664','4849665'));
assert.notEqual(projectOutput(otherSuccess),null);
assert.equal(gradeReturn({...finalInput,files:{...returnFiles,output:otherSuccess}}).passed,false);
const borrowed=Buffer.from(batchFiles.output);
const borrowedBatch=gradeBatch({...batchInput,files:{...batchFiles,output:borrowed}});
assert.equal(borrowedBatch.passed,true);
borrowed[20]^=1;
assert.equal(gradeReturn({...finalInput,batch:borrowedBatch}).passed,true);
const getterFiles={...batchFiles};let getterRead=false;
Object.defineProperty(getterFiles,'output',{get(){getterRead=true;return batchFiles.output;}});
assert.equal(gradeBatch({...batchInput,files:getterFiles}).passed,false);
assert.equal(getterRead,false);

for(const change of [
  {initial:{...initial,returned:bytes(RETURN)}},
  {cutFiles:{...initial,output:bytes(SUCCESS)}},
  {cutFiles:{...initial,ok:bytes(EXIT_OK)}},
  {cutFiles:{...initial,fail:bytes('BW-DPMI-EXIT-FAIL')}},
  {cutFiles:{...initial,returned:bytes(RETURN)}},
  {files:{...batchFiles,output:Buffer.concat([batchFiles.output,Buffer.from('x')])}},
  {files:{...batchFiles,ok:bytes('prefix '+EXIT_OK)}},
  {files:{...batchFiles,fail:bytes('BW-DPMI-EXIT-FAIL')}},
  {files:{...batchFiles,returned:bytes(RETURN)}},
  {files:{...batchFiles,extra:null}},
  {rows:rows('A:\\>')},
  {rows:rows('running')},
  {rows:rows('C:\\>','other marker')},
  {rows:rows('running','A:\\>')}, // stale old prompt above active line
  {accepted:first.slice(0,-1)},
  {accepted:[...first.slice(0,3),{scan:'invalid',step:13,accepted:true},
    ...first.slice(3).map(event=>({...event,step:event.step+1}))]},
  {accepted:[...first.slice(0,3),{scan:0x1e,step:13,accepted:false},
    ...first.slice(3)]},
  {accepted:[first[1],first[0],...first.slice(2)]},
  {boundStep:5},
  {pendingKeys:1},
]) assert.equal(gradeBatch({...batchInput,...change}).passed,false);
assert.equal(gradeBatch({...batchInput,accepted:[{scan:0x1e,step:1,accepted:true},...first]}).passed,true);

for(const change of [
  {files:{...returnFiles,returned:bytes('prefix '+RETURN)}},
  {files:{...returnFiles,fail:bytes('BW-DPMI-EXIT-FAIL')}},
  {files:{...returnFiles,extra:null}},
  {secondRows:rows('A:\\>')},
  {accepted:[...first,...second.slice(0,-1)]},
  {accepted:[...first, ...accepted(SECOND_SCANS,1098)]},
  {accepted:[{...first[0],scan:first[0].scan^1},...first.slice(1),...second]},
  {accepted:[...first,{scan:0x1e,step:999,accepted:true},...second]},
  {secondQueuedStep:1000},
  {queuedRows:rows('C:\\>','C:\\>c:\\verifyht.bat')},
  {echoRows:rows('C:\\>','')},
  {echoRows:rows('VERIFY RUNNING','C:\\>c:\\verifyht.bat')},
  {echoStep:1100},
  {batch:{...batch,passed:true}},
  {session:{}},
  {firstRows:rows('RUNNING','A:\\>')},
  {secondRows:rows('RUNNING','A:\\>')},
  {secondStep:1201},
  {pendingKeys:1},
]) assert.equal(gradeReturn({...finalInput,...change}).passed,false);

const tooEarly=accepted(SECOND_SCANS,600);
assert.equal(gradeReturn({...finalInput,accepted:[...first,...tooEarly]}).passed,false);
console.log('CWSDPMI AT completion grade controls PASS');
