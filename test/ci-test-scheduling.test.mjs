import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {serialTestCommand,runObservedProcess,resourceTelemetry} from '../scripts/run-ci-tests-serial.mjs';
test('CI scheduler changes only the heap and file concurrency flags',()=>{
 const script='node --test test/*.test.js test/*.test.mjs test/explicit.test.mjs';
 assert.equal(serialTestCommand(script),'node --max-old-space-size=1024 --test --test-concurrency=1 test/*.test.js test/*.test.mjs test/explicit.test.mjs');
 assert.throws(()=>serialTestCommand(script+'; exit 0'),/explicit scheduling audit/);
});
test('asynchronous CI observer emits heartbeats and preserves nonzero test exit',async()=>{
 const events=[];const result=await runObservedProcess(process.execPath,['-e','setTimeout(()=>process.exit(7),120)'],{intervalMs:25,log:(...args)=>events.push(args)});
 assert.deepEqual(result,{code:7,signal:null,forwarded:null});assert.ok(events.length>=3);
 assert.ok(events.some(event=>JSON.parse(event[1]).processes.some(p=>p.name==='node')),'live Node child PID attribution');
 assert.equal(typeof resourceTelemetry(process.pid).freeMemoryBytes,'number');
});
test('CI observer forwards termination to its isolated child process group',()=>{
 const module=new URL('../scripts/run-ci-tests-serial.mjs',import.meta.url).href;
 const code=`import {runObservedProcess} from ${JSON.stringify(module)};setTimeout(()=>process.kill(process.pid,'SIGTERM'),200);const result=await runObservedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{intervalMs:30,log:()=>{}});console.log(JSON.stringify(result));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:5000});assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
 assert.deepEqual(JSON.parse(child.stdout),{code:null,signal:'SIGTERM',forwarded:'SIGTERM'});
});
