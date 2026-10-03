/** Separate source-only fixed 8042 owner. No native initializer/build admission. */
import assert from 'node:assert/strict';
import {ramResetEvidence} from '../bochs-cpu3-native-owned-in8/reset-witness.mjs';
import {HotDirectBoardFacade} from '../bochs-cpu3-native-hot-direct/board.mjs';
import {fixedSelfTestRom,selfTestProfile,selfTestRomSha256,selfTestBoardConfig} from './profile.mjs';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {createHash} from 'node:crypto';
const apply=Reflect.apply;
/** Public source-control facade; the private factory accepts no caller board. */
export class Source8042Board extends HotDirectBoardFacade {
 #chipFlush=false;
 constructor(...args){
  assert.equal(args.length,0,'fixed source facade has no ROM/config/hooks');super(fixedSelfTestRom().rom);
  // The ordinary combined fixture may configure keyboard BAT/mouse. Construct
  // this separate owner with its fixed device profile, before any command.
  this.machine=new ExperimentalI80386ATMachine(selfTestBoardConfig);
  const m=this.machine,rom=fixedSelfTestRom().rom;m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();assert.ok(m.cycles===4&&m._chipDebt===0&&m._a20Enabled,'reset epoch');
  m.cpu.step=()=>{throw Error('source8042 owner: JavaScript CPU stepping forbidden');};
  const c=this.machine._a20Controller;
  assert.ok(c&&!this.running&&!this.active&&!c.delayedResponse&&c.outputQueue.length===0&&c.keyboardSchedule.length===0&&c.pendingCommand===null&&c.pendingKeyboardCommand===null&&!c.mouse,'fresh private controller');
  assert.equal(c.inputBusyCycles,12);assert.equal(c.responseDelayCycles,32);
  // Pin the fresh controller before its first command. Never alter a live response.
  Object.defineProperties(c,{inputBusyCycles:{value:selfTestProfile.inputBusyCycles,writable:false,configurable:false},responseDelayCycles:{value:selfTestProfile.responseDelayCycles,writable:false,configurable:false}});
  const a20=c.onA20Change;c.onA20Change=enabled=>{if(this.#chipFlush)assert.equal(enabled,m._a20Enabled,'owned chip flush cannot change A20');assert.ok(this.active&&this.running&&!this.closed,'unauthorized A20 mutation before effect');assert.ok(this.mappingEpoch<0xffffffff,'mapping overflow before A20 effect');const before=m._a20Enabled,r=a20(enabled);if(before!==m._a20Enabled)this.mappingEpoch++;return r;};
  this.selfTestPhase='idle';this.statusReads=0;this.dataReads=0;
 }
 #flush(rearm){
  assert.ok(!this.running&&!this.active&&!this.closed&&!this.#chipFlush,'closed owner chip flush phase');
  this.#chipFlush=true;this.running=this.active=true;
  try{if(rearm)this.machine._flushChips();else this.machine._catchUpChips();}
  finally{this.running=this.active=false;this.#chipFlush=false;}
 }
 beginRun(){assert.ok(!this.closed&&!this.running&&!this.active,'begin lifecycle');if(this.machine._chipDebt>=this.machine._chipDeadline)this.#flush(true);this.running=true;}
 stageLine(){assert.ok(!this.running&&!this.active&&!this.closed,'line phase');if(this.machine._chipDebt>=this.machine._chipDeadline)this.#flush(true);const asserted=!!this.machine._pic.intActive,changed=asserted!==this.lineAsserted;this.lineAsserted=asserted;return {asserted,changed};}
 settleTerminal(){assert.ok(!this.running&&!this.active&&!this.closed,'terminal phase');this.#flush(false);return this.inspect();}
 inspect(){return {...super.inspect(),selfTest:{phase:this.selfTestPhase,statusReads:this.statusReads,dataReads:this.dataReads}};}
 _controllerSafe(){
  const c=this.machine._a20Controller;
  assert.ok(c.inputBusyCycles===12&&c.responseDelayCycles===32&&!c.mouse&&c.keyboardSchedule.length===0&&c.pendingKeyboardCommand===null&&c.typematicParameter===null,'8042 unsolicited schedule/device');
  assert.ok(c.pendingCommand===null,'8042 pending command before device consumption');
  assert.ok(c.commandByte===0&&!c.systemFlag,'8042 fixed command-byte profile');
  assert.ok(c.outputQueue.length<=1&&c.outputQueue.every(e=>e.value===0x55&&e.keyboard===false&&!e.aux),'8042 keyboard/aux/foreign queue before device consumption');
  assert.ok(c.delayedResponse===null||this.selfTestPhase==='waiting'&&c.delayedResponse.value===0x55,'8042 foreign delayed response');
  assert.equal(this.machine._pic.imr,255,'8042 master PIC masked');assert.equal(this.machine.chips.pic2.imr,255,'8042 slave PIC masked');
  assert.ok(!this.machine._pic.pollPending&&!this.machine.chips.pic2.pollPending,'8042 no PIC poll');return c;
 }
 outPort(port,width,value){
  if(port!==0x64||value!==0xaa)return super.outPort(port,width,value); // Exact original D1/OUT60 1-or3 path.
  return this._call('outPort',[port,width,value],()=>{
   assert.ok(Number.isInteger(port)&&width===1&&value===0xaa,'8042 AA byte admission');
   assert.ok(this.mappingEpoch<0xffffffff,'mapping overflow before effect');
   this.machine._catchUpChips(); // Denial promises no command/read consumption, not no elapsed-clock effects.
   const c=this._controllerSafe();assert.ok(this.selfTestPhase==='idle'&&!c.delayedResponse&&c.outputQueue.length===0&&c.inputBusyCyclesRemaining===0,'one AA from an empty idle controller');
   const epoch=this.mappingEpoch,a20=Number(this.machine._a20Enabled);this.machine._out386(port,value,8);this.selfTestPhase='waiting';
   assert.equal(this.mappingEpoch,epoch);assert.equal(Number(this.machine._a20Enabled),a20);assert.ok(!this.machine._cpuResetPending&&this.machine._fastA20Latch===0);return {value:0,mappingEpoch:epoch,boardA20:a20};
  });
 }
 inPort(port,width){return this._call('inPort',[port,width],()=>{
  assert.ok(Number.isInteger(port)&&width===1&&[0x40,0x21,0xa1,0x60,0x64].includes(port),'IN8 admission before device effect');
  const epoch=this.mappingEpoch,a20=Number(this.machine._a20Enabled);
  if(port===0x60||port===0x64){
   this.machine._catchUpChips();const c=this._controllerSafe();assert.ok(this.selfTestPhase!=='idle','8042 read requires owned AA');
   if(port===0x64)assert.ok(this.statusReads<selfTestProfile.maxStatusReads,'bounded status polling');
   else {assert.ok(this.dataReads<selfTestProfile.maxDataReads,'bounded self-test data reads');assert.ok(this.dataReads===0?this.selfTestPhase==='waiting'&&c.delayedResponse===null&&c.outputQueue.length===1:this.selfTestPhase==='consumed'&&c.outputQueue.length===0&&c.delayedResponse===null,'8042 ready55 then emptyFF only');}
  }else {const pic=port===0x21?this.machine._pic:port===0xa1?this.machine.chips.pic2:null;assert.ok(port===0x40||pic&&pic.pollPending===false,'PIC present and no poll before device effect');}
  const value=this.machine._in386(port,8);assert.ok(Number.isInteger(value)&&value>=0&&value<=255,'actual IN8 byte');
  if(port===0x64)this.statusReads++;
  if(port===0x60){assert.equal(value,this.dataReads===0?0x55:0xff);this.dataReads++;this.selfTestPhase=this.dataReads===1?'consumed':'complete';}
  assert.equal(this.mappingEpoch,epoch);assert.equal(Number(this.machine._a20Enabled),a20);return {value,mappingEpoch:epoch,boardA20:a20};
 });}
}
export function createOwned8042Provider(...args){
 assert.equal(args.length,0,'private fixed factory accepts no caller config/hooks');
 const {rom,sha256}=fixedSelfTestRom();assert.equal(sha256,selfTestRomSha256);
 const board=new Source8042Board();
 const methods=Object.fromEntries(['readPhysical','writePhysical','admitExecutePage','outPort','inPort','acknowledgeIrq','nativeTick','quantum','stageLine','beginRun','endRun','inspect','settleTerminal','close'].map(k=>[k,board[k]]));
 const call=(k,args=[])=>apply(methods[k],board,args);
 let lease=false,closed=false,initialized=false,entry=false,postPio=false,mappingPending=false,active=false,n=0,q=0;
 const state=()=>[board.nativeTicks,board.successfulQuanta,board.machine.cycles,board.machine._chipDebt,board.machine._chipDeadline,board.mappingEpoch,Number(board.machine._a20Enabled)];
 const checkState=()=>{const s=state();assert.ok(s.every(v=>Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff));assert.equal(s[2],4+6*s[1]);assert.ok(s[4]>=1&&s[4]<=6000&&s[3]<=s[4]+5);assert.ok(s[6]<=1);return s;};
 const callback=fn=>(...args)=>{assert.ok(lease&&!closed&&!active&&!entry&&!postPio&&!mappingPending,'owned callback lease');active=true;try{return fn(...args);}finally{active=false;}};
 const callbacks=Object.freeze({
  readPhysical:callback((...args)=>call('readPhysical',args)),writePhysical:callback((...args)=>call('writePhysical',args)),admitExecutePage:callback((...args)=>call('admitExecutePage',args)),
  packedScalar:callback((op,a,b,c)=>{assert.ok(op===3||op===4||op===5,'no scalar clocks');if(op===5){assert.ok(Number.isInteger(a)&&[0x40,0x21,0xa1,0x60,0x64].includes(a)&&b===1&&c===0,'IN8 scalar admission');const before=state();const result=call('inPort',[a,b]);const after=checkState();assert.deepEqual(after.slice(0,3),before.slice(0,3),'IN does not charge clocks');assert.equal(after[3],0);assert.deepEqual(after.slice(5),before.slice(5),'IN mapping unchanged');postPio=true;return Uint32Array.of(result.value,result.mappingEpoch,result.boardA20);}if(op===4){assert.equal(a|b|c,0);return Uint32Array.of(call('acknowledgeIrq'),board.mappingEpoch,Number(board.machine._a20Enabled));}assert.ok(!postPio,'one pending PIO');const before=state();const result=call('outPort',[a,b,c]);const after=checkState();assert.deepEqual(after.slice(0,3),before.slice(0,3),'PIO does not charge clocks');assert.equal(after[3],0,'actual PIO catches chips up');assert.ok(after[5]===before[5]||a===0x60&&after[5]===before[5]+1,'actual mapping transition');mappingPending=after[5]!==before[5];postPio=true;return Uint32Array.of(result.value,result.mappingEpoch,result.boardA20);}),
  clockTransfer(words,reason){
   assert.ok(!closed&&!active,'clock reentry');assert.ok(words instanceof Uint32Array&&words.buffer instanceof ArrayBuffer&&words.byteOffset===0&&words.byteLength===words.buffer.byteLength&&words.length<=900,'owned tape');
   const query=words.length===0;
   if(query){assert.ok(reason===1&&!initialized&&!lease||reason===2&&lease&&entry||reason===6&&lease&&postPio,'clock query phase');}
   else assert.ok(lease&&!entry&&!postPio&&reason>=3&&reason<=11&&reason!==6,'clock commit phase');
   // Entire bounded tape is preflighted before any board effect.
   let nextMapping=mappingPending,nextN=n,nextQ=q,nn=board.nativeTicks,qq=board.successfulQuanta,debt=board.machine._chipDebt;
   for(const word of words){assert.ok(word===1||word===2||word===3,'word enum');if(word===1){assert.ok(!nextMapping,'N pending mapping');assert.ok(++nn<=160000&&++nextN<=600,'independent N cap');}else{assert.ok(!nextMapping||word===2,'REP pending mapping');nextMapping=false;assert.ok(debt<board.machine._chipDeadline,'Q after due');assert.ok(++qq<=150000&&++nextQ<=300,'independent Q cap');debt+=6;}}
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
  terminal(){assert.ok(!lease&&!active&&!closed);const state=call('settleTerminal');return {state,...ramResetEvidence(board.machine.mem),selfTestWitness:Array.from(board.machine.mem.subarray(0x592,0x594)),ramSha256:createHash('sha256').update(board.machine.mem).digest('hex')};},
  close(){assert.ok(!lease&&!active&&!closed);call('close');closed=true;}
 });
}
