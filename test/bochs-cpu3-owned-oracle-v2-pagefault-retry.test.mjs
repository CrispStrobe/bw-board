import assert from 'node:assert/strict';
import test from 'node:test';
import {assertRecoverablePageFault} from '../scripts/bochs-cpu3-owned-oracle-v2-pagefault-retry/contract.mjs';

const symbols={setup:0x7e00,faulting_store:0x7ebe,pf_handler:0x7ef3,
  cr3_reload:0x7f40,iret_retry:0x7f45};
function record(){
  const events=[];
  const add=(kind,a,b=0,{why=0,phase='none',bytes=null,c=0,instruction=1}={})=>
    events.push({ordinal:events.length+1,instruction,kind,a,b,c,d:0,e:0,why,phase,bytes});
  add('instruction',8,symbols.faulting_store);
  add('physical-access',0xa014,0,{why:5,phase:'postread',bytes:'02500000',c:4});
  add('exception',14,2);
  add('interrupt',14);
  add('linear-access',0x6ffc,0x6ffc,{phase:'prewrite',bytes:'46000100',c:4});
  add('linear-access',0x6ff8,0x6ff8,{phase:'prewrite',bytes:'08000000',c:4});
  add('linear-access',0x6ff4,0x6ff4,{phase:'prewrite',bytes:'be7e0000',c:4});
  add('linear-access',0x6ff0,0x6ff0,{phase:'prewrite',bytes:'02000000',c:4});
  add('instruction',8,symbols.pf_handler,{instruction:2});
  add('linear-access',0x0520,0x0520,{phase:'prewrite',bytes:'00500000',c:4,instruction:2});
  add('linear-access',0x0520,0x0520,{phase:'postread',bytes:'00500000',c:4,instruction:3});
  add('linear-access',0xa014,0xa014,{phase:'prewrite',bytes:'03500000',c:4,instruction:4});
  add('instruction',8,symbols.cr3_reload,{instruction:5});
  add('instruction',8,symbols.iret_retry,{instruction:6});
  add('instruction',8,symbols.faulting_store,{instruction:7});
  add('physical-access',0xa014,0,{why:5,phase:'postread',bytes:'03500000',c:4,instruction:7});
  add('linear-access',0x5000,0x5000,{phase:'prewrite',bytes:'44332211',c:4,instruction:7});
  return {events,state:{cr2:0x5000},tables:{idtrBase:0,idtrLimit:0x03ff}};
}
const rejects=mutate=>{
  const candidate=record();
  mutate(candidate);
  assert.throws(()=>assertRecoverablePageFault(candidate,symbols),/page-fault proof/);
};

test('accepts exactly one fault, observed dword frame, handler and same-EIP retry',()=>{
  const evidence=assertRecoverablePageFault(record(),symbols);
  assert.equal(evidence.frame.eip.value,symbols.faulting_store);
  assert.equal(evidence.frame.eflags.value,0x10046);
  assert.equal(evidence.retryOrdinal,15);
  assert.equal(evidence.failedStoreLinearCallbackCount,0);
});
test('rejects extra or changed fault and missing repaired retry',()=>{
  rejects(r=>{r.events[2].b=0;});
  rejects(r=>{r.events.splice(3,0,{...r.events[2],ordinal:2.5});});
  rejects(r=>{r.events[14].b=0x7ec0;});
  rejects(r=>{r.events[15].bytes='02500000';});
  rejects(r=>{r.events[12].b=0x7f41;});
});
test('rejects false frame values, phase, order and missing RF',()=>{
  rejects(r=>{r.events[4].bytes='46000000';});
  rejects(r=>{r.events[6].bytes='c07e0000';});
  rejects(r=>{r.events[7].bytes='00000000';});
  rejects(r=>{r.events[5].phase='postread';});
  rejects(r=>{r.events[4].ordinal=10;});
  rejects(r=>{r.events[7].instruction=2;});
});
test('rejects missing nonpresent read, scratch CR2 and premature data write',()=>{
  rejects(r=>{r.events[1].bytes='03500000';});
  rejects(r=>{r.events[10].bytes='00000000';});
  rejects(r=>{r.events[11].bytes='02500000';});
  rejects(r=>{r.events.splice(2,0,{...r.events[11],a:0x5000,ordinal:2.5});});
  rejects(r=>{r.state.cr2=0;});
  rejects(r=>{r.events[1].instruction=2;});
  rejects(r=>{r.events[15].instruction=8;});
  rejects(r=>{r.events[15].ordinal=18;});
  rejects(r=>{r.events[16].bytes='00000000';});
  rejects(r=>{r.events[8].b=0x7ef5;});
  rejects(r=>{r.events[3].a=13;});
});
