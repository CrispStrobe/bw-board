/** Live candidate shape only; JSON projection is evidence work outside execution timing. */
import assert from 'node:assert/strict';
export const stateExportProfile='bw.cold-native.copied-u32-state.v1';
export const slotLengths=Object.freeze({state:20,extra:20,segments:90,system:30,debug:6});
export function validateTypedSlots(snapshot){
 const buffers=new Set();
 for(const [name,length] of Object.entries(slotLengths)){
  const v=snapshot[name];assert.ok(v instanceof Uint32Array&&Object.getPrototypeOf(v)===Uint32Array.prototype,'exact live Uint32Array '+name);
  assert.ok(v.buffer instanceof ArrayBuffer&&Object.getPrototypeOf(v.buffer)===ArrayBuffer.prototype,'ordinary owned buffer '+name);
  assert.equal(v.length,length);assert.equal(v.byteOffset,0);assert.equal(v.byteLength,length*4);assert.equal(v.buffer.byteLength,length*4,'non-detached dedicated buffer');assert.equal(v.buffer.resizable,false,'fixed non-resizable snapshot storage');assert.ok(!buffers.has(v.buffer),'separate slot buffers');buffers.add(v.buffer);
 }
 return snapshot;
}
export function plainSnapshot(snapshot){
 validateTypedSlots(snapshot);return {...snapshot,...Object.fromEntries(Object.keys(slotLengths).map(k=>[k,Array.from(snapshot[k])]))};
}
const retainedSnapshots=new WeakMap();
export function retainSnapshot(snapshot){
 validateTypedSlots(snapshot);const token=Object.freeze({kind:'owned-typed-snapshot'});retainedSnapshots.set(token,{snapshot,words:Object.fromEntries(Object.keys(slotLengths).map(k=>[k,Array.from(snapshot[k])]))});return token;
}
export function validateRetainedSnapshot(token,current){
 assert.ok(retainedSnapshots.has(token),'owned retained snapshot token');const retained=retainedSnapshots.get(token);validateTypedSlots(retained.snapshot);validateTypedSlots(current);
 const oldBuffers=new Set(Object.keys(slotLengths).map(k=>retained.snapshot[k].buffer));
 for(const name of Object.keys(slotLengths)){assert.deepEqual(Array.from(retained.snapshot[name]),retained.words[name],'old snapshot unchanged '+name);assert.ok(!oldBuffers.has(current[name].buffer),'new snapshot independent of all old slots');}
}
export function validateAddonProfile(api){assert.equal(api.abiVersion,4);assert.equal(api.stateExportProfile,stateExportProfile,'distinct typed export admission');for(const k of ['create','resume','setIRQ','inspect','close'])assert.equal(typeof api[k],'function');}
export const serializeEvidence=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint32Array||v instanceof Uint8Array?Array.from(v):v);
