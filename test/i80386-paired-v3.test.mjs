import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import CPU from '../src/experimental/i80386.js';
import Machine,{PCAT80386_EXPERIMENTAL as config} from '../src/experimental/i80386-at-machine.js';
import {make,execute} from '../scripts/i80386-at-profile/fixture.mjs';
import {MEASURED_STEPS,WARMUP_STEPS,ORDER,GATE,measured} from '../scripts/i80386-paired-v3/fixture.mjs';

const ns=new URL('../scripts/i80386-paired-v3/',import.meta.url);

test('request pins rows and arms; work/gate equal paired-v2',()=>{
  const req=new URL('request.json',ns);
  if(existsSync(req)){
    const r=JSON.parse(readFileSync(req)),rows=readFileSync(new URL('source-rows.json',ns));
    assert.equal(r.schema,'bw.paired-v3-request.v1');
    assert.equal(r.sourceRowsSha256,createHash('sha256').update(rows).digest('hex'));
    const arms=JSON.parse(rows).arms;
    for(const k of ['A','B'])assert.deepEqual(r.arms[k],{head:arms[k].head,tree:arms[k].tree});
    assert.deepEqual(r.predeclared.gate,GATE);
  }
  assert.equal(MEASURED_STEPS,10000000);
  assert.equal(WARMUP_STEPS,25000);
  assert.deepEqual(GATE,{cpuMedianMin:1.03,cpuEveryGreaterThan:1,wallMedianMax:1.02});
  assert.equal(ORDER.join(''),'ABABABBAABBABAABBA');
  assert.throws(()=>measured(CPU,Machine,config,1000000),/fixed work bounds/);
});

test('frozen arm rows: 37 files each, only the AT machine source differs',()=>{
  const rows=JSON.parse(readFileSync(new URL('source-rows.json',ns)));
  const a=rows.arms.A.files,b=rows.arms.B.files,names=Object.keys(a);
  assert.equal(names.length,37);
  assert.deepEqual(Object.keys(b),names);
  assert.deepEqual(names.filter(n=>a[n].sha256!==b[n].sha256),['src/experimental/i80386-at-machine.js']);
});

test('independent device derivation agrees with small authored executions',()=>{
  // Cross-check of the reader's derivation against this checkout's runtime at
  // small bounds (flush, first horizon, keyboard BAT crossing). The reader
  // itself never runs JS or reads child output to obtain its goldens.
  const script=fileURLToPath(new URL('device_golden.py',ns));
  for(const steps of [0,1,2667,2668,33928,700001]){
    const g=JSON.parse(execFileSync('python3',['-I','-B',script,String(steps)],{encoding:'utf8'}));
    const d=execute(make('at',CPU,Machine,config),steps).devices;
    for(const k of ['machineCycles','debt','deadline','appliedClocks','pitFraction','rtc','cga','keyboard'])
      assert.deepEqual(d[k],g[k],`${k} @${steps}`);
  }
});
