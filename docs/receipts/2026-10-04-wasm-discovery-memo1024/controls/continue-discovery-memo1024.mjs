import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,existsSync,statfsSync} from 'node:fs';
const exec=promisify(execFile);
const root='/mnt/volume1/code/lego/labwired-same-host-20261003.R0T0cC';
const experiment='/mnt/storage/code/labwired-evidence/labwired-same-host-20261003.R0T0cC/discovery-memo1024-20261004';
const run=async(args,options={})=>{
    const result=await exec(process.execPath,args,{cwd:root,maxBuffer:8*1024*1024,...options});
    if(result.stdout)console.log(result.stdout);
    if(result.stderr)console.error(result.stderr);
};
const proof=JSON.parse(readFileSync('/mnt/storage/code/labwired-evidence/labwired-same-host-20261003.R0T0cC/discovery-memo1024-source-contract.json'));
assert.equal(proof.source,'30131a9068e7c4aff6540092bce0a019f3b5c021');
assert.equal(proof.cpuReconstructionExact,true);
assert.equal(proof.nativeDispatchUnchanged,true);
const disk=statfsSync(root);
assert(disk.bavail*disk.bsize>128*1024*1024,'Small receipt reserve required; no cleanup');
assert(!existsSync(experiment+'/verification.json'),'Controller already started; inspect saved phase instead of restarting');
console.log('Hosted-only discovery memo capacity controller: native verification, independent build, then four frozen ordinary pairs. No merge/publication.');
await run([root+'/verify-discovery-memo1024-hosted.mjs']);
const state=JSON.parse(readFileSync(experiment+'/verification.json'));
assert.equal(state.nativeCorrectness.conclusion,'success');
assert.equal(state.source,proof.source);
assert(Number.isSafeInteger(state.buildRun.databaseId));
const config={nativeRun:state.nativeRun,sources:{baseline:{run:36915940413,
    commit:proof.base,toolHead:'1cac10ba28ddd5e71c5a7e32437a3b0080d47f14',integrationTests:101},
    candidate:{run:state.buildRun.databaseId,commit:proof.source,toolHead:state.toolHead,integrationTests:108}}};
// execFile has no stdin input option: send the generated patch through the
// child pipe without shell expansion, preserving authored file constraints.
async function addViaPipe(path,data){
    assert(!existsSync(path),'Preserve existing '+path);
    const {spawn}=await import('node:child_process');
    const patch='*** Begin Patch\n*** Add File: '+path+'\n'+data.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n';
    await new Promise((resolve,reject)=>{
        const child=spawn('apply_patch',[],{stdio:['pipe','inherit','inherit']});
        child.on('error',reject);
        child.on('exit',code=>code===0?resolve():reject(Error('Patch failed: '+code)));
        child.stdin.end(patch);
    });
}
await addViaPipe(experiment+'/config.json',JSON.stringify(config,null,2)+'\n');
const evaluator=readFileSync(root+'/edge-eligibility-bool-tail-20261003/evaluate-hosted.mjs','utf8');
await addViaPipe(experiment+'/evaluate-hosted.mjs',evaluator);
await run([experiment+'/evaluate-hosted.mjs','--self-test']);
await run([experiment+'/evaluate-hosted.mjs']);
console.log('Complete: all ordinary paired receipts retained. Inspect every gain, loss and floor before deciding.');
