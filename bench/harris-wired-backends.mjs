/** Alternating reference/indexed net backends on identical wired POST work.
 * Uses only existing local DOS inputs. Outputs a receipt, never a disk image.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const clocks=Number(process.argv[2]??10000),rounds=Number(process.argv[3]??4);
if(!Number.isSafeInteger(clocks)||clocks<1||clocks>1000000||!Number.isSafeInteger(rounds)||rounds<1||rounds>10)throw new RangeError('clocks/rounds');
const hash=b=>createHash('sha256').update(b).digest('hex');
let expected,sourceHashes;
const samples=[];
for(let round=0;round<rounds;round++) {
    const sample={round};
    for(const backend of round%2?['compiled','reference']:['reference','compiled']) {
        let output;
        try {output=execFileSync(process.execPath,['scripts/probe-harris-dos.mjs',String(clocks)],
            {cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,HARRIS_NET_BACKEND:backend},stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});}
        catch(error){if(error.status!==2)throw error;output=error.stdout;}
        const report=JSON.parse(output);
        assert.equal(report.outcome.status,'budget-exhausted');assert.equal(report.clocks,clocks);assert.equal(report.netBackend,backend);
        const {elapsedMS,sourceHashes:hashes,netBackend,...state}=report;
        assert.ok(state.cpu.retired>0,'no instruction progress');
        if(expected){assert.deepEqual(state,expected);assert.deepEqual(hashes,sourceHashes);}else {expected=state;sourceHashes=hashes;}
        sample[backend]={elapsedMS,stateSHA256:hash(JSON.stringify(state)),periodsPerSecond:clocks*1000/elapsedMS};
        process.stderr.write(`${round} ${backend}: ${elapsedMS} ms\n`);
    }
    samples.push(sample);
}
const median=a=>{a.sort((a,b)=>a-b);const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const medians=Object.fromEntries(['reference','compiled'].map(b=>[b,median(samples.map(s=>s[b].elapsedMS))]));
console.log(JSON.stringify({benchmark:'wired-POST-net-backends',node:process.version,clocks,rounds,sourceHashes,
    initializationIncluded:true,fullBoot:false,medians,throughputRatio:medians.reference/medians.compiled,samples},null,2));
