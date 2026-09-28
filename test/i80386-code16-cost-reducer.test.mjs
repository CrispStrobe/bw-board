import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/summarize-i80386-code16-cost.mjs',import.meta.url));
const secret='PRIVATE_MEDIA_AND_GUEST_TEXT';
const altered='../src/experimental/i80386-code16-wasm-block.js';
const sourceSha256={[altered]:'original','../src/experimental/i80386.js':'same'};
const inputs={bios:secret,vga:secret,hdd:secret,geometry:[1,2,3],
  cmosType:47,cmosEquipment:1,events:secret,mouseEnabled:false,
  dosboxConfig:null,code16Wasm:true};
const base={executionRevision:'source',sourceSha256,inputs,
  steps:60_000_000,stop:'budget',refusal:null,cpu:{eip:1},delivered:[],
  serial:secret,textRam:secret,vga:{planeSha256:secret},
  code16WasmStats:{attempts:1,decoded:1,blockCalls:0,instructions:0,
    fallback:60_000_000,boundary:0}};
function reduce({guestMutation=false,inputMutation=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'bw-cost-reducer-'));
  try{
    const paths=['profile.json','ordinary.json','optin.json','profile.time',
      'ordinary.time','optin.time','probe.patch'].map(name=>join(dir,name));
    const profile={...base,
      sourceSha256:{...sourceSha256,[altered]:'instrumented'},
      inputs:inputMutation?{...inputs,bios:'CHANGED'}:inputs,
      cpu:guestMutation?{eip:2}:base.cpu,
      code16WasmStats:{...base.code16WasmStats,
        costProbe:{sampleRate:256,calls:60_000_000,sampledCalls:1,
          phases:{total:{samples:1,ms:1},admission:{samples:1,ms:0.1}}}}};
    writeFileSync(paths[0],JSON.stringify(profile));
    writeFileSync(paths[1],JSON.stringify({...base,inputs:{...inputs,code16Wasm:false}}));
    writeFileSync(paths[2],JSON.stringify(base));
    for(const path of paths.slice(3,6))
      writeFileSync(path,'wall=1 user=1 system=0 maxrss=1\n');
    writeFileSync(paths[6],'public probe patch');
    return spawnSync(process.execPath,[script,...paths],{encoding:'utf8'});
  }finally{rmSync(dir,{recursive:true,force:true});}
}

test('reducer emits aggregate fields without private input or guest text',()=>{
  const result=reduce();
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.includes(secret),false);
  const receipt=JSON.parse(result.stdout);
  assert.equal(receipt.privateInputsIdentical,true);
  assert.equal(receipt.sampling.naiveExtrapolationValid,false);
});
test('guest or private-input changes block public attribution',()=>{
  for(const change of [{guestMutation:true},{inputMutation:true}]){
    const result=reduce(change);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/selected reported guest fields differ|private input differs/);
  }
});
