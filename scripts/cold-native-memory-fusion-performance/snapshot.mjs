/** Live candidate shape only; JSON projection is evidence work outside execution timing. */
import assert from 'node:assert/strict';
export const memoryFusionProfile='bw.cold-native.memory-clock-fusion.v1';
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
 validateTypedSlots(snapshot);validateBridgeAttempts(snapshot);const {bridgeClockEntryAttempts,bridgeMemoryEntryAttempts,...held}=snapshot;return {...held,...Object.fromEntries(Object.keys(slotLengths).map(k=>[k,Array.from(snapshot[k])]))};
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
export function validateAddonProfile(api){assert.equal(api.abiVersion,4);assert.equal(api.stateExportProfile,stateExportProfile,'distinct typed export admission');assert.equal(api.memoryFusionProfile,memoryFusionProfile,'distinct fusion admission');for(const k of ['create','resume','setIRQ','inspect','close'])assert.equal(typeof api[k],'function');}
export const serializeEvidence=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint32Array||v instanceof Uint8Array?Array.from(v):v);

export const clockReasons=Object.freeze(['unknown','INIT','ENTRY','MEMORY','PAGE','PRE_PIO','POST_PIO','ACK','FAULT','IRQ','HLT','RETURN']);
export const memoryReasons=Object.freeze(['ordinaryRead','ordinaryWrite','fusedOuter']);
export function validateBridgeAttempts(snapshot){
 for(const [field,keys] of [['bridgeClockEntryAttempts',clockReasons],['bridgeMemoryEntryAttempts',memoryReasons]]){
  assert.deepEqual(Object.keys(snapshot[field]).sort(),[...keys].sort(),'fixed bridge attempt map '+field);
  for(const v of Object.values(snapshot[field]))assert.ok(Number.isSafeInteger(v)&&v>=0,'bounded bridge attempt count');
 }
 return snapshot;
}
export function validateBridgeEvidence(reset,final,provider){
 validateBridgeAttempts(reset);validateBridgeAttempts(final);
 for(const field of ['bridgeClockEntryAttempts','bridgeMemoryEntryAttempts'])for(const key of Object.keys(reset[field]))assert.ok(final[field][key]>=reset[field][key],'monotonic attempt evidence');
 assert.deepEqual(reset.bridgeClockEntryAttempts,Object.fromEntries(clockReasons.map(k=>[k,k==='INIT'?1:0])));
 assert.deepEqual(reset.bridgeMemoryEntryAttempts,Object.fromEntries(memoryReasons.map(k=>[k,0])));
 assert.deepEqual(Object.keys(provider).sort(),['memoryOuterEntries','replyValidations','readEffects','writeEffects'].sort());
 for(const v of Object.values(provider))assert.ok(Number.isSafeInteger(v)&&v>=0);
 assert.equal(provider.memoryOuterEntries,final.bridgeMemoryEntryAttempts.fusedOuter);
 assert.equal(provider.replyValidations,provider.memoryOuterEntries);
 assert.equal(provider.readEffects+provider.writeEffects,provider.replyValidations);
 return {provider,reset:{clock:reset.bridgeClockEntryAttempts,memory:reset.bridgeMemoryEntryAttempts},final:{clock:final.bridgeClockEntryAttempts,memory:final.bridgeMemoryEntryAttempts},scope:'Actual outer entry attempts; clockTransfers.transfers is logical accepted transfers in this profile, not outer entries'};
}
