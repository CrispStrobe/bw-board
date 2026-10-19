import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {SAME_HOST_ORDERS, FROZEN_HARNESS, summarizeOrdinaryRuns, verifySameHostPair} from '../scripts/lib/same-host-orders.mjs';
const archive=new URL('../docs/receipts/2026-10-03-wasm-edge-eligibility-bool/',import.meta.url);
// Prior immutable receipts are parser fixtures, NOT evidence of new same-host repeats.
const pair=(index,node='v20.20.2')=>{
    const repeat=(node==='v20.20.2'?0:2)+(SAME_HOST_ORDERS[index]?2:1);
    const root=new URL('hosted-ab-'+repeat+'/',archive);
    return {motion:JSON.parse(readFileSync(new URL('abba.json',root))),
        f0:JSON.parse(readFileSync(new URL('f0-abba/abba.json',root))),
        stdoutFor:(i,label)=>readFileSync(new URL(`f0-abba/${i+1}-${label}/ordinary-stdout.txt`,root),'utf8')};
};
test('schedule balances both orders across early and late pairs',()=>{
    assert.deepEqual(SAME_HOST_ORDERS,[false,true,true,false]);assert(Object.isFrozen(SAME_HOST_ORDERS));
    assert.equal(FROZEN_HARNESS,'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162');
});
test('all runtime/order parser fixtures reproduce original summaries and failed floors',()=>{
    for(const node of ['v20.20.2','v22.23.3'])for(let index=0;index<4;index++){
        const fixture=pair(index,node),result=verifySameHostPair(fixture,index,node);
        assert.deepEqual(result.motion,fixture.motion.summary);assert.deepEqual(result.f0,fixture.f0.summary);
    }
    assert.equal(verifySameHostPair(pair(0),0,'v20.20.2').motion.candidate.allWindowsMeet1x,false);
});
test('wrong runtime, order, host CPU or original artifact bytes fail closed',()=>{
    for(const mutate of [p=>p.motion.node='v22.23.3',p=>p.f0.order[0]='candidate',
        p=>p.f0.cpu='different CPU',p=>p.motion.artifacts.candidate.wasmSha256='0'.repeat(64),
        p=>p.f0.artifacts.baseline.glueSha256='0'.repeat(64)]){
        const fixture=pair(0);mutate(fixture);assert.throws(()=>verifySameHostPair(fixture,0,'v20.20.2'));
    }
    assert.throws(()=>verifySameHostPair(pair(0),4,'v20.20.2'));
    assert.throws(()=>verifySameHostPair(pair(0),0,'v24.0.0'));
});
test('profiling, flags, broken guest output and altered floor summaries fail closed',()=>{
    for(const mutate of [p=>p.f0.runs[0].capture.ordinary.flags=['--liftoff-only'],
        p=>p.f0.runs[0].capture.sampled=true,p=>p.motion.runs[0].signal='SIGTERM',
        p=>p.motion.summary.candidate.allWindowsMeet1x=true,
        p=>p.stdoutFor=()=>'',p=>p.f0.runs[0].capture.buildInfo.ref='0'.repeat(40)]){
        const fixture=pair(0);mutate(fixture);assert.throws(()=>verifySameHostPair(fixture,0,'v20.20.2'));
    }
});
test('ten-window summary preserves minima and losses; missing data cannot pass',()=>{
    const runs=['baseline','candidate','candidate','baseline'].map(label=>({label,samples:Array.from({length:5},()=>({rtx:label==='candidate'?.5:2}))}));
    const summary=summarizeOrdinaryRuns(runs,r=>r.samples);assert.equal(summary.candidateMedianRatio,.25);
    assert.equal(summary.candidate.allWindowsMeet1x,false);assert.equal(summary.candidate.minimumRtx,.5);
    assert.throws(()=>summarizeOrdinaryRuns(runs.slice(1),r=>r.samples));
});
test('wrapper freezes child flags and harness and retains originals before analysis',()=>{
    const script=readFileSync(new URL('../scripts/probe-labwired-same-host-orders.mjs',import.meta.url),'utf8');
    assert(script.includes("assert.equal(process.env.GITHUB_ACTIONS, 'true'"));
    assert(script.includes('assert.deepEqual(process.execArgv, [])'));
    assert(script.includes("assert.equal(git(['rev-parse', 'HEAD']), FROZEN_HARNESS)"));
    assert(script.includes("assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '')"));
    assert(script.includes('Parser drift: '));assert(script.includes("{flag: 'wx'}"));
    assert(script.indexOf('Bind raw receipts before parsing')<script.indexOf('const parsed = verifySameHostPair'));
    for(const flag of ['--cpu-prof','--liftoff-only','--no-liftoff','--trace-wasm'])assert(!script.includes(flag));
});
test('workflow isolates runtimes, freezes artifact runs and retains failures without promotion',()=>{
    const workflow=readFileSync(new URL('../.github/workflows/labwired-same-host-orders.yml',import.meta.url),'utf8');
    assert(workflow.includes("node: ['20.20.2', '22.23.3']"));assert(workflow.includes('fail-fast: false'));
    assert(workflow.includes('ref: '+FROZEN_HARNESS));assert(workflow.includes('path: harness'));
    assert(workflow.includes("run-id: '36915940413'"));assert(workflow.includes("run-id: '37117416202'"));
    assert(workflow.includes('Retain all original receipts even on failure (no engines)\n        if: always()'));
    assert(workflow.includes('path: evidence/'));assert(!workflow.includes('contents: write'));
    assert(!workflow.includes('publish'));assert(!workflow.includes('profile-labwired'));
});
test('local wrapper cannot execute or load an engine when hosted marker is absent',()=>{
    const child=spawnSync(process.execPath,['scripts/probe-labwired-same-host-orders.mjs'],{
        cwd:new URL('../',import.meta.url),encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false'}});
    assert.equal(child.status,1);assert(child.stderr.includes('Hosted-only; never execute engines on VPS'));
});
