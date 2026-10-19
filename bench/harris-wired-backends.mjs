/** Alternating reference/indexed net backends on identical wired POST work.
 * Uses only existing local DOS inputs. Outputs a receipt, never a disk image.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const clocks=Number(process.argv[2]??10000),rounds=Number(process.argv[3]??4);
if(process.argv[4]&&process.argv[4]!=='--scheduled')throw new TypeError('expected --scheduled');
const backends=process.argv[4]?['reference','compiled','scheduled']:['reference','compiled'];
if(!Number.isSafeInteger(clocks)||clocks<1||clocks>1000000||!Number.isSafeInteger(rounds)||rounds<1||rounds>10)throw new RangeError('clocks/rounds');
const hash=b=>createHash('sha256').update(b).digest('hex');
let expected,sourceHashes;
const samples=[];
for(let round=0;round<rounds;round++) {
    const sample={round};
    for(const backend of round%2?[...backends].reverse():backends) {
        let output;
        try {output=execFileSync(process.execPath,['scripts/probe-harris-dos.mjs',String(clocks)],
            {cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,HARRIS_NET_BACKEND:backend==='scheduled'?'compiled':backend,
                HARRIS_MEMORY_SCHEDULING:backend==='scheduled'?'on':'off'},stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});}
        catch(error){if(error.status!==2)throw error;output=error.stdout;}
        const report=JSON.parse(output);
        assert.equal(report.outcome.status,'budget-exhausted');assert.equal(report.clocks,clocks);assert.equal(report.netBackend,backend==='scheduled'?'compiled':backend);
        assert.equal(report.memoryScheduling,backend==='scheduled');
        const {elapsedMS,sourceHashes:hashes,netBackend,memoryScheduling,...state}=report;
        assert.ok(state.cpu.retired>0,'no instruction progress');
        if(expected){assert.deepEqual(state,expected);assert.deepEqual(hashes,sourceHashes);}else {expected=state;sourceHashes=hashes;}
        sample[backend]={elapsedMS,stateSHA256:hash(JSON.stringify(state)),periodsPerSecond:clocks*1000/elapsedMS};
        process.stderr.write(`${round} ${backend}: ${elapsedMS} ms\n`);
    }
    samples.push(sample);
}
const median=a=>{a.sort((a,b)=>a-b);const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const medians=Object.fromEntries(backends.map(b=>[b,median(samples.map(s=>s[b].elapsedMS))]));
console.log(JSON.stringify({benchmark:'wired-POST-net-backends',node:process.version,clocks,rounds,sourceHashes,
    busTraceEnabled:expected.busTraceEnabled,memoryWriteJournal:expected.memoryWriteJournal,initializationIncluded:true,fullBoot:false,medians,throughputRatio:medians.reference/medians.compiled,
    scheduledThroughputRatio:medians.scheduled?medians.reference/medians.scheduled:undefined,samples},null,2));
