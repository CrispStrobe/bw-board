import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script=fileURLToPath(new URL('../scripts/summarize-i80386-code16-windows.mjs',import.meta.url));
const privateMarker='PRIVATE_MEDIA_AND_GUEST_TEXT';
const input={bios:privateMarker,vga:privateMarker,hdd:privateMarker,
  geometry:'1000,4,17',cmosType:47,cmosEquipment:null,events:[],
  mouseEnabled:false,dosboxConfig:null,nativeBlocks:false,
  code16Loads:false,code16Wasm:false};
const base={executionRevision:'test-revision',sourceSha256:{'../src/experimental/i80386.js':'test-hash'},
  inputs:input,steps:60_000_000,stop:'budget',refusal:null,
  cpu:{eip:1},delivered:[],serial:privateMarker,textRam:privateMarker,
  vga:{text:privateMarker}};

function reduce(changes={}){
  const dir=mkdtempSync(join(tmpdir(),'code16-reducer-'));
  try{
    const files=['ordinary.json','optin.json','ordinary.time','optin.time']
      .map(name=>join(dir,name));
    writeFileSync(files[0],JSON.stringify(base));
    writeFileSync(files[1],JSON.stringify({...base,inputs:{...input,code16Wasm:true},...changes,
      code16WasmStats:{attempts:1,decoded:1,blockCalls:1,instructions:2,fallback:59_999_998,boundary:0},
      code16WasmDiagnostics:{fallbacks:{mode32:15_000_000},exits:{completed:1}}}));
    writeFileSync(files[2],'wall=1 user=1 system=0 maxrss=1\n');
    writeFileSync(files[3],'wall=2 user=2 system=0 maxrss=2\n');
    return spawnSync(process.execPath,[script,...files],{encoding:'utf8'});
  }finally{rmSync(dir,{recursive:true,force:true});}
}

test('private identifiers and guest text never enter the public receipt',()=>{
  const result=reduce();
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.includes(privateMarker),false);
  const receipt=JSON.parse(result.stdout);
  assert.equal(receipt.guestParitySha256.length,64);
  assert.equal(receipt.code16.stats.instructions,2);
});

test('guest divergence blocks receipt publication',()=>{
  const result=reduce({cpu:{eip:2}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/guest results differ/);
});
