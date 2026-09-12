/** Hosted mutation proof for dedicated incremental-stage profile names. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {STAGES,classify} from './classify-harris-native-incremental-stages.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const WORK=Object.freeze(['driverComparisons','valueChangingDriverWrites','dirtyNetResolutions','netDriverVisits','evaluatorRows','dependencyProbes','stagedDriverCopies','committedEvaluatorOutputs','publishNetCopies','deltas','reverseIndexVisits','operationBitsetWordVisits']);
const hash=value=>createHash('sha256').update(value).digest('hex');
export const MUTATIONS=Object.freeze([
    ['resolve dirty','RESOLVE_DIRTY','incremental_stage_resolve_dirty'],
    ['mark affected operations','MARK_AFFECTED','incremental_stage_mark_affected_operations'],
    ['evaluate and stage sparse outputs','EVALUATE_SPARSE','incremental_stage_evaluate_and_stage_sparse_outputs'],
    ['publish successful fixpoint','PUBLISH_INCREMENTAL','incremental_stage_publish_successful_fixpoint'],
].map(([name,selector,target],index)=>Object.freeze({name,selector,target,unknown:`incremental_stage_unknown_${index}`})));

async function mutantProfileChild(wasmPath,receiptPath){
    const iterations=4096,wasmBytes=readFileSync(wasmPath);
    const [bus,cpu,rom,board,run]=await Promise.all([
        import('../src/devices/bus-memory.js'),import('../src/experimental/harris-80c286-boot-cpu.js'),
        import('../src/experimental/harris-boot-rom.js'),import('../src/experimental/harris-native-memory-board.js'),
        import('../src/experimental/harris-run-transactions.js')]);
    bus.registerBusMemory();
    let expected=null;
    for(let repetition=0;repetition<4;repetition++){
        const memory=await board.createHarrisNativeMemoryBoard({enabled:true,rom:rom.createHarrisStoreLoopROM(iterations),romLowAlias:true,wasmBytes,admittedGraph:true,incrementalGraph:true});
        const processor=new cpu.HarrisBootCPU({enabled:true,board:memory});processor.initialize();memory.resetWorkCounters();
        const result=await run.runHarrisTransactions({cpu:processor,maxPeriods:iterations*32+100,batchPeriods:8192,wallBudgetMS:1000,yieldTask:()=>Promise.resolve()});
        assert.equal(result.status,'halted');assert.equal(result.chunks,1);
        const banks=['rom0','rom1','ram0','ram1'].map(id=>{const{bytes,...rest}=memory.inspectMemory(id);return{id,...rest,bytes:[...bytes]}});
        const semantic={stateHash:hash(JSON.stringify({cpu:processor.inspect(),bus:memory.inspectBus(),phase:memory.inspectPhase(),lifecycle:memory.inspectLifecycle(),nets:memory.inspectNets(),banks})),periods:result.periods,retired:processor.retired,writes:[banks[2].writes,banks[3].writes],physicalClock:memory.inspectBus().clock,work:memory.inspectWorkCounters()};
        assert.deepEqual(Object.keys(semantic.work),[...WORK]);assert.equal(semantic.retired,iterations*3+4);assert.deepEqual(semantic.writes,[iterations,iterations]);assert.equal(semantic.physicalClock,result.periods+67);
        expected??=semantic;assert.deepEqual(semantic,expected);
    }
    writeFileSync(receiptPath,JSON.stringify({schemaVersion:1,iterations,repetitions:4,wasmSHA256:hash(wasmBytes),semantic:expected},null,2)+'\n',{flag:'wx'});
}

async function main(){
    const receiptOption=process.argv.find(arg=>arg.startsWith('--receipt-dir='));
    assert.ok(receiptOption,'--receipt-dir required');
    const receiptDir=realpathSync(receiptOption.slice('--receipt-dir='.length));
    let expectedSemantic=null;
    for(const mutation of MUTATIONS){
        const sandbox=mkdtempSync(join(tmpdir(),'harris-incremental-stage-mutant.'));
        try{
            mkdirSync(join(sandbox,'scripts'),{recursive:true});
            mkdirSync(join(sandbox,'src/experimental'),{recursive:true});
            cpSync(join(root,'src/experimental/wired-kernel'),join(sandbox,'src/experimental/wired-kernel'),{recursive:true});
            cpSync(join(root,'scripts/build-wired-net-kernel.mjs'),join(sandbox,'scripts/build-wired-net-kernel.mjs'));
            const path=join(sandbox,'src/experimental/wired-kernel/incremental-nets.c');
            const source=readFileSync(path,'utf8');
            const from=`#define ${mutation.selector} ${mutation.target}`;
            const to=`#define ${mutation.selector} ${mutation.unknown}`;
            assert.equal(source.split(from).length-1,1,`${mutation.name} exact selector`);
            writeFileSync(path,source.replace(from,to));
            const build=join(sandbox,'build');mkdirSync(build);
            execFileSync(process.execPath,[join(sandbox,'scripts/build-wired-net-kernel.mjs'),build],{
                env:{...process.env,NATIVE_INCREMENTAL_STAGE_PROFILE_NAMING:'1'},stdio:'pipe'});
            const wasm=readFileSync(join(build,'wired-net-kernel.wasm'));
            assert.ok(wasm.includes(Buffer.from(mutation.unknown)),`${mutation.name} mutant name emitted`);
            assert.equal(wasm.includes(Buffer.from(mutation.target)),false,`${mutation.name} expected name removed`);
            const slug=mutation.selector.toLowerCase().replaceAll('_','-');
            const profilePath=join(receiptDir,`mutant-${slug}.cpuprofile`),receiptPath=join(receiptDir,`mutant-${slug}.json`);
            execFileSync(process.execPath,['--cpu-prof','--cpu-prof-interval=100',`--cpu-prof-dir=${receiptDir}`,`--cpu-prof-name=mutant-${slug}.cpuprofile`,fileURLToPath(import.meta.url),'--mutant-profile-child',join(build,'wired-net-kernel.wasm'),receiptPath],{cwd:root,stdio:'pipe'});
            const profile=JSON.parse(readFileSync(profilePath)),receipt=JSON.parse(readFileSync(receiptPath));
            expectedSemantic??=receipt.semantic;assert.deepEqual(receipt.semantic,expectedSemantic,`${mutation.name} exact workload`);
            const functions=new Set(profile.nodes.map(node=>node.callFrame.functionName));
            assert.equal(functions.has(mutation.target),false,`${mutation.name} expected profile name absent`);
            assert.equal(functions.has(mutation.unknown),true,`${mutation.name} unknown profile name emitted`);
            assert.deepEqual([...functions].filter(name=>name.startsWith('incremental_stage_')).sort(),[...STAGES.filter(name=>name!==mutation.target),mutation.unknown].sort(),`${mutation.name} exact dedicated names`);
            assert.throws(()=>classify(profile),new RegExp(`unknown incremental stage ${mutation.unknown}`));
            writeFileSync(receiptPath,JSON.stringify({...receipt,mutation:{name:mutation.name,selector:mutation.selector,target:mutation.target,unknown:mutation.unknown},profileSamples:profile.samples.length},null,2)+'\n');
            console.log(`# mutation rejected: ${mutation.name}`);
        }finally{rmSync(sandbox,{recursive:true,force:true});}
    }
    console.log(`# mutations rejected: ${MUTATIONS.length}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
    if(process.argv[2]==='--mutant-profile-child')await mutantProfileChild(process.argv[3],process.argv[4]);
    else await main();
}
