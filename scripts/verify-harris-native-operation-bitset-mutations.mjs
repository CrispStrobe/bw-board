/** Rebuild operation-bitset mutations and require named contract failures.
 * Run only in an exclusive worktree: sources are briefly mutated and restored. */
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

if(!process.env.WASM_LD)throw new Error('WASM_LD required');
const root=fileURLToPath(new URL('../',import.meta.url)),boundary='operation bitset preserves row order',dirty='incremental dirty queues initialize',admission='incremental admission requires unique membership';
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),hash=value=>createHash('sha256').update(value).digest('hex');
const cases=[
    ['floor-word-count','src/experimental/wired-kernel/net-resolver.c','for(u32 word=0;word<(count+31)/32;word++) {','for(u32 word=0;word<count/32;word++) {',boundary],
    ['replace-mark-or','src/experimental/wired-kernel/incremental-nets.c',
        'if(!(affected[operation>>5]&mask)){affected[operation>>5]|=mask;has_affected=1;}',
        'if(!(affected[operation>>5]&mask)){affected[operation>>5]=mask;has_affected=1;}',boundary],
    ['reverse-bit-order','src/experimental/wired-kernel/net-resolver.c','const u32 bit=__builtin_ctz(bits),i=word*32+bit;bits&=bits-1;',
        'const u32 bit=31-__builtin_clz(bits),i=word*32+bit;bits&=~(1u<<bit);',boundary],
    ['reverse-word-order','src/experimental/wired-kernel/net-resolver.c','for(u32 word=0;word<(count+31)/32;word++) {',
        'for(u32 word=(count+31)/32;word-->0;) {',boundary],
    ['retain-word-marks','src/experimental/wired-kernel/net-resolver.c','u32 bits=affected[word];affected[word]=0;',
        'u32 bits=affected[word];',boundary],
    ['omit-admission-clear','src/experimental/wired-kernel/incremental-nets.c','for(u32 word=0;word<(c[7]+31)/32;word++)affected[word]=0;',
        'for(u32 word=0;word<0;word++)affected[word]=0;',dirty],
    ['hide-word-visits','src/experimental/wired-kernel/net-resolver.c','incremental_work[11]++;','(void)word;',boundary],
    ['accept-abi3-mode','src/experimental/wired-kernel/net-resolver.c','if(c[31]!=1&&c[31]!=4)return 0x80000006u;',
        'if(c[31]!=1&&c[31]!=2&&c[31]!=3&&c[31]!=4)return 0x80000006u;',admission]
];
const originals=new Map();for(const [,relative] of cases)if(!originals.has(relative))originals.set(relative,readFileSync(join(root,relative),'utf8'));
const results=[];
for(const [name,relative,from,to,testName] of cases){
    const path=join(root,relative),source=originals.get(relative);assert.equal(source.split(from).length-1,1,`${name}: exact mutation target`);
    const directory=mkdtempSync(join(tmpdir(),`harris-bitset-${name}-`));let run;
    try{
        writeFileSync(path,source.replace(from,to));
        execFileSync(process.execPath,['scripts/build-wired-net-kernel.mjs',directory],{cwd:root,env:process.env,stdio:'ignore'});
        run=spawnSync(process.execPath,['--test','--test-name-pattern',testName,'test/harris-native-incremental-nets.test.mjs'],{
            cwd:root,env:{...process.env,HARRIS_NET_WASM:join(directory,'wired-net-kernel.wasm')},encoding:'utf8'});
    }finally{writeFileSync(path,source);}
    const output=`${run.stdout??''}${run.stderr??''}`,fired=run.status!==0&&output.includes('not ok')&&output.includes(testName);
    assert.equal(fired,true,`${name}: mutation must fail ${testName}`);results.push({name,testName,status:run.status,namedRed:true});
}
for(const [relative,source] of originals)assert.equal(readFileSync(join(root,relative),'utf8'),source,`${relative} restored`);
console.log(JSON.stringify({accepted:true,revision,sourceSHA256:Object.fromEntries([...originals].map(([name,source])=>[name,hash(source)])),kills:results.length,results},null,2));
