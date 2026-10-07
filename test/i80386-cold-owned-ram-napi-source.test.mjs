import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
const require=createRequire(import.meta.url);

test('standalone NAPI bridge owns copied bytes and isolates concurrent Worker sessions',async()=>{
 const candidates=['/usr/include/node',resolve(dirname(process.execPath),'../include/node')];
 const headers=candidates.find(p=>existsSync(join(p,'node_api.h')));
 assert.ok(headers,'Node N-API headers required for owned RAM bridge');
 const dir=mkdtempSync(join(tmpdir(),'bw-owned-ram-napi-'));
 try{
  const source=new URL('../scripts/bochs-cpu3-native-cold-owned-ram/napi.cc',import.meta.url).pathname;
  const binary=join(dir,'owned_ram.node');
  const build=spawnSync('c++',['-std=c++17','-O1','-fPIC','-shared','-Wall','-Wextra','-Werror',`-I${headers}`,source,'-o',binary],{encoding:'utf8',timeout:15000});
  assert.equal(build.status,0,build.stderr||build.error?.message);
  const owner=require(binary);assert.equal(owner.profile,'bw.cold-native.owned-ram-rom-exec.v1');
  const ram=new Uint8Array(0x180000),rom=new Uint8Array(0x10000);ram[0x100]=4;rom[7]=9;owner.create(ram,rom);ram[0x100]=8;rom[7]=8;
  assert.equal(owner.read(0x100,1).bytes[0],4);
  assert.equal(owner.read(0xf0007,1).bytes[0],9);
  assert.equal(owner.read(0xffff0007,1).bytes[0],9);
  assert.equal(owner.read(0xc0000,1).bytes[0],255);
  assert.throws(()=>owner.write(0,new Uint8Array(new SharedArrayBuffer(1)),0,0),/write raw\/bytes\/N\/Q/);
  for(let i=0;i<32;i++)assert.equal(owner.write(0x200+i,Uint8Array.of(i+1),i+1,i).fence,0);
  assert.equal(owner.write(0x400,Uint8Array.of(99),33,32).fence,1);
  assert.equal(owner.drain().length,32);assert.equal(owner.acknowledge(),32);
  assert.equal(owner.write(0x400,Uint8Array.of(99),33,32).fence,0);
  const record=owner.drain();assert.equal(record.length,1);assert.equal(record[0].before[0],0);assert.equal(record[0].after[0],99);
  assert.equal(owner.acknowledge(),33);owner.close();
  const workerSource=`
    const {parentPort,workerData}=require('node:worker_threads');
    const owner=require(workerData.binary),ram=new Uint8Array(0x180000),rom=new Uint8Array(0x10000);
    ram[0]=workerData.initial;owner.create(ram,rom);
    parentPort.postMessage({ready:true,initial:owner.read(0,1).bytes[0]});
    parentPort.once('message',()=>{
      const result=owner.write(0,Uint8Array.of(workerData.initial+1),1,0);
      const before=owner.drain()[0].before[0],after=owner.drain()[0].after[0],ack=owner.acknowledge();
      owner.close();parentPort.postMessage({initial:workerData.initial,before,after,ack,fence:result.fence});
    });`;
  const workers=[11,22].map(initial=>new Worker(workerSource,{eval:true,workerData:{binary,initial}}));
  try{
   const ready=await Promise.all(workers.map(w=>once(w,'message').then(([m])=>m)));
   assert.deepEqual(ready.map(r=>r.initial).sort((a,b)=>a-b),[11,22]);
   const done=workers.map(w=>once(w,'message').then(([m])=>m));
   workers.forEach(w=>w.postMessage('continue'));
   const results=await Promise.all(done);
   assert.deepEqual(results.sort((a,b)=>a.initial-b.initial),[
    {initial:11,before:11,after:12,ack:1,fence:0},
    {initial:22,before:22,after:23,ack:1,fence:0}
   ]);
  }finally{await Promise.all(workers.map(w=>w.terminate()));}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
