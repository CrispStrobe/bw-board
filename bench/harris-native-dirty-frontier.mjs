/** Work-count and timing probe for the bounded native driver frontier. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import assert from 'node:assert/strict';
import {bitDrives} from '../src/experimental/digital-circuit.js';
import {HARRIS_80C286_STATUS} from '../src/experimental/harris-80c286-contract.js';
import {createPhaseCircuitOracle} from '../scripts/lib/harris-native-phase-circuit-oracle.mjs';

const rounds=Number(process.argv[2]??5),count=Number(process.argv[3]??1024);
if(!Number.isInteger(rounds)||rounds<2||rounds>10||count!==1024)throw new RangeError('rounds 2..10 and count 1024 required');
for(const name of ['HARRIS_NET_WASM','HARRIS_COMPARE_WASM','HARRIS_COMPARE_REVISION','HARRIS_FRONTIER_REPORT'])if(!process.env[name])throw new Error(`${name} required`);
const digest=value=>createHash('sha256').update(value).digest('hex');
const artifact=(path,revision)=>{
    const bytes=new Uint8Array(readFileSync(path)),build=JSON.parse(readFileSync(new URL('wired-net-kernel-build.json',`file://${path}`)));
    assert.equal(digest(bytes),build.wasmSHA256,'Wasm/build receipt');
    return {bytes,build,revision};
};
const before=artifact(process.env.HARRIS_COMPARE_WASM,process.env.HARRIS_COMPARE_REVISION);
const after=artifact(process.env.HARRIS_NET_WASM,process.env.HARRIS_FRONTIER_REVISION??'working-tree');
const publication=process.env.HARRIS_FRONTIER_KIND==='publication';
const modes=publication?
    [{name:'incremental-driver-frontier',artifact:before,incremental:true},{name:'incremental-publication-frontier',artifact:after,incremental:true}]:
    [{name:'admitted-full-scan',artifact:before,incremental:false},{name:'incremental-scan',artifact:before,incremental:true},
        {name:'incremental-driver-frontier',artifact:after,incremental:true}];
const normalize=value=>value instanceof Uint8Array?Array.from(value):Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?
    Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v)])):value;
const snapshot=kernel=>{
    const state=normalize(kernel.inspect()),phase=normalize(kernel.inspectPhase()),memory=[0,1].map(i=>normalize(kernel.inspectMemory(i)));
    return {stateSHA256:digest(JSON.stringify(state)),phaseSHA256:digest(JSON.stringify(phase)),memorySHA256:digest(JSON.stringify(memory)),state,phase,memory};
};
const stepsFor=(f,n)=>{
    const steps=[{values:{...f.passive,reset:1}},{values:f.passive}];
    for(let i=0;i<n;i++)for(const kind of ['memory-write','memory-read']) {
        const address=i*2,value=(i*977)&65535,active={...f.passive,...HARRIS_80C286_STATUS[kind],...bitDrives(f.A,address),bhe_n:0,
            ...(kind==='memory-write'?bitDrives(f.D,value):Object.fromEntries(f.D.map(p=>[p,'Z'])))};
        steps.push({values:active},{values:active},{values:f.passive,read:kind==='memory-read'?value:null},{values:f.passive,read:kind==='memory-read'?value:null});
    }
    return steps;
};
const compileChunks=(kernel,steps)=>{
    const result=[];let chunk=[],updates=0;
    for(const step of steps){const n=Object.keys(step.values).length;
        if(chunk.length===kernel.scheduleLimits.maxPeriods||updates+n>kernel.scheduleLimits.maxUpdates){result.push(kernel.compileSchedule(chunk));chunk=[];updates=0;}
        chunk.push(step);updates+=n;
    }
    if(chunk.length)result.push(kernel.compileSchedule(chunk));return result;
};
const runHandles=(kernel,handles)=>{let periods=0,reads=0;for(const handle of handles){const r=kernel.runSchedule(handle);periods+=r.periods;reads+=r.reads;}return {periods,reads};};
async function runScheduleMode(mode) {
    const f=await createPhaseCircuitOracle({wasmBytes:mode.artifact.bytes,schedule:true,admittedGraph:true,incrementalGraph:mode.incremental});
    const steps=stepsFor(f,count),handles=compileChunks(f.kernel,steps);f.kernel.resetWorkCounters();
        const start=performance.now(),progress=runHandles(f.kernel,handles),elapsedMS=performance.now()-start;
    assert.deepEqual(progress,{periods:8194,reads:2048});
    const {stateSHA256,phaseSHA256,memorySHA256}=snapshot(f.kernel);
    return {elapsedMS,counters:f.kernel.inspectWorkCounters(),stateSHA256,phaseSHA256,memorySHA256};
}
async function categoryCounters(mode) {
    const f=await createPhaseCircuitOracle({wasmBytes:mode.artifact.bytes,schedule:true,admittedGraph:true,incrementalGraph:mode.incremental});
    runHandles(f.kernel,[f.kernel.compileSchedule([{values:{...f.passive,reset:1}},{values:f.passive}])]);
    const run=(name,steps)=>{f.kernel.resetWorkCounters();runHandles(f.kernel,[f.kernel.compileSchedule(steps)]);return [name,f.kernel.inspectWorkCounters()];};
    const address=0x2468,value=0xa55a,write={...f.passive,...HARRIS_80C286_STATUS['memory-write'],...bitDrives(f.A,address),...bitDrives(f.D,value),bhe_n:0};
    const read={...f.passive,...HARRIS_80C286_STATUS['memory-read'],...bitDrives(f.A,address),...Object.fromEntries(f.D.map(p=>[p,'Z'])),bhe_n:0};
    return Object.fromEntries([run('empty-input-period',[{values:{}}]),run('one-host-pin-change',[{values:{reset:1}},{values:{reset:0}}]),
        run('memory-write-controller-latch',[{values:write},{values:write},{values:f.passive},{values:f.passive}]),
        run('memory-read-controller-latch',[{values:read},{values:read},{values:f.passive,read:value},{values:f.passive,read:value}])]);
}
async function rawKernel(mode,{oscillator=false}={}) {
    const {instance}=await WebAssembly.instantiate(mode.artifact.bytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const p={context:base,offsets:base+128,ids:base+144,drivers:base+160,live:base+164,conflicts:base+168,ops:base+172,
        staged:base+300,published:base+304,publishedConflicts:base+308,dependencyOffsets:base+312,dependencies:base+320,previous:base+332,changed:base+336};
    const put=(at,values)=>values.forEach((n,i)=>v.setUint32(at+4*i,n,true)),drivers=oscillator?3:4;
    put(p.context,[3,drivers,p.offsets,p.ids,p.drivers,p.live,p.conflicts,1,p.ops,p.staged,p.published,p.publishedConflicts,oscillator?2:8,
        p.dependencyOffsets,p.dependencies,3,p.previous,p.changed,...new Array(13).fill(0),mode.incremental?2:1]);
    put(p.offsets,[0,1,2,drivers]);put(p.ids,oscillator?[0,1,2]:[0,1,2,3]);put(p.dependencyOffsets,[0,3]);put(p.dependencies,[0,1,2]);
    put(p.ops,oscillator?[1,0,0,65536,0,0,1,0,...new Array(24).fill(2)]:[2,0,1,2]);
    const initial=oscillator?[2,0,0]:[3,3,2,3],published=oscillator?[2,0,0]:[3,3,2];
    new Uint8Array(e.memory.buffer,p.drivers,drivers).set(initial);new Uint8Array(e.memory.buffer,p.previous,3).set(published);
    new Uint8Array(e.memory.buffer,p.published,3).set(published);assert.equal(e.admit_owned_context(p.context),0);
    const counters=()=>Array.from(new Uint32Array(e.memory.buffer,e.incremental_work_counters_ptr(),10));
    const inspect=()=>Object.fromEntries(['drivers','live','conflicts','published','publishedConflicts','previous','changed'].map(name=>
        [name,Array.from(new Uint8Array(e.memory.buffer,p[name],name==='drivers'?drivers:3))]));
    const step=levels=>{if(mode.incremental&&e.write_owned_driver)levels.forEach((code,id)=>assert.equal(e.write_owned_driver(p.context,id,code),0));
        else new Uint8Array(e.memory.buffer,p.drivers,drivers).set(levels);return e.settle_owned_context(p.context)>>>0;};
    return {e,step,counters,inspect};
}
async function rawCases(mode) {
    const k=await rawKernel(mode),out={};
    for(const [name,levels] of [['idle',[3,3,2,3]],['one-host-pin-change',[1,3,2,3]],['x-z',[1,0,3,3]],
        ['conflict',[1,0,1,0]],['conflict-only',[1,0,2,3]],['masked-same-net',[1,0,2,0]]]){
        k.e.reset_incremental_work_counters();const result=k.step(levels);out[name]={result,counters:k.counters(),stateSHA256:digest(JSON.stringify(k.inspect()))};
    }
    const o=await rawKernel(mode,{oscillator:true});o.e.reset_incremental_work_counters();const failed=o.step([0,0,0]),failedHash=digest(JSON.stringify(o.inspect()));
    o.e.reset_incremental_work_counters();const recovered=o.step([2,0,0]);
    out['nonconvergence-recovery']={failed,recovered,failedStateSHA256:failedHash,recoveredStateSHA256:digest(JSON.stringify(o.inspect())),recoveryCounters:o.counters()};
    return out;
}

const samples=[];
for(let round=0;round<rounds;round++)for(const mode of round%2?[...modes].reverse():modes)samples.push({round,mode:mode.name,...await runScheduleMode(mode)});
for(const field of ['stateSHA256','phaseSHA256','memorySHA256'])assert.equal(new Set(samples.map(s=>s[field])).size,1,`${field} differs`);
const categories={},raw={};for(const mode of modes){categories[mode.name]=await categoryCounters(mode);raw[mode.name]=await rawCases(mode);}
for(const name of Object.keys(raw[modes[0].name]))for(const field of Object.keys(raw[modes[0].name][name]).filter(k=>/SHA256$/.test(k)))
    assert.equal(new Set(modes.map(m=>raw[m.name][name][field])).size,1,`${name} ${field} differs`);
const median=a=>{const s=[...a].sort((x,y)=>x-y),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const summaries=Object.fromEntries(modes.map(mode=>{const own=samples.filter(s=>s.mode===mode.name),times=own.map(s=>s.elapsedMS);
    return [mode.name,{medianMS:median(times),minMS:Math.min(...times),maxMS:Math.max(...times),counters:own[0].counters}];}));
if(publication){
    const prior=modes[0].name,current=modes[1].name,counterNames=Object.keys(summaries[prior].counters);
    assert.equal(categories[current]['empty-input-period'].publishNetCopies,0,'empty input publishes no net copies');
    assert.ok(summaries[current].counters.publishNetCopies<summaries[prior].counters.publishNetCopies,'total publication copies decrease');
    for(const name of counterNames.filter(name=>name!=='publishNetCopies')){
        assert.equal(summaries[current].counters[name],summaries[prior].counters[name],`${name} summary differs`);
        for(const category of Object.keys(categories[prior]))
            assert.equal(categories[current][category][name],categories[prior][category][name],`${category} ${name} differs`);
    }
    for(const name of Object.keys(raw[prior]))for(let i=0;i<10;i++)if(i!==8)
        assert.equal(raw[current][name].counters?.[i]??raw[current][name].recoveryCounters[i],
            raw[prior][name].counters?.[i]??raw[prior][name].recoveryCounters[i],`${name} counter ${i} differs`);
}
const report={benchmark:publication?'native-publication-frontier':'native-dirty-driver-frontier',accepted:true,capacityClaim:false,fullBoard:false,cpu:false,rounds,periods:8194,
    benchmarkSHA256:digest(readFileSync(new URL(import.meta.url))),
    revisions:Object.fromEntries(modes.map(m=>[m.name,m.artifact.revision])),builds:{before:before.build,after:after.build},
    host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCPUs:cpus().length,node:process.version},summaries,categories,raw,samples,
    notes:['Counters are reset after construction/admission and read outside each timed region.',
        'Counters are unsigned 32-bit observations and wrap modulo 2^32; reset between bounded measurements.',
        'driverComparisons counts kernel-side comparisons. It excludes the permitted JS bulk-image scan before changed host drivers enter the native seam.',
        'The 8,194-period schedule contains reset/idle, controller/latch changes, 1,024 memory writes and 1,024 memory reads; every period and sampled read executes.',
        'Raw cases isolate idle, one input change, X/Z, contention, a masked same-net change, conflict-only publication and nonconvergence/recovery.',
        'Timing ranges are shared-host component measurements and make no speed or full-board capacity claim.']};
writeFileSync(process.env.HARRIS_FRONTIER_REPORT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({accepted:true,capacityClaim:false,summaries},null,2));
