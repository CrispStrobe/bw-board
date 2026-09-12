/** Synthetic resolver-only benchmark, NOT emulator real-time throughput.
 * Run from any directory: node bench/harris-net-resolve.mjs
 * Requires local Git history containing the explicitly pinned baseline.
 */
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {DigitalCircuit} from '../src/experimental/digital-circuit.js';

const baselineCommit='c658507c0912375d45926be5450b2d48c77f7d9a';
const source=execFileSync('git',['show',`${baselineCommit}:src/experimental/digital-circuit.js`],
    {cwd:new URL('..',import.meta.url),encoding:'utf8'});
const {DigitalCircuit:Previous}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const hash=s=>createHash('sha256').update(s).digest('hex');
const parts=Array.from({length:256},(_,i)=>({id:`p${i}`,pins:['a','b','c','d'],outputs:['a','b','c','d']}));
const wires=parts.slice(1).flatMap((p,i)=>['a','b'].map(pin=>
    ({from:parts[i].id,fromTerminal:pin,to:p.id,toTerminal:pin})));
const current=new DigitalCircuit({enabled:true,parts,wires}),previous=new Previous({enabled:true,parts,wires});
for(const c of [previous,current])for(const p of parts)c.drive(p.id,{a:1,b:0,c:1,d:'Z'});
assert.deepEqual(current.resolve(),previous.resolve());
console.log(JSON.stringify({benchmark:'synthetic-resolver-only',baselineCommit,node:process.version,
    previousSHA256:hash(source),currentSHA256:hash(readFileSync(new URL('../src/experimental/digital-circuit.js',import.meta.url))),
    parts:256,nets:514,iterations:10000,rounds:4,emulatorThroughput:false}));
for(let round=0;round<4;round++) {
    const results={};
    const order=round%2?[['current',current],['previous',previous]]:[['previous',previous],['current',current]];
    for(const [name,c] of order) {
        let checksum=0;const start=performance.now();
        for(let i=0;i<10000;i++)checksum+=c.resolve().size;
        results[name]={ms:performance.now()-start,checksum};
        assert.equal(checksum,5140000);
    }
    console.log(JSON.stringify({round,...results}));
}
