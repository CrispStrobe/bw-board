import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadDirectNative} from '../scripts/bochs-cpu3-native-direct-board-adapter/loader.mjs';
// These source-stage tests exercise artifact admission, not compiled native execution.
test('direct addon loader requires explicit SHA and native filename',()=>{
 for(const [path,sha] of [['fake.node',undefined],['fake.js','0'.repeat(64)],['fake.node','MAIN']])assert.throws(()=>loadDirectNative(path,sha),/artifact path and SHA required/);
});
test('direct addon byte identity is checked before native module loading',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bw-direct-loader-'));
 try{const file=join(dir,'uncompiled.node');writeFileSync(file,'uncompiled source-stage fixture');assert.throws(()=>loadDirectNative(file,'0'.repeat(64)),/artifact SHA mismatch/);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('worker loader admission rejects before filesystem or native loading',async()=>{
 const {Worker}=await import('node:worker_threads');
 const loader=new URL('../scripts/bochs-cpu3-native-direct-board-adapter/loader.mjs',import.meta.url).href;
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');import(${JSON.stringify(loader)}).then(({loadDirectNative})=>{try{loadDirectNative('/absent.node','0'.repeat(64));parentPort.postMessage('admitted');}catch(error){parentPort.postMessage(error.message);}});`,{eval:true});
 const message=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
 assert.match(message,/requires main thread/);await worker.terminate();
});
test('existing loader image admission rejects another canonical path before dlopen',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {createHash}=await import('node:crypto');
 const dir=mkdtempSync(join(tmpdir(),'bw-direct-image-'));
 try{const file=join(dir,'other.node'),data='not a native library';writeFileSync(file,data);const sha=createHash('sha256').update(data).digest('hex');
  const loader=new URL('../scripts/bochs-cpu3-native-direct-board-adapter/loader.mjs',import.meta.url).href;
  const code=`import {loadDirectNative} from ${JSON.stringify(loader)};globalThis[Symbol.for('bw.direct-native-addon.image.v1')]={path:'/previous.node',sha256:${JSON.stringify(sha)}};try{loadDirectNative(${JSON.stringify(file)},${JSON.stringify(sha)});process.exitCode=2;}catch(error){console.log(error.message);}`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/duplicate addon image rejected/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
