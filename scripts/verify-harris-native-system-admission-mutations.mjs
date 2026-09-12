/** Hosted mutation proof for the graph + immutable memory-map admission grant. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const mutations=[
    {name:'admission accepts input net at the bound',pattern:'combined admission rejects',file:'memory-circuit.c',
        from:'memory_admission_work[3]++;if(input_nets[i]>=c[0])',to:'memory_admission_work[3]++;if(input_nets[i]>c[0])'},
    {name:'admission accepts output driver at the bound',pattern:'combined admission rejects',file:'memory-circuit.c',
        from:'memory_admission_work[4]++;if(output_ids[i]>=c[1])',to:'memory_admission_work[4]++;if(output_ids[i]>c[1])'},
    {name:'admission accepts duplicate memory outputs',pattern:'combined admission rejects',file:'memory-circuit.c',
        from:'if(output_ids[i]==output_ids[j])return reject_memory_admission(fault,4);',to:'if(0&&output_ids[i]==output_ids[j])return reject_memory_admission(fault,4);'},
    {name:'admission accepts malformed protection',pattern:'combined admission rejects',file:'memory-circuit.c',
        from:'if(protected_rom[i]>1)return reject_memory_admission(fault,5);',to:'if(protected_rom[i]>2)return reject_memory_admission(fault,5);'},
    {name:'failed combined admission retains graph trust',pattern:'combined admission rejects',file:'memory-circuit.c',
        from:'admitted_memory_context=0;revoke_owned_graph_admission();memory_admission_work[2]++;',
        to:'admitted_memory_context=0;memory_admission_work[2]++;'},
    {name:'graph-only admission retains memory trust',pattern:'graph-only admission',file:'net-resolver.c',
        from:'revoke_owned_memory_admission();\n    return admit_owned_context_for_memory(c);',
        to:'return admit_owned_context_for_memory(c);'},
    {name:'admitted runtime rejects its valid grant',pattern:'admission proves immutable',file:'memory-circuit.c',
        from:'if(c[31]&&admitted_memory_context!=c)',to:'if(c[31]&&admitted_memory_context==c)'},
    {name:'admitted runtime repeats immutable validation',pattern:'admission proves immutable',file:'memory-circuit.c',
        from:'if(!c[31]){\n    for(u32 i=0;i<banks*28;i++){memory_admission_work[7]++;',
        to:'if(1){\n    for(u32 i=0;i<banks*28;i++){memory_admission_work[7]++;'},
    {name:'memory admission ABI version is stale',pattern:'admission proves immutable',file:'memory-circuit.c',
        from:'u32 memory_admission_version(void){return 1;}',to:'u32 memory_admission_version(void){return 2;}'}
];

for(const mutation of mutations){
    const sandbox=mkdtempSync(join(tmpdir(),'harris-system-admission-mutant.'));
    try{
        mkdirSync(join(sandbox,'scripts'),{recursive:true});mkdirSync(join(sandbox,'src/experimental'),{recursive:true});
        cpSync(join(root,'src/experimental/wired-kernel'),join(sandbox,'src/experimental/wired-kernel'),{recursive:true});
        cpSync(join(root,'scripts/build-wired-net-kernel.mjs'),join(sandbox,'scripts/build-wired-net-kernel.mjs'));
        const path=join(sandbox,'src/experimental/wired-kernel',mutation.file),source=readFileSync(path,'utf8');
        assert.equal(source.split(mutation.from).length-1,1,`${mutation.name} exact source selector`);
        writeFileSync(path,source.replace(mutation.from,mutation.to));
        const build=join(sandbox,'build');mkdirSync(build);
        execFileSync(process.execPath,[join(sandbox,'scripts/build-wired-net-kernel.mjs'),build],{stdio:'pipe'});
        let output='',failed=false;
        try{execFileSync(process.execPath,['--test',`--test-name-pattern=${mutation.pattern}`,'test/harris-native-system-admission.test.mjs'],
            {cwd:root,env:{...process.env,HARRIS_NET_WASM:join(build,'wired-net-kernel.wasm')},encoding:'utf8'});}
        catch(error){failed=true;output=`${error.stdout??''}${error.stderr??''}`;}
        assert.equal(failed,true,`${mutation.name} must be rejected`);
        assert.ok(output.includes(mutation.pattern),`${mutation.name} named behavioral red`);
        console.log(`# mutation rejected: ${mutation.name}`);
    }finally{rmSync(sandbox,{recursive:true,force:true});}
}
console.log(`# mutations rejected: ${mutations.length}`);
