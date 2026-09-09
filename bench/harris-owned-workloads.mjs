/** Media-free full-board workloads. JSON receipt only; no RT/timing certification. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {cpus,platform,arch} from 'node:os';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {createOwnedWorkload,ownedWorkloads} from '../scripts/lib/harris-owned-workloads.mjs';

const rounds=Number(process.argv[2]??3),selected=process.argv[3]?process.argv[3].split(','):ownedWorkloads;
if(!Number.isSafeInteger(rounds)||rounds<1||rounds>10||selected.some(n=>!ownedWorkloads.includes(n)))throw new RangeError('rounds/workloads');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const availableModes={reference:{netBackend:'reference'},compiled:{netBackend:'compiled'},scheduled:{netBackend:'compiled',memoryScheduling:true},
    journal:{netBackend:'compiled',memoryScheduling:true,memoryWriteJournal:true},
    specialized:{netBackend:'compiled',memoryScheduling:true,decoderSpecialization:true}};
const selectedModes=process.argv[4]?process.argv[4].split(','):Object.keys(availableModes);
if(selectedModes.some(mode=>!Object.hasOwn(availableModes,mode)))throw new RangeError('workload modes');
const modes=Object.fromEntries(selectedModes.map(mode=>[mode,availableModes[mode]]));
const sources=['bench/harris-owned-workloads.mjs','scripts/lib/harris-owned-workloads.mjs','src/i8086-asm.js',
    ...['harris-80c286-memory-board','harris-80c286-bus','harris-80c286-contract','harris-80c286-boot-cpu','harris-boot-rom',
        'digital-circuit','compiled-digital-circuit','latched-memory-components','harris-8259-adapter','harris-8254-adapter',
        'harris-fdc-adapter','harris-dma-adapter','harris-keyboard-adapter','harris-memory-decoder'].map(n=>`src/experimental/${n}.js`),
    ...['devices/bus-memory','devices','i8259','i8254','i8255','i8237','upd765'].map(n=>`src/${n}.js`)];
const sourceHashes=()=>Object.fromEntries(sources.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))]));
const before=sourceHashes(),samples=[],expected=new Map();
const median=values=>{const v=[...values].sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;};
// Round -1 warms each mode/workload and grades it, but is excluded from medians.
for(let round=-1;round<rounds;round++)for(const name of selected) {
    const order=round%2?[...Object.keys(modes)].reverse():Object.keys(modes);
    for(const mode of order) {
        const f=createOwnedWorkload(name,{...modes[mode],busTraceEnabled:false});
        const start=performance.now();f.cpu.initialize();let clocks=0;
        while(!f.finished(clocks)&&clocks<100000){f.cpu.stepClock();clocks++;}
        const elapsedMS=performance.now()-start;
        assert.ok(f.finished(clocks),`${name}/${mode} budget exhausted`);f.verify();
        const memory=Object.fromEntries(f.board.memoryMap.flatMap(r=>r.chips.map(id=>{
            const {bytes,...state}=f.board.inspectMemory(id);return [id,{...state,sha256:hash(bytes)}];
        })));
        const state={clocks,cpu:f.cpu.inspect(),devices:Object.fromEntries(Object.entries(f.devices).map(([n,d])=>[n,d.inspect()])),memory};
        if(expected.has(name))assert.deepEqual(state,expected.get(name),`${name}/${mode} divergence`);else expected.set(name,state);
        const sample={round,name,mode,clocks,retired:f.cpu.retired,elapsedMS,periodsPerSecond:clocks*1000/elapsedMS,stateSHA256:hash(JSON.stringify(state))};
        if(round>=0)samples.push(sample);
        process.stderr.write(`${round<0?'warmup':round} ${name}/${mode}: ${clocks} periods, ${elapsedMS.toFixed(1)} ms\n`);
    }
}
assert.deepEqual(sourceHashes(),before,'sources changed during benchmark');
const summaries=selected.map(name=>({name,modes:Object.fromEntries(Object.keys(modes).map(mode=>{
    const group=samples.filter(s=>s.name===name&&s.mode===mode),elapsed=group.map(s=>s.elapsedMS),ms=median(elapsed);
    return [mode,{medianMS:ms,minMS:Math.min(...elapsed),maxMS:Math.max(...elapsed),periodsPerSecond:group[0].clocks*1000/ms,
        xtCapacityFactor:group[0].clocks*1000/ms/9545454}];
}))}));
console.log(JSON.stringify({benchmark:'owned-wired-full-board',node:process.version,host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCPUs:cpus().length},
    revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:new URL('..',import.meta.url)}).trim(),sourceHashes:before,
    rounds,warmupRounds:1,configurations:modes,busTraceEnabled:false,cpuHistoryEnabled:true,initializationIncluded:true,constructionIncluded:false,
    notes:['Shared-host scheduling uncontrolled.','Capacity denominator is 9545454 system periods/s, not certified complete CPU/prefetch timing.',
        'Owned synthetic sector and assembly only; no DOS boot or browser claim.','Idle is reported separately and never substituted for useful CPU/memory, I/O, DMA or interrupt work.'],summaries,samples},null,2));
