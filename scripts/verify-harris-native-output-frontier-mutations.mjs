/** Rebuild sparse-output mutations and require the named contract test to fail.
 * Run only in an exclusive disposable worktree: sources are briefly mutated. */
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

if(!process.env.WASM_LD)throw new Error('WASM_LD required');
const root=fileURLToPath(new URL('../',import.meta.url)),testName='sparse evaluator outputs preserve multi-output';
const cases=[
    ['drop-mux-outputs','src/experimental/wired-kernel/net-resolver.c',
        'else {outputs=r+11;count_outputs=4;}','else {outputs=r+11;count_outputs=1;}'],
    ['remove-output-dedup','src/experimental/wired-kernel/net-resolver.c',
        'for(u32 j=0;j<count_outputs;j++)if(!queued[outputs[j]]){','for(u32 j=0;j<count_outputs;j++)if(1){'],
    ['reverse-row-order','src/experimental/wired-kernel/net-resolver.c',
        'u32 queued_count=0;\n    for(u32 i=0;i<count;i++) {','u32 queued_count=0;\n    for(u32 i=count;i-->0;) {'],
    ['evaluate-unaffected-rows','src/experimental/wired-kernel/net-resolver.c',
        'if(!affected_operation(i,dep_offsets,deps,changed))continue;','(void)affected_operation(i,dep_offsets,deps,changed);'],
    ['retain-output-flags','src/experimental/wired-kernel/incremental-nets.c',
        'const u32 d=output_queue[i];queued_output[d]=0;incremental_work[0]++;',
        'const u32 d=output_queue[i];incremental_work[0]++;'],
    ['compare-wrong-output','src/experimental/wired-kernel/incremental-nets.c',
        'const u32 d=output_queue[i];queued_output[d]=0;incremental_work[0]++;',
        'const u32 d=i;queued_output[output_queue[i]]=0;incremental_work[0]++;']
];
const originals=new Map();for(const [,relative] of cases)if(!originals.has(relative))originals.set(relative,readFileSync(join(root,relative),'utf8'));
const results=[];
for(const [name,relative,from,to] of cases){
    const path=join(root,relative),source=originals.get(relative);assert.equal(source.split(from).length-1,1,`${name}: exact mutation target`);
    const directory=mkdtempSync(join(tmpdir(),`harris-output-${name}-`));
    try{
        writeFileSync(path,source.replace(from,to));
        execFileSync(process.execPath,['scripts/build-wired-net-kernel.mjs',directory],{cwd:root,env:process.env,stdio:'ignore'});
    }finally{writeFileSync(path,source);}
    const run=spawnSync(process.execPath,['--test','--test-name-pattern',testName,'test/harris-native-incremental-nets.test.mjs'],{
        cwd:root,env:{...process.env,HARRIS_NET_WASM:join(directory,'wired-net-kernel.wasm')},encoding:'utf8'});
    const output=`${run.stdout??''}${run.stderr??''}`,fired=run.status!==0&&output.includes('not ok')&&output.includes(testName);
    assert.equal(fired,true,`${name}: mutation must fail ${testName}`);results.push({name,testName,status:run.status,namedRed:true});
}
for(const [relative,source] of originals)assert.equal(readFileSync(join(root,relative),'utf8'),source,`${relative} restored`);
console.log(JSON.stringify({accepted:true,kills:results.length,results},null,2));
