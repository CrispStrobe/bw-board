import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
const root='/tmp/labwired-same-host-20261003.R0T0cC/register-low-high-split-20261004';
const nativeRun=37176557440;
const source='5fed1f735dd48c899395a74f0565451c38a03716';
const toolRef='test/wasm-live-word-dispatch-20261002';
const toolHead='d1f2c8ebfc5e4e76d5fc81f930588c13de13e974';
const statePath=root+'/verification.json';
const gh=args=>execFileSync('gh',args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
function save(path,value) {
    const data=JSON.stringify(value,null,2)+'\n';
    const patch=existsSync(path)
        ?`*** Update File: ${path}\n@@\n${readFileSync(path,'utf8').trimEnd().split('\n').map(l=>'-'+l).join('\n')}\n${data.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n`
        :`*** Add File: ${path}\n${data.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n`;
    execFileSync('apply_patch',[],{input:`*** Begin Patch\n${patch}*** End Patch\n`,maxBuffer:8*1024*1024});
}
let state=existsSync(statePath)?JSON.parse(readFileSync(statePath)):{source,nativeRun,toolHead,toolRef,hostedOnly:true,publication:false,appPinChanges:false,startedAt:new Date().toISOString()};
assert.equal(state.source,source);
assert.equal(state.nativeRun,nativeRun);
if(state.dispatchAttemptedAt)throw Error('Previous build write exists; inspect remote rather than automatically redispatching');
save(statePath,state);
const deadline=Date.now()+6*60*60*1000;
while(Date.now()<deadline) {
    const native=JSON.parse(gh(['run','view',String(nativeRun),'-R','CrispStrobe/labwired-core','--json','status,conclusion,headSha,jobs,url']));
    assert.equal(native.headSha,source);
    if(native.status==='completed') {
        assert.equal(native.conclusion,'success','Source verification failed; do not build');
        const job=native.jobs.find(j=>j.name==='correctness');
        assert.equal(job?.conclusion,'success');
        const log=gh(['run','view',String(nativeRun),'-R','CrispStrobe/labwired-core','--log','--job',String(job.databaseId)]);
        for(const name of ["cached_scalar_matches_interpreter_for_every_halfword_and_flags","cached_runs_match_interpreter_across_budgets_branches_and_live_ram","cached_runs_stop_before_cold_collision_wide_and_dynamic_mmio_barriers"])assert.equal(log.split(name+" ... ok").length,4,name);
        assert.equal(log.split("cached_partitioned_registers_match_native_for_every_index_and_value ... ok").length,4);
        const results=[...log.matchAll(/test result: ok\. (\d+) passed; 0 failed; (\d+) ignored;/g)].map(m=>[Number(m[1]),Number(m[2])]);
        assert.equal(results.length,7);
        for(const result of results.slice(0,2)){assert.equal(result[0],13);assert.equal(result[1],0);}
        assert.deepEqual(results.slice(2),[[4235,3],[8,0],[4,0],[2,0],[2,0]]);
        save(root+'/source-ci.json',native);
        save(root+'/native-log.utf8.json',{encoding:'utf8',data:log});
        assert.equal(gh(['api',`repos/CrispStrobe/bw-board/git/ref/heads/${toolRef}`,'--jq','.object.sha']).trim(),toolHead,'Tool branch changed');
        state.nativeCorrectness=native;
        state.dispatchAttemptedAt=new Date().toISOString();
        state.buildInputs={ref:source,publish:false,qualify_motion:true};
        save(statePath,state); // Persist before any write; never retry ambiguous dispatch.
        gh(['workflow','run','labwired-wasm.yml','-R','CrispStrobe/bw-board','--ref',toolRef,
            '-f',`ref=${source}`,'-f','publish=false','-f','qualify_motion=true']);
        state.dispatchCommandCompletedAt=new Date().toISOString();
        save(statePath,state);
        for(let attempt=0;attempt<8;attempt++) {
            const runs=JSON.parse(gh(['run','list','-R','CrispStrobe/bw-board','--workflow','labwired-wasm.yml',
                '--branch',toolRef,'--event','workflow_dispatch','--limit','10','--json','databaseId,headSha,createdAt,url,status']));
            const matches=runs.filter(r=>r.headSha===toolHead&&Date.parse(r.createdAt)>=Date.parse(state.dispatchAttemptedAt)-1000);
            assert.ok(matches.length<=1,'Ambiguous build run; inspect manually');
            if(matches.length===1) {
                state.buildRun=matches[0];save(statePath,state);
                console.log('Low/high register split verification passed; new 108-test WASM build:',JSON.stringify(state.buildRun));
                process.exit(0);
            }
            await new Promise(resolve=>setTimeout(resolve,5000));
        }
        throw Error('Dispatch returned but build ID not yet visible; inspect remote, do not redispatch');
    }
    await new Promise(resolve=>setTimeout(resolve,45000));
}
throw Error('Six-hour source monitoring limit reached');
