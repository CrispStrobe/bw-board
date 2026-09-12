/** Rebuild dirty-driver mutations and require a named state comparison to fail.
 * Run only in an exclusive disposable worktree: sources are briefly mutated. */
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

if(!process.env.WASM_LD)throw new Error('WASM_LD required');
const root=fileURLToPath(new URL('../',import.meta.url));
const cases=[
    ['schedule','src/experimental/wired-kernel/phase-schedule.c',
        'if(write_owned_driver(c,ids[i],values[i]))return schedule_fault(6,i,fault);',
        'if((((u8*)(unsigned long)c[4])[ids[i]]=values[i],0))return schedule_fault(6,i,fault);',
        'incremental schedule oracle'],
    ['controller','src/experimental/wired-kernel/phase-circuit.c',
        'if(write_owned_driver(c,W(5)[i],B(11)[i]))return 1;',
        'if((((u8*)(unsigned long)c[4])[W(5)[i]]=B(11)[i],0))return 1;',
        'incremental phase oracle'],
    ['latch','src/experimental/wired-kernel/phase-circuit.c',
        'if(write_owned_driver(c,W(7)[i],B(11)[i]))return reject_phase(p,1,2,NONE,fault);',
        'if((((u8*)(unsigned long)c[4])[W(7)[i]]=B(11)[i],0))return reject_phase(p,1,2,NONE,fault);',
        'incremental phase oracle'],
    ['memory','src/experimental/wired-kernel/memory-circuit.c',
        'if(write_owned_driver(c,output_ids[b*8+bit],U8(25)[b*8+bit])){fault[0]=1;fault[1]=2;return 1;}',
        'if((U8(4)[output_ids[b*8+bit]]=U8(25)[b*8+bit],0)){fault[0]=1;fault[1]=2;return 1;}',
        'incremental memory oracle'],
    ['evaluator','src/experimental/wired-kernel/incremental-nets.c',
        'if(write_driver(c,d,B(9)[d],0))return 0x80000002u;',
        'if((B(4)[d]=B(9)[d],0))return 0x80000002u;',
        'incremental resolver matches'],
    ['four-state','src/experimental/wired-kernel/incremental-nets.c',
        'if(code>3)return 2;','if(code>4)return 2;','driver seam validates'],
    ['duplicate-order','src/experimental/wired-kernel/incremental-nets.c',
        'if(B(4)[id]==code)return 0;',
        'if(c[31]==2&&queued_driver[id])return 0;\n    if(B(4)[id]==code)return 0;',
        'driver seam validates'],
    ['bus-inputs','src/experimental/wired-kernel/bus-circuit.c',
        'if(stage_bus_driver(W(0),W(4)[i],B(5)[i]))return failure(p,8,2,i,fault);',
        'if((((u8*)(unsigned long)W(0)[4])[W(4)[i]]=B(5)[i],0))return failure(p,8,2,i,fault);',
        'same-instance bus/actual-net/controller/memory oracle','test/harris-native-bus-circuit.test.mjs'],
    ['bus-outputs','src/experimental/wired-kernel/bus-circuit.c',
        'if(stage_bus_driver(W(0),W(3)[i],(u8)output[i]))return failure(p,8,2,i,fault);',
        'if((((u8*)(unsigned long)W(0)[4])[W(3)[i]]=(u8)output[i],0))return failure(p,8,2,i,fault);',
        'same-instance bus/actual-net/controller/memory oracle','test/harris-native-bus-circuit.test.mjs']
];
const results=[];
for(const [name,relative,from,to,testName,testFile='test/harris-native-incremental-nets.test.mjs'] of cases){
    const path=join(root,relative),source=readFileSync(path,'utf8');
    assert.equal(source.split(from).length-1,1,`${name}: exact mutation target`);
    const directory=mkdtempSync(join(tmpdir(),`harris-driver-${name}-`));
    try{
        writeFileSync(path,source.replace(from,to));
        execFileSync(process.execPath,['scripts/build-wired-net-kernel.mjs',directory],{cwd:root,env:process.env,stdio:'ignore'});
    }finally{
        writeFileSync(path,source);
    }
    const run=spawnSync(process.execPath,['--test','--test-name-pattern',testName,testFile],{
        cwd:root,env:{...process.env,HARRIS_NET_WASM:join(directory,'wired-net-kernel.wasm')},encoding:'utf8'});
    const output=`${run.stdout??''}${run.stderr??''}`,fired=run.status!==0&&output.includes('not ok')&&output.includes(testName);
    assert.equal(fired,true,`${name}: mutation must fail ${testName}`);results.push({name,testName,testFile,status:run.status,namedRed:true});
}
for(const [,relative] of cases)assert.equal(readFileSync(join(root,relative),'utf8').includes('write_owned_driver')||relative.endsWith('incremental-nets.c'),true);
console.log(JSON.stringify({accepted:true,kills:results.length,results},null,2));
