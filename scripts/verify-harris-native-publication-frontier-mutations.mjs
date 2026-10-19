/** Rebuild publication-frontier mutations and require a named regression to fail.
 * Run only in an exclusive disposable worktree: the source is briefly mutated. */
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

if(!process.env.WASM_LD)throw new Error('WASM_LD required');
const root=fileURLToPath(new URL('../',import.meta.url));
const relative='src/experimental/wired-kernel/incremental-nets.c';
const cases=[
    ['no-candidate-enqueue',
        'if((B(5)[n]!=B(10)[n]||B(6)[n]!=B(11)[n])&&!queued_publish[n]){',
        'if(0&&((B(5)[n]!=B(10)[n]||B(6)[n]!=B(11)[n])&&!queued_publish[n])){',
        'incremental resolver matches checked deltas'],
    ['ignore-conflict-change',
        'if((B(5)[n]!=B(10)[n]||B(6)[n]!=B(11)[n])&&!queued_publish[n]){',
        'if(B(5)[n]!=B(10)[n]&&!queued_publish[n]){',
        'incremental resolver matches checked deltas'],
    ['duplicate-candidates',
        '&&!queued_publish[n]){',
        '){',
        'publication candidate queue stays bounded'],
    ['publish-failed-fixpoint',
        'return 0x80000003u;',
        'publish_incremental(c);return 0x80000003u;',
        'incremental nonconvergence preserves published state'],
    ['discard-failed-candidates',
        'return 0x80000003u;',
        'for(u32 i=0;i<publish_count;i++)queued_publish[publish_queue[i]]=0;publish_count=0;return 0x80000003u;',
        'incremental nonconvergence preserves published state'],
    ['copy-reverted-candidate',
        'if(B(10)[n]!=B(5)[n]||B(11)[n]!=B(6)[n]){',
        'if(1){',
        'incremental nonconvergence preserves published state'],
    ['retain-old-graph-queue',
        'driver_count=0;dirty_count=0;changed_count=0;publish_count=0;',
        'driver_count=0;dirty_count=0;changed_count=0;',
        'incremental nonconvergence preserves published state']
];
const path=join(root,relative),original=readFileSync(path,'utf8'),results=[];
for(const [name,from,to,testName] of cases){
    assert.equal(original.split(from).length-1,1,`${name}: exact mutation target`);
    const directory=mkdtempSync(join(tmpdir(),`harris-publication-${name}-`));
    try{
        writeFileSync(path,original.replace(from,to));
        execFileSync(process.execPath,['scripts/build-wired-net-kernel.mjs',directory],{cwd:root,env:process.env,stdio:'ignore'});
    }finally{writeFileSync(path,original);}
    const run=spawnSync(process.execPath,['--test','--test-name-pattern',testName,'test/harris-native-incremental-nets.test.mjs'],{
        cwd:root,env:{...process.env,HARRIS_NET_WASM:join(directory,'wired-net-kernel.wasm')},encoding:'utf8'});
    const output=`${run.stdout??''}${run.stderr??''}`,fired=run.status!==0&&output.includes('not ok')&&output.includes(testName);
    assert.equal(fired,true,`${name}: mutation must fail ${testName}`);
    results.push({name,testName,status:run.status,namedRed:true});
}
assert.equal(readFileSync(path,'utf8'),original,'source restored after mutations');
console.log(JSON.stringify({accepted:true,kills:results.length,results},null,2));
