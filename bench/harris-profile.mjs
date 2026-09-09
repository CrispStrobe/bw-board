/** Sample execution only, after warmup and board construction/reset. */
import {Session} from 'node:inspector';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import assert from 'node:assert/strict';
import {createOwnedWorkload,ownedWorkloads} from '../scripts/lib/harris-owned-workloads.mjs';
const name=process.argv[2]??'memory';
if(!ownedWorkloads.includes(name))throw new RangeError('owned workload');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=new URL('..',import.meta.url);
const reference=JSON.parse(readFileSync(new URL('../docs/HARRIS-OWNED-WORKLOADS-BENCH.json',import.meta.url)));
const sourcePaths=[...new Set(['bench/harris-profile.mjs',...Object.keys(reference.sourceHashes),
    'src/experimental/compiled-device-scheduler.js','src/experimental/harris-memory-decoder.js','src/experimental/wired-kernel/evaluator-contract.js'])];
const hashes=()=>Object.fromEntries(sourcePaths.map(p=>[p,hash(readFileSync(new URL(p,root)))]));
const sourceHashes=hashes();
const options={netBackend:'compiled',memoryScheduling:true,deviceScheduling:true,packedBus:true,busTraceEnabled:false};
const execute=f=>{let clocks=0;while(clocks<100000&&!f.finished(clocks)){f.cpu.stepClock();clocks++;}
    assert.ok(f.finished(clocks),'workload exhausted its budget');return clocks;};
const warm=createOwnedWorkload(name,options);warm.cpu.initialize();execute(warm);warm.verify();
const f=createOwnedWorkload(name,options);f.cpu.initialize();
const session=new Session();session.connect();const post=promisify(session.post).bind(session);
let profile,clocks,elapsedMS;
try {
    await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});
    await post('Profiler.start');const start=performance.now();clocks=execute(f);elapsedMS=performance.now()-start;
    ({profile}=await post('Profiler.stop'));
}finally{session.disconnect();}
f.verify();
const memory={};for(const region of f.board.memoryMap)for(const id of region.chips){const {bytes,...state}=f.board.inspectMemory(id);memory[id]={...state,sha256:hash(bytes)};}
const state={clocks,cpu:f.cpu.inspect(),devices:Object.fromEntries(Object.entries(f.devices).map(([n,d])=>[n,d.inspect()])),memory};
const stateSHA256=hash(JSON.stringify(state));assert.equal(stateSHA256,reference.samples.find(s=>s.name===name).stateSHA256);
assert.deepEqual(hashes(),sourceHashes,'profile sources changed');
const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map(),self=new Map(),inclusive=new Map();
for(const n of nodes.values())for(const child of n.children??[])parents.set(child,n.id);
let sampledUS=0;
for(let i=0;i<profile.samples.length;i++){
    const id=profile.samples[i],us=profile.timeDeltas[i];sampledUS+=us;self.set(id,(self.get(id)??0)+us);
    for(let cursor=id;cursor!==undefined;cursor=parents.get(cursor))inclusive.set(cursor,(inclusive.get(cursor)??0)+us);
}
const rank=map=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([id,us])=>{
    const c=nodes.get(id).callFrame;return {function:c.functionName||'(anonymous)',url:c.url.replace(root.href,''),line:c.lineNumber+1,microseconds:us,percent:us*100/sampledUS};
});
const report={accepted:true,benchmark:'owned-wired-sampled-profile',name,node:process.version,hostCPU:cpus()[0]?.model,
    revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes,options,
    warmupRuns:1,initializationIncluded:false,constructionIncluded:false,verificationIncluded:false,
    samplingIntervalUS:1000,clocks,retired:f.cpu.retired,elapsedMS,stateSHA256,samples:profile.samples.length,sampledUS,
    self:rank(self),inclusive:rank(inclusive),notes:['Sampled profile, not a controlled performance receipt.',
        'Inclusive entries overlap; do not add their percentages.','A sample points to a stack frame, not a proof of the cost of one source expression.',
        'Inspector start/stop overhead can appear at the edges. Shared-host load uncontrolled.']};
if(process.env.HARRIS_CPU_PROFILE)writeFileSync(process.env.HARRIS_CPU_PROFILE,JSON.stringify(profile),{flag:'wx'});
if(process.env.HARRIS_PROFILE_REPORT)writeFileSync(process.env.HARRIS_PROFILE_REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
