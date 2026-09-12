/** Same-runner A/B measurement of sparse native CPU bus-output publication. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {arch,cpus,hostname,loadavg,platform} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

export const BASE_REVISION='059a7c09838aaf3a83711bf4be552cfe589c15d5';
export const CANDIDATE_REVISION='d86c163147c7f4ecf7300dc0948f184b332de987';
export const LEGACY_WORK_COUNTERS=Object.freeze([
    'driverComparisons','valueChangingDriverWrites','dirtyNetResolutions','netDriverVisits',
    'evaluatorRows','dependencyProbes','stagedDriverCopies','committedEvaluatorOutputs',
    'publishNetCopies','deltas','reverseIndexVisits','operationBitsetWordVisits']);
export const PRODUCERS=Object.freeze(['other','busExternal','busOutput','phaseController','phaseLatch','memoryBank',
    'phaseSchedule','evaluator','fullScan']);

const hash=value=>createHash('sha256').update(value).digest('hex');
const median=values=>{const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const quantile=(values,q)=>{const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,l=Math.floor(p),f=p-l;return a[l]+(a[Math.min(l+1,a.length-1)]-a[l])*f;};
export function summarize(values){
    assert.ok(Array.isArray(values)&&values.length,'nonempty samples required');
    for(const value of values)assert.ok(Number.isFinite(value)&&value>0,'positive finite sample required');
    const center=median(values),deviations=values.map(value=>Math.abs(value-center));
    return Object.freeze({samples:values.length,median:center,mad:median(deviations),q1:quantile(values,.25),
        q3:quantile(values,.75),min:Math.min(...values),max:Math.max(...values)});
}
export function interleavedOrder(warmupRounds,measuredRounds){
    for(const [name,value] of Object.entries({warmupRounds,measuredRounds}))
        assert.ok(Number.isSafeInteger(value)&&value>0,`${name} must be positive`);
    return Array.from({length:warmupRounds+measuredRounds},(_,index)=>({
        phase:index<warmupRounds?'warmup':'measured',
        round:index<warmupRounds?index+1:index-warmupRounds+1,
        order:index%2?['candidate','base']:['base','candidate']}));
}
const commonSemantic=receipt=>Object.fromEntries(['stateHash','periods','retired','writes','physicalClock','chunks','yields']
    .map(name=>[name,receipt[name]]));
export function assertSparseReconciliation(candidate,base,label='sample'){
    assert.deepEqual(commonSemantic(candidate),commonSemantic(base),`${label}: state and progress`);
    assert.deepEqual(Object.keys(candidate.work).sort(),[...LEGACY_WORK_COUNTERS].sort(),`${label}: candidate work schema`);
    assert.deepEqual(Object.keys(base.work).sort(),[...LEGACY_WORK_COUNTERS].sort(),`${label}: base work schema`);
    for(const name of LEGACY_WORK_COUNTERS)if(name!=='driverComparisons')
        assert.equal(candidate.work[name],base.work[name],`${label}: unchanged work ${name}`);
    assert.deepEqual(Object.keys(candidate.producerWork.producers),[...PRODUCERS],`${label}: producer schema`);
    for(const name of PRODUCERS){
        assert.equal(candidate.producerWork.producers[name].changes,base.producerWork.producers[name].changes,
            `${label}: producer changes ${name}`);
        if(name!=='busOutput')assert.equal(candidate.producerWork.producers[name].attempts,
            base.producerWork.producers[name].attempts,`${label}: producer attempts ${name}`);
    }
    assert.deepEqual(candidate.producerWork.memory,base.producerWork.memory,`${label}: memory counters`);
    const cb=candidate.producerWork.producers.busOutput,bb=base.producerWork.producers.busOutput;
    assert.equal(cb.attempts,cb.changes,`${label}: sparse writes are actual raw-driver changes`);
    assert.equal(bb.attempts,base.periods*48,`${label}: base publishes all 48 outputs per period`);
    assert.equal(base.work.driverComparisons-candidate.work.driverComparisons,bb.attempts-cb.attempts,
        `${label}: comparison reduction reconciles exactly with skipped bus-output calls`);
    return (base.work.driverComparisons-candidate.work.driverComparisons)/base.work.driverComparisons;
}

const options={};
function parseOptions(args){for(const arg of args){
    const match=/^--(experimental|base-dir=(.+)|candidate-dir=(.+)|base-wasm=(.+)|candidate-wasm=(.+)|iterations=([0-9]+)|warmup-rounds=([0-9]+)|rounds=([0-9]+)|batch-periods=([0-9]+)|wall-budget-ms=([0-9]+(?:\.[0-9]+)?))$/.exec(arg);
    if(!match)throw new Error(`unknown measurement option: ${arg}`);
    const [key,value]=arg.slice(2).split(/=(.*)/s);if(Object.hasOwn(options,key))throw new Error(`duplicate option: --${key}`);options[key]=value??true;
}}
const integer=(name,fallback,maximum)=>{const value=options[name]===undefined?fallback:Number(options[name]);
    if(!Number.isSafeInteger(value)||value<1||value>maximum)throw new RangeError(`${name} 1..${maximum}`);return value;};
const git=(directory,...args)=>execFileSync('git',['-C',directory,...args],{encoding:'utf8'}).trim();
const moduleURL=(directory,path)=>pathToFileURL(join(directory,path)).href;
async function loadVariant({name,directory,wasmPath,revision}){
    directory=realpathSync(directory);wasmPath=realpathSync(wasmPath);
    assert.equal(git(directory,'rev-parse','HEAD'),revision,`${name}: exact revision`);
    assert.equal(git(directory,'status','--porcelain'),'',`${name}: clean source tree`);
    const wasmBytes=readFileSync(wasmPath),manifestBytes=readFileSync(join(dirname(wasmPath),'wired-net-kernel-build.json'));
    const build=JSON.parse(manifestBytes);assert.equal(build.wasmSHA256,hash(wasmBytes),`${name}: Wasm receipt`);
    for(const [path,expected] of Object.entries(build.sourceHashes))assert.equal(hash(readFileSync(join(directory,path))),expected,`${name}: ${path}`);
    const jsPaths=['src/devices/bus-memory.js','src/experimental/harris-80c286-boot-cpu.js','src/experimental/harris-boot-rom.js',
        'src/experimental/harris-native-memory-board.js','src/experimental/harris-run-transactions.js'];
    const provenancePaths=[...jsPaths,'src/experimental/harris-80c286-memory-board.js','src/experimental/wired-kernel/bus-circuit-image.js'];
    const [busMemory,cpuModule,romModule,boardModule,runModule]=await Promise.all(jsPaths.map(path=>import(moduleURL(directory,path))));
    busMemory.registerBusMemory();
    return Object.freeze({name,directory,revision,wasmBytes,HarrisBootCPU:cpuModule.HarrisBootCPU,
        createROM:romModule.createHarrisStoreLoopROM,createBoard:boardModule.createHarrisNativeMemoryBoard,
        runTransactions:runModule.runHarrisTransactions,provenance:Object.freeze({revision,wasmSHA256:build.wasmSHA256,
            buildManifestSHA256:hash(manifestBytes),compiler:build.compiler,buildArgs:build.args,nativeSourceHashes:build.sourceHashes,
            jsSourceHashes:Object.fromEntries(provenancePaths.map(path=>[path,hash(readFileSync(join(directory,path)))]))})});
}
function stateOf(cpu,board){const bus=board.inspectBus();return {stateHash:hash(JSON.stringify({cpu:cpu.inspect(),bus,
    memory:['rom0','rom1','ram0','ram1'].map(id=>{const memory=board.inspectMemory(id);return {id,bytes:[...memory.bytes],writes:memory.writes};})})),
    physicalClock:bus.clock,status:cpu.status,retired:cpu.retired,writes:[board.inspectMemory('ram0').writes,board.inspectMemory('ram1').writes]};}
async function sample(variant,{iterations,batchPeriods,wallBudgetMS}){
    const board=await variant.createBoard({enabled:true,rom:variant.createROM(iterations),romLowAlias:true,wasmBytes:variant.wasmBytes,
        admittedGraph:true,incrementalGraph:true});const cpu=new variant.HarrisBootCPU({enabled:true,board});
    cpu.initialize();board.resetWorkCounters();board.resetProducerCounters();global.gc?.();let yields=0;
    const wallStart=performance.now();const result=await variant.runTransactions({cpu,maxPeriods:iterations*32+100,batchPeriods,wallBudgetMS,
        yieldTask:()=>new Promise(resolve=>setImmediate(()=>{yields++;resolve();}))});const wallMS=performance.now()-wallStart;
    assert.equal(result.status,'halted');assert.equal(cpu.retired,iterations*3+4);assert.equal(yields,result.chunks-1);
    const state=stateOf(cpu,board),work=board.inspectWorkCounters(),producerWork=board.inspectProducerCounters();
    assert.deepEqual(state.writes,[iterations,iterations]);assert.equal(state.physicalClock,result.periods+67);
    const values=Object.values(producerWork.producers);
    assert.equal(values.reduce((sum,value)=>sum+value.attempts,0)>>>0,work.driverComparisons);
    assert.equal(values.reduce((sum,value)=>sum+value.changes,0)>>>0,work.valueChangingDriverWrites);
    return {label:variant.name,activeMS:result.activeMS,wallMS,activePeriodsPerSecond:result.periods*1000/result.activeMS,
        wallPeriodsPerSecond:result.periods*1000/wallMS,semantic:{stateHash:state.stateHash,periods:result.periods,
            retired:state.retired,writes:state.writes,physicalClock:state.physicalClock,chunks:result.chunks,yields,work,producerWork}};
}
async function main(){
    parseOptions(process.argv.slice(2));
    if(options.experimental!==true||!options['base-dir']||!options['candidate-dir']||!options['base-wasm']||!options['candidate-wasm'])
        throw new Error('usage: node --expose-gc scripts/measure-harris-native-bus-output-sparse.mjs --experimental --base-dir=DIR --candidate-dir=DIR --base-wasm=FILE --candidate-wasm=FILE');
    const settings={iterations:integer('iterations',4096,65535),warmupRounds:integer('warmup-rounds',2,10),
        rounds:integer('rounds',12,30),batchPeriods:integer('batch-periods',8192,8192),
        wallBudgetMS:options['wall-budget-ms']===undefined?1000:Number(options['wall-budget-ms'])};
    assert.ok(Number.isFinite(settings.wallBudgetMS)&&settings.wallBudgetMS>0&&settings.wallBudgetMS<=5000,'wall-budget-ms 0..5000');
    const variants=Object.fromEntries(await Promise.all([
        {name:'base',directory:options['base-dir'],wasmPath:options['base-wasm'],revision:BASE_REVISION},
        {name:'candidate',directory:options['candidate-dir'],wasmPath:options['candidate-wasm'],revision:CANDIDATE_REVISION}
    ].map(async spec=>[spec.name,await loadVariant(spec)])));
    const warmups=[],samples=[],paired=[];let sequence=0,expectedByVariant={};
    for(const group of interleavedOrder(settings.warmupRounds,settings.rounds)){
        const pair={};for(let position=0;position<group.order.length;position++){
            const value=await sample(variants[group.order[position]],settings);pair[value.label]=value;
            expectedByVariant[value.label]??=value.semantic;assert.deepEqual(value.semantic,expectedByVariant[value.label],`${value.label}: repeat identity`);
            const record={sequence:++sequence,phase:group.phase,round:group.round,position:position+1,...value};
            (group.phase==='warmup'?warmups:samples).push(record);
        }
        const comparisonReduction=assertSparseReconciliation(pair.candidate.semantic,pair.base.semantic,`${group.phase} ${group.round}`);
        const record={phase:group.phase,round:group.round,order:group.order,comparisonReduction,
            activeThroughputRatio:pair.candidate.activePeriodsPerSecond/pair.base.activePeriodsPerSecond,
            wallThroughputRatio:pair.candidate.wallPeriodsPerSecond/pair.base.wallPeriodsPerSecond};
        if(group.phase==='measured')paired.push(record);
    }
    const metrics=Object.fromEntries(['base','candidate'].map(label=>{const selected=samples.filter(sample=>sample.label===label);return [label,{
        activeMS:summarize(selected.map(sample=>sample.activeMS)),wallMS:summarize(selected.map(sample=>sample.wallMS)),
        activePeriodsPerSecond:summarize(selected.map(sample=>sample.activePeriodsPerSecond)),
        wallPeriodsPerSecond:summarize(selected.map(sample=>sample.wallPeriodsPerSecond))}];}));
    const comparisonReduction=paired[0].comparisonReduction;
    for(const pair of paired)assert.equal(pair.comparisonReduction,comparisonReduction,'deterministic comparison reduction');
    const pairedActiveThroughputRatio=summarize(paired.map(pair=>pair.activeThroughputRatio));
    const positionEffects=Object.fromEntries(['base','candidate'].flatMap(label=>[1,2].map(position=>{
        const selected=samples.filter(sample=>sample.label===label&&sample.position===position);
        return [`${label}Position${position}`,summarize(selected.map(sample=>sample.activePeriodsPerSecond))];})));
    assert.ok(comparisonReduction>=.25,`driver comparison reduction ${comparisonReduction} below 25%`);
    assert.ok(pairedActiveThroughputRatio.median>=1.05,`paired median active throughput ratio ${pairedActiveThroughputRatio.median} below 1.05`);
    const measurementDirectory=realpathSync(fileURLToPath(new URL('..',import.meta.url))),measurementRevision=git(measurementDirectory,'rev-parse','HEAD');
    assert.equal(git(measurementDirectory,'status','--porcelain'),'','measurement requires a clean harness tree');
    console.log(JSON.stringify({schemaVersion:1,workload:'owned-harris-store-loop-memory-only-admitted-incremental-native-bus-output-sparse',
        measurementRevision,clean:true,settings,host:{hostname:hostname(),platform:platform(),arch:arch(),cpu:cpus()[0]?.model,
            node:process.version,loadavg:loadavg(),exposedGC:typeof global.gc==='function'},
        variants:Object.fromEntries(Object.entries(variants).map(([name,variant])=>[name,variant.provenance])),
        expectedByVariant,comparisonReduction,pairedActiveThroughputRatio,positionEffects,metrics,warmups,samples,paired,
        limitations:['Same hosted job, process and balanced AB/BA order reduce runner drift but do not make shared-host timing deterministic.',
            'The comparison and throughput thresholds qualify only the explicitly selected admittedGraph:true, incrementalGraph:true path; they are not default checked-path performance evidence.',
            'The candidate changes only native CPU bus-output publication plus its fail-closed ABI and qualification gates; neither variant changes execution defaults.',
            'The mask compares raw per-driver 0/1/X/Z codes. Other drivers remain responsible for contention and resolved-net changes.',
            'Counters wrap modulo 2^32; driverComparisons is kernel-side and excludes JavaScript bulk-image scanning.',
            'Memory-only owned workload; no DOS, peripherals, full-native CPU, browser capacity or default-change claim.']},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
