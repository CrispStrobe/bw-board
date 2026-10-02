import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {f0TimingResult} from '/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002/scripts/lib/f0-timing-receipt.mjs';
import {f0GpioTimingResult,assertSameGpioGuest} from '/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002/scripts/lib/f0-gpio-profile-receipt.mjs';
import {summarizeCpuProfile} from '/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002/scripts/lib/wasm-motion-profile.mjs';
const root='/mnt/volume1/code/lego/.fastpath-census-evidence.kYeuzx/gpio-isolated';
const index=Number(process.argv[2]);assert.ok([1,2,3].includes(index));
const id=[null,37048440399,37048740665,37049199265][index];
const head=index===3?'3a6562ff588b65293bcae5afeafea0d59b63bc14':'d06d8c183d3c11d3ab65eb20a6b9c8b61c985ea2';
const gh=args=>execFileSync('gh',args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
function save(name,value){
 const file=root+'/'+name,text=JSON.stringify(value,null,2)+'\n';
 if(existsSync(file)){assert.equal(readFileSync(file,'utf8'),text);return;}
 execFileSync('apply_patch',[],{input:`*** Begin Patch\n*** Add File: ${file}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`});
}
const run=JSON.parse(gh(['run','view',String(id),'-R','CrispStrobe/bw-board','--json','status,conclusion,headSha,url,jobs,createdAt,updatedAt']));
assert.equal(run.status,'completed');assert.equal(run.conclusion,index===2?'failure':'success');assert.equal(run.headSha,head);
const api=JSON.parse(gh(['api',`repos/CrispStrobe/bw-board/actions/runs/${id}/artifacts`]));
assert.equal(api.artifacts.length,1);const artifact=api.artifacts[0];
assert.equal(artifact.name,'active-f0-main-profile-diagnostic');assert.equal(artifact.expired,false);
assert.equal(artifact.workflow_run.head_sha,head);assert.equal(artifact.workflow_run.id,id);
assert.ok(artifact.size_in_bytes>0&&artifact.size_in_bytes<4*1024*1024);
save(`run-${index}-api.json`,run);save(`run-${index}-artifact-api.json`,api);
if(!existsSync(root+`/run-${index}/gpio-only/receipt.json`))gh(['run','download',String(id),'-R','CrispStrobe/bw-board','--name',artifact.name,'--dir',root+`/run-${index}`]);
const data=path=>readFileSync(root+`/run-${index}/`+path),json=path=>JSON.parse(data(path));
const both=json('f0/receipt.json'),gpio=json('gpio-only/receipt.json'),info=json('build-info.json');
for(const r of [both,gpio]){
 assert.equal(r.node,'v22.23.3');assert.deepEqual(r.buildInfo,info);
 if(index!==2||r===both)assert.ok(r.completedAt);
 assert.equal(r.diagnosticOnly,true);
 assert.equal(r.ordinary.signal,null);assert.equal(r.ordinary.error,undefined);assert.deepEqual(r.ordinary.flags,[]);
}
assert.equal(info.ref,'43b2d62f5a0fa24ae0b38a645069f5aaa78af685');
assert.equal(info.targets.nodejs['labwired_wasm_bg.wasm'].sha256,'7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d');
assert.equal(info.targets.nodejs['labwired_wasm.js'].sha256,'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73');
const ordinary=f0TimingResult(data('f0/ordinary-stdout.txt').toString(),both.ordinary.exitCode);
assert.deepEqual(ordinary.workloads,both.ordinary.workloads);
for(const label of ['ordinary','sampled']){
 const parsed=f0GpioTimingResult(data(`gpio-only/${label}-stdout.txt`).toString(),gpio[label].exitCode);
 assert.deepEqual(parsed.workloads,gpio[label].workloads);assert.equal(gpio[label].signal,null);assert.equal(gpio[label].error,undefined);
}
assertSameGpioGuest(ordinary,gpio.ordinary);assertSameGpioGuest(gpio.ordinary,gpio.sampled);
assert.deepEqual(gpio.sampled.flags.filter(f=>!f.startsWith('--cpu-prof-dir=')),['--cpu-prof','--cpu-prof-name=f0-gpio.cpuprofile']);
const raw=data('gpio-only/f0-gpio.cpuprofile');
const profileHash=createHash('sha256').update(raw).digest('hex');
if(index!==2)assert.equal(profileHash,gpio.sampled.profileSha256);
if(index===2){
 assert.equal(gpio.completedAt,undefined);assert.equal(gpio.sampled.profile,undefined);
 assert.throws(()=>summarizeCpuProfile(JSON.parse(raw)),/Invalid CPU profile sample/);
 const rawProfile=JSON.parse(raw),bad=rawProfile.timeDeltas.flatMap((delta,i)=>delta<0?[{index:i,delta}]:[]);
 assert.deepEqual(bad,[{index:7742,delta:-2}]);
 save('run-2-invalid-profile.json',{run:id,head,diagnosticOnly:true,workflowConclusion:'failure',
  attributionAvailable:false,reason:'Invalid CPU profile sample',negativeDeltas:bad,profileSha256:profileHash,
  ordinaryBoth:ordinary.workloads,ordinaryGpio:gpio.ordinary.workloads,sampled:gpio.sampled.workloads});
 console.log('Failed repeat retained; all raw ordinary/sampled timing proofs valid, no attribution claimed.');
 process.exit(0);
}
const summary=summarizeCpuProfile(JSON.parse(raw));
assert.deepEqual(summary,{...gpio.sampled.profile,topWasmFrames:gpio.sampled.profile.topWasmFrames.map(({wasmName,...f})=>f)});
const brief=p=>Object.fromEntries(Object.entries(p.workloads).map(([k,v])=>[k,{medianRtx:v.medianRtx,minimumRtx:v.minimumRtx,allWindowsMeet1x:v.allWindowsMeet1x}]));
save(`run-${index}-verified.json`,{run:id,head,source:info.ref,node:gpio.node,diagnosticOnly:true,ordinaryBoth:brief(ordinary),ordinaryGpio:brief(gpio.ordinary),profileSha256:gpio.sampled.profileSha256,profileSamples:summary.samples,topWasmFrames:summary.topWasmFrames});
console.log(JSON.stringify({run:id,ordinaryBoth:brief(ordinary),ordinaryGpio:brief(gpio.ordinary),top:summary.topWasmFrames.slice(0,9).map(f=>({name:f.functionName,share:f.processSelfShare}))}));
