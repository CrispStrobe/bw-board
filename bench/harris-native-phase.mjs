/** Component-only cost probe. NOT a full-board/CPU real-time benchmark. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {cpus,platform,arch} from 'node:os';
import assert from 'node:assert/strict';
import {DigitalCircuit,bitDrives} from '../src/experimental/digital-circuit.js';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {settleBusMemories} from '../src/experimental/latched-memory-components.js';
import {captureWiredNetImage} from '../src/experimental/wired-net-image.js';
import {HARRIS_80C286_STATUS} from '../src/experimental/harris-80c286-contract.js';
import {createPhaseCircuitOracle} from '../scripts/lib/harris-native-phase-circuit-oracle.mjs';
const rounds=Number(process.argv[2]??3),count=Number(process.argv[3]??512);
if(!Number.isInteger(rounds)||rounds<1||rounds>10||!Number.isInteger(count)||count<1||count>4096)throw new RangeError('rounds/count');
if(!process.env.HARRIS_NET_WASM)throw new Error('HARRIS_NET_WASM required');
const wasmBytes=new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)),hash=b=>createHash('sha256').update(b).digest('hex');
const build=JSON.parse(readFileSync(join(dirname(process.env.HARRIS_NET_WASM),'wired-net-kernel-build.json')));
assert.equal(hash(wasmBytes),build.wasmSHA256);
const root=new URL('../',import.meta.url),sourceHashes={};
// Record the complete execution source tree rather than guess a transitive import list.
const paths=execFileSync('rg',['--files','src','scripts/lib'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>/\.(js|mjs|c)$/.test(p));
paths.push('bench/harris-native-phase.mjs');
for(const p of paths)sourceHashes[p]=hash(readFileSync(new URL(p,root)));
for(const[p,h]of Object.entries(build.sourceHashes))assert.equal(sourceHashes[p],h,'rebuild native sources');
const samples=[],modes=['reference','compiled','native','native-batched','native-admitted','native-incremental'];let expected;
for(let round=-1;round<rounds;round++)for(const mode of round%2?[...modes].reverse():modes) {
    const admitted=mode==='native-admitted'||mode==='native-incremental',batched=mode==='native-batched'||admitted;
    const f=await createPhaseCircuitOracle({wasmBytes,Circuit:mode==='compiled'?CompiledDigitalCircuit:DigitalCircuit,schedule:batched,
        admittedGraph:admitted,incrementalGraph:mode==='native-incremental'});
    const image=captureWiredNetImage({enabled:true,circuit:f.circuit}),driverIDs=new Map(image.driverNames.map((n,i)=>[n,i]));
    const dataNets=f.D.map(p=>image.terminals.find(t=>t.name===`host.${p}`).net);
    const steps=[{values:{...f.passive,reset:1}},{values:f.passive}];
    for(let i=0;i<count;i++) {
        const address=i*2,value=(i*977)&65535;
        for(const kind of ['memory-write','memory-read']) {
            const active={...f.passive,...HARRIS_80C286_STATUS[kind],...bitDrives(f.A,address),bhe_n:0,
                ...(kind==='memory-write'?bitDrives(f.D,value):Object.fromEntries(f.D.map(p=>[p,'Z'])))};
            steps.push({values:active},{values:active},{values:f.passive,read:kind==='memory-read'?value:null},{values:f.passive,read:kind==='memory-read'?value:null});
        }
    }
    for(const step of steps)step.updates=Object.entries(step.values).map(([p,v])=>[driverIDs.get(`host.${p}`),v==='Z'?3:v]);
    const handles=[];
    if(batched) {
        const {maxPeriods,maxUpdates}=f.kernel.scheduleLimits;let chunk=[],updates=0;
        for(const step of steps){
            if(chunk.length===maxPeriods||updates+step.updates.length>maxUpdates){handles.push(f.kernel.compileSchedule(chunk));chunk=[];updates=0;}
            chunk.push(step);updates+=step.updates.length;
        }
        if(chunk.length)handles.push(f.kernel.compileSchedule(chunk));
    }
    let levels=image.driverLevels,reads=0;
    const start=performance.now();
    if(batched) {
        for(const handle of handles){const result=f.kernel.runSchedule(handle);assert.equal(result.periods,handle.periods);reads+=result.reads;levels=result.driverLevels;}
    }else for(const step of steps) {
        if(mode==='native') {
            for(const[id,value]of step.updates)levels[id]=value;
            const begun=f.kernel.beginClock(levels);
            if(step.read!=null){assert.equal(dataNets.reduce((v,n,i)=>v|(begun.levels[n]<<i),0),step.read);reads++;}
            levels=f.kernel.endClock().driverLevels;
        }else {
            const c=f.circuit;c.drive('host',step.values);c.settle();c.drive('controller',f.controller.beginClock(p=>c.require('controller',p)));c.settle();
            c.drive('latch',f.latch.update(p=>c.require('latch',p)));settleBusMemories(c,f.refs);
            if(step.read!=null){assert.equal(f.D.reduce((v,p,i)=>v|(c.require('host',p)<<i),0),step.read);reads++;}
            const end=f.controller.previewEnd(p=>c.require('controller',p)),commands=end.finish();
            if(commands){c.drive('controller',commands);c.settle();settleBusMemories(c,f.refs);}
        }
    }
    const elapsedMS=performance.now()-start;
    assert.equal(reads,count*2);
    const state=mode.startsWith('native')?f.kernel.inspect():captureWiredNetImage({enabled:true,circuit:f.circuit});
    const memory=f.refs.map((ref,i)=>{
        const m=mode.startsWith('native')?f.kernel.inspectMemory(i):{bytes:ref.state.mem,writes:ref.writes};assert.equal(m.writes,count);
        for(let a=0;a<count;a++)assert.equal(m.bytes[a],((a*977)>>>(8*i))&255);
        return {sha256:hash(m.bytes),writes:m.writes};
    });
    const stateSHA256=hash(JSON.stringify({levels:Array.from(state.levels??state.resolvedLevels),
        conflicts:Array.from(state.conflicts??state.resolvedConflicts),drivers:Array.from(state.driverLevels),memory}));
    expected??=stateSHA256;assert.equal(stateSHA256,expected,`${mode} final state`);
    if(round>=0)samples.push({round,mode,periods:steps.length,reads,writes:count*2,elapsedMS,periodsPerSecond:steps.length*1000/elapsedMS,stateSHA256});
}
for(const[p,h]of Object.entries(sourceHashes))assert.equal(hash(readFileSync(new URL(p,root))),h,'source changed during benchmark');
const median=a=>{const s=[...a].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const summaries=Object.fromEntries(modes.map(mode=>{const s=samples.filter(x=>x.mode===mode),ms=s.map(x=>x.elapsedMS),m=median(ms);
    return [mode,{medianMS:m,minMS:Math.min(...ms),maxMS:Math.max(...ms),periodsPerSecond:s[0].periods*1000/m}];}));
const report={benchmark:'owned-latched-memory-components',accepted:true,capacityClaim:false,fullBoard:false,cpu:false,rounds,warmupRounds:1,count,
    revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes,nativeBuild:build,
    host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCPUs:cpus().length},node:process.version,samples,summaries,
    notes:['Two SRAM banks/64 KiB, ideal controller/latch and actual nets only. No CPU, timers, DMA, interrupts or DOS workload.',
        'Construction, Wasm instantiation and final hashes excluded; sampled read checks included.',
        'Native mode copies typed input and diagnostic output arrays per begin/end boundary. Native-batched uses precompiled bounded fixture schedules; compilation excluded, upload/admission included.',
        'Every native-batched period and actual-net read check still executes; synthetic schedule replay is not a CPU/device runner.',
        'Native-admitted uses the same bounded schedule with private immutable graph admission; input/schedule validation remains enabled.',
        'Native-incremental additionally caches driver membership/levels and resolves only dirty nets while retaining every period.',
        'One warmup excluded, alternating mode order, shared host load uncontrolled. Do not extrapolate this ratio to a full board.']};
if(process.env.HARRIS_PHASE_REPORT)writeFileSync(process.env.HARRIS_PHASE_REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({accepted:true,capacityClaim:false,summaries},null,2));
