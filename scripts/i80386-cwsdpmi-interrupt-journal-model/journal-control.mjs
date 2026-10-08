import assert from 'node:assert/strict';
import {InterruptJournalModel} from './journal.mjs';

const state=(patch={})=>({cs:0x1b,ss:0x23,eip:0x125a0,esp:0x90000,
  eflags:0x202,cpl:3,cr0:0x80000009|0,cr3:0x38000,cr4:0,
  eax:0x501,ecx:1,edx:2,ebx:3,ebp:4,esi:5,edi:6,...patch});
const softwareBefore=state();
const softwareAfter=state({cs:0x30,ss:0x10,eip:0x5000,esp:0x80000,
  eflags:2,cpl:0});
const softwareFrame={gateType:14,width:32,oldCpl:3,newCpl:0,
  returnCs:softwareBefore.cs,returnEip:softwareBefore.eip+2,
  returnSs:softwareBefore.ss,returnEsp:softwareBefore.esp,
  returnFlags:softwareBefore.eflags,handlerCs:softwareAfter.cs,
  handlerEip:softwareAfter.eip,frameSs:softwareAfter.ss,
  frameEsp:softwareAfter.esp};
const software=()=>({source:'software',vector:0x31,opcode:0xcd,
  instructionStart:softwareBefore.eip,returnEip:softwareFrame.returnEip,
  before:structuredClone(softwareBefore),after:structuredClone(softwareAfter),
  frame:structuredClone(softwareFrame)});
const hardwareBefore=state({...softwareAfter,eip:0x5010,esp:0x7fff0});
const hardwareAfter=state({...hardwareBefore,eip:0x8000,esp:0x7ffd0});
const hardwareFrame={gateType:14,width:32,oldCpl:0,newCpl:0,
  returnCs:hardwareBefore.cs,returnEip:hardwareBefore.eip,
  returnSs:hardwareBefore.ss,returnEsp:hardwareBefore.esp,
  returnFlags:hardwareBefore.eflags,handlerCs:hardwareAfter.cs,
  handlerEip:hardwareAfter.eip,frameSs:hardwareAfter.ss,
  frameEsp:hardwareAfter.esp};
const hardware=()=>({source:'hardware',vector:0x20,returnEip:hardwareFrame.returnEip,
  before:structuredClone(hardwareBefore),after:structuredClone(hardwareAfter),
  frame:structuredClone(hardwareFrame)});
const hardwareReturn=()=>({width:32,before:structuredClone(hardwareAfter),
  after:structuredClone(hardwareBefore),frame:structuredClone(hardwareFrame)});
const softwareReturn=()=>({width:32,before:structuredClone(softwareAfter),
  after:state({eip:softwareFrame.returnEip}),frame:structuredClone(softwareFrame)});

const journal=new InterruptJournalModel(4);
let ticket=journal.begin('step');
assert.equal(journal.commit(ticket),null); // ordinary instruction, no event
ticket=journal.begin('step');
const supplied=software();journal.stageDelivery(ticket,supplied);
supplied.frame.returnEip=0;supplied.before.eax=0; // copied before publication
assert.equal(journal.commit(ticket),1);
assert.deepEqual(journal.status(),{failed:false,pending:1,active:false,openFrames:1,sequence:1});
assert.throws(()=>journal.commit(ticket)); // replay poisons this session
assert.equal(journal.status().failed,true);

const nested=new InterruptJournalModel(4);
ticket=nested.begin('step');nested.stageDelivery(ticket,software());nested.commit(ticket);
ticket=nested.begin('external');nested.stageDelivery(ticket,hardware());nested.commit(ticket);
ticket=nested.begin('step');nested.stageIret(ticket,hardwareReturn());nested.commit(ticket);
ticket=nested.begin('step');nested.stageIret(ticket,softwareReturn());nested.commit(ticket);
const events=nested.drain();
assert.deepEqual(events.map(e=>[e.kind,e.source,e.deliveryId??null]),[
  ['delivery','software',null],['delivery','hardware',null],
  ['iret','hardware',2],['iret','software',1]]);
assert.equal(nested.status().openFrames,0);
events[0].frame.returnEip=0;
assert.equal(nested.drain().length,0); // diagnostics are copies

const carryResult=new InterruptJournalModel();
ticket=carryResult.begin('step');carryResult.stageDelivery(ticket,software());
carryResult.commit(ticket);
ticket=carryResult.begin('step');const carryReturn=softwareReturn();
carryReturn.frame.returnFlags|=1;carryReturn.after.eflags|=1;
carryResult.stageIret(ticket,carryReturn);carryResult.commit(ticket);
const [,carryEvent]=carryResult.drain();
assert.equal(carryEvent.deliveredReturnFlags,0x202);
assert.equal(carryEvent.consumedReturnFlags,0x203);
assert.equal(carryEvent.after.eflags&1,1);

const rollback=new InterruptJournalModel();
ticket=rollback.begin('step');rollback.stageDelivery(ticket,software());
rollback.discard(ticket,{rollback:true});
assert.deepEqual(rollback.status(),{failed:false,pending:0,active:false,openFrames:0,sequence:0});
ticket=rollback.begin('step');assert.equal(rollback.commit(ticket),null);
const ambiguous=new InterruptJournalModel();
ticket=ambiguous.begin('step');ambiguous.stageDelivery(ticket,software());
assert.throws(()=>ambiguous.discard(ticket));
assert.equal(ambiguous.status().failed,true);
const accessorDiscard=new InterruptJournalModel();
ticket=accessorDiscard.begin('step');accessorDiscard.stageDelivery(ticket,software());
let accessorRan=false;
assert.throws(()=>accessorDiscard.discard(ticket,{get rollback(){
  accessorRan=true;accessorDiscard.commit(ticket);return true;
}}));
assert.equal(accessorRan,false);
assert.equal(accessorDiscard.status().pending,0);
assert.equal(accessorDiscard.status().failed,true);
const reentrantDiscard=new InterruptJournalModel();
ticket=reentrantDiscard.begin('step');reentrantDiscard.stageDelivery(ticket,software());
let trapRan=false;
const options=new Proxy({rollback:true},{getOwnPropertyDescriptor(target,key){
  if(key==='rollback'){
    trapRan=true;
    try{reentrantDiscard.commit(ticket);}catch{}
  }
  return Reflect.getOwnPropertyDescriptor(target,key);
}});
assert.throws(()=>reentrantDiscard.discard(ticket,options));
assert.equal(trapRan,true);
assert.equal(reentrantDiscard.status().pending,0);
assert.equal(reentrantDiscard.status().failed,true);

const full=new InterruptJournalModel(1);
ticket=full.begin('step');full.stageDelivery(ticket,software());full.commit(ticket);
assert.throws(()=>full.begin('step')); // pre-effect capacity refusal
assert.equal(full.status().failed,false);
assert.equal(full.drain().length,1);
const external=new InterruptJournalModel();
ticket=external.begin('external');assert.throws(()=>external.commit(ticket));
assert.equal(external.status().failed,true); // no invented delivery

const malformed=new InterruptJournalModel();
ticket=malformed.begin('step');const bad=software();bad.frame.gateType=5;
assert.throws(()=>malformed.stageDelivery(ticket,bad));
assert.equal(malformed.status().failed,true);
const vm=new InterruptJournalModel();
ticket=vm.begin('step');const vmInput=software();vmInput.before.eflags|=0x20000;
assert.throws(()=>vm.stageDelivery(ticket,vmInput));
const wrongFrame=new InterruptJournalModel();
ticket=wrongFrame.begin('step');wrongFrame.stageDelivery(ticket,software());wrongFrame.commit(ticket);
ticket=wrongFrame.begin('step');const badReturn=softwareReturn();badReturn.after.esp++;
assert.throws(()=>wrongFrame.stageIret(ticket,badReturn));
const wrongHandlerStack=new InterruptJournalModel();
ticket=wrongHandlerStack.begin('step');wrongHandlerStack.stageDelivery(ticket,software());
wrongHandlerStack.commit(ticket);
ticket=wrongHandlerStack.begin('step');const shifted=softwareReturn();shifted.before.esp++;
assert.throws(()=>wrongHandlerStack.stageIret(ticket,shifted));

const depth=new InterruptJournalModel(1);
ticket=depth.begin('step');depth.stageDelivery(ticket,software());depth.commit(ticket);
depth.drain(); // queue is empty but the first interrupt frame remains open
ticket=depth.begin('external');depth.stageDelivery(ticket,hardware());
assert.throws(()=>depth.commit(ticket));
assert.deepEqual(depth.status(),{failed:true,pending:0,active:true,openFrames:1,sequence:1});

const foreign=new InterruptJournalModel(),other=new InterruptJournalModel();
ticket=foreign.begin('step');
assert.throws(()=>other.stageDelivery(ticket,software()));
assert.equal(other.status().failed,true);
foreign.discard(ticket,{rollback:true});
const reentry=new InterruptJournalModel();
ticket=reentry.begin('step');let nestedAttempt=false;
const trapped=new Proxy(software(),{getOwnPropertyDescriptor(target,key){
  if(key==='vector'){
    nestedAttempt=true;
    try{reentry.status();}catch{}
  }
  return Reflect.getOwnPropertyDescriptor(target,key);
}});
assert.throws(()=>reentry.stageDelivery(ticket,trapped));
assert.equal(nestedAttempt,true);
assert.equal(reentry.status().failed,true);

console.log('CWSDPMI interrupt journal model controls PASS');
