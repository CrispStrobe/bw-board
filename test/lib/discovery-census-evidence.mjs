import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const hash=data=>createHash('sha256').update(data).digest('hex');
export function openArchive(root) {
    const manifest=JSON.parse(readFileSync(join(root,'manifest.json')));
    const raw=name=>{
        const wrapped=JSON.parse(readFileSync(join(root,name+'.utf8.json')));
        assert.equal(wrapped.schema,'labwired.lossless-utf8.v1');
        const bytes=Buffer.from(wrapped.text,'utf8');
        assert.equal(bytes.length,wrapped.bytes);assert.equal(hash(bytes),wrapped.sha256);
        return wrapped.text;
    };
    const json=name=>JSON.parse(raw(name));
    const states=Object.fromEntries(['initial','build','firstCapture','shared'].map(label=>[label,
        json('runs/'+label+'/'+(label==='build'?'observation-resumed.json':'observation.json'))]));
    const log=(label,name)=>{
        const job=states[label].snapshot.jobs.find(j=>j.name===name);assert(job,name);
        const binding=states[label].logs.find(l=>l.job===job.databaseId);assert(binding);
        const record=json('runs/'+label+'/'+binding.path.split('/').at(-1));
        const bytes=Buffer.from(record.text,'utf8');assert.equal(hash(bytes),record.sha256);
        assert.equal(bytes.length,record.bytes);assert.equal(record.sha256,binding.sha256);
        assert.equal(record.job,job.databaseId);assert.equal(record.name,name);
        assert.equal(record.conclusion,job.conclusion);return record.text;
    };
    const emitted=(label,name,needle)=>{
        const found=log(label,name).split('\n').filter(line=>line.includes(needle));
        assert.equal(found.length,1,'Unique emitted original JSON: '+needle);
        return JSON.parse(found[0].slice(found[0].indexOf(needle)));
    };
    const capture=(label,leg)=>emitted(label,'capture ('+leg+')','{"schema":"labwired.t16-census-capture.v1"');
    const reuse=leg=>emitted('shared','capture ('+leg+')','{"schema":"labwired.t16-census-artifact-reuse.v1"');
    return {root,manifest,raw,json,states,log,emitted,capture,reuse};
}
export function validatePartitions(window) {
    assert.equal(window.schema,'labwired.t16-discovery-census.v1');
    assert.equal(window.overflow,false);assert.equal(window.diagnostic_only,true);
    assert.equal(window.memo_slots,64);assert.equal(window.cycles,64000000);
    assert.equal(Object.keys(window.counts).length,20);
    const counts=Object.fromEntries(Object.entries(window.counts).map(([key,value])=>{
        assert.match(value,/^\d+$/);return [key,BigInt(value)];
    }));
    assert(counts.calls>0n);
    assert.equal(counts.calls,counts.positive_reuse+counts.no_positive_span);
    assert.equal(counts.no_positive_span,counts.memo_hit+counts.memo_empty+
        counts.memo_same_generation_collision+counts.memo_same_pc_stale_generation+
        counts.memo_different_pc_stale_generation);
    assert.equal(counts.no_positive_span,counts.memo_hit+counts.admission_refused+
        counts.discovered+counts.search_exhausted);
    assert.equal(counts.positive_reuse+counts.discovered,
        counts.runtime_rejected+counts.branch_exit+counts.budget_exit);
    return counts;
}
export function summarize(windows) {
    assert.equal(windows.length,5);
    const totals={};
    for(const [index,window] of windows.entries()){
        assert.equal(window.index,index);
        for(const [name,count] of Object.entries(validatePartitions(window)))
            totals[name]=(BigInt(totals[name]||'0')+count).toString();
    }
    return {diagnosticOnly:true,qualification:false,windows:5,cycles:320000000,totals,
        memoHitPercent:Number(totals.memo_hit)/Number(totals.no_positive_span)*100,
        collisionPercent:Number(totals.memo_same_generation_collision)/Number(totals.no_positive_span)*100,
        limitations:['Occurrence ratios are not wall-time shares or removable cost',
            'Selected warmed motion workload only; RAM/GPIO/other chips not measured by this census',
            'Control module/glue differ from production bytes; no ordinary RTx or binary-identity claim']};
}
