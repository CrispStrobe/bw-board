/** Future native execution entry: only local callbacks, only inside bounded child. */
import assert from 'node:assert/strict';
import {now,add,measure,snapshot as attributionSnapshot,reset as attributionReset} from './timing.mjs';
import {parentPort,workerData,isMainThread} from 'node:worker_threads';
import {readFileSync,openSync,writeSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Session} from 'node:inspector';
import {writeFileSync} from 'node:fs';
import {writeJournalRecord} from 'file:///tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-hot-direct/journal.mjs';
import {createOwnedProvider} from './provider.mjs';
import {loadOwnedNative} from 'file:///tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-owned-clock/loader.mjs';
import {sha256} from 'file:///tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-owned-clock/derive.mjs';
assert.ok(!isMainThread);assert.equal(sha256(readFileSync(new URL(import.meta.url))),workerData.workerSha256);
const input=JSON.parse(workerData.serialized);assert.equal(typeof input.configuration,'string');assert.equal(sha256(readFileSync(input.configuration)),input.configurationSha256,'frozen configuration');
const serialize=v=>JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?[...v]:v);
let rows=0,bytes=0;const digest=createHash('sha256'),fd=openSync(input.journal,'wx');
const provider=createOwnedProvider({compactSink:input.hostJournal?e=>{const line=serialize([e.ordinal,e.operation,e.args,e.result,e.nativeTicks,e.successfulQuanta,e.boardCycles,e.debt,e.mappingEpoch])+'\n';assert.ok(bytes+Buffer.byteLength(line)<=32*1024*1024);writeJournalRecord(fd,line);digest.update(line);bytes+=Buffer.byteLength(line);rows++;}:null});
const native=loadOwnedNative(input.addon,input.sha256);
const reset=native.create(input.configuration,provider.rom,provider.callbacks,input.nativeTrace);
attributionReset();
const attributionSession=process.env.BW_OWNED_ATTRIBUTION_PROFILE==='1'?new Session():null;
const attributionPost=method=>new Promise((resolve,reject)=>attributionSession.post(method,(error,result)=>error?reject(error):resolve(result)));
// Inspector setup/start are startup, before parent execution CPU window.
if(attributionSession){attributionSession.connect();await attributionPost('Profiler.enable');await attributionPost('Profiler.start');}
let sequence=0,closed=false,active=false,terminal=false;
parentPort.postMessage({ready:true,snapshot:serialize(reset)});
parentPort.on('message',async m=>{
 const attributionMessageStart=now();
 try{
  assert.ok(!closed&&!active);assert.equal(m.id,++sequence);assert.equal(typeof m.payload,'string');active=true;let result;
  if(m.command==='resume'){
   assert.ok(!terminal,'resume after terminal');const {n,q,deadline}=measure("worker.resume.parse",()=>JSON.parse(m.payload));assert.ok(Number.isSafeInteger(n)&&n>0&&n<=600&&Number.isSafeInteger(q)&&q>0&&q<=300);assert.ok(typeof deadline==='string'&&/^[0-9]{1,20}$/.test(deadline));const d=BigInt(deadline);assert.ok(d<=0xffffffffffffffffn);
   const attributionStageStart=now();const staged=provider.stage();if(staged.changed)native.setIRQ(staged.asserted);provider.begin();add("worker.resume.stage-begin",attributionStageStart);
   try{result=measure("worker.native-resume.inclusive",()=>native.resume(n,q,d));}finally{measure("worker.resume.end",()=>provider.end());}
   terminal=result.reason===4&&result.chargedNativeTicks===0&&result.chargedQuanta===0;
  }else if(m.command==='checkpoint'){assert.equal(m.payload,'');result=measure('worker.checkpoint.board',()=>provider.checkpoint());}
  else if(m.command==='attribution-stop'){assert.equal(m.payload,'');assert.ok(terminal);if(attributionSession){const profile=(await attributionPost('Profiler.stop')).profile;attributionSession.disconnect();writeFileSync(input.journal+'.worker.cpuprofile',JSON.stringify(profile),{flag:'wx'});}result={scope:'inclusive wall buckets overlap; profile startup/stop outside parent executionCPU, before settlement',worker:attributionSnapshot(),profile:!!attributionSession};}
  else if(m.command==='inspect'){assert.equal(m.payload,'');result=native.inspect();}
  else if(m.command==='close'){
   assert.equal(m.payload,'');assert.ok(terminal);const final=native.inspect();assert.equal(final.nativeTicks,100684n);assert.equal(final.successfulQuanta,100682n);result=provider.terminal();assert.equal(result.state.marker,'RPGH001');native.close();provider.close();closeSync(fd);closed=true;result.journal={rows,bytes,sha256:digest.digest('hex')};
  }else assert.fail('unknown owned command');
  active=false;const attributionPayload=measure("worker."+m.command+".serialize",()=>serialize(result));add("worker."+m.command+".processing-to-ready",attributionMessageStart);measure("worker."+m.command+".post-enqueue",()=>parentPort.postMessage({id:m.id,payload:attributionPayload}));
 }catch(e){closed=true;active=false;try{closeSync(fd);}catch{}parentPort.postMessage({id:m.id,error:e.message});parentPort.close();}
});
