/** Repeated authenticated terminal payload; NOT guest chronology/native runtime. */
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateReceivedEnvelope} from './bochs-cpu3-native-owned-dto/ipc-response.mjs';
import {encodeOwned,decodeReceived} from './bochs-cpu3-native-owned-packed/codec.mjs';
import {nativeLedger,validateAdvance} from './bochs-cpu3-native-owned-dto/response.mjs';
const [path,expected,output,...extra]=process.argv.slice(2);assert.equal(extra.length,0);assert.match(expected,/^[a-f0-9]{64}$/);assert.ok(statSync(path).isFile()&&statSync(path).size<=16*1024*1024);
const raw=readFileSync(path);assert.equal(createHash('sha256').update(raw).digest('hex'),expected);const captured=JSON.parse(raw).final,snapshot=structuredClone(captured);
for(const k of ['nativeTicks','successfulQuanta'])snapshot[k]=BigInt(snapshot[k]);for(const group of ['callbacks','fallback','execution','clockTransfers'])for(const k of Object.keys(snapshot[group]))snapshot[group][k]=BigInt(snapshot[group][k]);snapshot.sliceBytes=Uint8Array.from(snapshot.sliceBytes);
assert.equal(snapshot.reason,4);assert.equal(snapshot.chargedNativeTicks,0);assert.equal(snapshot.chargedQuanta,0);
const serialize=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?[...v]:v);
async function trial(protocol,round){
 const {port1,port2}=new MessageChannel();let ownerSequence=0,id=0,pending=null,active=false,last,previous=nativeLedger(snapshot);
 port2.on('message',m=>{try{assert.ok(!active);assert.equal(m.id,++ownerSequence);assert.equal(m.command,'resume');assert.equal(typeof m.payload,'string');active=true;const args=JSON.parse(m.payload);assert.ok(args.n>0&&args.n<=600&&args.q>0&&args.q<=300);assert.equal(typeof args.deadline,'string');port2.postMessage({id:m.id,payload:protocol==='json'?serialize(snapshot):protocol==='packed'?encodeOwned(snapshot):snapshot});active=false;}catch(e){pending?.reject(e);}});
 port1.on('message',m=>{const p=pending;pending=null;try{assert.equal(m.id,p.id);if(protocol==='json'){assert.equal(typeof m.payload,'string');last=JSON.parse(m.payload);}else{last=protocol==='packed'?(assert.deepEqual(Object.keys(m),['id','payload']),decodeReceived(m.payload)):validateReceivedEnvelope(m,p.id,'resume');previous=validateAdvance(last,previous,p.requested);}p.resolve();}catch(e){p.reject(e);}});
 const cpuStart=process.cpuUsage(),start=process.hrtime.bigint();
 try{for(let i=0;i<200;i++){const payload=JSON.stringify({n:600,q:300,deadline:'18446744073709551615'});assert.equal(typeof payload,'string');assert.ok(Buffer.byteLength(payload)<=16384);await new Promise((resolve,reject)=>{const requestId=++id,requested=protocol!=='json'?JSON.parse(payload):null;pending={id:requestId,requested,resolve,reject};port1.postMessage({id:requestId,command:'resume',payload});});}
  const ns=Number(process.hrtime.bigint()-start),cpu=process.cpuUsage(cpuStart);assert.equal(ownerSequence,200);assert.deepEqual(JSON.parse(serialize(last)),captured);return {protocol,round,operations:200,ns,cpuMicroseconds:{user:cpu.user,system:cpu.system,total:cpu.user+cpu.system}};
 }finally{port1.close();port2.close();}
}
const records=[];for(let round=0;round<3;round++)for(const protocol of [['json','dto','packed'],['packed','json','dto'],['dto','packed','json']][round])records.push(await trial(protocol,round));
const report={status:'SOURCE_ONLY_MESSAGECHANNEL_REPLY_PIPELINE_NOT_NATIVE_BENCHMARK',input:{path,sha256:expected},records,scope:'200 repeated authentic zero-work terminal payloads per round; request JSON creation/parse, actual MessageChannel roundtrip, sender JSON-or-DTO-or-packed encode response, receive packed decode plus envelope/value schema and DTO requested-cap/delta/primitive ledger included',limits:'Same-process MessageChannel, not actual private Worker scheduling, native CPU, board progression or full factory infrastructure. Repeated terminal payload is not guest chronology. Every round retained; no speed/admission claim.'};writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(records));
