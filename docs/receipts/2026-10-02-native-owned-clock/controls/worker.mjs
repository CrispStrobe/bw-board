/** EXTERNAL UNSUPPORTED NEGATIVE DIAGNOSTICS, never production admission. */
import assert from 'node:assert/strict';
import {workerData,parentPort} from 'node:worker_threads';
import {openSync,closeSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createOwnedProvider} from '/tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-owned-clock/provider.mjs';
import {loadOwnedNative} from '/tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-owned-clock/loader.mjs';
import {writeJournalRecord} from '/tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-hot-direct/journal.mjs';
const {input,control,eventsPath}=workerData,fd=openSync(eventsPath,'wx');
let ordinal=0,mutated=false,transfers=0,query=0,logical=0;
const record=(name,extra={})=>writeJournalRecord(fd,JSON.stringify({...extra,ordinal:++ordinal,name})+'\n');
const provider=createOwnedProvider({compactSink:e=>{logical++;}}),native=loadOwnedNative(input.addon,input.sha256),original=provider.callbacks;
const callbacks={...original};
for(const name of ['readPhysical','writePhysical','admitExecutePage','packedScalar'])callbacks[name]=(...args)=>{if(mutated&&(control.startsWith('tuple-')||control.startsWith('field-')))record('observer-after-mutation',{operation:name});return original[name](...args);};
callbacks.clockTransfer=(words,reason)=>{
 if(words.length===0){query++;record('query',{reason});if(control==='phase-entry-as-postpio'&&reason===2){record('phase-denial-attempt',{reason});return original.clockTransfer(words,6);}return original.clockTransfer(words,reason);}
 transfers++;record('commit-enter',{reason,count:words.length,logicalBefore:logical});
 if(control==='reentry'&&!mutated){for(const [op,args] of [['resume',[1,1,0xffffffffffffffffn]],['setIRQ',[false]],['inspect',[]],['close',[]]]){assert.throws(()=>native[op](...args));record('reentry-denied',{op});}mutated=true;}
 const reply=original.clockTransfer(words,reason);record('commit-applied',{reply:[...reply],logicalAfter:logical});
 if(control.startsWith('field-')&&!mutated){const i=['n','q','cycles','debt','deadline','epoch','a20'].indexOf(control.slice(6));assert.ok(i>=0);reply[i]=i===6?1-reply[i]:i===4?(reply[i]>1?reply[i]-1:reply[i]+1):i===3?(reply[i]>0?reply[i]-1:1):reply[i]+1;mutated=true;record('malformed-reply',{control,scope:'actual logical effects precede native denial'});return reply;}
 if(control.startsWith('tuple-')&&!mutated){mutated=true;record('malformed-reply',{control,scope:'actual logical effects precede native denial'});
  if(control==='tuple-number')return 0;if(control==='tuple-array')return [...reply];if(control==='tuple-float')return Float64Array.from(reply);if(control==='tuple-short')return reply.slice(0,6);if(control==='tuple-long')return Uint32Array.of(...reply,0);
  if(control==='tuple-offset'){const a=new Uint32Array(new ArrayBuffer(32),4,7);a.set(reply);return a;}if(control==='tuple-backing'){const a=new Uint32Array(new ArrayBuffer(32),0,7);a.set(reply);return a;}if(control==='tuple-shared'){const a=new Uint32Array(new SharedArrayBuffer(28));a.set(reply);return a;}
  if(control==='tuple-detached'){structuredClone(reply.buffer,{transfer:[reply.buffer]});return reply;}if(control==='tuple-throw')throw Error('diagnostic callback after actual effects');assert.fail('unknown tuple');
 }
 return reply;
};
try{
 const reset=native.create(input.configuration,provider.rom,Object.freeze(callbacks),false);record('initialized',{n:String(reset.nativeTicks),q:String(reset.successfulQuanta)});
 if(control==='thread-owner'||control==='second-worker'){parentPort.postMessage({ownerReady:true});parentPort.once('message',m=>{assert.equal(m,'finish');native.close();provider.close();record('owner-closed');closeSync(fd);parentPort.postMessage({done:true});});}
 else {
  if(control==='same-worker-reinit'){native.close();provider.close();const before={query,logical,transfers};assert.throws(()=>native.create(input.configuration,provider.rom,Object.freeze(callbacks),false));assert.deepEqual({query,logical,transfers},before);record('reinit-before-callback-denied');}
  else if(control.startsWith('invalid-')){const map={'invalid-n0':[0,1,1n],'invalid-n601':[601,1,1n],'invalid-q0':[1,0,1n],'invalid-q301':[1,301,1n],'invalid-deadline':[1,1,-1n]};const before={query,logical,transfers};assert.throws(()=>native.resume(...map[control]));assert.deepEqual({query,logical,transfers},before);record('invalid-before-query-denied',{before});native.close();provider.close();}
  else {const staged=provider.stage();if(staged.changed)native.setIRQ(staged.asserted);provider.begin();const budgets=control==='positive-n1'?[1,300,0xffffffffffffffffn]:control==='positive-n2'?[2,300,0xffffffffffffffffn]:control==='positive-q1'?[600,1,0xffffffffffffffffn]:control==='positive-q2'?[600,2,0xffffffffffffffffn]:control==='positive-deadline0'?[600,300,0n]:[600,300,0xffffffffffffffffn];let result;try{result=native.resume(...budgets);}finally{provider.end();}const actual=provider.checkpoint();assert.equal(BigInt(actual.nativeTicks),result.nativeTicks);assert.equal(BigInt(actual.successfulQuanta),result.successfulQuanta);assert.equal(actual.javascriptCpuCycles,0);assert.equal(result.clockTransfers.words,result.nativeTicks+result.successfulQuanta);assert.equal(result.clockTransfers.transfers,result.clockTransfers.commits+BigInt(query));record('returned',{n:String(result.nativeTicks),q:String(result.successfulQuanta),reason:result.reason,chargedN:result.chargedNativeTicks,chargedQ:result.chargedQuanta,clockTransfers:Object.fromEntries(Object.entries(result.clockTransfers).map(([k,v])=>[k,String(v)]))});if(control==='positive-deadline0'){assert.equal(result.chargedNativeTicks,0);assert.equal(result.chargedQuanta,0);assert.equal(logical,0);}if(control==='positive-n1'||control==='positive-n2'){assert.ok(result.chargedNativeTicks<=budgets[0]);assert.equal(result.chargedNativeTicks,control==='positive-n1'?1:2);}if(control==='positive-q1'||control==='positive-q2')assert.equal(result.chargedQuanta,control==='positive-q1'?1:2);native.close();provider.close();}
  record('done');closeSync(fd);parentPort.postMessage({done:true});
 }
}catch(e){record('unexpected-js-error',{message:e.message});closeSync(fd);throw e;}
