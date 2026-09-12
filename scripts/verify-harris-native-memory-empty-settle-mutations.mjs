/** Hosted mutation proof for omitting no-work post-memory settles. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const counters='cooperative producer labels reconcile';
const differential='same-instance bus/actual-net/controller/memory oracle compares every boundary';
const mutations=[
    {name:'restored every post-memory settle',pattern:counters,from:'if(driver_changed) {',to:'if(1) {'},
    {name:'skipped a required dirty settle',pattern:differential,from:'if(driver_changed) {',to:'if(0&&driver_changed) {'},
    {name:'inverted raw driver comparison',pattern:differential,from:'if(U8(4)[id]!=value)driver_changed=1;',
        to:'if(U8(4)[id]==value)driver_changed=1;'},
    {name:'returned before a required internal follow-up pass',pattern:differential,
        from:'} else memory_pass_work[7]++;\n        if(!changed)',
        to:'} else {memory_pass_work[7]++;fault[0]=0;return 0;}\n        if(!changed)'},
    {name:'bypassed canonical tagged memory writer',pattern:differential,
        from:'if(write_owned_driver_tagged(c,id,value,PRODUCER_MEMORY_BANK)){fault[0]=1;fault[1]=2;return 1;}',
        to:'if((U8(4)[id]=value,0)){fault[0]=1;fault[1]=2;return 1;}'},
    {name:'lost skipped-settle diagnostic',pattern:counters,from:'else memory_pass_work[7]++;',to:'else (void)driver_changed;'}
];
for(const mutation of mutations){
    const sandbox=mkdtempSync(join(tmpdir(),'harris-empty-settle-mutant.'));
    try{
        mkdirSync(join(sandbox,'scripts'),{recursive:true});mkdirSync(join(sandbox,'src/experimental'),{recursive:true});
        cpSync(join(root,'src/experimental/wired-kernel'),join(sandbox,'src/experimental/wired-kernel'),{recursive:true});
        cpSync(join(root,'scripts/build-wired-net-kernel.mjs'),join(sandbox,'scripts/build-wired-net-kernel.mjs'));
        const path=join(sandbox,'src/experimental/wired-kernel/memory-circuit.c'),source=readFileSync(path,'utf8');
        assert.equal(source.split(mutation.from).length-1,1,`${mutation.name}: exact mutation target`);
        writeFileSync(path,source.replace(mutation.from,mutation.to));
        const build=join(sandbox,'build');mkdirSync(build);
        execFileSync(process.execPath,[join(sandbox,'scripts/build-wired-net-kernel.mjs'),build],{stdio:'pipe'});
        let output='',failed=false;
        try{execFileSync(process.execPath,['--test',`--test-name-pattern=${mutation.pattern}`,
            mutation.pattern===counters?'test/harris-native-producer-counters.test.mjs':'test/harris-native-bus-circuit.test.mjs'],
        {cwd:root,env:{...process.env,HARRIS_NET_WASM:join(build,'wired-net-kernel.wasm')},encoding:'utf8'});}
        catch(error){failed=true;output=`${error.stdout??''}${error.stderr??''}`;}
        assert.equal(failed,true,`${mutation.name}: mutation must be rejected`);
        assert.ok(output.includes(mutation.pattern),`${mutation.name}: named red`);
        console.log(`# mutation rejected: ${mutation.name}`);
    }finally{rmSync(sandbox,{recursive:true,force:true});}
}
console.log(`# mutations rejected: ${mutations.length}`);
