/** Same 10,000-clock wired POST workload, alternating pinned/current sources.
 * Local DOS inputs only; no media is written or included in the receipt.
 * This is startup throughput, NOT a whole-boot or real-time-speed benchmark.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const cwd=new URL('..',import.meta.url);
const baselineCommit='068fe702cede16fd339f5824082fe8f91b70e4be';
const files=['digital-circuit.js','latched-memory-components.js','harris-80c286-bus.js',
    'harris-dma-adapter.js','harris-fdc-adapter.js','harris-keyboard-adapter.js',
    'harris-8259-adapter.js','harris-8254-adapter.js'].map(file=>`src/experimental/${file}`);
const hash=s=>createHash('sha256').update(s).digest('hex');
const baselineSHA=execFileSync('git',['rev-parse',baselineCommit],{cwd,encoding:'utf8'}).trim();
const previous=files.map(file=>execFileSync('git',['show',`${baselineSHA}:${file}`],{cwd,encoding:'utf8'}));
const sourceHashes=Object.fromEntries(files.map((file,i)=>[file,{previous:hash(previous[i]),current:hash(readFileSync(new URL(file,cwd)))}]));
const sources=Object.fromEntries(files.map((file,i)=>[new URL(file,cwd).href,previous[i]]));
// Module substitution avoids editing the worktree or disturbing a running guest.
const loader=`const sources=${JSON.stringify(sources)};export async function load(url,context,next){return Object.hasOwn(sources,url)?{format:'module',source:sources[url],shortCircuit:true}:next(url,context);}`;
const url=`data:text/javascript;base64,${Buffer.from(loader).toString('base64')}`;
const receipt={benchmark:'wired-POST-first-10000-clocks',baselineSHA,node:process.version,sourceHashes,rounds:[],fullBoot:false};
let reference;
for(let round=0;round<4;round++) {
    const results={};
    for(const name of round%2?['current','previous']:['previous','current']) {
        const args=[...(name==='previous'?['--loader',url]:[]),'scripts/probe-harris-dos.mjs','10000'];
        let stdout;
        try{stdout=execFileSync(process.execPath,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});}
        catch(error){if(error.status!==2)throw error;stdout=error.stdout;}
        const report=JSON.parse(stdout);
        assert.equal(report.outcome.status,'budget-exhausted');assert.equal(report.clocks,10000);
        const {elapsedMS,sourceHashes:ignored,...state}=report;
        if(reference)assert.deepEqual(state,reference);else reference=state;
        results[name]={elapsedMS,stateSHA256:hash(JSON.stringify(state))};
        process.stderr.write(`${round} ${name}: ${elapsedMS} ms\n`);
    }
    receipt.rounds.push({round,...results});
}
console.log(JSON.stringify(receipt,null,2));
