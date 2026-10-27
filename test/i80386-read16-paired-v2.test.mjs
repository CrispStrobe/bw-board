import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import CPU from '../src/experimental/i80386.js';
import Machine,{PCAT80386_EXPERIMENTAL as config} from '../src/experimental/i80386-at-machine.js';
import {make,execute} from '../scripts/i80386-at-profile/fixture.mjs';
import {existsSync} from 'node:fs';
import {MEASURED_STEPS,WARMUP_STEPS,ORDER,GATE,architecturalGolden,measured} from '../scripts/i80386-read16-paired-v2/fixture.mjs';

test('execution is admitted only by a committed request; work/gate are unchanged',()=>{
  const req=new URL('../scripts/i80386-read16-paired-v2/request.json',import.meta.url);
  if(existsSync(req)){
    const r=JSON.parse(readFileSync(req)),rows=readFileSync(new URL('../scripts/i80386-read16-paired-v2/source-rows.json',import.meta.url));
    assert.equal(r.schema,'bw.read16-paired-v2-request.v1');
    assert.equal(r.sourceRowsSha256,createHash('sha256').update(rows).digest('hex'));
    const arms=JSON.parse(rows).arms;
    for(const k of ['A','B'])assert.deepEqual(r.arms[k],{head:arms[k].head,tree:arms[k].tree});
  }
  assert.equal(MEASURED_STEPS,10000000);
  assert.equal(WARMUP_STEPS,25000);
  assert.deepEqual(GATE,{cpuMedianMin:1.03,cpuEveryGreaterThan:1,wallMedianMax:1.02});
  assert.equal(ORDER.join(''),'ABABABBAABBABAABBA');
  const pairs=[];for(let i=4;i<18;i+=2)pairs.push(ORDER[i]+ORDER[i+1]);
  assert.deepEqual(pairs,['AB','BA','AB','BA','BA','AB','BA']);
  assert.throws(()=>measured(CPU,Machine,config,1000000),/fixed work bounds/);
  assert.throws(()=>measured(CPU,Machine,config,MEASURED_STEPS,5),/fixed work bounds/);
});

test('architectural golden at ten million is the saturated tuple (insufficient alone)',()=>{
  for(const ax0 of [0,1,0x7fff,0xfffe,0xffff])
    assert.deepEqual(architecturalGolden(MEASURED_STEPS,ax0),{ax:0xfffe,bx:0xffff,word:0xffff,ip:0,retired:10000000,fullLoops:2000000});
  // Closed form 2^n*(ax0+2)-2: from ax0=0 AX reaches 0xfffe at n=15 loops,
  // from odd ax0 only at n=16, so the full tuple saturates by 16 loops.
  assert.equal(architecturalGolden(75,0).ax,0xfffe);
  assert.notEqual(architecturalGolden(70,0).ax,0xfffe);
  assert.notEqual(architecturalGolden(75,1).ax,0xfffe);
  assert.equal(architecturalGolden(80,1).ax,0xfffe);
});

test('small authored executions agree with the independent recurrence on both paths',()=>{
  for(const kind of ['core','at'])for(const steps of [0,1,2,3,4,5,6,23,60,81,97]){
    const s=make(kind,CPU,Machine,config),ax0=s.cpu.eax&0xffff;
    const g=architecturalGolden(steps,ax0),o=execute(s,steps);
    assert.equal(o.state.ax,g.ax,`${kind} ax @${steps}`);
    assert.equal(o.state.ip,g.ip,`${kind} ip @${steps}`);
    if(g.bx!==null)assert.equal(o.state.bx,g.bx,`${kind} bx @${steps}`);
    if(g.word!==null)assert.equal(o.state.word,g.word,`${kind} word @${steps}`);
    assert.equal(o.cpuCycles,steps);
  }
});

test('frozen arm rows: 35 files each, only CPU source differs',()=>{
  // Byte checks against the actual arm checkouts happen in the hosted child,
  // so later runtime edits on master never break this test.
  const rows=JSON.parse(readFileSync(new URL('../scripts/i80386-read16-paired-v2/source-rows.json',import.meta.url)));
  const a=rows.arms.A.files,b=rows.arms.B.files,names=Object.keys(a);
  assert.equal(names.length,35);
  assert.deepEqual(Object.keys(b),names);
  assert.deepEqual(names.filter(n=>a[n].sha256!==b[n].sha256),['src/experimental/i80386.js']);
  assert.equal(rows.arms.A.head,'e5bf38a5f2936a461be15bed3c568e9090bd4d77');
  assert.equal(rows.arms.B.head,'55917c48dffe0c7c743388024481ef0a47a7c76c');
});
