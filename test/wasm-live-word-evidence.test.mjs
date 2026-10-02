import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {motionProbeResult,assertSameMotionGuest,median} from '../scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult,assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';

const archive=new URL('../docs/receipts/2026-10-02-wasm-live-word-admission/',import.meta.url);
const bytes=path=>readFileSync(new URL(path,archive));
const manifest=JSON.parse(bytes('manifest.json'));
const hash=data=>createHash('sha256').update(data).digest('hex');
const original=path=>{
    const file=manifest.files.find(f=>(f.original?.path??f.path)===path);
    assert.ok(file,`Missing original ${path}`);
    const data=bytes(file.path);
    return file.original?Buffer.from(JSON.parse(data).data,file.original.encoding):data;
};
const json=path=>JSON.parse(original(path));
const stripped=path=>original(path).toString().split('\n').map(line=>line.replace(/^\d{4}-\d\d-\d\dT\S+ /,'')).join('\n');
const sources={baseline:'43b2d62f5a0fa24ae0b38a645069f5aaa78af685',candidate:'03302546de866ae00e805b0a4c791c684c2903c0'};
const moduleHashes={baseline:'7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d',candidate:'15a8ec726b87c220eb53379e82c5feea32df53445fb50173200a5e8a175f4394'};
const glueHashes={baseline:'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73',candidate:'339deaca58b4c5a5319f95168b8356a9d0b495905383d1d2166e527c8f2cb3cd'};
const tool='fb13d48b7bc377bceb5da5a1d4ed5cd11555e162';
const combined=samples=>({samples:samples.length,medianRtx:median(samples.map(s=>s.rtx)),minimumRtx:Math.min(...samples.map(s=>s.rtx)),allWindowsMeet1x:samples.every(s=>s.rtx>=1)});
function summary(runs,samples) {
    const result={};
    for(const label of ['baseline','candidate']) {
        result[label]=combined(runs.filter(r=>r.label===label).flatMap(samples));
        assert.equal(result[label].samples,10);
    }
    result.candidateMedianRatio=result.candidate.medianRtx/result.baseline.medianRtx;
    return result;
}
test('live-word archive preserves all 112 originals with no engine artifact downloads to VPS',()=>{
    assert.equal(manifest.files.length,112);
    assert.equal(new Set(manifest.files.map(f=>f.path)).size,112);
    assert.equal(manifest.diagnosticOnly,true);
    assert.equal(manifest.hostedOnly,true);
    assert.equal(manifest.timingHarness,tool);
    for(const file of manifest.files) {
        const data=bytes(file.path);
        assert.equal(data.length,file.bytes);
        assert.equal(hash(data),file.sha256,file.path);
        if(file.original) {
            const wrapper=JSON.parse(data);
            assert.equal(wrapper.originalPath,file.original.path);
            assert.equal(wrapper.encoding,file.original.encoding);
            const decoded=original(file.original.path);
            assert.equal(decoded.length,file.original.bytes);
            assert.equal(hash(decoded),file.original.sha256);
        }
    }
    const p=json('pipeline.json');
    assert.equal(p.hostedOnly,true);
    assert.equal(p.localEngineArtifactDownloads,false);
    for(const key of ['automaticMerge','publication','appPinChanges'])assert.equal(p[key],false);
    assert.ok(p.completedAt);
    assert.equal(p.error,undefined);
    assert.equal(p.dispatchPending,undefined);
});
test('source proof and independent build manifests retain failed fresh floor verdicts',()=>{
    const p=json('pipeline.json'),native=json('source-ci.json');
    assert.equal(native.headSha,sources.candidate);
    assert.equal(native.conclusion,'success');
    assert.equal(native.status,'completed');
    assert.equal(p.nativeCorrectness.headSha,sources.candidate);
    const sourceLog=original('native-source-tests.txt').toString();
    for(const name of ['live_word_admission_selects_exactly_word_immediate_accesses',
        'live_word_admission_matches_current_memory_bounds_registers_and_wrapping',
        'live_word_rejections_do_not_retire_or_touch_architectural_bus_state']) {
        assert.match(sourceLog,new RegExp(`${name} \\.\\.\\. ok`));
    }
    assert.match(sourceLog,/test result: ok\. \d+ passed; 0 failed;/);
    for(const label of ['baseline','candidate']) {
        const v=p.verifications[label];
        assert.equal(p.sources[label].commit,sources[label]);
        assert.equal(v.run.status,'completed');
        assert.equal(v.run.conclusion,'failure'); // only fresh motion floor failed
        assert.equal(v.run.headSha,p.sources[label].toolHead);
        for(const name of ['build (a)','build (b)','determinism','test']) {
            assert.equal(v.run.jobs.find(job=>job.name===name)?.conclusion,'success');
        }
        assert.equal(v.run.jobs.find(job=>job.name==='motion')?.conclusion,'failure');
        assert.equal(v.run.jobs.find(job=>job.name==='publish')?.conclusion,'skipped');
        const infos=['a','b'].map(leg=>{
            const blocks=[...stripped(`${label}-build-${leg}.txt`).matchAll(/^\{\n[\s\S]*?^\}$/gm)]
                .map(m=>JSON.parse(m[0])).filter(i=>i.ref===sources[label]&&i.targets?.nodejs&&i.targets?.web);
            assert.equal(blocks.length,1);
            return blocks[0];
        });
        assert.deepEqual(infos[0].targets,infos[1].targets);
        assert.deepEqual(infos[1],v.buildInfo);
        assert.equal(v.buildInfo.postprocess,undefined);
        assert.equal(v.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256,moduleHashes[label]);
        assert.equal(v.buildInfo.targets.nodejs['labwired_wasm.js'].sha256,glueHashes[label]);
        assert.equal(v.integrationTests,101);
        const integration=stripped(`${label}-integration.txt`);
        for(const [key,value]of [['tests',101],['pass',101],['fail',0],['skipped',0]])assert.match(integration,new RegExp(`^# ${key} ${value}$`,'m'));
        const qualification=motionProbeResult(stripped(`${label}-qualification.txt`),1);
        assert.deepEqual(qualification,v.qualification);
        assert.equal(qualification.allWindowsMeet1x,false);
    }
});
test('all four hosted pairs reparse 240 measured windows and verify original paired glue',()=>{
    const p=json('pipeline.json');
    assert.equal(p.comparisons.length,4);
    for(const [index,c]of p.comparisons.entries()) {
        assert.equal(c.repeat,index+1);
        assert.equal(c.nodeVersion,index<2?'20.20.2':'22.23.3');
        assert.equal(c.reverse,index%2===1);
        assert.equal(c.runReceipt.headSha,tool);
        assert.equal(c.runReceipt.status,'completed');
        assert.equal(c.runReceipt.conclusion,'success');
        const verification=c.runReceipt.jobs.flatMap(j=>j.steps).find(s=>s.name==='Verify declared sources and actual artifact hashes');
        assert.equal(verification?.conclusion,'success');
        assert.equal(c.artifact.name,'motion-artifact-ab-diagnostic');
        assert.ok(c.artifact.size_in_bytes>0&&c.artifact.size_in_bytes<4*1024*1024);
        const prefix=`hosted-ab-${index+1}/`,motion=json(prefix+'abba.json'),f0=json(prefix+'f0-abba/abba.json');
        const order=c.reverse?['candidate','baseline','baseline','candidate']:['baseline','candidate','candidate','baseline'];
        for(const receipt of [motion,f0]) {
            assert.equal(receipt.node,`v${c.nodeVersion}`);
            assert.equal(receipt.diagnosticOnly,true);
            assert.equal(receipt.guestObservationsMatch,true);
            assert.deepEqual(receipt.order,order);
            assert.deepEqual(receipt.runs.map(r=>r.label),order);
            assert.match(receipt.gluePolicy,/explicit paired-glue comparison/);
            for(const label of ['baseline','candidate']) {
                assert.equal(receipt.artifacts[label].wasmSha256,moduleHashes[label]);
                assert.equal(receipt.artifacts[label].glueSha256,glueHashes[label]);
            }
        }
        const parsedMotion=motion.runs.map(run=>{
            const result=motionProbeResult(run.stdout,run.exitCode);
            for(const [key,value]of Object.entries(result))assert.deepEqual(run[key],value);
            return result;
        });
        parsedMotion.slice(1).forEach(r=>assertSameMotionGuest(parsedMotion[0],r));
        assert.deepEqual(summary(motion.runs,r=>r.samples),motion.summary);
        assert.deepEqual(c.summary,motion.summary);
        const parsedF0=f0.runs.map((run,i)=>{
            const ordinary=run.capture.ordinary;
            assert.equal(run.capture.node,`v${c.nodeVersion}`);
            assert.deepEqual(run.capture.buildInfo,p.verifications[run.label].buildInfo);
            assert.deepEqual(ordinary.flags,[]);
            assert.equal(run.capture.profiling,undefined);
            const result=f0TimingResult(original(prefix+`f0-abba/${i+1}-${run.label}/ordinary-stdout.txt`).toString(),ordinary.exitCode);
            assert.deepEqual(result.workloads,ordinary.workloads);
            assert.equal(result.allWindowsMeet1x,ordinary.allWindowsMeet1x);
            return result;
        });
        parsedF0.slice(1).forEach(r=>assertSameF0Guest(parsedF0[0],r));
        for(const workload of ['ram','gpio'])assert.deepEqual(summary(f0.runs,r=>r.capture.ordinary.workloads[workload].samples),f0.summary[workload]);
        assert.deepEqual(c.f0Summary,f0.summary);
        for(const label of ['baseline','candidate']) {
            assert.deepEqual(json(prefix+`${label}-build-info.json`),p.verifications[label].buildInfo);
            assert.equal(motion.summary[label].allWindowsMeet1x,index===2);
            assert.equal(f0.summary.ram[label].allWindowsMeet1x,true);
            assert.equal(f0.summary.gpio[label].allWindowsMeet1x,index===2&&label==='candidate');
        }
        assert.ok(f0.summary.gpio.candidateMedianRatio>1,'GPIO improves in every hosted order/runtime');
        assert.ok(f0.summary.ram.candidateMedianRatio>1,'RAM median improves in every hosted order/runtime');
        if(index===2)assert.ok(motion.summary.candidateMedianRatio<1,'Preserve Node22 forward motion loss');
        if(index===3)assert.ok(motion.summary.candidate.minimumRtx<motion.summary.baseline.minimumRtx,'Preserve reverse motion minimum loss');
    }
});
