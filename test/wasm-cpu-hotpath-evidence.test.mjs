import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {selectCpuWat} from '../scripts/lib/wasm-cpu-inspection.mjs';
const archive=new URL('../docs/receipts/2026-10-03-wasm-cpu-hotpath-inspection/',import.meta.url);
const bytes=path=>readFileSync(new URL(path,archive));
const manifest=JSON.parse(bytes('manifest.json'));
const hash=data=>createHash('sha256').update(data).digest('hex');
const original=path=>{
    const f=manifest.files.find(f=>(f.original?.path??f.path)===path);assert(f,path);
    const data=bytes(f.path);return f.original?Buffer.from(JSON.parse(data).data,f.original.encoding):data;
};
const json=path=>JSON.parse(original(path));
const tool='ad05b8ec01309dba79e7cf9435c6b0b5424d50fc';
const core='43b2d62f5a0fa24ae0b38a645069f5aaa78af685';
test('CPU corpus binds all 76 original members including three failed inspections',()=>{
    assert.equal(manifest.files.length,76);assert.equal(manifest.toolHead,tool);
    for(const key of ['diagnosticOnly','hostedOnly'])assert.equal(manifest[key],true);
    for(const key of ['engineExecution','enginePromotion'])assert.equal(manifest[key],false);
    assert.equal(new Set(manifest.files.map(f=>f.path)).size,76);
    for(const f of manifest.files){
        const data=bytes(f.path);assert.equal(data.length,f.bytes);assert.equal(hash(data),f.sha256,f.path);
        if(f.original){const raw=original(f.original.path);assert.equal(raw.length,f.original.bytes);assert.equal(hash(raw),f.original.sha256);}
    }
    for(const prefix of ['initial','r2','r3']){
        const p=json(prefix+'/pipeline.json'),run=json(prefix+'/baseline-run.json');
        assert(p.error);assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
        const logFile=manifest.files.find(f=>f.path.startsWith(prefix+'/baseline-job-'));
        assert(logFile);assert.match(JSON.parse(bytes(logFile.path)).log,/exceeds receipt bound|exceed total text bound/);
    }
});
test('selected roots reassemble all bounded chunks and reparse original code/types/statics',()=>{
    const p=json('final/pipeline.json'),r=json('final/baseline/selected-cpu.json');
    assert(p.completedAt&&!p.error);assert.equal(p.toolHead,tool);assert.equal(p.targets[0].run,37142446921);
    assert.equal(r.coreCommit,core);assert.equal(r.toolCommit,tool);assert.equal(r.buildRun,'36915940413');
    assert.equal(r.engineExecution,false);
    assert.equal(r.wasmSha256,'7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d');
    assert.equal(r.glueSha256,'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73');
    assert.deepEqual(r.fullWat,json('final/baseline/disassembly-provenance.json'));
    assert.equal(r.functions.length,2);assert.equal(r.bodyFiles.length,2);
    assert.equal(r.totalBodyBytes,14926355);assert(r.totalBodyBytes<=16*1024*1024);
    assert(original('final/baseline/selected-cpu.json').length<=2_000_000);
    const bodies=r.bodyFiles.map((f,i)=>{
        assert.equal(f.name,r.functions[i].name);
        const raw=Buffer.concat(f.chunks.map(c=>{
            assert.match(c.path,/^body-\d+-\d+\.txt$/);
            const b=original('final/baseline/'+c.path);assert.equal(b.length,c.bytes);
            assert(b.length>0&&b.length<=512*1024);assert.equal(hash(b),c.sha256);return b;
        }));
        assert.equal(raw.length,r.functions[i].watBytes);assert.equal(hash(raw),r.functions[i].watSha256);
        return raw.toString();
    });
    const selected=selectCpuWat([...r.types,...bodies].join('\n'),{metadataOnly:true});
    for(const key of ['functions','types','absentLabels','limitations'])assert.deepEqual(selected[key],r[key]);
});
test('textual sizing/table analysis is reproducible and does not claim runtime cost',()=>{
    const r=json('final/baseline/selected-cpu.json'),a=json('controls/cpu-hotpath-text-analysis.json');
    assert.equal(a.source,core);assert.equal(a.tool,tool);assert.equal(a.run,37142446921);
    for(const [i,f]of r.functions.entries()){
        const text=Buffer.concat(r.bodyFiles[i].chunks.map(c=>original('final/baseline/'+c.path))).toString();
        assert.equal(a.functions[i].name,f.name);assert.equal(a.functions[i].watSha256,f.watSha256);
        assert.equal(a.functions[i].watBytes,Buffer.byteLength(text));
        assert.equal(a.functions[i].lines,text.split('\n').length);
        assert.equal(a.functions[i].nonWhitespaceBytes,Buffer.byteLength(text.replace(/\s/g,'')));
        const histogram={};
        for(const line of text.split('\n').filter(l=>/^\s*br_table\b/.test(l))){
            const n=line.replace(/\(;[^;]*;\)/g,'').trim().split(/\s+/).length-1;
            histogram[n]=(histogram[n]||0)+1;
        }
        assert.deepEqual(histogram,a.functions[i].branchTableTargetHistogram);
    }
    assert.deepEqual(a.functions[1].branchTableTargetHistogram,{'16':1,'18':107,'84':1});
    assert(a.limitations.includes('Text size is not binary size'));
    assert(a.limitations.includes('No performance, causality or source-promotion claim'));
});
test('tool merge required all eleven enabled checks and exact successful production inspection',()=>{
    const l=json('controls/pr320-landing.json'),run=json('final/baseline-run.json');
    assert.equal(l.head,tool);assert.equal(l.after.state,'MERGED');assert.equal(l.after.headRefOid,tool);
    assert.equal(l.after.mergeCommit.oid,'f0bff66711d5bdef392b783351a6386482581b72');
    assert.equal(l.engineMerge,false);assert.equal(l.physicalAcknowledgementChanges,false);
    const checks=l.pr.statusCheckRollup;assert.equal(checks.length,13);
    assert(checks.every(c=>c.status==='COMPLETED'));
    assert.equal(checks.filter(c=>c.conclusion==='SUCCESS').length,11);
    const skipped=checks.filter(c=>c.conclusion==='SKIPPED');assert.equal(skipped.length,2);
    assert(skipped.every(c=>c.name==='vectors-full'));
    assert.equal(run.headSha,tool);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
});
