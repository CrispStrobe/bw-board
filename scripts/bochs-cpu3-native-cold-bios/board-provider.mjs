/** Fresh fixed cold-board source owner, with ordinary paused checkpoints. */
import assert from 'node:assert/strict';import {createHash}from 'node:crypto';
import {HotDirectBoardFacade}from '../bochs-cpu3-native-hot-direct/board.mjs';
import {ExperimentalI80386ATMachine}from '../../src/experimental/i80386-at-machine.js';
import {coldBoardConfig,coldBoardProfile,fixedColdBios,coldOutAllowed,coldInAllowed}from './board-profile.mjs';
const apply=Reflect.apply;
export class SourceColdBiosBoard extends HotDirectBoardFacade{
 #chipFlush=false;
 constructor(...args){assert.equal(args.length,0,'fixed source owner');super(fixedColdBios());this.portEvents=[];this.debugBytes=[];this.controllerPhase='idle';this.statusReads=0;this.dataReads=0;
  this.machine=new ExperimentalI80386ATMachine(coldBoardConfig,{onPortAccess:e=>{assert.ok(this.active&&this.running&&!this.closed,'actual PIO hook lease');assert.ok(this.portEvents.length<coldBoardProfile.maxPortEvents);this.portEvents.push({ordinal:this.portEvents.length+1,...e,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,cycles:this.machine.cycles});}});
  const m=this.machine,rom=fixedColdBios();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();assert.equal(m.cycles,4);assert.equal(m._chipDebt,0);assert.equal(m._a20Enabled,true);m.cpu.step=()=>{throw Error('source cold owner cannot execute JS CPU');};
  const c=m._a20Controller;assert.ok(!c.mouse&&!c.delayedResponse&&!c.outputQueue.length&&!c.keyboardSchedule.length&&!c.pendingCommand&&!c.pendingKeyboardCommand);assert.equal(c.inputBusyCycles,12);assert.equal(c.responseDelayCycles,32);Object.defineProperties(c,{inputBusyCycles:{value:12,writable:false,configurable:false},responseDelayCycles:{value:32,writable:false,configurable:false}});
  const a20=c.onA20Change;c.onA20Change=enabled=>{assert.ok(this.active&&this.running&&!this.closed,'A20 callback lease');assert.equal(enabled,m._a20Enabled,'cold profile forbids A20 transition');return a20(enabled);};
 }
 #flush(rearm){assert.ok(!this.running&&!this.active&&!this.closed&&!this.#chipFlush);this.#chipFlush=true;this.running=this.active=true;try{if(rearm)this.machine._flushChips();else this.machine._catchUpChips();}finally{this.running=this.active=false;this.#chipFlush=false;}}
 beginRun(){assert.ok(!this.closed&&!this.running&&!this.active);if(this.machine._chipDebt>=this.machine._chipDeadline)this.#flush(true);this.running=true;}
 stageLine(){assert.ok(!this.running&&!this.active&&!this.closed);if(this.machine._chipDebt>=this.machine._chipDeadline)this.#flush(true);const asserted=!!this.machine._pic.intActive,changed=asserted!==this.lineAsserted;this.lineAsserted=asserted;return {asserted,changed};}
 settleTerminal(){assert.ok(!this.running&&!this.active&&!this.closed);this.#flush(false);return this.inspect();}
 inspect(){return {...super.inspect(),cold:{phase:this.controllerPhase,statusReads:this.statusReads,dataReads:this.dataReads,debugBytes:[...this.debugBytes],portEventCount:this.portEvents.length}};}
 nativeTick(){return this._call('nativeTick',[],()=>{assert.ok(this.nativeTicks<coldBoardProfile.totalNativeTicks);this.nativeTicks++;return 0;});}
 quantum(kind){return this._call('quantum',[kind],()=>{assert.ok(kind===0||kind===1);assert.ok(this.successfulQuanta<coldBoardProfile.totalQuanta);this.successfulQuanta++;this.machine.cycles+=6;this.machine._chipDebt+=6;return Number(this.machine._chipDebt>=this.machine._chipDeadline);});}
 admitExecutePage(raw){assert.ok(this.running&&!this.active&&!this.closed,'ROM page lifecycle');const span=this.span(raw,4096,{execute:true});assert.ok(span.kind===2&&((span.decoded>=0xf0000&&span.decoded+4096<=0x100000)||(span.decoded>=0xff0000&&span.decoded+4096<=0x1000000)),'cold ROM-only execution');return super.admitExecutePage(raw);}
 acknowledgeIrq(){return this._call('ack',[],()=>{throw Error('cold BIOS source scope forbids PIC ACK/delivery');});}
 #controller(){const c=this.machine._a20Controller;assert.ok(!c.mouse&&!c.keyboardSchedule.length&&!c.pendingKeyboardCommand&&!c.pendingCommand&&c.typematicParameter===null&&c.commandByte===0&&!c.systemFlag,'unsolicited controller state');assert.equal(c.inputBusyCycles,12);assert.equal(c.responseDelayCycles,32);const waiting=this.controllerPhase==='waiting55'||this.controllerPhase==='waiting00',expected=this.controllerPhase==='waiting00'?0:85;assert.ok(waiting?c.outputQueue.length<=1&&c.outputQueue.every(e=>e.value===expected&&e.keyboard===false&&!e.aux):c.outputQueue.length===0,'foreign response');assert.ok(!c.delayedResponse||waiting&&c.delayedResponse.value===expected,'foreign delayed response');return c;}
 outPort(port,width,value){return this._call('outPort',[port,width,value],()=>{assert.ok(coldOutAllowed(port,width,value),'cold byte OUT before effect');assert.ok(this.portEvents.length<coldBoardProfile.maxPortEvents);if(port===0x402)assert.ok(this.debugBytes.length<coldBoardProfile.maxDebugBytes);this.machine._catchUpChips();
  if(port===0x64){const c=this.#controller();assert.equal(this.controllerPhase,value===0xaa?'idle':'consumed55','ordered AA then AB');assert.ok(!c.outputQueue.length&&!c.delayedResponse&&!c.inputBusyCyclesRemaining);}
  if(port===0x71)assert.equal(this.machine.chips.rtc1.index,0x0f,'fixed CMOS shutdown-register write');
  const epoch=this.mappingEpoch,a20=Number(this.machine._a20Enabled);this.machine._out386(port,value,8);if(port===0x64)this.controllerPhase=value===0xaa?'waiting55':'waiting00';if(port===0x402)this.debugBytes.push(value);assert.equal(this.mappingEpoch,epoch);assert.equal(Number(this.machine._a20Enabled),a20);assert.ok(!this.machine._cpuResetPending&&!this.machine._fastA20Latch);return {value:0,mappingEpoch:epoch,boardA20:a20};
 });}
 inPort(port,width){return this._call('inPort',[port,width],()=>{assert.ok(coldInAllowed(port,width),'cold byte IN before effect');assert.ok(this.portEvents.length<coldBoardProfile.maxPortEvents);this.machine._catchUpChips();
  if(port===0x71)assert.equal(this.machine.chips.rtc1.index,0x0f,'fixed CMOS shutdown-register read');
  if(port===0x64||port===0x60){const c=this.#controller();if(port===0x64)assert.ok(this.statusReads<coldBoardProfile.maxStatusReads);else assert.ok((this.controllerPhase==='waiting55'||this.controllerPhase==='waiting00')&&!c.delayedResponse&&c.outputQueue.length===1,'ready response consumption');}
  const epoch=this.mappingEpoch,a20=Number(this.machine._a20Enabled),value=this.machine._in386(port,8);assert.ok(Number.isInteger(value)&&value>=0&&value<=255);if(port===0x64)this.statusReads++;if(port===0x60){assert.equal(value,this.controllerPhase==='waiting55'?85:0);this.dataReads++;this.controllerPhase=this.dataReads===1?'consumed55':'complete';}assert.equal(this.mappingEpoch,epoch);assert.equal(Number(this.machine._a20Enabled),a20);return {value,mappingEpoch:epoch,boardA20:a20};
 });}
}
export function createOwnedColdBiosProvider(...args){
 assert.equal(args.length,0,'private fixed factory accepts no caller config/hooks');
 const rom=fixedColdBios();
 const board=new SourceColdBiosBoard();
 const methods=Object.fromEntries(['readPhysical','writePhysical','admitExecutePage','outPort','inPort','acknowledgeIrq','nativeTick','quantum','stageLine','beginRun','endRun','inspect','settleTerminal','close'].map(k=>[k,board[k]]));
 const call=(k,args=[])=>apply(methods[k],board,args);
 let lease=false,closed=false,initialized=false,entry=false,postPio=false,mappingPending=false,active=false,n=0,q=0;
 const state=()=>[board.nativeTicks,board.successfulQuanta,board.machine.cycles,board.machine._chipDebt,board.machine._chipDeadline,board.mappingEpoch,Number(board.machine._a20Enabled)];
 const checkState=()=>{const s=state();assert.ok(s.every(v=>Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff));assert.equal(s[2],4+6*s[1]);assert.ok(s[4]>=1&&s[4]<=6000&&s[3]<=s[4]+5);assert.ok(s[6]<=1);return s;};
 const callback=fn=>(...args)=>{assert.ok(lease&&!closed&&!active&&!entry&&!postPio&&!mappingPending,'owned callback lease');active=true;try{return fn(...args);}finally{active=false;}};
 const callbacks=Object.freeze({
  readPhysical:callback((...args)=>call('readPhysical',args)),writePhysical:callback((...args)=>call('writePhysical',args)),admitExecutePage:callback((...args)=>call('admitExecutePage',args)),
  packedScalar:callback((op,a,b,c)=>{assert.ok(op===3||op===4||op===5,'no scalar clocks');if(op===5){assert.ok(Number.isInteger(a)&&coldInAllowed(a,b)&&b===1&&c===0,'IN8 scalar admission');const before=state();const result=call('inPort',[a,b]);const after=checkState();assert.deepEqual(after.slice(0,3),before.slice(0,3),'IN does not charge clocks');assert.equal(after[3],0);assert.deepEqual(after.slice(5),before.slice(5),'IN mapping unchanged');postPio=true;return Uint32Array.of(result.value,result.mappingEpoch,result.boardA20);}if(op===4){assert.equal(a|b|c,0);return Uint32Array.of(call('acknowledgeIrq'),board.mappingEpoch,Number(board.machine._a20Enabled));}assert.ok(!postPio,'one pending PIO');const before=state();const result=call('outPort',[a,b,c]);const after=checkState();assert.deepEqual(after.slice(0,3),before.slice(0,3),'PIO does not charge clocks');assert.equal(after[3],0,'actual PIO catches chips up');assert.equal(after[5],before[5],'cold mapping unchanged');mappingPending=after[5]!==before[5];postPio=true;return Uint32Array.of(result.value,result.mappingEpoch,result.boardA20);}),
  clockTransfer(words,reason){
   assert.ok(Number.isInteger(reason),'integer clock reason before effects');
   assert.ok(!closed&&!active,'clock reentry');assert.ok(words instanceof Uint32Array&&words.buffer instanceof ArrayBuffer&&words.byteOffset===0&&words.byteLength===words.buffer.byteLength&&words.length<=900,'owned tape');
   const query=words.length===0;
   if(query){assert.ok(reason===1&&!initialized&&!lease||reason===2&&lease&&entry||reason===6&&lease&&postPio,'clock query phase');}
   else assert.ok(lease&&!entry&&!postPio&&reason>=3&&reason<=11&&reason!==6,'clock commit phase');
   // Entire bounded tape is preflighted before any board effect.
   let nextMapping=mappingPending,nextN=n,nextQ=q,nn=board.nativeTicks,qq=board.successfulQuanta,debt=board.machine._chipDebt;
   for(const word of words){assert.ok(word===1||word===2||word===3,'word enum');if(word===1){assert.ok(!nextMapping,'N pending mapping');assert.ok(++nn<=coldBoardProfile.totalNativeTicks&&++nextN<=600,'independent N cap');}else{assert.ok(!nextMapping||word===2,'REP pending mapping');nextMapping=false;assert.ok(debt<board.machine._chipDeadline,'Q after due');assert.ok(++qq<=coldBoardProfile.totalQuanta&&++nextQ<=300,'independent Q cap');debt+=6;}}
   n=nextN;q=nextQ;mappingPending=nextMapping;active=true;try{
    for(const word of words)call(word===1?'nativeTick':'quantum',word===1?[]:[word===3?1:0]);
    const s=checkState();assert.equal(s[0],nn);assert.equal(s[1],qq);assert.equal(s[3],debt);
    if(reason===1){assert.deepEqual(s,[0,0,4,0,6000,0,1]);initialized=true;}
    if(reason===2){assert.ok(s[3]<s[4]);entry=false;}
    if(reason===6){assert.equal(s[3],0);postPio=false;}
    return Uint32Array.from(s);
   }finally{active=false;}
  }
 });
 return Object.freeze({rom:Uint8Array.from(rom),callbacks,
  stage(){assert.ok(initialized&&!lease&&!closed&&!active);return call('stageLine');},
  begin(){assert.ok(initialized&&!lease&&!closed&&!active);call('beginRun');lease=true;entry=true;n=q=0;checkState();},
  end(){assert.ok(lease&&!active&&!entry&&!postPio&&!mappingPending);call('endRun');lease=false;},
  checkpoint(){assert.ok(!lease&&!active&&!closed);return call('inspect');},
  records(){assert.ok(!lease&&!active&&!closed);return board.portEvents.map(e=>({...e}));},
  settleCheckpoint(){assert.ok(!lease&&!active&&!closed);const state=call('settleTerminal');return {state,ramSha256:createHash('sha256').update(board.machine.mem).digest('hex')};},
  close(){assert.ok(!lease&&!active&&!closed);call('close');closed=true;}
 });
}
