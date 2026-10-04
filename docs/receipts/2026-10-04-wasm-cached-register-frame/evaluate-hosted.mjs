// Hosted-only evaluation: never download/compile/profile/run engine binaries on this VPS.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync, writeFileSync, mkdirSync, existsSync, statfsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {motionProbeResult, assertSameMotionGuest, median} from '/mnt/volume1/code/lego/cp13-motion-board-20261001/scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from '/mnt/volume1/code/lego/cp13-motion-board-20261001/scripts/lib/f0-timing-receipt.mjs';

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const repo = 'CrispStrobe/bw-board';
const toolRef = 'perf/register-inline-node-control-20261002';
const toolHead = 'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162';
const config = JSON.parse(readFileSync(join(root,'config.json')));
const {sources,nativeRun} = config;
for (const source of Object.values(sources)) {
    assert(Number.isSafeInteger(source.run) && source.run > 0);
    assert(/^[a-f0-9]{40}$/.test(source.commit));
    assert(/^[a-f0-9]{40}$/.test(source.toolHead));
    assert(Number.isSafeInteger(source.integrationTests) && source.integrationTests >= 101);
}
assert(Number.isSafeInteger(nativeRun) && nativeRun > 0);
const gh = async args => (await exec('gh', args, {encoding:'utf8', timeout:120_000, maxBuffer:8*1024*1024})).stdout;
const readGh = async args => {
    for (let attempt=0; ; attempt++) {
        try { return await gh(args); }
        catch (error) {
            if (attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
};
const watch = async id => {
    const deadline = Date.now() + 3*60*60*1000;
    while (Date.now() < deadline) {
        const run = JSON.parse(await readGh(['run','view',String(id),'-R',repo,'--json','status,conclusion']));
        if (run.status === 'completed') return;
        await new Promise(resolve => setTimeout(resolve, 45_000));
    }
    throw Error('Read-only monitor deadline exceeded; inspect existing run, do not redispatch');
};
function jobsFor(run, source) {
    assert.equal(run.headSha, source.toolHead);
    assert.equal(run.status, 'completed');
    const jobs = new Map(run.jobs.map(job => [job.name, job]));
    for (const name of ['build (a)','build (b)','determinism','test']) assert.equal(jobs.get(name)?.conclusion, 'success', name);
    assert.equal(jobs.get('publish')?.conclusion, 'skipped');
    assert(['success','failure'].includes(jobs.get('motion')?.conclusion));
    assert.equal(run.conclusion, jobs.get('motion').conclusion === 'failure' ? 'failure' : 'success');
    return jobs;
}
function integrationCount(log, source) {
    const counts=log.match(/^tests=(\d+) fail=(\d+) skipped=(\d+)\s*$/m);
    assert(counts && Number(counts[1])===source.integrationTests && counts[2]==='0' && counts[3]==='0','Exact integration count required');
    for (const [name,count] of [['tests',source.integrationTests],['pass',source.integrationTests],['fail',0],['skipped',0],['cancelled',0],['todo',0]]) {
        assert.match(log,new RegExp(`^# ${name} ${count}$`,'m'));
    }
    return Number(counts[1]);
}
function buildInfoFrom(log, source) {
    const matches = [...log.matchAll(/^\{\n[\s\S]*?^\}$/gm)].map(match => {
        try { return JSON.parse(match[0]); } catch { return null; }
    }).filter(info => info?.ref === source.commit && info.targets?.nodejs && info.targets?.web);
    assert.equal(matches.length, 1, 'Expected one reported build manifest for exact source');
    const info = matches[0];
    assert.equal(info.postprocess, undefined);
    for (const target of ['nodejs','web']) for (const name of ['labwired_wasm.js','labwired_wasm_bg.wasm']) {
        const file = info.targets[target][name];
        assert(/^[a-f0-9]{64}$/.test(file.sha256));
        assert(Number.isSafeInteger(file.bytes) && file.bytes > 0);
    }
    return info;
}
const combined = samples => ({samples:samples.length, medianRtx:median(samples.map(s=>s.rtx)),
    minimumRtx:Math.min(...samples.map(s=>s.rtx)), allWindowsMeet1x:samples.every(s=>s.rtx>=1)});
function summary(runs, samples) {
    const result = {};
    for (const label of ['baseline','candidate']) {
        result[label] = combined(runs.filter(r=>r.label===label).flatMap(samples));
        assert.equal(result[label].samples, 10);
    }
    result.candidateMedianRatio = result.candidate.medianRtx / result.baseline.medianRtx;
    return result;
}
function verifyComparison(directory, comparison, verifications) {
    const json = path => JSON.parse(readFileSync(join(directory,path)));
    const motion = json('abba.json'), f0 = json('f0-abba/abba.json');
    const order = comparison.reverse ? ['candidate','baseline','baseline','candidate'] : ['baseline','candidate','candidate','baseline'];
    for (const receipt of [motion,f0]) {
        assert.equal(receipt.node, `v${comparison.nodeVersion}`);
        assert.equal(receipt.diagnosticOnly, true);
        assert.equal(receipt.guestObservationsMatch, true);
        assert.deepEqual(receipt.order, order);
        assert.deepEqual(receipt.runs.map(r=>r.label), order);
        for (const label of ['baseline','candidate']) {
            const files = verifications[label].buildInfo.targets.nodejs;
            assert.equal(receipt.artifacts[label].wasmSha256, files['labwired_wasm_bg.wasm'].sha256);
            assert.equal(receipt.artifacts[label].glueSha256, files['labwired_wasm.js'].sha256);
        }
    }
    const parsedMotion = motion.runs.map(run => {
        assert.equal(run.signal, null);
        const parsed = motionProbeResult(run.stdout,run.exitCode);
        for (const [key,value] of Object.entries(parsed)) assert.deepEqual(run[key],value);
        return parsed;
    });
    parsedMotion.slice(1).forEach(parsed=>assertSameMotionGuest(parsedMotion[0],parsed));
    assert.deepEqual(summary(motion.runs,r=>r.samples),motion.summary);
    const parsedF0 = f0.runs.map((run,index)=>{
        assert.equal(run.exitCode,0);
        assert.equal(run.signal,null);
        const capture = run.capture, ordinary = capture.ordinary;
        assert.equal(capture.node,`v${comparison.nodeVersion}`);
        assert.deepEqual(capture.buildInfo,verifications[run.label].buildInfo);
        assert.deepEqual(ordinary.flags,[]);
        assert.equal(capture.profiling,undefined);
        const parsed = f0TimingResult(readFileSync(join(directory,`f0-abba/${index+1}-${run.label}/ordinary-stdout.txt`),'utf8'),ordinary.exitCode);
        assert.deepEqual(parsed.workloads,ordinary.workloads);
        assert.equal(parsed.allWindowsMeet1x,ordinary.allWindowsMeet1x);
        return parsed;
    });
    parsedF0.slice(1).forEach(parsed=>assertSameF0Guest(parsedF0[0],parsed));
    for (const workload of ['ram','gpio']) assert.deepEqual(summary(f0.runs,r=>r.capture.ordinary.workloads[workload].samples),f0.summary[workload]);
    for (const label of ['baseline','candidate']) assert.deepEqual(json(`${label}-build-info.json`),verifications[label].buildInfo);
    return {summary:motion.summary,f0Summary:f0.summary};
}
if (process.argv.includes('--self-test')) {
    const names = ['build (a)','build (b)','determinism','test','motion','publish'];
    const good = {headSha:sources.candidate.toolHead,status:'completed',conclusion:'failure',jobs:names.map(name=>({name,
        conclusion:name==='publish'?'skipped':name==='motion'?'failure':'success'}))};
    jobsFor(good,sources.candidate);
    for (const name of names) assert.throws(()=>jobsFor({...good,jobs:good.jobs.filter(j=>j.name!==name)},sources.candidate));
    assert.throws(()=>jobsFor({...good,headSha:'changed'},sources.candidate));
    assert.throws(()=>jobsFor({...good,status:'in_progress'},sources.candidate));
    assert.throws(()=>jobsFor({...good,jobs:good.jobs.map(j=>j.name==='publish'?{...j,conclusion:'success'}:j)},sources.candidate));
    const text = JSON.stringify({ref:sources.candidate.commit,targets:Object.fromEntries(['nodejs','web'].map(target=>[target,
        Object.fromEntries(['labwired_wasm.js','labwired_wasm_bg.wasm'].map(name=>[name,{bytes:1,sha256:'a'.repeat(64)}]))]))},null,2);
    buildInfoFrom(text,sources.candidate);
    assert.throws(()=>buildInfoFrom(text,sources.baseline));
    assert.throws(()=>buildInfoFrom(text+'\n'+text,sources.candidate));
    const countLog=n=>`tests=${n} fail=0 skipped=0\n# tests ${n}\n# pass ${n}\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n`;
    for (const label of ['baseline','candidate']) {
        integrationCount(countLog(sources[label].integrationTests),sources[label]);
        assert.throws(()=>integrationCount(countLog(sources[label].integrationTests-1),sources[label]));
        assert.throws(()=>integrationCount(countLog(sources[label].integrationTests).replace('# todo 0','# todo 1'),sources[label]));
    }
    console.log('Hosted pipeline guard tests pass; synthetic fixtures are NOT timing evidence.');
    process.exit(0);
}
const statePath = join(root,'pipeline.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath)) : {
    schema:1,diagnosticOnly:true,hostedOnly:true,localEngineArtifactDownloads:false,
    startedAt:new Date().toISOString(),toolHead,sources,verifications:{},comparisons:[],
    automaticMerge:false,publication:false,appPinChanges:false
};
assert.deepEqual(state.sources,sources);
assert.equal(state.toolHead,toolHead);
assert.equal(state.automaticMerge,false);
assert.equal(state.publication,false);
assert.equal(state.appPinChanges,false);
assert.equal(state.hostedOnly,true);
assert.equal(state.localEngineArtifactDownloads,false);
assert(!state.error,'Inspect failed state; no automatic retry of ambiguous dispatch');
assert(!state.dispatchPending,'Ambiguous dispatch: inspect remote before retry');
const save = ()=>writeFileSync(statePath,JSON.stringify(state,null,2)+'\n');
const logFor = async(job,path)=>{
    const raw = await readGh(['api',`repos/${repo}/actions/jobs/${job.databaseId}/logs`]);
    const output = join(root,path);
    if (existsSync(output)) assert.equal(readFileSync(output,'utf8'),raw,'Existing raw log changed; do not overwrite');
    else writeFileSync(output,raw);
    return raw.split('\n').map(line=>line.replace(/^\d{4}-\d\d-\d\dT\S+ /,'')).join('\n');
};
try {
    save();
    const native = JSON.parse(await readGh(['run','view',String(nativeRun),'-R','CrispStrobe/labwired-core','--json','status,conclusion,headSha,jobs,url']));
    assert.equal(native.headSha,sources.candidate.commit);
    assert.equal(native.status,'completed');
    assert.equal(native.conclusion,'success');
    state.nativeCorrectness=native;
    save();
    const nativePath=join(root,'source-ci.json'),nativeText=JSON.stringify(native,null,2)+'\n';
    if(existsSync(nativePath)) assert.equal(readFileSync(nativePath,'utf8'),nativeText);
    else writeFileSync(nativePath,nativeText);
    for (const [label,source] of Object.entries(sources)) {
        if (state.verifications[label]) continue;
        console.log(`Watching existing ${label} build ${source.run}; no engine artifact download to VPS.`);
        await watch(source.run);
        const run = JSON.parse(await readGh(['run','view',String(source.run),'-R',repo,'--json','status,conclusion,headSha,jobs,url']));
        const jobs = jobsFor(run,source);
        const infos = [];
        for (const leg of ['a','b']) infos.push(buildInfoFrom(await logFor(jobs.get(`build (${leg})`),`${label}-build-${leg}.txt`),source));
        assert.deepEqual(infos[0].targets,infos[1].targets,'Independent module/glue declarations must agree');
        const integration = await logFor(jobs.get('test'),`${label}-integration.txt`);
        const integrationTests = integrationCount(integration,source);
        const qualification = motionProbeResult(await logFor(jobs.get('motion'),`${label}-qualification.txt`),jobs.get('motion').conclusion==='success'?0:1);
        state.verifications[label]={run,buildInfo:infos[1],integrationTests,qualification,
            byteVerification:'independent-build CI determinism; paired runner verifies original bytes before timing'};
        if (label==='candidate') assert.notEqual(infos[1].targets.nodejs['labwired_wasm_bg.wasm'].sha256,state.verifications.baseline.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256);
        save();
        console.log(`${label} verified; fresh floor=${qualification.allWindowsMeet1x}, median=${qualification.medianRtx}, minimum=${qualification.minimumRtx}`);
    }
    for (let repeat=1;repeat<=4;repeat++) {
        const nodeVersion=repeat<=2?'20.20.2':'22.23.3',reverse=repeat%2===0;
        assert.equal((await readGh(['api',`repos/${repo}/git/ref/heads/${toolRef}`,'--jq','.object.sha'])).trim(),toolHead);
        let comparison=state.comparisons.find(c=>c.repeat===repeat);
        if (!comparison) {
            state.dispatchPending={repeat,nodeVersion,reverse,startedAt:new Date().toISOString()};
            save();
            const dispatched=await gh(['workflow','run','labwired-motion-ab.yml','-R',repo,'--ref',toolRef,
                '-f',`baseline_run=${sources.baseline.run}`,'-f',`baseline_commit=${sources.baseline.commit}`,
                '-f',`candidate_run=${sources.candidate.run}`,'-f',`candidate_commit=${sources.candidate.commit}`,
                '-f','allow_paired_glue=true','-f','profile=false','-f','f0=true','-f',`node_version=${nodeVersion}`,'-f',`reverse=${reverse}`]);
            const id=dispatched.match(/\/actions\/runs\/(\d+)/)?.[1];
            assert(id,'Missing dispatch receipt: inspect remote, do not retry');
            comparison={repeat,nodeVersion,reverse,run:Number(id),url:`https://github.com/${repo}/actions/runs/${id}`};
            state.comparisons.push(comparison);
            delete state.dispatchPending;
            save();
            console.log(`New comparison ${repeat}: ${comparison.url}`);
        }
        assert.equal(comparison.nodeVersion,nodeVersion);
        assert.equal(comparison.reverse,reverse);
        if (comparison.summary && comparison.f0Summary) {
            assert.deepEqual(verifyComparison(join(root,`hosted-ab-${repeat}`),comparison,state.verifications),
                {summary:comparison.summary,f0Summary:comparison.f0Summary});
            continue;
        }
        await watch(comparison.run);
        const run=JSON.parse(await readGh(['run','view',String(comparison.run),'-R',repo,'--json','status,conclusion,headSha,jobs,url']));
        assert.equal(run.headSha,toolHead);
        assert.equal(run.conclusion,'success','Diagnostic failed: inspect original raw receipts');
        const artifacts=JSON.parse(await readGh(['api',`repos/${repo}/actions/runs/${comparison.run}/artifacts`]));
        const small=artifacts.artifacts.filter(a=>a.name==='motion-artifact-ab-diagnostic');
        assert.equal(small.length,1);
        assert(!small[0].expired && small[0].size_in_bytes>0 && small[0].size_in_bytes<4*1024*1024,'Only small timing receipt archives may be downloaded locally');
        const disk=statfsSync(root);
        assert(disk.bavail*disk.bsize>=128*1024*1024,'Insufficient disk for small receipt download; no cleanup or engine work');
        const directory=join(root,`hosted-ab-${repeat}`);
        assert(!existsSync(directory),'Partial receipt download exists: inspect, never overwrite');
        mkdirSync(directory);
        await gh(['run','download',String(comparison.run),'-R',repo,'--name','motion-artifact-ab-diagnostic','--dir',directory]);
        const results=verifyComparison(directory,comparison,state.verifications);
        Object.assign(comparison,results,{runReceipt:run,artifact:small[0]});
        save();
        console.log(JSON.stringify({repeat,motion:results.summary,f0:results.f0Summary}));
    }
    state.completedAt=new Date().toISOString();
    save();
    console.log('All four hosted comparisons retained. No local engine execution, promotion, publication or acknowledgement update.');
} catch (error) {
    state.stoppedAt=new Date().toISOString();
    state.error=error.message;
    save();
    console.error('STOPPED: '+error.message);
    process.exitCode=1;
}
