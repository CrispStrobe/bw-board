/** Hosted mutation proof for admitted-only native memory preview validation. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const mutations=[
    {name:'raw circuit wrongly uses owned preview',pattern:'cooperative producer labels',file:'memory-circuit.c',
        from:'if(c[31])result=preview_owned_memory_banks',to:'if(1)result=preview_owned_memory_banks'},
    {name:'admitted circuit keeps checked preview',pattern:'cooperative producer labels',file:'memory-circuit.c',
        from:'if(c[31])result=preview_owned_memory_banks',to:'if(0)result=preview_owned_memory_banks'},
    {name:'public preview accepts malformed protection',pattern:'public native memory preview',file:'memory-banks.c',
        from:'if(protected_rom[b]>1)return fail_memory(9,b,NONE,fault);',to:'(void)protected_rom[b];'},
    {name:'public preview accepts invalid level encoding',pattern:'public native memory preview',file:'memory-banks.c',
        from:'inputs[b*PINS+p]>3',to:'inputs[b*PINS+p]>4'},
    {name:'public preview accepts out-of-range state address',pattern:'public native memory preview',file:'memory-banks.c',
        from:'s[0]>3||s[1]>=SIZE',to:'s[0]>3||s[1]>SIZE'},
    {name:'peer commit loop stops after first bank',pattern:'late peer-bank fault',file:'memory-banks.c',
        from:'/* Commit the old pending bytes only after all peer previews succeeded. */\n    for(u32 b=0;b<banks;b++) {',
        to:'/* Commit the old pending bytes only after all peer previews succeeded. */\n    for(u32 b=0;b<1;b++) {'},
    {name:'owned preview ABI version is stale',pattern:'owned circuit memory preview',file:'memory-circuit.c',
        from:'u32 memory_circuit_version(void){return 3;}',to:'u32 memory_circuit_version(void){return 2;}'}
];
for(const mutation of mutations){
    const sandbox=mkdtempSync(join(tmpdir(),'harris-owned-memory-preview-mutant.'));
    try{
        mkdirSync(join(sandbox,'scripts'),{recursive:true});mkdirSync(join(sandbox,'src/experimental'),{recursive:true});
        cpSync(join(root,'src/experimental/wired-kernel'),join(sandbox,'src/experimental/wired-kernel'),{recursive:true});
        cpSync(join(root,'scripts/build-wired-net-kernel.mjs'),join(sandbox,'scripts/build-wired-net-kernel.mjs'));
        const path=join(sandbox,'src/experimental/wired-kernel',mutation.file),source=readFileSync(path,'utf8');
        assert.equal(source.split(mutation.from).length-1,1,`${mutation.name} source shape`);
        writeFileSync(path,source.replace(mutation.from,mutation.to));
        const build=join(sandbox,'build');mkdirSync(build);
        execFileSync(process.execPath,[join(sandbox,'scripts/build-wired-net-kernel.mjs'),build],{stdio:'pipe'});
        let output='',failed=false;
        try{execFileSync(process.execPath,['--test',`--test-name-pattern=${mutation.pattern}`,
            'test/harris-native-memory.test.mjs','test/harris-native-memory-circuit.test.mjs',
            'test/harris-native-producer-counters.test.mjs'],{cwd:root,
            env:{...process.env,HARRIS_NET_WASM:join(build,'wired-net-kernel.wasm')},encoding:'utf8'});}
        catch(error){failed=true;output=`${error.stdout??''}${error.stderr??''}`;}
        assert.equal(failed,true,`${mutation.name} must be rejected`);
        assert.ok(output.includes(mutation.pattern),`${mutation.name} named red`);
        console.log(`# mutation rejected: ${mutation.name}`);
    }finally{rmSync(sandbox,{recursive:true,force:true});}
}
console.log(`# mutations rejected: ${mutations.length}`);
