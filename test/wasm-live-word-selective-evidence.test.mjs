import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {motionProbeResult,assertSameMotionGuest,median} from '../scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult,assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';

const archive=new URL('../docs/receipts/2026-10-02-wasm-live-word-selective/',import.meta.url);
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
const sources={baseline:'43b2d62f5a0fa24ae0b38a645069f5aaa78af685',candidate:'90ff69aa8b78e91667d1d5067a39dc0b37bc8115'};
const moduleHashes={baseline:'7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d',candidate:'ad1704cbb2438baeb92536ed963b5353ccc86688032b921619c6415e101cac4b'};
const glueHashes={baseline:'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73',candidate:'339deaca58b4c5a5319f95168b8356a9d0b495905383d1d2166e527c8f2cb3cd'};
const tool='fb13d48b7bc377bceb5da5a1d4ed5cd11555e162';
const sourceRuns={baseline:36915940413,candidate:37027849668};
const nativeRun=37026594366;
const sourceTools={baseline:'1cac10ba28ddd5e71c5a7e32437a3b0080d47f14',candidate:tool};
const originalPaths=manifest.files.map(f=>f.original?.path??f.path);
const requireOriginal=path=>assert.ok(originalPaths.includes(path),`Missing corpus member ${path}`);
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
test('selective live-word archive binds complete original corpus and immutable experiment config',()=>{
    assert.ok(manifest.files.length>0);
    assert.equal(new Set(manifest.files.map(f=>f.path)).size,manifest.files.length);
    assert.equal(new Set(originalPaths).size,manifest.files.length);
    for(const path of ['config.json','evaluate-hosted.mjs','pipeline.json','source-ci.json','native-source-tests.txt'])requireOriginal(path);
    for(const label of ['baseline','candidate'])for(const part of ['build-a','build-b','integration','qualification'])requireOriginal(`${label}-${part}.txt`);
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
    const config=json('config.json');
    assert.equal(config.nativeRun,nativeRun);
    assert.deepEqual(config.sources,p.sources);
    for(const label of ['baseline','candidate'])assert.deepEqual(config.sources[label],{
        run:sourceRuns[label],commit:sources[label],toolHead:sourceTools[label]
    });
    assert.match(original('evaluate-hosted.mjs').toString(),/config\.json/);
    assert.ok(p.completedAt);
    assert.equal(p.error,undefined);
    assert.equal(p.dispatchPending,undefined);
});
test('selective source proof and independent build manifests retain exact fresh floor verdicts',()=>{
    const p=json('pipeline.json'),native=json('source-ci.json');
    assert.equal(native.url,`https://github.com/CrispStrobe/labwired-core/actions/runs/${nativeRun}`);
    assert.equal(native.headSha,sources.candidate);
    assert.equal(native.conclusion,'success');
    assert.equal(native.status,'completed');
    assert.deepEqual(p.nativeCorrectness,native);
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
        assert.equal(p.sources[label].run,sourceRuns[label]);
        assert.equal(p.sources[label].toolHead,sourceTools[label]);
        assert.equal(v.run.url,`https://github.com/CrispStrobe/bw-board/actions/runs/${sourceRuns[label]}`);
        const motionVerdict=v.qualification.allWindowsMeet1x?'success':'failure';
        assert.equal(v.run.conclusion,motionVerdict); // diagnostic workflow retains actual fresh floor
        assert.equal(v.run.headSha,p.sources[label].toolHead);
        for(const name of ['build (a)','build (b)','determinism','test']) {
            assert.equal(v.run.jobs.find(job=>job.name===name)?.conclusion,'success');
        }
        assert.equal(v.run.jobs.find(job=>job.name==='motion')?.conclusion,motionVerdict);
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
        assert.equal(v.buildInfo.ref,sources[label]);
        for(const target of ['nodejs','web'])for(const name of ['labwired_wasm.js','labwired_wasm_bg.wasm']) {
            const file=v.buildInfo.targets[target][name];
            assert.match(file.sha256,/^[a-f0-9]{64}$/);
            assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>0);
        }
        assert.equal(v.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256,moduleHashes[label]);
        assert.equal(v.buildInfo.targets.nodejs['labwired_wasm.js'].sha256,glueHashes[label]);
        assert.equal(v.integrationTests,101);
        const integration=stripped(`${label}-integration.txt`);
        for(const [key,value]of [['tests',101],['pass',101],['fail',0],['skipped',0]])assert.match(integration,new RegExp(`^# ${key} ${value}$`,'m'));
        const qualification=motionProbeResult(stripped(`${label}-qualification.txt`),motionVerdict==='success'?0:1);
        assert.deepEqual(qualification,v.qualification);
        assert.equal(qualification.allWindowsMeet1x,qualification.samples.every(s=>s.rtx>=1));
    }
});
test('all four selective hosted pairs reparse 240 windows without suppressing measured losses',()=>{
    const p=json('pipeline.json');
    assert.equal(p.comparisons.length,4);
    for(const [index,c]of p.comparisons.entries()) {
        assert.equal(c.repeat,index+1);
        assert.equal(c.nodeVersion,index<2?'20.20.2':'22.23.3');
        assert.equal(c.reverse,index%2===1);
        assert.equal(c.runReceipt.url,`https://github.com/CrispStrobe/bw-board/actions/runs/${c.run}`);
        assert.equal(c.url,c.runReceipt.url);
        assert.equal(c.runReceipt.headSha,tool);
        assert.equal(c.runReceipt.status,'completed');
        assert.equal(c.runReceipt.conclusion,'success');
        const verification=c.runReceipt.jobs.flatMap(j=>j.steps).find(s=>s.name==='Verify declared sources and actual artifact hashes');
        assert.equal(verification?.conclusion,'success');
        assert.equal(c.artifact.name,'motion-artifact-ab-diagnostic');
        assert.ok(c.artifact.size_in_bytes>0&&c.artifact.size_in_bytes<4*1024*1024);
        const prefix=`hosted-ab-${index+1}/`;
        for(const path of ['abba.json','f0-abba/abba.json','baseline-build-info.json','candidate-build-info.json','runner.txt'])requireOriginal(prefix+path);
        const motion=json(prefix+'abba.json'),f0=json(prefix+'f0-abba/abba.json');
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
            assert.equal(run.signal,null);
            const result=motionProbeResult(run.stdout,run.exitCode);
            for(const [key,value]of Object.entries(result))assert.deepEqual(run[key],value);
            return result;
        });
        parsedMotion.slice(1).forEach(r=>assertSameMotionGuest(parsedMotion[0],r));
        assert.deepEqual(summary(motion.runs,r=>r.samples),motion.summary);
        assert.deepEqual(c.summary,motion.summary);
        const parsedF0=f0.runs.map((run,i)=>{
            assert.equal(run.exitCode,0);
            assert.equal(run.signal,null);
            const child=prefix+`f0-abba/${i+1}-${run.label}/`;
            for(const file of ['receipt.json','ordinary-stdout.txt','ordinary-stderr.txt'])requireOriginal(child+file);
            for(const stream of ['stdout','stderr'])requireOriginal(prefix+`f0-abba/${i+1}-capture-${stream}.txt`);
            assert.deepEqual(json(child+'receipt.json'),run.capture);
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
            for(const s of [motion.summary[label],f0.summary.ram[label],f0.summary.gpio[label]]) {
                assert.equal(s.allWindowsMeet1x,s.minimumRtx>=1);
                assert.ok(s.minimumRtx<=s.medianRtx);
            }
        }
        // Equality above binds every measured gain, loss, minimum and floor.
        // Performance direction is evidence, not an assertion chosen for promotion.
    }
});

test('actual-WASM same-PC word dispatcher proof passes all seven cases on both original engines',()=>{
    const prefix='dispatcher-proof/';
    const run=json(prefix+'run.json');
    assert.equal(run.url,'https://github.com/CrispStrobe/bw-board/actions/runs/37037845280');
    assert.equal(run.headSha,'d1f2c8ebfc5e4e76d5fc81f930588c13de13e974');
    assert.equal(run.status,'completed');
    assert.equal(run.conclusion,'success');
    const steps=run.jobs.flatMap(j=>j.steps);
    for(const name of ['Verify original source and module bytes',
        'Exercise both original engines without debugger bypass or skipped tests']) {
        assert.equal(steps.find(s=>s.name===name)?.conclusion,'success');
    }
    requireOriginal(prefix+'regression-source.mjs');
    requireOriginal(prefix+'regression-workflow.txt');
    const log=json(prefix+'ci-log.utf8.json');
    assert.equal(log.encoding,'utf8');
    assert.equal(typeof log.data,'string');
    const artifacts=json(prefix+'artifact-api.json').artifacts;
    assert.equal(artifacts.length,1);
    assert.equal(artifacts[0].name,'labwired-word-dispatch-regression');
    assert.equal(artifacts[0].id,11240853626);
    assert.ok(artifacts[0].size_in_bytes>0&&artifacts[0].size_in_bytes<4*1024*1024);
    const proofs=[];
    for(const label of ['baseline','candidate']) {
        const info=json(prefix+`artifact/${label}-BUILD-INFO.json`);
        assert.deepEqual(info,json('pipeline.json').verifications[label].buildInfo);
        const text=original(prefix+`artifact/${label}-tests.txt`).toString();
        for(const [name,count]of [['tests',7],['pass',7],['fail',0],['cancelled',0],['skipped',0],['todo',0]]) {
            assert.match(text,new RegExp(`^# ${name} ${count}$`,'m'));
        }
        assert.deepEqual(text.split(/\r?\n/).filter(line=>/^ok \d+ -/.test(line)),
            [1,7,8,16,31,64,257].map((budget,i)=>`ok ${i+1} - actual WASM same-PC word RAM/MMIO/RAM, alignment and bounds; budget=${budget}`));
        const parsed=[...text.matchAll(/^# WASM_WORD_DISPATCH_PROOF (.+)$/gm)].map(m=>JSON.parse(m[1]));
        assert.deepEqual(parsed.map(r=>r.budget),[1,7,8,16,31,64,257]);
        for(const row of parsed) {
            assert.equal(row.imageSha256,'60fcba1c8ab4b3bfb835acd755d10253acaf817bfb7a9c979928e316f8d2427f');
            assert.equal(row.storePc,0x08000060);
            assert.equal(row.loadPc,0x08000062);
            assert.equal(row.safeInterval,1024);
            assert.equal(row.phases,5);
            assert.equal(row.loops,1572);
        }
        proofs.push(parsed);
    }
    assert.deepEqual(proofs[0],proofs[1],'Identical guest observations for both original engines');
});
