/** Exact, reversible execution-scope inspector derivative of the paired children. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha=x=>createHash('sha256').update(x).digest('hex');
const HELD=Object.freeze({
 'native.mjs':'f9e78c9f8adb510fda66bec1dde666233477600dabea57e0018a16f9050d25db',
 'plain.mjs':'d1f4370a2a850c03302c0dc775a11b15f1ca1eb4098fe6cd16a198ffadab2e2b',
 'plain-child.mjs':'17d363ee941cd549e7e23eefd562301b455a00bc2d67e079388891b0ea2cd246'
});
export const profilePrelude=String.raw`
import {Session as BWProfileSession} from 'node:inspector/promises';
import {writeFileSync as bwWriteProfileFileSync} from 'node:fs';
import {resolve as bwResolveProfile} from 'node:path';
async function bwStartProfile(){
 const path=process.env.BW_CPU_PROFILE_PATH;
 if(typeof path!=='string'||!path.startsWith('/')||bwResolveProfile(path)!==path)
  throw Error('exact absolute diagnostic profile path');
 const session=new BWProfileSession();session.connect();
 try{
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval',{interval:1000});
  await session.post('Profiler.start');return {session,path};
 }catch(error){session.disconnect();throw error;}
}
async function bwStopProfile(state){
 try{
  const {profile}=await state.session.post('Profiler.stop');
  const data=JSON.stringify(profile);
  if(!data||Buffer.byteLength(data)>16*1024*1024)throw Error('bounded diagnostic CPU profile');
  bwWriteProfileFileSync(state.path,data+'\n',{flag:'wx'});
 }finally{state.session.disconnect();}
}
`;
function once(source,old,next,label){
 assert.equal(source.split(old).length,2,`unique ${label} seam`);
 return source.replace(old,next);
}
function deriveNative(original){
 let s=profilePrelude+original;
 s=once(s,' const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();',
  ' const bwProfiler=await bwStartProfile();let bwProfileError=null;\n const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();','native execution start');
 s=once(s,'   receipt.resumes=resumes;receipt.zero=zero;receipt.progressQ=q;}',
  '   receipt.resumes=resumes;receipt.zero=zero;receipt.progressQ=q;\n'
  +'   try{await bwStopProfile(bwProfiler);}catch(error){bwProfileError=error;}}\n'
  +'  if(bwProfileError)throw bwProfileError;','native execution end');
 return s;
}
function derivePlain(original){
 let s=profilePrelude+original;
 s=once(s,' const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();active=true;',
  ' const bwProfiler=await bwStartProfile();let bwProfileError=null;\n'
  +' const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();active=true;','plain execution start');
 s=once(s,'  scope:\'Ordinary JS machine.step loop, real device clocks, complete PIO collection and GC; setup, settlement, checks and serialization excluded\'};active=false;}',
  '  scope:\'Ordinary JS machine.step loop, real device clocks, complete PIO collection and GC; setup, settlement, checks and serialization excluded\'};active=false;\n'
  +'  try{await bwStopProfile(bwProfiler);}catch(error){bwProfileError=error;}}\n'
  +' if(bwProfileError)throw bwProfileError;','plain execution end');
 return s;
}
function deriveChild(original){return original;}
export function materialize(harnessRoot,outDir){
 const root=resolve(harnessRoot),out=resolve(outDir),held=resolve(root,'scripts/cold-direct-ram-paired');
 mkdirSync(out,{recursive:true});const report={schema:'bw.cold-direct-ram.sampling-derivation.v1',held:{},normalized:{},loaded:{}};
 for(const [name,expected] of Object.entries(HELD)){
  const original=readFileSync(join(held,name),'utf8');assert.equal(sha(original),expected,`held ${name}`);
  let normalized=name==='native.mjs'?deriveNative(original):name==='plain.mjs'?derivePlain(original):deriveChild(original);
  // This exact inverse removes all diagnostic additions; held semantics remain complete.
  let inverse=normalized;
  if(name!=='plain-child.mjs'){
   inverse=once(inverse,profilePrelude,'',`${name} profile prelude inverse`);
   if(name==='native.mjs'){
    inverse=once(inverse,' const bwProfiler=await bwStartProfile();let bwProfileError=null;\n const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();',
     ' const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();','native start inverse');
    inverse=once(inverse,'   receipt.resumes=resumes;receipt.zero=zero;receipt.progressQ=q;\n'
     +'   try{await bwStopProfile(bwProfiler);}catch(error){bwProfileError=error;}}\n'
     +'  if(bwProfileError)throw bwProfileError;',
     '   receipt.resumes=resumes;receipt.zero=zero;receipt.progressQ=q;}','native end inverse');
   }else{
    inverse=once(inverse,' const bwProfiler=await bwStartProfile();let bwProfileError=null;\n'
     +' const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();active=true;',
     ' const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();active=true;','plain start inverse');
    inverse=once(inverse,'  scope:\'Ordinary JS machine.step loop, real device clocks, complete PIO collection and GC; setup, settlement, checks and serialization excluded\'};active=false;\n'
     +'  try{await bwStopProfile(bwProfiler);}catch(error){bwProfileError=error;}}\n'
     +' if(bwProfileError)throw bwProfileError;',
     '  scope:\'Ordinary JS machine.step loop, real device clocks, complete PIO collection and GC; setup, settlement, checks and serialization excluded\'};active=false;}','plain end inverse');
   }
  }
  assert.equal(sha(inverse),expected,`inverse ${name}`);
  let loaded=normalized;
  if(name==='native.mjs'){
   const relative="'./direct-provider.mjs'";
   const absolute=`'${pathToFileURL(join(held,'direct-provider.mjs')).href}'`;
   loaded=once(loaded,relative,absolute,'native import URL');
   assert.equal(once(loaded,absolute,relative,'native import inverse'),normalized);
  }
  writeFileSync(join(out,name),loaded,{flag:'wx'});
  report.held[name]=expected;report.normalized[name]=sha(normalized);report.loaded[name]=sha(loaded);
 }
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 assert.equal(process.argv.length,4);
 process.stdout.write(JSON.stringify(materialize(process.argv[2],process.argv[3]))+'\n');
}
