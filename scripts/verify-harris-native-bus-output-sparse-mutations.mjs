/** Hosted mutation proof for the native CPU bus-output dirty frontier. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const frontier='CPU output frontier publishes the full first image then skips an identical reset image';
const differential='same-instance bus/actual-net/controller/memory oracle compares every boundary';
const mutations=[
    {name:'missing full first publication',pattern:frontier,edits:[{file:'bus-sequencer.c',
        from:'output_changes[0]=output_changes[1]=0;first_outputs=1;',
        to:'output_changes[0]=output_changes[1]=0;first_outputs=0;'}]},
    {name:'retained prior dirty mask',pattern:frontier,edits:[{file:'bus-sequencer.c',
        from:'    output_changes[0]=output_changes[1]=0;\n    for(u32 i=0;i<24;i++)set_output',
        to:'    (void)output_changes;\n    for(u32 i=0;i<24;i++)set_output'}]},
    {name:'inverted final-image comparison',pattern:frontier,edits:[{file:'bus-sequencer.c',
        from:'if(first_outputs||outputs[pin]!=value)',to:'if(first_outputs||outputs[pin]==value)'}]},
    {name:'collapsed 31/32 mask boundary',pattern:frontier,edits:[{file:'bus-sequencer.c',
        from:'output_changes[pin>>5]|=1u<<(pin&31);',to:'output_changes[pin>>5]|=1u<<(pin&30);'}]},
    {name:'published every unmarked output',pattern:frontier,edits:[{file:'bus-circuit.c',
        from:'const u32 changed[2]={bus_output_change_word(0),bus_output_change_word(1)};',
        to:'const u32 changed[2]={~0u,~0u};'}]},
    {name:'bypassed canonical tagged writer',pattern:differential,edits:[{file:'bus-circuit.c',
        from:'stage_bus_driver(W(0),outputs[i],(u8)output[i],PRODUCER_BUS_OUTPUT)',
        to:'(((u8*)(unsigned long)W(0)[4])[outputs[i]]=(u8)output[i],0)'}]},
    {name:'omitted address output computation',pattern:differential,edits:[{file:'bus-sequencer.c',
        from:'for(u32 i=0;i<24;i++)set_output(i,(b.address>>i)&1);',
        to:'for(u32 i=0;i<24;i++)set_output(i,0);'}]},
    {name:'omitted active write data image',pattern:differential,edits:[{file:'bus-sequencer.c',
        from:'if(active)value=(i<8?active->a0!=0:active->bhe!=0)?3:(active->data>>i)&1;',
        to:'if(active)value=3;'}]},
    {name:'omitted status control transition',pattern:differential,edits:[{file:'bus-sequencer.c',
        from:'set_output(41,b.state==TS?b.s1:1);',to:'set_output(41,1);'}]}
];

for(const mutation of mutations){
    const sandbox=mkdtempSync(join(tmpdir(),'harris-bus-output-mutant.'));
    try{
        mkdirSync(join(sandbox,'scripts'),{recursive:true});mkdirSync(join(sandbox,'src/experimental'),{recursive:true});
        cpSync(join(root,'src/experimental/wired-kernel'),join(sandbox,'src/experimental/wired-kernel'),{recursive:true});
        cpSync(join(root,'scripts/build-wired-net-kernel.mjs'),join(sandbox,'scripts/build-wired-net-kernel.mjs'));
        for(const edit of mutation.edits){
            const path=join(sandbox,'src/experimental/wired-kernel',edit.file),source=readFileSync(path,'utf8');
            assert.equal(source.split(edit.from).length-1,1,`${mutation.name}: exact mutation target`);
            writeFileSync(path,source.replace(edit.from,edit.to));
        }
        const build=join(sandbox,'build');mkdirSync(build);
        execFileSync(process.execPath,[join(sandbox,'scripts/build-wired-net-kernel.mjs'),build],{stdio:'pipe'});
        let output='',failed=false;
        try{execFileSync(process.execPath,['--test',`--test-name-pattern=${mutation.pattern}`,
            'test/harris-native-bus-circuit.test.mjs'],{cwd:root,
            env:{...process.env,HARRIS_NET_WASM:join(build,'wired-net-kernel.wasm')},encoding:'utf8'});}
        catch(error){failed=true;output=`${error.stdout??''}${error.stderr??''}`;}
        assert.equal(failed,true,`${mutation.name}: mutation must be rejected`);
        assert.ok(output.includes(mutation.pattern),`${mutation.name}: named red`);
        console.log(`# mutation rejected: ${mutation.name}`);
    }finally{rmSync(sandbox,{recursive:true,force:true});}
}
console.log(`# mutations rejected: ${mutations.length}`);
