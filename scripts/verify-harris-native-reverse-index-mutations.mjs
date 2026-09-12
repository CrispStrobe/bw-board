/** Rebuild reverse-index mutations and require each named contract test to fail.
 * Run only in an exclusive disposable worktree: sources are briefly mutated. */
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

if(!process.env.WASM_LD)throw new Error('WASM_LD required');
const root=fileURLToPath(new URL('../',import.meta.url));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),hash=value=>createHash('sha256').update(value).digest('hex');
const cases=[
    ['drop-inverse-membership','src/experimental/wired-kernel/evaluator-image.js',
        'for(let p=dependencyOffsets[operation];p<dependencyOffsets[operation+1];p++)reverse[dependencies[p]].push(operation);',
        'for(let p=dependencyOffsets[operation]+1;p<dependencyOffsets[operation+1];p++)reverse[dependencies[p]].push(operation);',
        'evaluator admission requires owned identities'],
    ['drop-affected-mark','src/experimental/wired-kernel/incremental-nets.c',
        'if(!(affected[operation>>5]&mask)){affected[operation>>5]|=mask;has_affected=1;}',
        'if(!(affected[operation>>5]&mask)){has_affected=1;}',
        'sparse evaluator outputs preserve multi-output'],
    ['reverse-marked-row-order','src/experimental/wired-kernel/net-resolver.c',
        'const u32 bit=__builtin_ctz(bits),i=word*32+bit;bits&=bits-1;',
        'const u32 bit=31-__builtin_clz(bits),i=word*32+bit;bits&=~(1u<<bit);',
        'sparse evaluator outputs preserve multi-output'],
    ['retain-operation-mark','src/experimental/wired-kernel/net-resolver.c',
        'u32 bits=affected[word];affected[word]=0;',
        'u32 bits=affected[word];',
        'sparse evaluator outputs preserve multi-output'],
    ['accept-inexact-inverse','src/experimental/wired-kernel/incremental-nets.c',
        'if(lo==reverse_offsets[net+1]||reverse_operations[lo]!=operation)return 4;',
        'if(0&&(lo==reverse_offsets[net+1]||reverse_operations[lo]!=operation))return 4;',
        'incremental admission rejects malformed or inexact reverse dependency images'],
    ['hide-reverse-visits','src/experimental/wired-kernel/incremental-nets.c',
        'const u32 operation=reverse_operations[p],mask=1u<<(operation&31);incremental_work[10]++;',
        'const u32 operation=reverse_operations[p],mask=1u<<(operation&31);',
        'sparse evaluator outputs preserve multi-output'],
    ['accept-old-incremental-mode','src/experimental/wired-kernel/net-resolver.c',
        'if(c[31]!=1&&c[31]!=4)return 0x80000006u;',
        'if(c[31]!=1&&c[31]!=2&&c[31]!=3&&c[31]!=4)return 0x80000006u;',
        'incremental admission requires unique membership']
];
const originals=new Map();for(const [,relative] of cases)if(!originals.has(relative))originals.set(relative,readFileSync(join(root,relative),'utf8'));
const results=[];
for(const [name,relative,from,to,testName] of cases){
    const path=join(root,relative),source=originals.get(relative);assert.equal(source.split(from).length-1,1,`${name}: exact mutation target`);
    const directory=mkdtempSync(join(tmpdir(),`harris-reverse-${name}-`));let run;
    try{
        writeFileSync(path,source.replace(from,to));
        execFileSync(process.execPath,['scripts/build-wired-net-kernel.mjs',directory],{cwd:root,env:process.env,stdio:'ignore'});
        const file=testName.startsWith('evaluator admission')?'test/harris-native-evaluators.test.mjs':'test/harris-native-incremental-nets.test.mjs';
        run=spawnSync(process.execPath,['--test','--test-name-pattern',testName,file],{
            cwd:root,env:{...process.env,HARRIS_NET_WASM:join(directory,'wired-net-kernel.wasm')},encoding:'utf8'});
    }finally{writeFileSync(path,source);}
    const output=`${run.stdout??''}${run.stderr??''}`,fired=run.status!==0&&output.includes('not ok')&&output.includes(testName);
    assert.equal(fired,true,`${name}: mutation must fail ${testName}`);results.push({name,testName,status:run.status,namedRed:true});
}
for(const [relative,source] of originals)assert.equal(readFileSync(join(root,relative),'utf8'),source,`${relative} restored`);
console.log(JSON.stringify({accepted:true,revision,sourceSHA256:Object.fromEntries([...originals].map(([name,source])=>[name,hash(source)])),kills:results.length,results},null,2));
