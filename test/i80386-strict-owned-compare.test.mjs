import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compareOwnedIntegerState} from '../scripts/compare-bochs-cpu3-owned-integer-state.mjs';

const native=JSON.parse(readFileSync(new URL('../docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-native-checkpoint.json',import.meta.url))).checkpoint;
const names=['es','cs','ss','ds','fs','gs'];
function jsProjection(){
  const js={...native.state,
    cr0:native.state.cr0&0x8000001f,
    gdtr:{base:native.tables.gdtrBase,limit:native.tables.gdtrLimit},
    idtr:{base:native.tables.idtrBase,limit:native.tables.idtrLimit},
    tr:{selector:native.segments.tr.selector,base:native.segments.tr.base,
      limit:native.segments.tr.limitScaled,type:native.segments.tr.type},
    ldtr:{selector:native.segments.ldtr.selector,present:false},
    segmentCaches:{},
    debugRegisters:{dr0:0,dr1:0,dr2:0,dr3:0,dr6:0,dr7:0}};
  for(const name of names){
    js[name]=native.segments[name].selector;
    js.segmentCaches[name]={base:native.segments[name].base,
      limit:native.segments[name].limitScaled,present:true,
      default32:!!native.segments[name].default32,
      code:name==='cs'};
  }
  return js;
}

test('defined CR0 bits and integer/system state match despite reported reserved and debug raw gaps',()=>{
  const result=compareOwnedIntegerState(native,jsProjection());
  assert.equal(result.status,'scoped-fields-match');
  assert.equal(result.mismatches.length,0);
  assert.equal(result.cr0.rawEqual,false);
  assert.equal(result.cr0.etNative,1);
  assert.equal(result.cr0.etJs,1);
  assert.notEqual(result.debug.native.dr6,result.debug.js.dr6);
  assert.equal(result.internalVm86Cache.nativeCsType,3);
  assert.equal(result.internalVm86Cache.jsCsCode,true);
});

test('comparator rejects defined ET or EIP changes instead of masking them',()=>{
  const et=jsProjection();et.cr0^=0x10;
  assert.deepEqual(compareOwnedIntegerState(native,et).mismatches.map(x=>x.field),['cr0.defined386']);
  const ip=jsProjection();ip.eip++;
  assert.deepEqual(compareOwnedIntegerState(native,ip).mismatches.map(x=>x.field),['eip']);
});

test('committed owned fixture matches scoped native integer/system fields',()=>{
  const repo=fileURLToPath(new URL('../',import.meta.url));
  const raw=execFileSync(process.execPath,
    ['scripts/compare-bochs-cpu3-owned-integer-state.mjs'],{cwd:repo,encoding:'utf8'});
  const report=JSON.parse(raw);
  assert.equal(report.marker,'BHVK003');
  assert.equal(report.comparison.status,'scoped-fields-match');
  assert.equal(report.comparison.cr0.etNative,1);
  assert.equal(report.comparison.cr0.etJs,1);
  assert.equal(report.comparison.cr0.rawEqual,false);
  assert.equal(report.comparison.mismatches.length,0);
});
