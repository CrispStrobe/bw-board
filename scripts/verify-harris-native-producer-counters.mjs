/** Hosted mutation proof for the diagnostic native producer counter seam. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const cooperative='cooperative producer labels reconcile';
const mutations=[
    {name:'mislabelled bus-external producer',edits:[{file:'bus-circuit.c',from:'B(5)[i],PRODUCER_BUS_EXTERNAL)',
        to:'B(5)[i],PRODUCER_OTHER)',prelude:'#define PRODUCER_OTHER 0\n'}]},
    {name:'mislabelled bus-output producer',edits:[{file:'bus-circuit.c',from:'(u8)output[i],PRODUCER_BUS_OUTPUT)',
        to:'(u8)output[i],PRODUCER_OTHER)',prelude:'#define PRODUCER_OTHER 0\n'}]},
    {name:'mislabelled controller producer',edits:[{file:'phase-circuit.c',from:'B(11)[i],PRODUCER_PHASE_CONTROLLER)',
        to:'B(11)[i],PRODUCER_OTHER)',prelude:'#define PRODUCER_OTHER 0\n'}]},
    {name:'mislabelled latch producer',edits:[{file:'phase-circuit.c',from:'B(11)[i],PRODUCER_PHASE_LATCH)',
        to:'B(11)[i],PRODUCER_OTHER)',prelude:'#define PRODUCER_OTHER 0\n'}]},
    {name:'mislabelled memory producer',edits:[{file:'memory-circuit.c',from:'U8(25)[b*8+bit],PRODUCER_MEMORY_BANK)',
        to:'U8(25)[b*8+bit],PRODUCER_OTHER)',prelude:'#define PRODUCER_OTHER 0\n'}]},
    {name:'mislabelled evaluator producer',edits:[{file:'incremental-nets.c',from:'producer_work[PRODUCER_EVALUATOR]++;',
        to:'producer_work[PRODUCER_OTHER]++;'}]},
    {name:'mislabelled schedule producer',pattern:'phase schedule has',edits:[{file:'phase-schedule.c',
        from:'values[i],PRODUCER_PHASE_SCHEDULE)',to:'values[i],PRODUCER_OTHER)',prelude:'#define PRODUCER_OTHER 0\n'}]},
    {name:'mislabelled full-scan producer',edits:[{file:'net-resolver.c',from:'producer_work[PRODUCER_FULL_SCAN]++;',
        to:'producer_work[PRODUCER_OTHER]++;',prelude:'#define PRODUCER_OTHER 0\n'}]},
    {name:'mislabelled legacy writer',pattern:'tagged writes validate',edits:[{file:'incremental-nets.c',
        from:'write_owned_driver_tagged(c,id,code,PRODUCER_OTHER)',to:'write_owned_driver_tagged(c,id,code,1)'}]},
    {name:'swapped phase tags',edits:[{file:'phase-circuit.c',
        from:'#define PRODUCER_PHASE_CONTROLLER 3\n#define PRODUCER_PHASE_LATCH 4',
        to:'#define PRODUCER_PHASE_CONTROLLER 4\n#define PRODUCER_PHASE_LATCH 3'}]},
    {name:'swapped memory and evaluator tags',edits:[
        {file:'memory-circuit.c',from:'#define PRODUCER_MEMORY_BANK 5',to:'#define PRODUCER_MEMORY_BANK 7'},
        {file:'incremental-nets.c',from:'#define PRODUCER_EVALUATOR 7',to:'#define PRODUCER_EVALUATOR 5'}]},
    ...[
        ['missing settle-call count','memory_pass_work[0]++;','(void)0;'],
        ['missing pass count','memory_pass_work[1]++;','(void)0;'],
        ['missing preview-call count','memory_pass_work[2]++;','(void)0;'],
        ['missing preview-bank count','memory_pass_work[3]+=banks;','(void)banks;'],
        ['missing present-bank count','if(U8(26)[b])memory_pass_work[4]++;','(void)U8(26)[b];'],
        ['missing changed-bank count','if(U8(27)[b]){changed=1;memory_pass_work[5]++;}','if(U8(27)[b])changed=1;'],
        ['missing post-memory-settle count','memory_pass_work[6]++;','(void)0;'],
        ['missing empty-post-settle count','if(producer_work[PRODUCER_COUNT+PRODUCER_MEMORY_BANK]==prior_driver_changes)memory_pass_work[7]++;',
            '(void)prior_driver_changes;']
    ].map(([name,from,to])=>({name,edits:[{file:'memory-circuit.c',from,to}]})),
    {name:'swapped present and changed bank counts',edits:[
        {file:'memory-circuit.c',from:'if(U8(26)[b])memory_pass_work[4]++;',to:'if(U8(26)[b])memory_pass_work[5]++;'},
        {file:'memory-circuit.c',from:'if(U8(27)[b]){changed=1;memory_pass_work[5]++;}',to:'if(U8(27)[b]){changed=1;memory_pass_work[4]++;}'}]},
    {name:'missing producer reset',edits:[{file:'incremental-nets.c',
        from:'for(u32 i=0;i<PRODUCER_COUNT*2;i++)producer_work[i]=0;',to:'(void)producer_work;'}]},
    {name:'missing memory reset',edits:[{file:'memory-circuit.c',
        from:'for(u32 i=0;i<8;i++)memory_pass_work[i]=0;',to:'(void)memory_pass_work;'}]},
    {name:'suppressed producer change',edits:[{file:'incremental-nets.c',
        from:'if(B(4)[id]!=code)producer_work[PRODUCER_COUNT+producer]++;',to:'if(B(4)[id]!=code)producer_work[producer]++;'}]}
];
for(const mutation of mutations){
    const sandbox=mkdtempSync(join(tmpdir(),'harris-producer-mutant.'));
    try{
        mkdirSync(join(sandbox,'scripts'),{recursive:true});mkdirSync(join(sandbox,'src/experimental'),{recursive:true});
        cpSync(join(root,'src/experimental/wired-kernel'),join(sandbox,'src/experimental/wired-kernel'),{recursive:true});
        cpSync(join(root,'scripts/build-wired-net-kernel.mjs'),join(sandbox,'scripts/build-wired-net-kernel.mjs'));
        for(const edit of mutation.edits){
            const path=join(sandbox,'src/experimental/wired-kernel',edit.file),source=readFileSync(path,'utf8');
            assert.equal(source.split(edit.from).length-1,1,`${mutation.name} source shape`);
            writeFileSync(path,(edit.prelude??'')+source.replace(edit.from,edit.to));
        }
        const build=join(sandbox,'build');mkdirSync(build);
        execFileSync(process.execPath,[join(sandbox,'scripts/build-wired-net-kernel.mjs'),build],{stdio:'pipe'});
        let output='',failed=false;
        const pattern=mutation.pattern??cooperative;
        try{execFileSync(process.execPath,['--test',`--test-name-pattern=${pattern}`,
            'test/harris-native-producer-counters.test.mjs'],{cwd:root,env:{...process.env,HARRIS_NET_WASM:join(build,'wired-net-kernel.wasm')},encoding:'utf8'});}
        catch(error){failed=true;output=`${error.stdout??''}${error.stderr??''}`;}
        assert.equal(failed,true,`${mutation.name} must be rejected`);
        assert.ok(output.includes(pattern),`${mutation.name} named red`);
        console.log(`# mutation rejected: ${mutation.name}`);
    }finally{rmSync(sandbox,{recursive:true,force:true});}
}
console.log(`# mutations rejected: ${mutations.length}`);
