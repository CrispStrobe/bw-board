/** Worker-local private actual device owner. Not a caller board/brand API. */
import assert from 'node:assert/strict';
import {HotDirectBoardFacade} from '../bochs-cpu3-native-hot-direct/board.mjs';
import {assembleOwnedIn8Rom} from '../i80386-free-owned-in8.mjs';
import {createHash} from 'node:crypto';
const apply=Reflect.apply;
export function createOwnedIn8Provider({compactSink=null}={}){
 const {rom,sha256}=assembleOwnedIn8Rom();assert.equal(sha256,'25c242668fb1e0cbf940a35045a5e1173d992232766a4cbdb6a369ef3929a939');
 class In8Board extends HotDirectBoardFacade {
  inPort(port,width){return this._call('inPort',[port,width],()=>{
   assert.ok(Number.isInteger(port)&&width===1&&[0x40,0x21,0xa1].includes(port),'IN8 admission before device effect');
   const pic=port===0x21?this.machine._pic:port===0xa1?this.machine.chips.pic2:null;
   assert.ok(port===0x40||pic&&pic.pollPending===false,'PIC present and no poll before device effect');
   const epoch=this.mappingEpoch,a20=Number(this.machine._a20Enabled);
   const value=this.machine._in386(port,8);
   assert.ok(Number.isInteger(value)&&value>=0&&value<=255,'actual IN8 byte');
   assert.equal(this.mappingEpoch,epoch);assert.equal(Number(this.machine._a20Enabled),a20);
   return {value,mappingEpoch:epoch,boardA20:a20};
  });}
 }
 const board=new In8Board(rom,{compactSink});
 const methods=Object.fromEntries(['readPhysical','writePhysical','admitExecutePage','outPort','inPort','acknowledgeIrq','nativeTick','quantum','stageLine','beginRun','endRun','inspect','settleTerminal','close'].map(k=>[k,board[k]]));
 const call=(k,args=[])=>apply(methods[k],board,args);
 let lease=false,closed=false,initialized=false,entry=false,postPio=false,mappingPending=false,active=false,n=0,q=0;
 const state=()=>[board.nativeTicks,board.successfulQuanta,board.machine.cycles,board.machine._chipDebt,board.machine._chipDeadline,board.mappingEpoch,Number(board.machine._a20Enabled)];
 const checkState=()=>{const s=state();assert.ok(s.every(v=>Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff));assert.equal(s[2],4+6*s[1]);assert.ok(s[4]>=1&&s[4]<=6000&&s[3]<=s[4]+5);assert.ok(s[6]<=1);return s;};
 const callback=fn=>(...args)=>{assert.ok(lease&&!closed&&!active&&!entry&&!postPio&&!mappingPending,'owned callback lease');active=true;try{return fn(...args);}finally{active=false;}};
 const callbacks=Object.freeze({
  readPhysical:callback((...args)=>call('readPhysical',args)),writePhysical:callback((...args)=>call('writePhysical',args)),admitExecutePage:callback((...args)=>call('admitExecutePage',args)),
  packedScalar:callback((op,a,b,c)=>{assert.ok(op===3||op===4||op===5,'no scalar clocks');if(op===5){assert.ok(Number.isInteger(a)&&[0x40,0x21,0xa1].includes(a)&&b===1&&c===0,'IN8 scalar admission');const before=state();const result=call('inPort',[a,b]);const after=checkState();assert.deepEqual(after.slice(0,3),before.slice(0,3),'IN does not charge clocks');assert.equal(after[3],0);assert.deepEqual(after.slice(5),before.slice(5),'IN mapping unchanged');postPio=true;return Uint32Array.of(result.value,result.mappingEpoch,result.boardA20);}if(op===4){assert.equal(a|b|c,0);return Uint32Array.of(call('acknowledgeIrq'),board.mappingEpoch,Number(board.machine._a20Enabled));}assert.ok(!postPio,'one pending PIO');const before=state();const result=call('outPort',[a,b,c]);const after=checkState();assert.deepEqual(after.slice(0,3),before.slice(0,3),'PIO does not charge clocks');assert.equal(after[3],0,'actual PIO catches chips up');assert.ok(after[5]===before[5]||a===0x60&&after[5]===before[5]+1,'actual mapping transition');mappingPending=after[5]!==before[5];postPio=true;return Uint32Array.of(result.value,result.mappingEpoch,result.boardA20);}),
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
  terminal(){assert.ok(!lease&&!active&&!closed);const state=call('settleTerminal');return {state,in8Witness:Array.from(board.machine.mem.subarray(0x590,0x592)),ramSha256:createHash('sha256').update(board.machine.mem).digest('hex')};},
  close(){assert.ok(!lease&&!active&&!closed);call('close');closed=true;}
 });
}
