/** Same-host interleaved unpaced A/B for unchanged native writer suppression. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {arch,cpus,hostname,loadavg,platform} from 'node:os';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const BASE_REVISION='4926e93cd0133dd038b929f8506318d0da320b3b';
const CANDIDATE_REVISION='e827ddaac2e5bfbbbc4b61ac95799c85b6c987be';
const SOURCES=['src/experimental/wired-kernel/net-resolver.c','src/experimental/wired-kernel/memory-banks.c',
    'src/experimental/wired-kernel/memory-circuit.c','src/experimental/wired-kernel/phase-components.c',
    'src/experimental/wired-kernel/phase-circuit.c','src/experimental/wired-kernel/phase-schedule.c',
    'src/experimental/wired-kernel/incremental-nets.c','src/experimental/wired-kernel/bus-sequencer.c',
    'src/experimental/wired-kernel/bus-circuit.c'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
const median=a=>{a=[...a].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const m=/^--([^=]+)=(.*)$/.exec(arg);if(!m)throw Error(`option: ${arg}`);return [m[1],m[2]];}));
const integer=(name,fallback,max)=>{const n=Number(options[name]??fallback);if(!Number.isSafeInteger(n)||n<1||n>max)throw RangeError(name);return n;};
const required=name=>{if(!options[name])throw Error(`--${name} required`);return options[name];};

async function load(name,dir,wasm,revision){
    dir=realpathSync(dir);wasm=realpathSync(wasm);
    assert.equal(git(dir,'rev-parse','HEAD'),revision,`${name} revision`);assert.equal(git(dir,'status','--porcelain'),'',`${name} clean`);
    const bytes=readFileSync(wasm),manifestBytes=readFileSync(join(dirname(wasm),'wired-net-kernel-build.json')),manifest=JSON.parse(manifestBytes);
    assert.equal(hash(bytes),manifest.wasmSHA256,`${name} wasm`);assert.deepEqual(Object.keys(manifest.sourceHashes),SOURCES);
    for(const [path,digest] of Object.entries(manifest.sourceHashes))assert.equal(hash(readFileSync(join(dir,path))),digest,`${name} ${path}`);
    const paths=['src/devices/bus-memory.js','src/experimental/harris-80c286-boot-cpu.js','src/experimental/harris-boot-rom.js',
        'src/experimental/harris-native-memory-board.js','src/experimental/harris-80c286-memory-board.js',
        'src/experimental/wired-kernel/bus-circuit-image.js','src/experimental/wired-kernel/memory-circuit.js'];
    const modules=await Promise.all(paths.slice(0,4).map(path=>import(pathToFileURL(join(dir,path)).href)));
    modules[0].registerBusMemory();
    return {name,revision,bytes,HarrisBootCPU:modules[1].HarrisBootCPU,createROM:modules[2].createHarrisStoreLoopROM,
        createBoard:modules[3].createHarrisNativeMemoryBoard,provenance:{revision,wasmSHA256:manifest.wasmSHA256,
            manifestSHA256:hash(manifestBytes),compiler:manifest.compiler,nativeSourceHashes:manifest.sourceHashes,
            jsSourceHashes:Object.fromEntries(paths.map(path=>[path,hash(readFileSync(join(dir,path)))]))}};
}
function state(cpu,board){
    const bus=board.inspectBus(),phase=board.inspectPhase(),lifecycle=board.inspectLifecycle(),nets=board.inspectNets();
    const memory=['rom0','rom1','ram0','ram1'].map(id=>{const value=board.inspectMemory(id);return {...value,bytes:[...value.bytes]};});
    return {stateHash:hash(JSON.stringify({cpu:cpu.inspect(),bus,phase,lifecycle,nets,memory})),physicalClock:bus.clock,
        retired:cpu.retired,writes:[memory[2].writes,memory[3].writes]};
}
async function sample(v,iterations){
    const raw=await v.createBoard({enabled:true,rom:v.createROM(iterations),romLowAlias:true,wasmBytes:v.bytes,admittedGraph:true,incrementalGraph:true});
    const trace=createHash('sha256'),faultTrace=[];
    const board={...raw,runUntilCompletion(options){try{const r=raw.runUntilCompletion(options);trace.update(JSON.stringify(r));return r;}
        catch(error){const f={code:error?.code??null,progress:error?.progress??null};faultTrace.push(f);trace.update(JSON.stringify(f));throw error;}}};
    const cpu=new v.HarrisBootCPU({enabled:true,board});cpu.initialize();raw.resetWorkCounters();raw.resetProducerCounters();global.gc?.();
    const start=performance.now();const result=cpu.runTransactions({maxPeriods:iterations*32+100,maxBatchPeriods:8192});const wallMS=performance.now()-start;
    assert.equal(result.status,'halted');assert.equal(cpu.retired,iterations*3+4);
    const observed=state(cpu,raw);assert.deepEqual(observed.writes,[iterations,iterations]);assert.equal(observed.physicalClock,result.periods+67);
    const work=raw.inspectWorkCounters(),producerWork=raw.inspectProducerCounters(),values=Object.values(producerWork.producers);
    assert.equal(values.reduce((n,v)=>n+v.attempts,0)>>>0,work.driverComparisons);
    assert.equal(values.reduce((n,v)=>n+v.changes,0)>>>0,work.valueChangingDriverWrites);
    return {wallMS,periodsPerSecond:result.periods*1000/wallMS,...observed,periods:result.periods,
        completionTraceSHA256:trace.digest('hex'),faultTrace,work,producerWork};
}
function parity(base,candidate,label){
    for(const key of ['stateHash','physicalClock','retired','writes','periods','completionTraceSHA256','faultTrace'])assert.deepEqual(candidate[key],base[key],`${label} ${key}`);
    const {driverComparisons:bd,...baseWork}=base.work,{driverComparisons:cd,...candidateWork}=candidate.work;
    assert.deepEqual(candidateWork,baseWork,`${label} work except submissions`);assert.ok(cd<bd,`${label} fewer comparisons`);
    assert.deepEqual(candidate.producerWork.memory,base.producerWork.memory,`${label} memory counters`);
    for(const name of Object.keys(base.producerWork.producers)){
        const b=base.producerWork.producers[name],c=candidate.producerWork.producers[name];
        assert.equal(c.changes,b.changes,`${label} ${name} changes`);
        if(name==='busExternal'||name==='phaseLatch'){assert.equal(c.attempts,c.changes);assert.ok(c.attempts<b.attempts,`${label} ${name} suppressed`);}
        else assert.equal(c.attempts,b.attempts,`${label} ${name} attempts`);
    }
    return {driverComparisonsSuppressed:bd-cd,busExternalSuppressed:base.producerWork.producers.busExternal.attempts-candidate.producerWork.producers.busExternal.attempts,
        phaseLatchSuppressed:base.producerWork.producers.phaseLatch.attempts-candidate.producerWork.producers.phaseLatch.attempts};
}
const iterations=integer('iterations',2048,65535),warmups=integer('warmups',2,10),rounds=integer('rounds',12,30);
const variants={base:await load('base',required('base-dir'),required('base-wasm'),BASE_REVISION),candidate:await load('candidate',required('candidate-dir'),required('candidate-wasm'),CANDIDATE_REVISION)};
const samples=[],pairs=[];let structural;
for(let round=0;round<warmups+rounds;round++){
    const order=round%2?['candidate','base']:['base','candidate'],pair={};
    for(const name of order)pair[name]=await sample(variants[name],iterations);
    const proof=parity(pair.base,pair.candidate,`round ${round+1}`);structural??=proof;assert.deepEqual(proof,structural);
    if(round>=warmups){samples.push(...order.map((name,position)=>({round:round-warmups+1,position:position+1,name,...pair[name]})));
        pairs.push({round:round-warmups+1,order,wallThroughputRatio:pair.candidate.periodsPerSecond/pair.base.periodsPerSecond});}
}
const ratios=pairs.map(p=>p.wallThroughputRatio),summary={median:median(ratios),min:Math.min(...ratios),max:Math.max(...ratios)};
console.log(JSON.stringify({schemaVersion:1,workload:'unpaced-owned-harris-store-loop-native-writer-suppression',settings:{iterations,warmups,rounds},
    host:{hostname:hostname(),platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version,loadavg:loadavg()},
    variants:Object.fromEntries(Object.entries(variants).map(([k,v])=>[k,v.provenance])),structural,wallThroughputRatio:summary,
    performanceClaim:summary.median>1?'observed faster in this same-host sample':'no improvement observed',samples,pairs,
    limitations:['Unpaced synchronous memory-only workload; no DOS, browser, peripherals or real-time claim.','Same-host balanced order reduces but cannot remove host noise.',
        'Completion trace and fault parity cover this successful workload; existing fault and edited-wire oracles provide fault-path coverage.']},null,2));
