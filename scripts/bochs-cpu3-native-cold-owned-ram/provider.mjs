import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SourceColdBiosBoard} from '../bochs-cpu3-native-cold-bios/board-provider.mjs';
import {coldBoardProfile,fixedColdBios,coldOutAllowed,coldInAllowed} from '../bochs-cpu3-native-cold-bios/board-profile.mjs';
const apply=Reflect.apply;
export function createOwnedRamColdBiosProvider(owner){
 assert.equal(owner?.profile,'bw.cold-native.owned-ram-rom-exec.v1','exact owned RAM addon profile');
 const rom=fixedColdBios();
 const board=new SourceColdBiosBoard();
 owner.create(Uint8Array.from(board.machine.mem.subarray(0,0x180000)),Uint8Array.from(rom));
 const methods=Object.fromEntries(['readPhysical','writePhysical','admitExecutePage','outPort','inPort','acknowledgeIrq','nativeTick','quantum','stageLine','beginRun','endRun','inspect','settleTerminal','close'].map(k=>[k,board[k]]));
 const call=(k,args=[])=>apply(methods[k],board,args);
 let lease=false,closed=false,initialized=false,entry=false,postPio=false,mappingPending=false,active=false,n=0,q=0;
 let acknowledged=0;
 const reconcile=()=>{
  assert.equal(board.mappingEpoch,0,'fixed mapping epoch');assert.equal(Number(board.machine._a20Enabled),1,'fixed A20');
  const entries=owner.drain();assert.ok(Array.isArray(entries)&&entries.length<=32,'copied bounded native journal');
  const stagedGenerations=new Map(board.generations);
  for(let i=0;i<entries.length;i++){
   const e=entries[i];assert.ok(Number.isInteger(e.address)&&e.address>=0&&e.address<0x180000&&e.before instanceof Uint8Array&&e.after instanceof Uint8Array&&e.before.length===e.after.length&&e.before.length>0&&e.before.length<=16&&e.address+e.before.length<=0x180000,'native journal record');
   const page=e.address&~4095;assert.ok((e.address&4095)+e.before.length<=4096,'single native page');
   assert.equal(e.generation,(stagedGenerations.get(page)??0)+1,'contiguous board page generation');
   assert.ok(stagedGenerations.has(page)||stagedGenerations.size<64,'board generation capacity');stagedGenerations.set(page,e.generation);
   for(let j=0;j<e.before.length;j++){
    let want=board.machine.mem[e.address+j];
    for(let k=0;k<i;k++){const prior=entries[k];if(e.address+j>=prior.address&&e.address+j<prior.address+prior.after.length)want=prior.after[e.address+j-prior.address];}
    assert.equal(want,e.before[j],'board untouched/overlap before byte');
   }
  }
  const next=owner.acknowledge();assert.equal(next,acknowledged+entries.length,'contiguous native acknowledgement');
  for(const e of entries)board.machine.mem.set(e.after,e.address);
  board.generations=stagedGenerations;
  acknowledged=next;
 };
 const state=()=>[board.nativeTicks,board.successfulQuanta,board.machine.cycles,board.machine._chipDebt,board.machine._chipDeadline,board.mappingEpoch,Number(board.machine._a20Enabled)];
 const checkState=()=>{const s=state();assert.ok(s.every(v=>Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff));assert.equal(s[2],4+6*s[1]);assert.ok(s[4]>=1&&s[4]<=6000&&s[3]<=s[4]+5);assert.ok(s[6]<=1);return s;};
 const callback=fn=>(...args)=>{assert.ok(lease&&!closed&&!active&&!entry&&!postPio&&!mappingPending,'owned callback lease');active=true;try{return fn(...args);}finally{active=false;}};
 const romPage=raw=>{if(!Number.isInteger(raw)||raw<0||raw>0xffffffff||(raw&4095)!==0)return false;const decoded=raw>=0xffff0000?0xff0000+(raw-0xffff0000):raw;return decoded>=0xf0000&&decoded+4096<=0x100000||decoded>=0xff0000&&decoded+4096<=0x1000000;};
 const callbacks=Object.freeze({
  readPhysical:callback((raw,length)=>owner.read(raw,length)),
  writePhysical:callback((raw,bytes)=>{let result=owner.write(raw,bytes,board.nativeTicks,board.successfulQuanta);if(result.fence===1){reconcile();result=owner.write(raw,bytes,board.nativeTicks,board.successfulQuanta);}assert.equal(result.fence,0,'no executed RAM code write in ROM-only fixture');return result;}),
  admitExecutePage:callback((raw)=>{assert.ok(romPage(raw),'owned ROM execution page before effects');reconcile();const native=owner.page(raw),boardPage=call('admitExecutePage',[raw]);assert.deepEqual(native,boardPage.bytes,'native owned ROM page versus callback oracle');return boardPage;}),
  packedScalar:callback((op,a,b,c)=>{assert.ok(op===3||op===5,'cold profile forbids PIC ACK before effects');if(op===5)assert.ok(Number.isInteger(a)&&coldInAllowed(a,b)&&b===1&&c===0,'IN8 scalar admission');else assert.ok(!postPio&&coldOutAllowed(a,b,c),'OUT8 scalar admission');reconcile();if(op===5){const before=state();const result=call('inPort',[a,b]);const after=checkState();assert.deepEqual(after.slice(0,3),before.slice(0,3),'IN does not charge clocks');assert.equal(after[3],0);assert.deepEqual(after.slice(5),before.slice(5),'IN mapping unchanged');postPio=true;return Uint32Array.of(result.value,result.mappingEpoch,result.boardA20);}const before=state();const result=call('outPort',[a,b,c]);const after=checkState();assert.deepEqual(after.slice(0,3),before.slice(0,3),'PIO does not charge clocks');assert.equal(after[3],0,'actual PIO catches chips up');assert.equal(after[5],before[5],'cold mapping unchanged');mappingPending=after[5]!==before[5];postPio=true;return Uint32Array.of(result.value,result.mappingEpoch,result.boardA20);}),
  clockTransfer(words,reason){
   assert.ok(Number.isInteger(reason),'integer clock reason before effects');
   assert.ok(!closed&&!active,'clock reentry');assert.ok(words instanceof Uint32Array&&words.buffer instanceof ArrayBuffer&&words.byteOffset===0&&words.byteLength===words.buffer.byteLength&&words.length<=900,'owned tape');
   const query=words.length===0;
   if(query){assert.ok(reason===1&&!initialized&&!lease||reason===2&&lease&&entry||reason===6&&lease&&postPio,'clock query phase');}
   else assert.ok(lease&&!entry&&!postPio&&reason>=3&&reason<=11&&reason!==6,'clock commit phase');
   // Entire bounded tape is preflighted before any board effect.
   let nextMapping=mappingPending,nextN=n,nextQ=q,nn=board.nativeTicks,qq=board.successfulQuanta,debt=board.machine._chipDebt;
   for(const word of words){assert.ok(word===1||word===2||word===3,'word enum');if(word===1){assert.ok(!nextMapping,'N pending mapping');assert.ok(++nn<=coldBoardProfile.totalNativeTicks&&++nextN<=600,'independent N cap');}else{assert.ok(!nextMapping||word===2,'REP pending mapping');nextMapping=false;assert.ok(debt<board.machine._chipDeadline,'Q after due');assert.ok(++qq<=coldBoardProfile.totalQuanta&&++nextQ<=300,'independent Q cap');debt+=6;}}
   assert.ok(nextQ<=nextN&&qq<=nn,'completed tape Q<=N before effects');
   reconcile();
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
  stage(){assert.ok(initialized&&!lease&&!closed&&!active);reconcile();return call('stageLine');},
  begin(){assert.ok(initialized&&!lease&&!closed&&!active);call('beginRun');lease=true;entry=true;n=q=0;checkState();},
  end(){assert.ok(lease&&!active&&!entry&&!postPio&&!mappingPending);reconcile();call('endRun');lease=false;},
  checkpoint(){assert.ok(!lease&&!active&&!closed);reconcile();return call('inspect');},
  records(){assert.ok(!lease&&!active&&!closed);return board.portEvents.map(e=>({...e}));},
  settleCheckpoint(){assert.ok(!lease&&!active&&!closed);reconcile();const state=call('settleTerminal');return {state,ramSha256:createHash('sha256').update(board.machine.mem).digest('hex')};},
  close(){assert.ok(!lease&&!active&&!closed);reconcile();call('close');owner.close();closed=true;}
 });
}
