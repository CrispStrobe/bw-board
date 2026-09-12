/** Hosted mutation proof for instance-local immutable bus-map admission. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const mapRefusal='bus admission refuses each final map entry, bound and live value';
const boundary='bus admission accepts the exact 128-external boundary';
const authority='admitted runtime refuses stale pointer, count and graph-bound authority';
const capture='post-admission arena map edits cannot redirect any of the three consumers';
const revocation='every bus, graph and memory re-admission attempt revokes';
const resets='logical, sequencer and counter reset preserve mapping authority';
const raw='raw mode retains full final-entry map and live-level validation';
const rawCount='raw mode accepts count 128 and refuses 129 before a writer';
const midPeriod='mid-period re-admission invalidates the end edge before phase preview or memory commit';
const mutations=[
    {name:'128-entry external boundary is rejected',pattern:boundary,file:'bus-circuit.c',
        from:'count>128)',to:'count>=128)'},
    {name:'external count bound is omitted',pattern:mapRefusal,file:'bus-circuit.c',
        from:'||count>128)',to:'||0)'},
    {name:'admission accepts input net at the bound',pattern:mapRefusal,file:'bus-circuit.c',
        from:'if(W(2)[i]>=c[0])return reject_bus_admission',to:'if(W(2)[i]>c[0])return reject_bus_admission'},
    {name:'admission accepts output driver at the bound',pattern:mapRefusal,file:'bus-circuit.c',
        from:'if(W(3)[i]>=c[1])return reject_bus_admission',to:'if(W(3)[i]>c[1])return reject_bus_admission'},
    {name:'admission accepts external driver at the bound',pattern:mapRefusal,file:'bus-circuit.c',
        from:'bus_admission_work[5]++;if(W(4)[i]>=c[1]||B(5)[i]>3)',
        to:'bus_admission_work[5]++;if(W(4)[i]>c[1]||B(5)[i]>3)'},
    {name:'admission accepts malformed live level',pattern:mapRefusal,file:'bus-circuit.c',
        from:'bus_admission_work[5]++;if(W(4)[i]>=c[1]||B(5)[i]>3)',
        to:'bus_admission_work[5]++;if(W(4)[i]>=c[1]||B(5)[i]>4)'},
    {name:'input admission validation omits its final entry',pattern:mapRefusal,file:'bus-circuit.c',
        from:'for(u32 i=0;i<24;i++){bus_admission_work[3]++;',
        to:'for(u32 i=0;i<23;i++){bus_admission_work[3]++;'},
    {name:'output admission validation omits its final entry',pattern:mapRefusal,file:'bus-circuit.c',
        from:'for(u32 i=0;i<48;i++){bus_admission_work[4]++;',
        to:'for(u32 i=0;i<47;i++){bus_admission_work[4]++;'},
    {name:'external admission validation omits its final entry',pattern:mapRefusal,file:'bus-circuit.c',
        from:'for(u32 i=0;i<count;i++){bus_admission_work[5]++;',
        to:'for(u32 i=0;i+1<count;i++){bus_admission_work[5]++;'},
    {name:'input map capture omits its final entry',pattern:capture,file:'bus-circuit.c',
        from:'for(u32 i=0;i<24;i++)admitted_inputs[i]=W(2)[i];',to:'for(u32 i=0;i<23;i++)admitted_inputs[i]=W(2)[i];'},
    {name:'output map capture omits its final entry',pattern:capture,file:'bus-circuit.c',
        from:'for(u32 i=0;i<48;i++)admitted_outputs[i]=W(3)[i];',to:'for(u32 i=0;i<47;i++)admitted_outputs[i]=W(3)[i];'},
    {name:'external map capture omits its final entry',pattern:capture,file:'bus-circuit.c',
        from:'for(u32 i=0;i<count;i++)admitted_externals[i]=W(4)[i];',to:'for(u32 i=0;i+1<count;i++)admitted_externals[i]=W(4)[i];'},
    {name:'gather reads mutable arena map',pattern:capture,file:'bus-circuit.c',
        from:'static const u32 *input_map(const u32*p){return p[10]?admitted_inputs:W(2);}',
        to:'static const u32 *input_map(const u32*p){return W(2);}'},
    {name:'CPU output publication reads mutable arena map',pattern:capture,file:'bus-circuit.c',
        from:'static const u32 *output_map(const u32*p){return p[10]?admitted_outputs:W(3);}',
        to:'static const u32 *output_map(const u32*p){return W(3);}'},
    {name:'external publication reads mutable arena map',pattern:capture,file:'bus-circuit.c',
        from:'static const u32 *external_map(const u32*p){return p[10]?admitted_externals:W(4);}',
        to:'static const u32 *external_map(const u32*p){return W(4);}'},
    {name:'bus admission attempt retains the old grant',pattern:revocation,file:'bus-circuit.c',
        from:'revoke_owned_bus_admission();bus_admission_work[0]++;',to:'bus_admission_work[0]++;'},
    {name:'graph re-admission retains a derived bus grant',pattern:revocation,file:'net-resolver.c',
        from:'admitted_context=0;admitted_mode=0;revoke_owned_bus_admission();',to:'admitted_context=0;admitted_mode=0;'},
    {name:'runtime accepts changed input pointer',pattern:authority,file:'bus-circuit.c',
        from:'admitted_input_pointer==W(2)&&',to:'1&&'},
    {name:'runtime accepts changed output pointer',pattern:authority,file:'bus-circuit.c',
        from:'admitted_output_pointer==W(3)&&',to:'1&&'},
    {name:'runtime accepts changed external pointer',pattern:authority,file:'bus-circuit.c',
        from:'admitted_external_pointer==W(4)&&',to:'1&&'},
    {name:'runtime accepts changed value pointer',pattern:authority,file:'bus-circuit.c',
        from:'admitted_values_pointer==B(5)&&',to:'1&&'},
    {name:'runtime accepts changed external count',pattern:authority,file:'bus-circuit.c',
        from:'admitted_external_count==p[6]&&',to:'1&&'},
    {name:'runtime accepts changed net bound',pattern:authority,file:'bus-circuit.c',
        from:'admitted_nets==c[0]&&',to:'1&&'},
    {name:'runtime accepts changed driver bound',pattern:authority,file:'bus-circuit.c',
        from:'admitted_drivers==c[1];',to:'1;'},
    {name:'runtime accepts foreign graph and memory authority',pattern:authority,file:'bus-circuit.c',
        from:'admitted_graph_context==c&&owned_graph_context_is_admitted(c)&&\n        owned_memory_context_is_admitted(c)&&',to:'1&&'},
    {name:'runtime accepts another bus context',pattern:authority,file:'bus-circuit.c',
        from:'return admitted_bus_context==p&&',to:'return 1&&'},
    {name:'raw context takes admitted fast path',pattern:raw,file:'bus-circuit.c',
        from:'if(!p[10])return validate_raw_bus_mapping(p,fault);',to:'if(0)return validate_raw_bus_mapping(p,fault);'},
    {name:'raw context omits its external count bound',pattern:rawCount,file:'bus-circuit.c',
        from:'if(p[6]>128)return failure(p,8,2,0,fault);',to:'if(0)return failure(p,8,2,0,fault);'},
    {name:'end edge omits its admitted authority check',pattern:midPeriod,file:'bus-circuit.c',
        from:'if(p[10]&&!admitted_bus_grant_matches(p))return failure(p,8,2,0,fault);',
        to:'if(0)return failure(p,8,2,0,fault);'},
    {name:'live validation occurs after an external writer',pattern:resets,file:'bus-circuit.c',edits:[
        {from:'if(B(5)[i]>3){',to:'if(0&&B(5)[i]>3){'},
        {from:'if(stage_bus_driver(W(0),external[i],B(5)[i],PRODUCER_BUS_EXTERNAL))',
            to:'if((((u8*)(unsigned long)W(0)[4])[external[i]]=B(5)[i],0))'}]},
    {name:'bus admission ABI version is stale',pattern:'admitted bus captures exact maps once',file:'bus-circuit.c',
        from:'u32 bus_admission_version(void){return 1;}',to:'u32 bus_admission_version(void){return 2;}'}
];

for(const mutation of mutations){
    const sandbox=mkdtempSync(join(tmpdir(),'harris-bus-admission-mutant.'));
    try{
        mkdirSync(join(sandbox,'scripts'),{recursive:true});mkdirSync(join(sandbox,'src/experimental'),{recursive:true});
        cpSync(join(root,'src/experimental/wired-kernel'),join(sandbox,'src/experimental/wired-kernel'),{recursive:true});
        cpSync(join(root,'scripts/build-wired-net-kernel.mjs'),join(sandbox,'scripts/build-wired-net-kernel.mjs'));
        const path=join(sandbox,'src/experimental/wired-kernel',mutation.file),source=readFileSync(path,'utf8');let changed=source;
        for(const edit of mutation.edits??[mutation]){
            assert.equal(changed.split(edit.from).length-1,1,`${mutation.name}: exact source selector`);
            changed=changed.replace(edit.from,edit.to);
        }
        writeFileSync(path,changed);const build=join(sandbox,'build');mkdirSync(build);
        execFileSync(process.execPath,[join(sandbox,'scripts/build-wired-net-kernel.mjs'),build],{stdio:'pipe'});
        let output='',failed=false;
        try{execFileSync(process.execPath,['--test',`--test-name-pattern=${mutation.pattern}`,'test/harris-native-bus-admission.test.mjs',
            'test/harris-native-bus-circuit.test.mjs'],{cwd:root,env:{...process.env,HARRIS_NET_WASM:join(build,'wired-net-kernel.wasm')},encoding:'utf8'});}
        catch(error){failed=true;output=`${error.stdout??''}${error.stderr??''}`;}
        assert.equal(failed,true,`${mutation.name}: mutation must be rejected`);
        assert.ok(output.includes(mutation.pattern),`${mutation.name}: named behavioral red`);
        console.log(`# mutation rejected: ${mutation.name}`);
    }finally{rmSync(sandbox,{recursive:true,force:true});}
}
console.log(`# mutations rejected: ${mutations.length}`);
