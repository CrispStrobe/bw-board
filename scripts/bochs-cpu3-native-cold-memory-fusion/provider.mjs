/** Candidate callback only. Requires the separately derived native expected-ledger transport. */
import assert from 'node:assert/strict';
export const MEMORY_FUSION_PROFILE='bw.cold-native.memory-clock-fusion.v1';
const apply=Reflect.apply;
function copyLedger(value){
 assert.ok(value instanceof Uint32Array&&value.length===7&&value.byteOffset===0&&value.byteLength===28);
 assert.equal(Object.getPrototypeOf(value),Uint32Array.prototype);
 assert.equal(Object.getPrototypeOf(value.buffer),ArrayBuffer.prototype);
 assert.equal(value.buffer.byteLength,28);assert.ok(!value.buffer.resizable);
 return Uint32Array.from(value);
}
export function validateMemoryReply(reply,expected){
 const r=copyLedger(reply),e=copyLedger(expected);
 assert.ok(r[4]>=1&&r[4]<=6000&&r[3]<=r[4]+5&&r[6]<=1,'clock domain');
 assert.equal(r[2],4+6*r[1],'clock cycles');
 // Exact equality includes nonquery debt/deadline and native epoch/A20 expectation.
 for(let i=0;i<7;i++)assert.equal(r[i],e[i],'MEMORY ledger word '+i);
 return r;
}
export function memoryFusionCallbacks(provider){
 const held=provider.callbacks;
 const clock=held.clockTransfer,read=held.readPhysical,write=held.writePhysical;
 assert.equal(typeof clock,'function');assert.equal(typeof read,'function');assert.equal(typeof write,'function');
 let active=false;
 const counts={memoryOuterEntries:0,replyValidations:0,readEffects:0,writeEffects:0};
 const fusedMemory=(words,reason,raw,length,writeBytes,expected)=>{
  assert.ok(!active,'fusion reentry');
  assert.equal(reason,3,'MEMORY reason only');
  assert.ok(words instanceof Uint32Array&&words.length>0&&words.length<=900,'nonempty owned tape');
  assert.ok(Number.isInteger(raw)&&raw>=0&&raw<=0xffffffff);
  assert.ok(Number.isInteger(length)&&length>=1&&length<=16);
  assert.ok(writeBytes===null||writeBytes instanceof Uint8Array&&writeBytes.length===length);
  const wanted=copyLedger(expected); // Private copy captured before any callback.
  const operand=writeBytes===null?null:Uint8Array.from(writeBytes);
  active=true;counts.memoryOuterEntries++;
  try{
   // Held clockTransfer preflights the whole tape before its real clock effects.
   // The genuine reply is passed directly: no synthesized or normalized ledger.
   const reply=apply(clock,held,[words,reason]);
   const accepted=validateMemoryReply(reply,wanted);counts.replyValidations++;
   // Source-owned complete nonquery validation precedes the unchanged memory effect.
   if(writeBytes===null){counts.readEffects++;return {clock:accepted,memory:apply(read,held,[raw,length])};}
   counts.writeEffects++;return {clock:accepted,memory:apply(write,held,[raw,operand])};
  }finally{active=false;}
 };
 return Object.freeze({callbacks:Object.freeze({...held,fusedMemory}),entryCounts:()=>Object.freeze({...counts})});
}
