import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBochsCpu3OwnedOracle} from '../scripts/bochs-cpu3-owned-oracle/parse.mjs';

const line=(...fields)=>`BW386O1\t${fields.join('\t')}`;
const marker='BHVK003';
const event=(ordinal,instruction,kind,a,b,c=0,d=0,e=0)=>
  line('EVENT',ordinal,instruction,kind,a.toString(16),b.toString(16),
    c.toString(16),d.toString(16),e.toString(16));
const segment=name=>line('SEG',name,'0','0',...Array(8).fill('0'));
const validRecord=()=>[
  line('BEGIN','vm-task',marker),
  ...[...marker].map((ch,index)=>event(index+1,index,'port-write',0xe9,ch.charCodeAt(0),1)),
  event(8,7,'instruction',0,0x7e00),
  line('STATE',...Array(13).fill('0')),
  line('DEBUG',...Array(6).fill('0')),
  line('TABLE',...Array(4).fill('0')),
  line('SCHED','0','0','100'),
  ...['es','cs','ss','ds','fs','gs','ldtr','tr'].map(segment),
  line('END',marker,'7','8'),
].join('\n')+'\n';

test('accepts a complete native hook record and marks invalid caches unavailable',()=>{
  const parsed=parseBochsCpu3OwnedOracle(`Bochs startup log\n${validRecord()}`);
  assert.equal(parsed.events.length,8);
  assert.equal(parsed.events[0].kind,'port-write');
  assert.equal(parsed.instructionCount,7);
  assert.equal(parsed.segments.ldtr.valid,0);
  assert.equal(parsed.segments.ldtr.base,null);
  assert.equal(parsed.segments.ldtr.type,null);
});

test('rejects missing or mutated owned boundary records',()=>{
  const valid=validRecord();
  assert.throws(()=>parseBochsCpu3OwnedOracle(valid.replace('BHVK003\t7\t8','BHVK003\t7\t9')),/malformed checkpoint end/);
  assert.throws(()=>parseBochsCpu3OwnedOracle(valid.replace('EVENT\t8\t7','EVENT\t9\t7')),/nonconsecutive event/);
  assert.throws(()=>parseBochsCpu3OwnedOracle(valid.replace('port-write\te9\t48','port-read\te9\t48')),/marker mismatch/);
  assert.throws(()=>parseBochsCpu3OwnedOracle(valid.replace('port-write\te9\t48','unknown-hook\te9\t48')),/invalid event kind/);
  assert.throws(()=>parseBochsCpu3OwnedOracle(valid.replace('EVENT\t8\t7','EVENT\t8\t6')),/invalid event kind or instruction order/);
  assert.throws(()=>parseBochsCpu3OwnedOracle(valid.replace('EVENT\t8\t7','EVENT\t8\t8')),/invalid event kind or instruction order/);
  assert.throws(()=>parseBochsCpu3OwnedOracle(valid.replace('e9\t42','100000000\t42')),/exceeds CPU3 width/);
  assert.throws(()=>parseBochsCpu3OwnedOracle(valid.replace(segment('tr'),'').trim()),/incomplete Bochs checkpoint/);
  assert.throws(()=>parseBochsCpu3OwnedOracle(valid.replace('BW386O1\tSTATE','BW386O1\tERROR\tbad\nBW386O1\tSTATE')),/probe error/);
});
