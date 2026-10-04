import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='/mnt/volume1/code/lego/labwired-same-host-20261003.R0T0cC';
const tool='ad05b8ec01309dba79e7cf9435c6b0b5424d50fc';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function helperCalls(calls,name){
    return calls.filter(c=>c.target.includes('CortexM::'+name+'::')).reduce((n,c)=>n+c.occurrences,0);
}
function snapshot(dir,source,run){
    const p=JSON.parse(readFileSync(dir+'/pipeline.json'));
    assert(p.completedAt&&!p.error&&!p.dispatchPending,'Capture must be complete');
    assert.equal(p.toolHead,tool);assert.equal(p.targets.length,1);
    assert.equal(p.targets[0].core,source);assert.equal(p.targets[0].run,run);
    const r=JSON.parse(readFileSync(dir+'/'+p.targets[0].label+'/selected-cpu.json'));
    assert.equal(r.coreCommit,source);assert.equal(r.toolCommit,tool);
    assert.equal(r.wasmSha256,p.targets[0].wasm);assert.equal(r.glueSha256,p.targets[0].glue);
    assert.equal(r.engineExecution,false);assert(r.totalBodyBytes<=16*1024*1024);
    assert.equal(r.functions.length,2);assert.equal(r.bodyFiles.length,2);
    return {source,run,wasmSha256:r.wasmSha256,glueSha256:r.glueSha256,functions:r.functions.map((f,i)=>{
        assert.equal(r.bodyFiles[i].name,f.name);
        const bytes=Buffer.concat(r.bodyFiles[i].chunks.map(c=>{
            assert.match(c.path,/^body-\d+-\d+\.txt$/);
            const b=readFileSync(dir+'/'+p.targets[0].label+'/'+c.path);
            assert.equal(b.length,c.bytes);assert(b.length<=512*1024);assert.equal(hash(b),c.sha256);return b;
        }));
        assert.equal(bytes.length,f.watBytes);assert.equal(hash(bytes),f.watSha256);
        const text=bytes.toString(),histogram={};
        for(const line of text.split('\n').filter(l=>/^\s*br_table\b/.test(l))){
            const tokens=line.replace(/\(;[^;]*;\)/g,'').trim().split(/\s+/).slice(1);
            assert(tokens.every(t=>/^\d+$/.test(t)));
            histogram[tokens.length]=(histogram[tokens.length]||0)+1;
        }
        return {name:f.name,labels:f.labels,watSha256:f.watSha256,watBytes:f.watBytes,
            nonWhitespaceBytes:Buffer.byteLength(text.replace(/\s/g,'')),
            branchTableTargetHistogram:histogram,
            staticDirectHelperCalls:Object.fromEntries(['read_reg','write_reg','read_reg_pc4','read_reg_frame','write_reg_frame','read_reg_frame_pc4','execute_t16_fast_op_frame'].map(name=>[name,helperCalls(f.directCalls,name)]))};
    })};
}
if(process.argv.includes('--self-test')){
    const calls=[{target:'$labwired_core::cpu::cortex_m::CortexM::read_reg::h1',occurrences:3},
        {target:'$labwired_core::cpu::cortex_m::CortexM::write_reg::h2',occurrences:4},
        {target:'$other::read_reg::h3',occurrences:99},
        {target:'$labwired_core::cpu::cortex_m::CortexM::read_reg_high::h4',occurrences:7},
        {target:'$labwired_core::cpu::cortex_m::CortexM::write_reg_high::h5',occurrences:11},
        {target:'$labwired_core::cpu::cortex_m::CortexM::read_reg_partitioned::h6',occurrences:5},
        {target:'$labwired_core::cpu::cortex_m::CortexM::read_reg_frame::h7',occurrences:13},
        {target:'$labwired_core::cpu::cortex_m::CortexM::write_reg_frame::h8',occurrences:17},
        {target:'$labwired_core::cpu::cortex_m::CortexM::read_reg_frame_pc4::h9',occurrences:19}];
    assert.equal(helperCalls(calls,'read_reg'),3);assert.equal(helperCalls(calls,'write_reg'),4);
    assert.equal(helperCalls(calls,'read_reg_pc4'),0);
    assert.equal(helperCalls(calls,'read_reg_high'),7);assert.equal(helperCalls(calls,'write_reg_high'),11);
    assert.equal(helperCalls(calls,'read_reg_partitioned'),5);assert.equal(helperCalls(calls,'write_reg_partitioned'),0);
    assert.equal(helperCalls(calls,'read_reg_frame'),13);assert.equal(helperCalls(calls,'write_reg_frame'),17);
    assert.equal(helperCalls(calls,'read_reg_frame_pc4'),19);
    console.log('Ten portable identity guard checks pass; synthetic counts are not engine/performance evidence.');
}else{
    const baseline=snapshot(root+'/cpu-hotpath-inspection-r4-20261003','43b2d62f5a0fa24ae0b38a645069f5aaa78af685',37142446921);
    const state=JSON.parse(readFileSync(root+'/cached-register-frame-cpu-inspection-20261004/pipeline.json'));
    assert(state.completedAt&&!state.error,'Candidate inspection not complete');
    const candidate=snapshot(root+'/cached-register-frame-cpu-inspection-20261004','098c99cf6b6a176a44c83b37ce77a1881909c767',state.targets[0].run);
    const comparisons=baseline.functions.map(b=>{
        const c=candidate.functions.find(c=>JSON.stringify(c.labels)===JSON.stringify(b.labels));assert(c);
        return {labels:b.labels,baseline:b,candidate:c,
            eighteenTargetTablesDelta:(c.branchTableTargetHistogram[18]||0)-(b.branchTableTargetHistogram[18]||0)};
    });
    const result={tool,baseline,candidate,comparisons,engineExecution:false,enginePromotion:false,
        limitations:['Static code shape only; no hit-frequency or runtime-cost claim',
            'Formatted/non-whitespace text sizes are not binary/code-cache sizes',
            '18-target table counts do not identify every table as a register access',
            'Actual ordinary paired measurements, not these counts, decide performance']};
    const out='/mnt/storage/code/labwired-evidence/labwired-same-host-20261003.R0T0cC/cached-register-frame-cpu-comparison.json';assert(!existsSync(out),'Preserve existing comparison');
    const data=JSON.stringify(result,null,2)+'\n';
    execFileSync('apply_patch',[],{input:'*** Begin Patch\n*** Add File: '+out+'\n'+data.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n'});
    console.log(JSON.stringify(result));
}
