import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openArchive,hash,validatePartitions,summarize} from './lib/discovery-census-evidence.mjs';
const root=fileURLToPath(new URL('../docs/receipts/2026-10-04-wasm-discovery-census/',import.meta.url));
const archive=openArchive(root),{manifest,states,raw,json,log,capture,reuse}=archive;
test('all original corpus members and diagnostic-only experiment identities are bound',()=>{
    assert.equal(manifest.files.length,70);assert.equal(new Set(manifest.files.map(f=>f.path)).size,70);
    for(const file of manifest.files){const bytes=readFileSync(root+file.path);
        assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);
        raw(file.path.slice(0,-'.utf8.json'.length));}
    assert.deepEqual(manifest.runIds,{initial:37200722140,build:37201401969,firstCapture:37203284967,shared:37203818623});
    assert.equal(manifest.base,'43b2d62f5a0fa24ae0b38a645069f5aaa78af685');
    assert.equal(manifest.engine,'1b044ea97d2a72c43f1b15a147d64a479620f0ee');
    assert.equal(manifest.tool,'82e5661fffbfcc8c12ecc8845475d4214c1f10e4');
    for(const key of ['qualification','enginePromotion','publication','physicalAcknowledgementChanges'])assert.equal(manifest[key],false);
});
test('all three real failed gates and the separate observer error remain failures',()=>{
    for(const label of ['initial','build','firstCapture'])assert.equal(states[label].snapshot.conclusion,'failure');
    assert.match(log('initial','correctness'),/as_any_mut\(\) call sites rose to 276 \(ceiling 274\)/);
    for(const leg of ['off','a','b']){
        const job=states.build.snapshot.jobs.find(j=>j.name==='build ('+leg+')');
        assert.equal(job.conclusion,'failure');
        for(const name of ['Build feature-off control or explicitly enabled diagnostic',
            'All 108 actual-WASM integrations including seven same-PC proofs'])
            assert.equal(job.steps.find(s=>s.name===name).conclusion,'success');
        assert.match(log('build',job.name),/AssertionError.*Unrecognized frozen workload/);
        assert.match(log('build',job.name),/# tests 108/);assert.match(log('build',job.name),/# skipped 0/);
    }
    assert.match(json('runs/build/observation.json').error,/still in progress/);
    assert.match(states.build.priorObservation.error,/still in progress/);
    const prior=['off','a','b'].map(leg=>capture('firstCapture',leg));
    assert.equal(new Set(prior.map(r=>r.guestSha256)).size,3);
    assert.equal(states.firstCapture.snapshot.jobs.find(j=>j.name==='equivalence').conclusion,'failure');
    assert.match(log('firstCapture','equivalence'),/AssertionError/);
});
test('original source bodies reconstruct, default-only policy and native execution checks hold',()=>{
    const proof=json('runs/build/source-contract.json');
    assert.equal(proof.head,manifest.engine);assert.equal(proof.defaultFeatureOff,true);
    assert.equal(proof.traitMethodsAddedOnlyUnderDiagnosticCfg,true);
    assert.equal(proof.nativeAndWasmMemoCapacity,64);
    for(const file of proof.additionsOnly){
        const base=raw('source/base/'+file.file),candidate=raw('source/engine/'+file.file);
        assert.equal(hash(base),file.originalSha256);assert.equal(hash(candidate),file.candidateSha256);
        const lines=candidate.split('\n');
        const patch=raw('source/patches/engine/'+file.file+'.diff');
        for(const hunk of [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].reverse()){
            assert.equal(Number(hunk[2]??1),0);lines.splice(Number(hunk[3])-1,Number(hunk[4]??1));}
        assert.equal(lines.join('\n'),base);
    }
    const results=[...log('build','correctness').matchAll(/test result: ok\. (\d+) passed; 0 failed; (\d+) ignored;/g)]
        .map(m=>[Number(m[1]),Number(m[2])]);
    assert.deepEqual(results,[[6,0],[12,0],[12,0],[4234,3],[4240,3],[15,0],[8,0],[4,0],[2,0],[2,0]]);
    assert.equal(states.build.snapshot.jobs.find(j=>j.name==='correctness').conclusion,'success');
});
test('shared guest and exact original engine manifests bind every actual capture',()=>{
    assert.equal(states.shared.snapshot.conclusion,'success');
    assert(states.shared.snapshot.jobs.every(j=>j.conclusion==='success'));
    const off=capture('shared','off');
    for(const leg of ['off','a','b']){
        const report=capture('shared',leg),binding=reuse(leg);
        assert.equal(report.exitCode,0);assert.equal(report.enabled,leg!=='off');
        assert.equal(report.qualification,false);assert.equal(report.originalHarnessSha256,'af73787b849eddf697ed988b3a7c0a2fe25a938a561131498f1b7de38db7e3c5');
        assert.equal(binding.source,manifest.engine);assert.equal(binding.run,37201401969);
        assert.equal(binding.originalWorkflowConclusion,'failure');assert.equal(binding.priorWindowCount,0);
        assert.equal(binding.buildInfo.ref,manifest.engine);
        assert.equal(report.wasmSha256,binding.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256);
        assert.equal(report.glueSha256,binding.buildInfo.targets.nodejs['labwired_wasm.js'].sha256);
        assert.deepEqual(binding.buildInfo.features,leg==='off'?[]:['t16-discovery-census']);
        assert.deepEqual(report.sharedGuestManifest,off.sharedGuestManifest);
        assert.equal(report.guestSha256,off.guestSha256);
        const image=Buffer.from(report.sharedGuestManifest.elfBase64,'base64');
        assert.equal(image.length,report.sharedGuestManifest.elfBytes);assert.equal(hash(image),report.guestSha256);
        assert.equal(report.sharedGuestManifest.boardRef,'d1f2c8ebfc5e4e76d5fc81f930588c13de13e974');
    }
    assert.notEqual(off.wasmSha256,'7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d');
    for(const target of ['nodejs','web'])for(const name of ['labwired_wasm.js','labwired_wasm_bg.wasm'])
        assert.deepEqual(reuse('a').buildInfo.targets[target][name],reuse('b').buildInfo.targets[target][name]);
});
test('all fifteen actual observations and ten counter windows reproduce hosted equivalence',()=>{
    const reports=Object.fromEntries(['off','a','b'].map(leg=>[leg,capture('shared',leg)]));
    const semantic=r=>r.samples.map(({wallSeconds,rtx,...sample})=>sample);
    for(const r of Object.values(reports)){assert.equal(r.samples.length,5);assert.deepEqual(semantic(r),semantic(reports.off));}
    assert.equal(reports.off.windows.length,0);assert.deepEqual(reports.a.windows,reports.b.windows);
    for(const r of [reports.a,reports.b])for(const w of r.windows)validatePartitions(w);
    const hosted=archive.emitted('shared','equivalence','{"diagnosticOnly":true');
    for(const key of ['actualGuestObservationsEquivalent','independentDiagnosticBuildBytesIdentical','independentCounterWindowsIdentical'])assert.equal(hosted[key],true);
    assert.equal(hosted.qualification,false);assert.equal(hosted.integrationsPerLeg,108);
    assert.deepEqual(hosted.windows,reports.a.windows);
});
test('frequency conclusion derives from all five windows, never timing or other-target qualification',()=>{
    const windows=capture('shared','a').windows,result=summarize(windows);
    assert.deepEqual(result,JSON.parse(readFileSync(root+'analysis.json')));
    assert.equal(result.totals.calls,'61614846');assert.equal(result.totals.no_positive_span,'61542607');
    assert.equal(result.totals.memo_hit,'61423781');assert.equal(result.totals.memo_same_generation_collision,'94901');
    assert.equal(result.totals.compile_attempts,'95669');
    for(const key of ['decode_insert','decode_clear','generation_wrap','memo_same_pc_stale_generation','memo_different_pc_stale_generation'])assert.equal(result.totals[key],'0');
    assert(result.memoHitPercent>99.8&&result.memoHitPercent<99.81);
    assert(windows.every(w=>w.decode_generation==='175'));
    assert.equal(result.qualification,false);
});
