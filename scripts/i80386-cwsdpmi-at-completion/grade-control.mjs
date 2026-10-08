import assert from 'node:assert/strict';
import {SUCCESS,EXIT_OK,RETURN} from '../i80386-cwsdpmi-qemu-owned/media.mjs';
import {FIRST_SCANS,SECOND_SCANS,gradeBatch,gradeReturn,currentPrompt} from './grade.mjs';

const bytes=text=>Buffer.from(text+'\r\n','ascii');
const initial={output:null,ok:null,fail:null,returned:null};
const session={};
const batchFiles={output:bytes(SUCCESS),ok:bytes(EXIT_OK),fail:null,returned:null};
const returnFiles={...batchFiles,returned:bytes(RETURN)};
const rows=(tail='C:\\>',marker='BW-DPMI-BATCH-DONE')=>
  [...Array(23).fill(''),marker,tail];
const accepted=(stream,start)=>stream.map((scan,index)=>({scan,step:start+index,
  accepted:true}));
const first=accepted(FIRST_SCANS,10),second=accepted(SECOND_SCANS,1101);
const batchInput={session,initial,cutFiles:initial,files:batchFiles,rows:rows(),accepted:first,
  boundStep:500,step:1000,pendingKeys:0};
const batch=gradeBatch(batchInput);
assert.equal(batch.passed,true);
assert.equal(currentPrompt(rows('C:\\>')),true);
assert.equal(currentPrompt(rows('Still running','A:\\>')),false);
const finalInput={session,batch,files:returnFiles,accepted:[...first,...second],
  secondQueuedStep:1100,firstRows:rows('C:\\>',''),firstStep:1200,
  secondRows:rows('C:\\>',''),secondStep:101200,pendingKeys:0};
assert.equal(gradeReturn(finalInput).passed,true);

for(const change of [
  {initial:{...initial,returned:bytes(RETURN)}},
  {cutFiles:{...initial,output:bytes(SUCCESS)}},
  {files:{...batchFiles,output:Buffer.concat([batchFiles.output,Buffer.from('x')])}},
  {files:{...batchFiles,ok:bytes('prefix '+EXIT_OK)}},
  {files:{...batchFiles,fail:bytes('BW-DPMI-EXIT-FAIL')}},
  {files:{...batchFiles,returned:bytes(RETURN)}},
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
  {accepted:[...first,...second.slice(0,-1)]},
  {accepted:[...first, ...accepted(SECOND_SCANS,1098)]},
  {accepted:[{...first[0],scan:first[0].scan^1},...first.slice(1),...second]},
  {accepted:[...first,{scan:0x1e,step:999,accepted:true},...second]},
  {secondQueuedStep:1000},
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
