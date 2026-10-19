/** Bounded saved-data codec diagnostic; NO addon load, guest or IPC benchmark. */
import assert from 'node:assert/strict';
import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateNative,validateCheckpoint} from './bochs-cpu3-native-owned-dto/response.mjs';
const [path,expected,output,...extra]=process.argv.slice(2);assert.equal(extra.length,0);assert.equal(typeof path,'string');assert.match(expected,/^[a-f0-9]{64}$/);assert.equal(typeof output,'string');
assert.ok(statSync(path).isFile()&&statSync(path).size<=16*1024*1024);const raw=readFileSync(path);assert.equal(createHash('sha256').update(raw).digest('hex'),expected);const capture=JSON.parse(raw);
const serialize=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?[...v]:v);
function nativeDto(x){const d=structuredClone(x);for(const key of ['nativeTicks','successfulQuanta'])d[key]=BigInt(d[key]);for(const group of ['clockTransfers','callbacks','fallback','execution'])for(const key of Object.keys(d[group]))d[group][key]=BigInt(d[group][key]);if(d.sliceBytes)d.sliceBytes=Uint8Array.from(d.sliceBytes);assert.equal(serialize(d),JSON.stringify(x));return d;}
const samples={native:[capture.reset,...capture.checkpoints.map(x=>x.native),capture.final].map(nativeDto),board:[...capture.checkpoints.map(x=>x.board),capture.settled]};
const records=[];for(const [kind,values] of Object.entries(samples)){
 const validate=value=>kind==='native'?validateNative(value,Object.hasOwn(value,'sliceBytes')):validateCheckpoint(value);
 for(const value of values){validate(value);assert.equal(serialize(structuredClone(value)),serialize(value));assert.equal(JSON.stringify(JSON.parse(serialize(value))),serialize(value));}
 for(let round=0;round<3;round++)for(const codec of round%2?['clone-validated','clone','json']:['json','clone','clone-validated']){
  const startCPU=process.cpuUsage(),start=process.hrtime.bigint();let bytes=0;
  for(let i=0;i<200;i++)for(const value of values){if(codec==='json'){const text=serialize(value);bytes+=text.length;JSON.parse(text);}else{const dto=structuredClone(value);if(codec==='clone-validated')validate(dto);}}
  const ns=Number(process.hrtime.bigint()-start),cpu=process.cpuUsage(startCPU);records.push({kind,round,codec,operations:200*values.length,ns,cpuMicroseconds:{user:cpu.user,system:cpu.system,total:cpu.user+cpu.system},jsonCharacters:codec==='json'?bytes:null});
 }
}
const report={status:'SAVED_DATA_CODEC_COMPARISON_ONLY',input:{path,sha256:expected},reconstruction:'Only NAPI-produced BigInt counters and ordinary160-byte slice snapshot reconstructed from authenticated saved JSON; not new native execution',records,limitations:'structuredClone is local payload codec only, excludes actual Worker IPC and queue/scheduler costs; clone-validated includes current strict response admission, source data type restoration excluded from timed loops (native produces those types directly). No native speed or admission claim.'};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(records));
