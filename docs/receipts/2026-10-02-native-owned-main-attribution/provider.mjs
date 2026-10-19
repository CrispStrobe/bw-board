/** Worker-local private actual device owner. Not a caller board/brand API. */
import assert from 'node:assert/strict';
import {now,add,measure}from './timing.mjs';
import {HotDirectBoardFacade} from '/tmp/bw-board-386-native-owned-main-20261002/scripts/bochs-cpu3-native-hot-direct/board.mjs';
import {assembleCombinedHotRom} from '/tmp/bw-board-386-native-owned-main-20261002/scripts/i80386-free-combined-hot.mjs';
import {createHash} from 'node:crypto';
const apply=Reflect.apply;
export function createOwnedProvider({compactSink=null}={}){
 const {rom,sha256}=assembleCombinedHotRom();assert.equal(sha256,'0c020faecb76160cfc748ca909d498a69ae47dd19a365891ccb20b3b5186b631');
 const board=new HotDirectBoardFacade(rom,{compactSink});
 const methods=Object.fromEntries(['readPhysical','writePhysical','admitExecutePage','outPort','acknowledgeIrq','nativeTick','quantum','stageLine','beginRun','endRun','inspect','settleTerminal','close'].map(k=>[k,board[k]]));
 const call=(k,args=[])=>measure('dispatch.'+k,()=>apply(methods[k],board,args));
 let lease=false,closed=false,initialized=false,entry=false,postPio=false,mappingPending=false,active=false,n=0,q=0;
 const state=()=>[board.nativeTicks,board.successfulQuanta,board.machine.cycles,board.machine._chipDebt,board.machine._chipDeadline,board.mappingEpoch,Number(board.machine._a20Enabled)];
 const checkState=()=>measure('checkState',()=>{const s=state();assert.ok(s.every(v=>Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff));assert.equal(s[2],4+6*s[1]);assert.ok(s[4]>=1&&s[4]<=6000&&s[3]<=s[4]+5);assert.ok(s[6]<=1);return s;});
 const callback=fn=>(...args)=>{assert.ok(lease&&!closed&&!active&&!entry&&!postPio&&!mappingPending,'owned callback lease');active=true;try{return fn(...args);}finally{active=false;}};
 const callbacks=Object.freeze({
  readPhysical:callback((...args)=>call('readPhysical',args)),writePhysical:callback((...args)=>call('writePhysical',args)),admitExecutePage:callback((...args)=>call('admitExecutePage',args)),
  packedScalar:callback((op,a,b,c)=>{assert.ok(op===3||op===4,'no scalar clocks');if(op===4){assert.equal(a|b|c,0);return Uint32Array.of(call('acknowledgeIrq'),board.mappingEpoch,Number(board.machine._a20Enabled));}assert.ok(!postPio,'one pending PIO');const before=state();const result=call('outPort',[a,b,c]);const after=checkState();assert.deepEqual(after.slice(0,3),before.slice(0,3),'PIO does not charge clocks');assert.equal(after[3],0,'actual PIO catches chips up');assert.ok(after[5]===before[5]||a===0x60&&after[5]===before[5]+1,'actual mapping transition');mappingPending=after[5]!==before[5];postPio=true;return Uint32Array.of(result.value,result.mappingEpoch,result.boardA20);}),
  clockTransfer(words,reason){const transferStart=now(),preflightStart=now();
   assert.ok(!closed&&!active,'clock reentry');assert.ok(words instanceof Uint32Array&&words.buffer instanceof ArrayBuffer&&words.byteOffset===0&&words.byteLength===words.buffer.byteLength&&words.length<=900,'owned tape');
   const query=words.length===0;
   if(query){assert.ok(reason===1&&!initialized&&!lease||reason===2&&lease&&entry||reason===6&&lease&&postPio,'clock query phase');}
   else assert.ok(lease&&!entry&&!postPio&&reason>=3&&reason<=11&&reason!==6,'clock commit phase');
   // Entire bounded tape is preflighted before any board effect.
   let nextMapping=mappingPending,nextN=n,nextQ=q,nn=board.nativeTicks,qq=board.successfulQuanta,debt=board.machine._chipDebt;
   for(const word of words){assert.ok(word===1||word===2||word===3,'word enum');if(word===1){assert.ok(!nextMapping,'N pending mapping');assert.ok(++nn<=160000&&++nextN<=600,'independent N cap');}else{assert.ok(!nextMapping||word===2,'REP pending mapping');nextMapping=false;assert.ok(debt<board.machine._chipDeadline,'Q after due');assert.ok(++qq<=150000&&++nextQ<=300,'independent Q cap');debt+=6;}}
   n=nextN;q=nextQ;mappingPending=nextMapping;add('clock.preflight',preflightStart);active=true;try{const replayStart=now();
    for(const word of words)call(word===1?'nativeTick':'quantum',word===1?[]:[word===3?1:0]);add('clock.replay',replayStart);
    const s=checkState();assert.equal(s[0],nn);assert.equal(s[1],qq);assert.equal(s[3],debt);
    if(reason===1){assert.deepEqual(s,[0,0,4,0,6000,0,1]);initialized=true;}
    if(reason===2){assert.ok(s[3]<s[4]);entry=false;}
    if(reason===6){assert.equal(s[3],0);postPio=false;}
    return measure('clock.reply',()=>Uint32Array.from(s));
   }finally{active=false;add('clock.inclusive',transferStart);}
  }
 });
 return Object.freeze({rom:Uint8Array.from(rom),callbacks,
  stage(){assert.ok(initialized&&!lease&&!closed&&!active);return call('stageLine');},
  begin(){assert.ok(initialized&&!lease&&!closed&&!active);call('beginRun');lease=true;entry=true;n=q=0;checkState();},
  end(){assert.ok(lease&&!active&&!entry&&!postPio&&!mappingPending);call('endRun');lease=false;},
  checkpoint(){assert.ok(!lease&&!active&&!closed);return call('inspect');},
  terminal(){assert.ok(!lease&&!active&&!closed);const state=call('settleTerminal');return {state,ramSha256:createHash('sha256').update(board.machine.mem).digest('hex')};},
  close(){assert.ok(!lease&&!active&&!closed);call('close');closed=true;}
 });
}
