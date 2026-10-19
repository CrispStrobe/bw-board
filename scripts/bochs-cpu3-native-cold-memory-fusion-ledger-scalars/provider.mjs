/** Candidate callback only. Requires the separately derived native expected-ledger transport. */
import assert from 'node:assert/strict';
export const MEMORY_FUSION_PROFILE='bw.cold-native.memory-clock-fusion.v1';
export const LEDGER_SCALAR_PROFILE='bw.cold-native.memory-clock-fusion.ledger-scalars.v1';
const apply=Reflect.apply;
function ledgerShape(value){
 assert.ok(value instanceof Uint32Array&&value.length===7&&value.byteOffset===0&&value.byteLength===28);
 assert.equal(Object.getPrototypeOf(value),Uint32Array.prototype);
 assert.equal(Object.getPrototypeOf(value.buffer),ArrayBuffer.prototype);
 assert.equal(value.buffer.byteLength,28);assert.ok(!value.buffer.resizable);
}
function copyLedger(value){ledgerShape(value);return Uint32Array.from(value);}
function validateCapturedReply(reply,e0,e1,e2,e3,e4,e5,e6){
 const r=copyLedger(reply);
 assert.ok(r[4]>=1&&r[4]<=6000&&r[3]<=r[4]+5&&r[6]<=1,'clock domain');
 assert.equal(r[2],4+6*r[1],'clock cycles');
 assert.equal(r[0],e0,'MEMORY ledger word 0');assert.equal(r[1],e1,'MEMORY ledger word 1');
 assert.equal(r[2],e2,'MEMORY ledger word 2');assert.equal(r[3],e3,'MEMORY ledger word 3');
 assert.equal(r[4],e4,'MEMORY ledger word 4');assert.equal(r[5],e5,'MEMORY ledger word 5');
 assert.equal(r[6],e6,'MEMORY ledger word 6');
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
  ledgerShape(expected);
  const e0=expected[0],e1=expected[1],e2=expected[2],e3=expected[3],e4=expected[4],e5=expected[5],e6=expected[6]; // Private scalar capture before any callback.
  const operand=writeBytes===null?null:Uint8Array.from(writeBytes);
  active=true;counts.memoryOuterEntries++;
  try{
   // Held clockTransfer preflights the whole tape before its real clock effects.
   // The genuine reply is passed directly: no synthesized or normalized ledger.
   const reply=apply(clock,held,[words,reason]);
   const accepted=validateCapturedReply(reply,e0,e1,e2,e3,e4,e5,e6);counts.replyValidations++;
   // Source-owned complete nonquery validation precedes the unchanged memory effect.
   if(writeBytes===null){counts.readEffects++;return {clock:accepted,memory:apply(read,held,[raw,length])};}
   counts.writeEffects++;return {clock:accepted,memory:apply(write,held,[raw,operand])};
  }finally{active=false;}
 };
 return Object.freeze({callbacks:Object.freeze({...held,fusedMemory}),entryCounts:()=>Object.freeze({...counts})});
}
