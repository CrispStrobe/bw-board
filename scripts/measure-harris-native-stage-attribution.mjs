/** Measurement-only attribution for the exact promoted native Harris hot path. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {arch,cpus,hostname,loadavg,platform} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

export const MASTER_REVISION='c3c0bbf97d7f68194b8dc5f1d0c6a423193731b0';
export const LEGACY_WORK_COUNTERS=Object.freeze(['driverComparisons','valueChangingDriverWrites','dirtyNetResolutions',
    'netDriverVisits','evaluatorRows','dependencyProbes','stagedDriverCopies','committedEvaluatorOutputs',
    'publishNetCopies','deltas','reverseIndexVisits','operationBitsetWordVisits']);
export const NATIVE_STAGES=Object.freeze(['memoryMappingCalls','memoryMappingVisits','memoryGatherCalls','memoryGatherPinRecords',
    'memoryPreviewCalls','memoryPreviewBanks','memoryPreviewStateWordCopies','memoryCommitBanks','memoryCommitStateWordCopies',
    'memoryWriterPublications','memoryPostSettles','phaseValidationCalls','phaseValidationVisits','busValidationCalls','busValidationVisits']);
const PRODUCERS=Object.freeze(['other','busExternal','busOutput','phaseController','phaseLatch','memoryBank','phaseSchedule','evaluator','fullScan']);
export const PROFILE_GATES=Object.freeze({classifiedRatio:.90,actionableRatio:.70,topFamilySamples:50,
    topFamilyShare:.10,topTwoCombinedShare:.25});
const hash=value=>createHash('sha256').update(value).digest('hex');
const median=values=>{const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const quantile=(values,q)=>{const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,l=Math.floor(p),f=p-l;return a[l]+(a[Math.min(l+1,a.length-1)]-a[l])*f;};
export function summarize(values){assert.ok(values.length,'nonempty samples');for(const v of values)assert.ok(Number.isFinite(v)&&v>0,'positive finite sample');
    const m=median(values);return {samples:values.length,median:m,mad:median(values.map(v=>Math.abs(v-m))),q1:quantile(values,.25),q3:quantile(values,.75),min:Math.min(...values),max:Math.max(...values)};}
export function rotatedOrder(round){const labels=['master','diagnosticOff','diagnosticOn'],start=(round-1)%3;return [...labels.slice(start),...labels.slice(0,start)];}
export function assertSemantic(actual,expected,label='sample'){assert.deepEqual(actual,expected,`${label}: exact semantic/work receipt`);}
export function assertStageReceipt(stage,semantic){
    assert.deepEqual(Object.keys(stage.native),[...NATIVE_STAGES],'native stage schema');
    for(const [name,value] of Object.entries(stage.native))assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff,`${name}: u32`);
    const m=semantic.producerWork.memory,n=stage.native,j=stage.js;
    assert.equal(n.memoryMappingCalls,m.settleCalls);assert.equal(n.memoryMappingVisits,n.memoryMappingCalls*640);
    assert.equal(n.memoryGatherCalls,m.passes);assert.equal(n.memoryGatherPinRecords,m.previewBanks*28);
    assert.equal(n.memoryPreviewCalls,m.previewCalls);assert.equal(n.memoryPreviewBanks,m.previewBanks);
    assert.equal(n.memoryPreviewStateWordCopies,m.previewBanks*9);assert.equal(n.memoryCommitBanks,m.previewBanks);
    assert.equal(n.memoryCommitStateWordCopies,m.previewBanks*9);
    assert.equal(n.memoryWriterPublications,semantic.producerWork.producers.memoryBank.attempts);
    assert.equal(n.memoryPostSettles,m.postMemorySettles);
    assert.equal(n.phaseValidationCalls,semantic.periods);assert.equal(n.phaseValidationVisits,semantic.periods*66);
    assert.equal(n.busValidationCalls,semantic.periods);assert.equal(n.busValidationVisits,semantic.periods*82);
    for(const value of Object.values(j))assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff,'JS stage u32');
    assert.equal(j.wasmBusSubmitEntries+1,j.completionObjects);assert.equal(j.wasmBusRunEntries,j.completionObjects);
    assert.equal(j.wasmBusInspectEntries,j.wasmBusSubmitEntries*4+j.wasmBusRunEntries);
    assert.equal(j.materializedCompletionRecordBytes,j.completionObjects*36);
}

const options={};
function parseOptions(args){for(const arg of args){const m=/^--(experimental|profile-only|classify-profile=(.+)|profile-receipt=(.+)|master-dir=(.+)|candidate-dir=(.+)|master-wasm=(.+)|off-wasm=(.+)|on-wasm=(.+)|candidate-revision=([0-9a-f]{40})|iterations=([0-9]+)|warmup-rounds=([0-9]+)|rounds=([0-9]+)|profile-repetitions=([0-9]+))$/.exec(arg);
    if(!m)throw new Error(`unknown option: ${arg}`);const [k,v]=arg.slice(2).split(/=(.*)/s);if(Object.hasOwn(options,k))throw new Error(`duplicate --${k}`);options[k]=v??true;}}
const integer=(name,fallback,max)=>{const v=options[name]===undefined?fallback:Number(options[name]);if(!Number.isSafeInteger(v)||v<1||v>max)throw new RangeError(name);return v;};
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
const moduleURL=(dir,path)=>pathToFileURL(join(dir,path)).href;
async function loadVariant(name,directory,wasmPath,revision,stageAttribution){
    directory=realpathSync(directory);wasmPath=realpathSync(wasmPath);assert.equal(git(directory,'rev-parse','HEAD'),revision,`${name}: revision`);
    assert.equal(git(directory,'status','--porcelain'),'',`${name}: clean tree`);const wasm=readFileSync(wasmPath),manifestBytes=readFileSync(join(dirname(wasmPath),'wired-net-kernel-build.json')),build=JSON.parse(manifestBytes);
    assert.equal(build.wasmSHA256,hash(wasm),`${name}: wasm receipt`);assert.equal(build.stageAttribution??false,stageAttribution,`${name}: diagnostic build mode`);
    for(const [path,digest] of Object.entries(build.sourceHashes))assert.equal(hash(readFileSync(join(directory,path))),digest,`${name}: ${path}`);
    const paths=['src/devices/bus-memory.js','src/experimental/harris-80c286-boot-cpu.js','src/experimental/harris-boot-rom.js','src/experimental/harris-native-memory-board.js','src/experimental/harris-run-transactions.js'];
    const [bus,cpu,rom,board,run]=await Promise.all(paths.map(path=>import(moduleURL(directory,path))));bus.registerBusMemory();
    return {name,directory,revision,wasm,HarrisBootCPU:cpu.HarrisBootCPU,createROM:rom.createHarrisStoreLoopROM,createBoard:board.createHarrisNativeMemoryBoard,run:run.runHarrisTransactions,stageAttribution,
        provenance:{revision,wasmSHA256:build.wasmSHA256,manifestSHA256:hash(manifestBytes),stageAttribution,compiler:build.compiler,args:build.args,sourceHashes:build.sourceHashes}};
}
function stateOf(cpu,board){const cpuState=cpu.inspect(),bus=board.inspectBus(),phase=board.inspectPhase(),lifecycle=board.inspectLifecycle(),nets=board.inspectNets();
    const memory=['rom0','rom1','ram0','ram1'].map(id=>{const {bytes,...state}=board.inspectMemory(id);return {id,...state,bytes:[...bytes]};});
    const observable={cpu:cpuState,bus,phase,lifecycle,nets,memory},componentHashes={cpu:hash(JSON.stringify(cpuState)),bus:hash(JSON.stringify(bus)),
        phase:hash(JSON.stringify(phase)),lifecycle:hash(JSON.stringify(lifecycle)),nets:hash(JSON.stringify(nets)),
        memory:Object.fromEntries(memory.map(value=>[value.id,hash(JSON.stringify(value))]))};
    return {stateHash:hash(JSON.stringify(observable)),componentHashes,physicalClock:bus.clock,retired:cpu.retired,
        writes:[memory[2].writes,memory[3].writes]};}
async function sample(v,iterations=4096){const board=await v.createBoard({enabled:true,rom:v.createROM(iterations),romLowAlias:true,wasmBytes:v.wasm,admittedGraph:true,incrementalGraph:true,
        ...(v.name==='master'?{}:{stageAttribution:v.stageAttribution})});
    const cpu=new v.HarrisBootCPU({enabled:true,board});cpu.initialize();board.resetWorkCounters();board.resetProducerCounters();if(v.stageAttribution)board.resetStageAttribution();global.gc?.();
    const start=performance.now(),result=await v.run({cpu,maxPeriods:iterations*32+100,batchPeriods:8192,wallBudgetMS:1000,yieldTask:()=>Promise.resolve()}),wallMS=performance.now()-start;
    assert.equal(result.status,'halted');assert.equal(result.chunks,1);assert.equal(cpu.retired,iterations*3+4);
    const work=board.inspectWorkCounters(),producerWork=board.inspectProducerCounters(),stage=v.stageAttribution?board.inspectStageAttribution():null,state=stateOf(cpu,board);
    assert.deepEqual(Object.keys(work),[...LEGACY_WORK_COUNTERS]);assert.deepEqual(Object.keys(producerWork.producers),[...PRODUCERS]);assert.deepEqual(state.writes,[iterations,iterations]);assert.equal(state.physicalClock,result.periods+67);
    const semantic={stateHash:state.stateHash,componentHashes:state.componentHashes,periods:result.periods,retired:state.retired,writes:state.writes,physicalClock:state.physicalClock,chunks:result.chunks,yields:0,work,producerWork};
    if(stage)assertStageReceipt(stage,semantic);return {label:v.name,activeMS:result.activeMS,wallMS,activePeriodsPerSecond:result.periods*1000/result.activeMS,semantic,stage};}
function classifyNode(frame){const f=frame.functionName||'',u=frame.url||'';
    if(f==='(idle)')return 'idle';if(f==='(garbage collector)')return 'gc';
    const exact={validate_memory_mapping:'memoryMappingValidation',gather_memory_inputs:'memoryGather',preview_memory_stage:'memoryPreview',commit_memory_stage:'memoryCommit',publish_memory_writers:'memoryWriterPublication',post_memory_settle:'memoryPostSettle',validate_phase_mapping:'phaseValidation',validate_bus_mapping:'busValidation'};
    const memory=new Set(['settle_memory_circuit','preview_memory_banks','preview_owned_memory_banks','known_memory']);
    const net=new Set(['settle_incremental_context','resolve_dirty','publish_incremental','settle_owned_context','admit_owned_context',
        'resolve_nets','resolve_valid','evaluate_owned_operations_marked_sparse','evaluate_operation','write_driver','write_owned_driver','write_owned_driver_tagged']);
    const busPhase=new Set(['run_bus_memory_until_completion','begin_bus_memory_clock','end_bus_memory_clock','validate_bus_mapping','gather','bus_begin','bus_end','bus_submit','bus_inspect','bus_output_ptr',
        'begin_latched_memory_clock','preview_latched_memory_clock','finish_latched_memory_clock','settle_phase_nets','gather_phase','publish_controller',
        'begin_memory_phase','preview_memory_phase_end','finish_memory_phase','update_address_latch','phase_commands','phase_decode']);
    if(u.startsWith('wasm://')){if(exact[f])return exact[f];if(memory.has(f))return 'nativeMemoryOrchestration';if(net.has(f))return 'nativeNetKernel';if(busPhase.has(f))return 'nativeBusAndPhase';return 'unclassified';}
    if(u.includes('harris-80c286-boot-cpu.js'))return 'jsCPU';if(u.includes('bus-circuit-image.js')||u.includes('memory-circuit.js')||u.includes('harris-native-memory-board.js'))return 'jsWasmEntriesAndReceipt';
    if(u.includes('harris-run-transactions.js'))return 'cooperativeControl';if(u.includes('measure-harris-native-stage-attribution.mjs'))return 'measurementHarness';
    if(u.includes('/src/'))return 'fixtureAndModelOther';if(f.startsWith('js-to-wasm'))return 'wasmEntryTrampoline';
    if(u.startsWith('node:')||u.includes('/internal/')||['(program)','(root)','compileForInternalLoader','compileFunction',
        'getPackageScopeConfig','lstat','read','parse','now','get buffer'].includes(f))return 'nodeRuntime';return 'unclassified';}
const ACTIONABLE_FAMILY=Object.freeze({memoryMappingValidation:'nativeMemory',memoryGather:'nativeMemory',memoryPreview:'nativeMemory',memoryCommit:'nativeMemory',memoryWriterPublication:'nativeMemory',memoryPostSettle:'nativeMemory',nativeMemoryOrchestration:'nativeMemory',
    nativeNetKernel:'nativeNetKernel',phaseValidation:'nativeBusAndPhase',busValidation:'nativeBusAndPhase',nativeBusAndPhase:'nativeBusAndPhase',jsCPU:'jsCPU',jsWasmEntriesAndReceipt:'jsWasmBoundary',wasmEntryTrampoline:'jsWasmBoundary',cooperativeControl:'cooperativeControl'});
export function classifyProfile(profile){const nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame])),counts={},families={};for(const id of profile.samples??[]){const category=classifyNode(nodes.get(id)??{});counts[category]=(counts[category]??0)+1;const family=ACTIONABLE_FAMILY[category];if(family)families[family]=(families[family]??0)+1;}
    const total=(profile.samples??[]).length,idle=counts.idle??0,gc=counts.gc??0,nonIdle=total-idle-gc,unclassified=counts.unclassified??0,classified=nonIdle-unclassified,ratio=nonIdle?classified/nonIdle:0;
    const actionableRanking=Object.entries(families).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([family,samples])=>({family,samples}));
    const actionableSamples=Object.values(families).reduce((sum,value)=>sum+value,0),actionableRatio=nonIdle?actionableSamples/nonIdle:0;
    const topTwoActionable=actionableRanking.slice(0,2).map(x=>({...x,shareOfNonIdle:nonIdle?x.samples/nonIdle:0}));
    return {totalSamples:total,idleSamples:idle,gcSamples:gc,nonIdleSamples:nonIdle,classifiedSamples:classified,classifiedRatio:ratio,categories:counts,
        actionableSamples,actionableRatio,actionableFamilies:families,actionableRanking,topTwoActionable,
        topTwoCombinedShare:topTwoActionable.reduce((sum,x)=>sum+x.shareOfNonIdle,0),topTwoActionableFamilies:topTwoActionable.map(x=>x.family)};}
export function assertProfileGates(value){assert.ok(value.classifiedRatio>=PROFILE_GATES.classifiedRatio,'less than 90% of non-idle/non-GC samples classified');
    assert.ok(value.actionableRatio>=PROFILE_GATES.actionableRatio,'less than 70% actionable attribution');assert.equal(value.topTwoActionable.length,2,'two actionable families required');
    for(const family of value.topTwoActionable){assert.ok(family.samples>=PROFILE_GATES.topFamilySamples,'top family sample minimum');assert.ok(family.shareOfNonIdle>=PROFILE_GATES.topFamilyShare,'top family share minimum');}
    assert.ok(value.topTwoCombinedShare>=PROFILE_GATES.topTwoCombinedShare,'top-two combined share minimum');}
async function main(){parseOptions(process.argv.slice(2));if(options['classify-profile']){const profile=JSON.parse(readFileSync(options['classify-profile'])),receipt=JSON.parse(readFileSync(options['profile-receipt']));const classification=classifyProfile(profile);assert.ok(receipt.samples?.length,'profile receipt');assertProfileGates(classification);console.log(JSON.stringify({schemaVersion:1,profileReceipt:receipt,profileGates:PROFILE_GATES,classification,limitations:['Leaf samples are assigned once; inclusive stacks are not summed. Idle and garbage-collector samples are disclosed and excluded from the classification denominator.','Runtime, harness and fixture-construction samples contribute to overall classification only; they never contribute to actionableSamples or actionableRatio.']},null,2));return;}
    assert.equal(options.experimental,true,'--experimental required');const candidate=options['candidate-revision'];assert.match(candidate??'',/^[0-9a-f]{40}$/);const iterations=integer('iterations',4096,65535);
    const master=await loadVariant('master',options['master-dir'],options['master-wasm'],MASTER_REVISION,false),off=await loadVariant('diagnosticOff',options['candidate-dir'],options['off-wasm'],candidate,false),on=await loadVariant('diagnosticOn',options['candidate-dir'],options['on-wasm'],candidate,true);
    if(options['profile-only']){const repetitions=integer('profile-repetitions',6,20),samples=[];let expected=null;for(let i=0;i<repetitions;i++){const value=await sample(on,iterations);expected??=value.semantic;assertSemantic(value.semantic,expected,`profile ${i+1}`);samples.push(value);}
        console.log(JSON.stringify({schemaVersion:1,mode:'diagnostic-profile',revision:candidate,iterations,repetitions,expected,samples},null,2));return;}
    const warmupRounds=integer('warmup-rounds',3,9),rounds=integer('rounds',12,30),variants={master,diagnosticOff:off,diagnosticOn:on},warmups=[],samples=[];let expected=null,sequence=0;
    for(let round=1;round<=warmupRounds+rounds;round++){const phase=round<=warmupRounds?'warmup':'measured',ordinal=phase==='warmup'?round:round-warmupRounds;for(let position=0;position<3;position++){const label=rotatedOrder(round)[position],value=await sample(variants[label],iterations);expected??=value.semantic;assertSemantic(value.semantic,expected,`${phase} ${ordinal} ${label}`);(phase==='warmup'?warmups:samples).push({sequence:++sequence,phase,round:ordinal,position:position+1,...value});}}
    const metrics=Object.fromEntries(Object.keys(variants).map(label=>[label,summarize(samples.filter(s=>s.label===label).map(s=>s.activePeriodsPerSecond))]));
    const ratios={candidateOffToMaster:metrics.diagnosticOff.median/metrics.master.median,diagnosticOnToOff:metrics.diagnosticOn.median/metrics.diagnosticOff.median};
    for(const [name,value] of Object.entries(ratios))assert.ok(value>=.98&&value<=1.02,`${name} outside 0.98..1.02`);
    const root=realpathSync(fileURLToPath(new URL('..',import.meta.url)));assert.equal(git(root,'rev-parse','HEAD'),candidate);assert.equal(git(root,'status','--porcelain'),'');
    console.log(JSON.stringify({schemaVersion:1,workload:'owned-harris-store-loop-memory-only-admitted-incremental-native-stage-attribution',measurementRevision:candidate,clean:true,settings:{iterations,warmupRounds,rounds,batchPeriods:8192,wallBudgetMS:1000},host:{hostname:hostname(),platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version,loadavg:loadavg()},variants:Object.fromEntries(Object.entries(variants).map(([k,v])=>[k,v.provenance])),expected,metrics,ratios,warmups,samples,limitations:['Diagnostic counters wrap modulo 2^32 and preserve all existing counter layouts and meanings.','Master, diagnostics-off candidate, and diagnostics-on candidate run in rotating same-job order; shared-host timing remains nondeterministic.','CPU profiling runs in a separate process and is never used as the uninstrumented control.','Memory-only workload; no DOS, peripherals, browser capacity, optimization, or default-change claim.']},null,2));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
