/** Same-runner A/B for one-time immutable memory-map admission. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {arch,cpus,hostname,loadavg,platform} from 'node:os';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {assertStageReceipt} from './measure-harris-native-stage-attribution.mjs';

export const BASE_REVISION='208710e006af1e5007fe31e37fb472ce9587255f';
export const CANDIDATE_REVISION='7e8941254ac72ff7a9add2aa061528c0f41768c6';
export const HEADER_PATH='src/experimental/wired-kernel/stage-attribution.h';
const hash=value=>createHash('sha256').update(value).digest('hex');
const median=values=>{const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const quantile=(values,q)=>{const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,l=Math.floor(p),f=p-l;return a[l]+(a[Math.min(l+1,a.length-1)]-a[l])*f;};
export function summarize(values){
    assert.ok(Array.isArray(values)&&values.length);for(const value of values)assert.ok(Number.isFinite(value)&&value>0);
    const center=median(values);return Object.freeze({samples:values.length,median:center,
        mad:median(values.map(value=>Math.abs(value-center))),q1:quantile(values,.25),q3:quantile(values,.75),
        min:Math.min(...values),max:Math.max(...values)});
}
export function interleavedOrder(warmupRounds,rounds){
    for(const value of [warmupRounds,rounds])assert.ok(Number.isSafeInteger(value)&&value>0);
    return Array.from({length:warmupRounds+rounds},(_,index)=>({phase:index<warmupRounds?'warmup':'measured',
        round:index<warmupRounds?index+1:index-warmupRounds+1,order:index%2?['candidate','base']:['base','candidate']}));
}
export function assertAdmissionReconciliation(candidate,base,label='sample'){
    for(const name of ['stateHash','periods','retired','physicalClock','chunks','yields'])assert.deepEqual(candidate[name],base[name],`${label}: ${name}`);
    assert.deepEqual(candidate.writes,base.writes,`${label}: writes`);
    assert.deepEqual(candidate.work,base.work,`${label}: legacy work`);
    assert.deepEqual(candidate.producerWork,base.producerWork,`${label}: producer and memory work`);
}
export function assertHeaderHashes(headerHashes,expected){
    assert.deepEqual(Object.keys(headerHashes??{}),[HEADER_PATH],'exact native header inventory');
    assert.equal(headerHashes[HEADER_PATH],expected,'native header digest');return Object.freeze({...headerHashes});
}
export function assertAdmissionCounters(value){
    const expected={attempts:1,admissions:1,failures:0,inputMapVisits:112,outputMapVisits:32,
        outputAliasComparisons:496,protectionVisits:4,runtimeMapVisits:0};
    assert.deepEqual(value,expected,'four-bank admission occurs once with no production runtime map visits');return Object.freeze({...value});
}
export function collectJSImportClosure(directory,entries){
    const root=realpathSync(directory),pending=[...entries],seen=new Set();
    while(pending.length){const path=pending.pop();if(seen.has(path))continue;const absolute=resolve(root,path);
        assert.ok(!relative(root,absolute).startsWith(`..${sep}`),'JS provenance stays inside source tree');seen.add(path);
        const source=readFileSync(absolute,'utf8'),folder=dirname(path);
        for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g))if(match[1].startsWith('.')){
            let child=relative(root,resolve(root,folder,match[1])).split(sep).join('/');if(!child.endsWith('.js')&&!child.endsWith('.mjs'))child+='.js';pending.push(child);}
    }
    return Object.freeze([...seen].sort());
}
const options={};
function parse(args){for(const arg of args){const m=/^--(experimental|base-dir=(.+)|candidate-dir=(.+)|base-wasm=(.+)|candidate-wasm=(.+)|attribution-wasm=(.+)|iterations=([0-9]+)|warmup-rounds=([0-9]+)|rounds=([0-9]+)|batch-periods=([0-9]+)|wall-budget-ms=([0-9]+(?:\.[0-9]+)?))$/.exec(arg);
    if(!m)throw new Error(`unknown option: ${arg}`);const [key,value]=arg.slice(2).split(/=(.*)/s);if(Object.hasOwn(options,key))throw new Error(`duplicate: ${key}`);options[key]=value??true;}}
const integer=(name,fallback,max)=>{const value=options[name]===undefined?fallback:Number(options[name]);if(!Number.isSafeInteger(value)||value<1||value>max)throw new RangeError(name);return value;};
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
const url=(dir,path)=>pathToFileURL(join(dir,path)).href;
async function loadVariant(name,directory,wasmPath,revision,stageAttribution=false){
    directory=realpathSync(directory);wasmPath=realpathSync(wasmPath);assert.equal(git(directory,'rev-parse','HEAD'),revision);
    assert.equal(git(directory,'status','--porcelain'),'');const wasm=readFileSync(wasmPath),manifestBytes=readFileSync(join(dirname(wasmPath),'wired-net-kernel-build.json'));
    const manifest=JSON.parse(manifestBytes);assert.equal(manifest.wasmSHA256,hash(wasm));
    for(const [path,digest] of Object.entries(manifest.sourceHashes))assert.equal(hash(readFileSync(join(directory,path))),digest,path);
    assert.equal(manifest.stageAttribution??false,stageAttribution,`${name}: stage-attribution build flag`);
    const headerHashes=assertHeaderHashes(manifest.headerHashes,hash(readFileSync(join(directory,HEADER_PATH))));
    const paths=['src/devices/bus-memory.js','src/experimental/harris-80c286-boot-cpu.js','src/experimental/harris-boot-rom.js',
        'src/experimental/harris-native-memory-board.js','src/experimental/harris-run-transactions.js'];
    const [busMemory,cpu,rom,board,runner]=await Promise.all(paths.map(path=>import(url(directory,path))));busMemory.registerBusMemory();
    const js=collectJSImportClosure(directory,paths);
    return {name,revision,wasm,stageAttribution,HarrisBootCPU:cpu.HarrisBootCPU,createROM:rom.createHarrisStoreLoopROM,
        createBoard:board.createHarrisNativeMemoryBoard,run:runner.runHarrisTransactions,provenance:{revision,wasmSHA256:manifest.wasmSHA256,
            manifestSHA256:hash(manifestBytes),compiler:manifest.compiler,buildArgs:manifest.args,nativeSourceHashes:manifest.sourceHashes,headerHashes,
            jsSourceHashes:Object.fromEntries(js.map(path=>[path,hash(readFileSync(join(directory,path)))]))}};
}
function state(cpu,board){const bus=board.inspectBus(),memories=['rom0','rom1','ram0','ram1'].map(id=>{const m=board.inspectMemory(id);return {id,bytes:[...m.bytes],writes:m.writes};});
    return {stateHash:hash(JSON.stringify({cpu:cpu.inspect(),bus,phase:board.inspectPhase(),nets:board.inspectNets(),memories})),
        retired:cpu.retired,writes:memories.slice(2).map(m=>m.writes),physicalClock:bus.clock};}
async function sample(variant,settings){
    const board=await variant.createBoard({enabled:true,rom:variant.createROM(settings.iterations),romLowAlias:true,wasmBytes:variant.wasm,
        admittedGraph:true,incrementalGraph:true,stageAttribution:variant.stageAttribution});
    const admissionAtConstruction=board.inspectMemoryAdmission?.()??null;const cpu=new variant.HarrisBootCPU({enabled:true,board});cpu.initialize();
    const admissionBefore=board.inspectMemoryAdmission?.()??null;
    board.resetWorkCounters();board.resetProducerCounters();if(variant.stageAttribution)board.resetStageAttribution();global.gc?.();let yields=0;const wallStart=performance.now();
    const result=await variant.run({cpu,maxPeriods:settings.iterations*32+100,batchPeriods:settings.batchPeriods,wallBudgetMS:settings.wallBudgetMS,
        yieldTask:()=>new Promise(resolve=>setImmediate(()=>{yields++;resolve();}))});const wallMS=performance.now()-wallStart;
    assert.equal(result.status,'halted');const final=state(cpu,board);assert.deepEqual(final.writes,[settings.iterations,settings.iterations]);
    assert.equal(final.physicalClock,result.periods+67);assert.equal(yields,result.chunks-1);
    const semantic={...final,periods:result.periods,chunks:result.chunks,yields,work:board.inspectWorkCounters(),producerWork:board.inspectProducerCounters()};
    const admissionAfter=board.inspectMemoryAdmission?.()??null;
    const stage=variant.stageAttribution?board.inspectStageAttribution():null;if(stage)assertStageReceipt(stage,semantic);
    return {label:variant.name,activeMS:result.activeMS,wallMS,activePeriodsPerSecond:result.periods*1000/result.activeMS,
        wallPeriodsPerSecond:result.periods*1000/wallMS,semantic,stage,admissionAtConstruction,admissionBefore,admissionAfter};
}
async function crossABIProof(base,candidate,settings){
    const optionsFor=(variant,wasmBytes)=>({enabled:true,rom:variant.createROM(settings.iterations),romLowAlias:true,wasmBytes,
        admittedGraph:true,incrementalGraph:true});
    const reject=async promise=>{try{await promise;assert.fail('mixed wrapper/Wasm pair accepted');}catch(error){
        assert.match(error.message,/ABI version mismatch/);return {name:error.name,message:error.message,code:error.code??null};}};
    return Object.freeze({newWrapperOldWasm:await reject(candidate.createBoard(optionsFor(candidate,base.wasm))),
        oldWrapperNewWasm:await reject(base.createBoard(optionsFor(base,candidate.wasm)))});
}
async function main(){
    parse(process.argv.slice(2));if(options.experimental!==true||!options['base-dir']||!options['candidate-dir']||!options['base-wasm']||!options['candidate-wasm']||!options['attribution-wasm'])throw new Error('explicit A/B and attribution inputs required');
    const settings={iterations:integer('iterations',4096,65535),warmupRounds:integer('warmup-rounds',2,10),rounds:integer('rounds',12,30),
        batchPeriods:integer('batch-periods',8192,8192),wallBudgetMS:options['wall-budget-ms']===undefined?1000:Number(options['wall-budget-ms'])};
    assert.ok(Number.isFinite(settings.wallBudgetMS)&&settings.wallBudgetMS>0&&settings.wallBudgetMS<=5000);
    const variants={base:await loadVariant('base',options['base-dir'],options['base-wasm'],BASE_REVISION),
        candidate:await loadVariant('candidate',options['candidate-dir'],options['candidate-wasm'],CANDIDATE_REVISION)};
    const crossABI=await crossABIProof(variants.base,variants.candidate,settings);
    const attribution=await loadVariant('attribution',options['candidate-dir'],options['attribution-wasm'],CANDIDATE_REVISION,true);
    const attributionProof=await sample(attribution,settings);assert.equal(attributionProof.stage.native.memoryMappingCalls,
        attributionProof.semantic.producerWork.memory.settleCalls);assert.equal(attributionProof.stage.native.memoryMappingVisits,
        attributionProof.stage.native.memoryMappingCalls*640);
    assert.equal(attributionProof.admissionAfter.runtimeMapVisits-attributionProof.admissionBefore.runtimeMapVisits,
        attributionProof.stage.native.memoryMappingVisits,'attribution-mode runtime visits equal the landed stage equation');
    const warmups=[],samples=[],paired=[];let sequence=0;const expected={};
    for(const group of interleavedOrder(settings.warmupRounds,settings.rounds)){const pair={};for(let position=0;position<2;position++){
        const value=await sample(variants[group.order[position]],settings);pair[value.label]=value;expected[value.label]??=value.semantic;
        assert.deepEqual(value.semantic,expected[value.label],`${value.label}: repeat identity`);(group.phase==='warmup'?warmups:samples).push({sequence:++sequence,...group,order:undefined,position:position+1,...value});}
        assertAdmissionReconciliation(pair.candidate.semantic,pair.base.semantic,`${group.phase} ${group.round}`);
        assertAdmissionCounters(pair.candidate.admissionAtConstruction);assertAdmissionCounters(pair.candidate.admissionBefore);
        assertAdmissionCounters(pair.candidate.admissionAfter);assert.equal(pair.base.admissionAfter,null);
        if(group.phase==='measured')paired.push({round:group.round,order:group.order,
            activeThroughputRatio:pair.candidate.activePeriodsPerSecond/pair.base.activePeriodsPerSecond,
            wallThroughputRatio:pair.candidate.wallPeriodsPerSecond/pair.base.wallPeriodsPerSecond});}
    const activeRatio=summarize(paired.map(pair=>pair.activeThroughputRatio)),wallRatio=summarize(paired.map(pair=>pair.wallThroughputRatio));
    const baseRepeatedMapVisits=expected.base.producerWork.memory.settleCalls*640;
    assert.equal(expected.base.producerWork.memory.settleCalls,143420);assert.equal(baseRepeatedMapVisits,91788800);
    const measurementDirectory=realpathSync(fileURLToPath(new URL('..',import.meta.url))),measurementRevision=git(measurementDirectory,'rev-parse','HEAD');
    assert.equal(git(measurementDirectory,'status','--porcelain'),'');
    console.log(JSON.stringify({schemaVersion:1,workload:'harris-store-loop-immutable-memory-map-admission',measurementRevision,clean:true,
        settings,host:{hostname:hostname(),platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version,loadavg:loadavg()},
        variants:{base:variants.base.provenance,candidate:variants.candidate.provenance,attribution:attribution.provenance},
        attributionProof,crossABI,removedWork:{baseSettleCalls:expected.base.producerWork.memory.settleCalls,
            visitsPerSettle:640,baseRepeatedMapVisits,candidateAdmissionVisits:112+32+496+4,candidateRuntimeMapVisits:0,
            unit:'validation visits; not elapsed-time attribution'},expected,activeRatio,wallRatio,warmups,samples,paired,
        decision:{capacityLeverAccepted:activeRatio.median>=1.10&&activeRatio.q1>=1.05&&activeRatio.min>=1,
            capacityLeverStopped:activeRatio.median<1.05,policy:'go median >=1.10, Q1 >=1.05, no pair <1.0; stop claim below median 1.05'},
        limitations:['Shared hosted timing is nondeterministic; raw pairs and dispersion remain authoritative.',
            'The candidate removes repeated immutable memory-map validation only for the explicit private admitted path.',
            'Phase/bus validation, electrical settles, preview/commit and execution defaults are unchanged.',
            'This bounded result cannot close the measured approximately 17.8x throughput gap by itself.']},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
