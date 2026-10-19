import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {compareOwnedPagingState} from '../scripts/compare-bochs-cpu3-owned-paging-v2.mjs';

const native=JSON.parse(readFileSync(new URL(
  '../docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-idtr-03ff.json',
  import.meta.url))).checkpoint;
const segments=['es','cs','ss','ds','fs','gs'];

function jsProjection(){
  const js={...native.state,cr0:(native.state.cr0&0x8000001f)>>>0,
    gdtr:{base:native.tables.gdtrBase,limit:native.tables.gdtrLimit},
    idtr:{base:native.tables.idtrBase,limit:native.tables.idtrLimit},
    tr:{selector:0,present:false},ldtr:{selector:0,present:false},
    segmentCaches:{},debugRegisters:{dr0:0,dr1:0,dr2:0,dr3:0,dr6:0,dr7:0},
    ramSnapshots:structuredClone(native.ramSnapshots)};
  for(const name of segments){
    const source=native.segments[name];
    js[name]=source.selector;
    js.segmentCaches[name]={base:source.base,limit:source.limitScaled,
      present:!!source.present,default32:!!source.default32,code:!!(source.type&8)};
  }
  return js;
}

test('aligned native IDTR and selected paging projection match',()=>{
  assert.equal(native.tables.idtrBase,0);
  assert.equal(native.tables.idtrLimit,0x03ff);
  const result=compareOwnedPagingState(native,jsProjection());
  assert.equal(result.status,'scoped-fields-match');
  assert.deepEqual(result.mismatches,[]);
});

test('aligned projection refuses defined state and each owned RAM-word mutation',()=>{
  const mutations=[
    [js=>{js.eax^=1;},'eax'],
    [js=>{js.eip++;},'eip'],
    [js=>{js.eflags^=0x40;},'eflags.defined386'],
    [js=>{js.cr0^=0x10;},'cr0.defined386'],
    [js=>{js.cr3^=0x1000;},'cr3'],
    [js=>{js.idtr.limit=0xffff;},'idtr.limit'],
    [js=>{js.ramSnapshots.pde0.bytes='03a00000';},'ram.pde0.bytes'],
    [js=>{js.ramSnapshots.pte5.bytes='23500000';},'ram.pte5.bytes'],
    [js=>{js.ramSnapshots.data5.bytes='00000000';},'ram.data5.bytes'],
  ];
  for(const [mutate,field] of mutations){
    const js=jsProjection();mutate(js);
    assert.deepEqual(compareOwnedPagingState(native,js).mismatches.map(x=>x.field),
      [field],field);
  }
});

test('source-bound CLI executes committed LIDT fixture in strict386 mode',()=>{
  const repo=fileURLToPath(new URL('../',import.meta.url));
  const raw=execFileSync(process.execPath,
    ['scripts/compare-bochs-cpu3-owned-paging-idtr-03ff.mjs'],{cwd:repo,encoding:'utf8'});
  const report=JSON.parse(raw);
  assert.equal(report.marker,'BHPG004');
  assert.equal(report.jsEntry,0x7e00);
  assert.equal(report.comparison.status,'scoped-fields-match');
  assert.deepEqual(report.comparison.mismatches,[]);
  for(const word of ['pde0','pte5','data5'])
    assert.equal(report.comparison.ramSnapshots.native[word].bytes,
      report.comparison.ramSnapshots.js[word].bytes);
});
