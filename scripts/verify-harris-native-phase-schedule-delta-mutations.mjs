/** Mutate the JS schedule compiler and require named contract failures. */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

if(!process.env.HARRIS_NET_WASM)throw new Error('HARRIS_NET_WASM required');
const root=fileURLToPath(new URL('../',import.meta.url)),relative='src/experimental/wired-kernel/phase-schedule.js',path=fileURLToPath(new URL(`../${relative}`,import.meta.url));
const lifecycle='schedule delta encoding is per handle',measurement='native schedule matches every-period',capacity='schedule capacity counts validated';
const cases=[
    ['omit-first-assignment','if(!lastCode.has(id)||lastCode.get(id)!==code){','if(lastCode.has(id)&&lastCode.get(id)!==code){',lifecycle],
    ['reset-cache-each-period','steps.forEach((step,i)=>{\n                    if(!step','steps.forEach((step,i)=>{\n                    lastCode.clear();\n                    if(!step',measurement],
    ['forget-return-transition','drivers.push(id);values.push(code);lastCode.set(id,code);','drivers.push(id);values.push(code);if(!lastCode.has(id))lastCode.set(id,code);',lifecycle],
    ['conflate-x-and-z',"value==='X'?2:value==='Z'?3:-1","value==='X'?2:value==='Z'?2:-1",lifecycle],
    ['cross-driver-cache','if(!lastCode.has(id)||lastCode.get(id)!==code){','if(!lastCode.has(0)||lastCode.get(0)!==code){',lifecycle],
    ['capacity-on-encoded-only',"if(++submittedUpdates>maxUpdates)throw new RangeError('schedule update capacity');","submittedUpdates++;if(drivers.length>maxUpdates)throw new RangeError('schedule update capacity');",capacity],
    ['trust-raw-handle-count','handle.periods,s.ids.length,p.scheduleOffsets','handle.periods,handle.updates,p.scheduleOffsets',measurement],
    ['encoded-offsets-use-raw-count','offsets[i]=drivers.length;','offsets[i]=submittedUpdates;',measurement],
    ['skip-elided-value-validation',"if(code<0)throw new CircuitFault('INVALID_DRIVER_LEVEL',pin);","if(code<0&&false)throw new CircuitFault('INVALID_DRIVER_LEVEL',pin);",capacity]
];
const source=readFileSync(path,'utf8'),hash=value=>createHash('sha256').update(value).digest('hex'),results=[];
for(const [name,from,to,testName] of cases){
    assert.equal(source.split(from).length-1,1,`${name}: exact mutation target`);let run;
    try{
        writeFileSync(path,source.replace(from,to));
        run=spawnSync(process.execPath,['--test','--test-name-pattern',testName,'test/harris-native-phase-schedule.test.mjs'],{
            cwd:root,env:process.env,encoding:'utf8'});
    }finally{writeFileSync(path,source);}
    const output=`${run.stdout??''}${run.stderr??''}`,fired=run.status!==0&&output.includes('not ok')&&output.includes(testName);
    assert.equal(fired,true,`${name}: mutation must fail ${testName}`);results.push({name,testName,status:run.status,namedRed:true});
}
assert.equal(readFileSync(path,'utf8'),source,'schedule source restored');
console.log(JSON.stringify({accepted:true,revision:process.env.HARRIS_FRONTIER_REVISION??'working-tree',sourceSHA256:{[relative]:hash(source)},kills:results.length,results},null,2));
