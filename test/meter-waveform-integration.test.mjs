import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';

const T=7_000_000n, omega=2*Math.PI*250;
const sine={wave:'spice-sine',offset:2,amplitude:1,freq:250,td:0,theta:0,phase:0};
const pulse={wave:'spice-pulse',v1:0,v2:5,td:.001,tr:.001,tf:.001,pw:.002,per:.010};
function bench(params,cap=false) {
  const b=new BoardImpl(5);
  b.configureTransientAnalysis('precision-v1');
  const parts=[
    {id:'V1',kind:'vsource',params,terminals:['pos','neg']},
    {id:'R1',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
    {id:'G1',kind:'gnd',params:{},terminals:['gnd']},
  ];
  const nets=[
    {id:'signal',terminals:[{part:'V1',terminal:'pos'},{part:'R1',terminal:'a'}]},
    {id:'zero',terminals:[{part:'V1',terminal:'neg'},{part:'G1',terminal:'gnd'}]},
  ];
  if(cap) {
    parts.push({id:'C1',kind:'capacitor',params:{farads:1e-6},terminals:['a','b']});
    nets.push({id:'out',terminals:[{part:'R1',terminal:'b'},{part:'C1',terminal:'a'}]});
    nets[1].terminals.push({part:'C1',terminal:'b'});
  } else nets[1].terminals.push({part:'R1',terminal:'b'});
  b.setNetlist(parts,nets);
  b.setPower(true);
  return b;
}
function run(b,end,stride) {
  for(let t=b.timeNs+stride;t<=end;t+=stride) b.advanceTo(t);
  if(b.timeNs<end) b.advanceTo(end);
}
const expectedSine=(from,to)=>2+(Math.cos(omega*from)-Math.cos(omega*to))/(omega*(to-from));
for(const [name,params,expected] of [['dc',{volts:2},2],
  ['sine',sine,expectedSine(0,.007)],['pulse',pulse,15/7]]) {
  test(`${name} voltage and signed current means agree across three caller schedules`,()=>{
    for(const stride of [T,700_000n,10_000n]) {
      const b=bench(params);
      assert.equal(b.meterVoltage('signal','zero'),b.nodeVoltage('signal'));
      b.meterCurrent('R1','a');
      run(b,T,stride);
      assert.ok(Math.abs(b.meterVoltage('signal','zero')-expected)<=5e-5,`${name} ${stride}: ${b.meterVoltage('signal','zero')} vs ${expected}`);
      assert.ok(Math.abs(b.meterCurrent('R1','a')+expected/1000)<=5e-8,`${name} signed OUT current ${stride}`);
      assert.equal(b.transientAnalysisStatus().failure,null);
    }
  });
}
test('unwatched algebraic endpoints keep their existing one-solve mode',()=>{
  const b=bench(sine);
  b.advanceTo(T);
  const s=b.transientAnalysisStatus();
  assert.equal(s.integrationMode,'algebraic-direct');
  assert.deepEqual(s.work,{attempts:1,solves:1,advances:1});
  assert.ok(Math.abs(b.nodeVoltage('signal')-1)<1e-9);
});
test('the clipped 100 ms sine window integrates partial segments, not the full watch',()=>{
  const params={...sine,freq:7},w=2*Math.PI*7;
  const expected=2+(Math.cos(w*.035)-Math.cos(w*.135))/(w*.100);
  const b=bench(params); b.meterVoltage('signal','zero'); b.meterCurrent('R1','a');
  run(b,135_000_000n,135_000_000n);
  assert.ok(Math.abs(b.meterVoltage('signal','zero')-expected)<=5e-5);
  assert.ok(Math.abs(b.meterCurrent('R1','a')+expected/1000)<=5e-8);
});
test('RC voltage and capacitor-current integrals use accepted solution state',()=>{
  const b=bench({...sine,offset:0},true);
  b.meterVoltage('out','zero'); b.meterCurrent('C1','a');
  b.advanceTo(T);
  const tau=.001,t=.007,gain=1/(1+(omega*tau)**2);
  const expected=gain*((1-Math.cos(omega*t))/omega-tau*Math.sin(omega*t)
    +omega*tau*tau*(1-Math.exp(-t/tau)))/t;
  const end=gain*(Math.sin(omega*t)-omega*tau*Math.cos(omega*t)+omega*tau*Math.exp(-t/tau));
  assert.ok(Math.abs(b.meterVoltage('out','zero')-expected)<=5e-5);
  assert.ok(Math.abs(b.meterCurrent('C1','a')+1e-6*end/t)<=5e-8);
});
test('budget exhaustion refuses a mean instead of returning a partial passing integral',()=>{
  const b=bench({...pulse,td:0,tr:20e-12,tf:20e-12,pw:400e-12,per:1e-9});
  b.meterVoltage('signal','zero'); b.meterCurrent('R1','a');
  b.advanceTo(10_000n);
  assert.equal(b.transientAnalysisStatus().failure?.code,'step-attempt-budget-exceeded');
  assert.throws(()=>b.meterVoltage('signal','zero'),/meter.*step-attempt-budget-exceeded/);
  assert.throws(()=>b.meterCurrent('R1','a'),/meter.*step-attempt-budget-exceeded/);
  // Isolate the watch's own fail-closed authority; the engine diagnostic is
  // naturally sticky, so do not pretend that it clears on a short advance.
  b._transientAccuracyUnmet=null;
  assert.throws(()=>b.meterVoltage('signal','zero'),/meter.*step-attempt-budget-exceeded/,
    'clearing an engine diagnostic cannot retroactively qualify failed history');
});
test('history capacity refuses instead of silently dropping unintegrated observations',()=>{
  const b=bench(sine); b.meterVoltage('signal','zero');
  b.advanceTo(99_999n);
  const w=[...b._meterWatches.values()][0];
  // Boundary fixture seeds capacity without performing 100,000 MNA solves.
  w.hist=Array.from({length:100000},(_,i)=>{
    const tSec=i/1e9,v=2+Math.sin(omega*tSec);
    return {tSec,before:v,v};
  });
  b.advanceTo(100_000n);
  assert.equal(w.hist.length,100000);
  assert.throws(()=>b.meterVoltage('signal','zero'),/meter-history-limit-exceeded/);
});
test('a full rolling window prunes expired points before judging the next sample capacity',()=>{
  const b=bench(sine); b.meterVoltage('signal','zero');
  b.advanceTo(99_999_000n);
  const w=[...b._meterWatches.values()][0];
  // Strictly ordered, physically consistent window boundary fixture.
  w.hist=Array.from({length:100000},(_,i)=>{
    const tSec=i/1e6,v=2+Math.sin(omega*tSec);
    return {tSec,before:v,v};
  });
  // Isolate publication's capacity policy at one exact next observation;
  // do not assume the adaptive solver chooses a particular first substep.
  b.timeNs=100_001_000n;
  const v=2+Math.sin(omega*.100001);
  b._recordMeterSamples(.100001,{nodeVoltages:new Map([['signal',v],['zero',0]]),branchCurrents:new Map()});
  assert.ok(w.hist.length<=100000);
  assert.ok(Math.abs(b.meterVoltage('signal','zero')-2)<=1e-6);
});
test('the analytic source-constrained inductor keeps its solver but refuses an unqualified mean',()=>{
  const b=new BoardImpl(5);
  b.configureTransientAnalysis('precision-v1');
  b.setNetlist([
    {id:'I1',kind:'isource',params:{...sine,offset:0,amplitude:.001},terminals:['pos','neg']},
    {id:'L1',kind:'inductor',params:{henrys:.001},terminals:['a','b']},
    {id:'G1',kind:'gnd',params:{},terminals:['gnd']},
  ],[
    {id:'signal',terminals:[{part:'I1',terminal:'pos'},{part:'L1',terminal:'a'}]},
    {id:'zero',terminals:[{part:'I1',terminal:'neg'},{part:'L1',terminal:'b'},{part:'G1',terminal:'gnd'}]},
  ]);
  b.setPower(true); b.advanceTo(1_000n);
  assert.equal(b.transientAnalysisStatus().integrationMode,'source-constrained-inductor-direct');
  assert.equal(b.meterVoltage('signal','zero'),b.nodeVoltage('signal'),'first instantaneous read remains valid');
  b.meterCurrent('L1','a');
  b.advanceTo(2_000n);
  assert.equal(b.transientAnalysisStatus().integrationMode,'source-constrained-inductor-direct');
  assert.throws(()=>b.meterVoltage('signal','zero'),/inductor-meter-integral-unqualified/);
  assert.throws(()=>b.meterCurrent('L1','a'),/inductor-meter-integral-unqualified/);
});
test('idle expiry and reset discard the old watch without fabricating prior history',()=>{
  const b=bench({volts:2}); b.meterVoltage('signal','zero');
  b.advanceTo(2_100_000_000n);
  assert.equal(b._meterWatches.size,0);
  assert.equal(b.meterVoltage('signal','zero'),2);
  assert.equal(b._meterWatches.size,1);
  b.reset();
  assert.equal(b._meterWatches.size,0);
});
test('same-time source control changes preserve the pre-edge integral and final right limit',()=>{
  const b=bench({volts:1}); b.meterVoltage('signal','zero'); b.meterCurrent('R1','a');
  b.advanceTo(1_000_000n);
  b.setControl('V1',2); b.setControl('V1',3);
  b.advanceTo(2_000_000n);
  assert.equal(b.meterVoltage('signal','zero'),2);
  assert.equal(b.meterCurrent('R1','a'),-.002);
});
test('power-off is a discrete edge and netlist replacement discards old meter history',()=>{
  const b=bench({volts:2}); b.meterVoltage('signal','zero'); b.meterCurrent('R1','a');
  b.advanceTo(1_000_000n); b.setPower(false); b.advanceTo(2_000_000n);
  assert.equal(b.meterVoltage('signal','zero'),1);
  assert.equal(b.meterCurrent('R1','a'),-.001);
  b.setNetlist(b.parts,b.nets);
  assert.equal(b._meterWatches.size,0);
});
const NGSPICE=process.env.NGSPICE || 'ngspice';
const ngspice=spawnSync(NGSPICE,['--version'],{encoding:'utf8'}).status===0;
for(const [name,card,params,expected] of [
  ['sine','SINE(2 1 250)',sine,expectedSine(0,.007)],
  ['pulse','PULSE(0 5 1m 1m 1m 2m 10m)',pulse,15/7],
]) test(`${name} meter integral matches independently sampled ngspice`,{skip:ngspice?false:'ngspice absent: independent integral did not run'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'bw-meter-integral-'));
  try {
    writeFileSync(join(dir,'reference.cir'),`* Independent source/resistor\nV1 signal 0 ${card}\nR1 signal 0 1k\n`
      +'.options reltol=1e-10 abstol=1e-14 vntol=1e-10\n.control\nset wr_vecnames\nset wr_singlescale\n'
      +'tran 1u 7m 0 100n\nlinearize v(signal)\nwrdata reference.csv time v(signal)\n.endc\n.end\n');
    const result=spawnSync(NGSPICE,['-b','reference.cir'],{cwd:dir,encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stderr);
    const rows=readFileSync(join(dir,'reference.csv'),'utf8').trim().split('\n').slice(1)
      .map(row=>row.trim().split(/\s+/).map(Number));
    assert.equal(rows.length,7001); assert.equal(rows[0][0],0);
    assert.ok(Math.abs(rows.at(-1)[0]-.007)<=1e-12);
    assert.ok(rows.every(row=>row.every(Number.isFinite)));
    let area=0;
    for(let i=1;i<rows.length;i++) {
      assert.ok(rows[i][0]>rows[i-1][0]);
      area+=(rows[i].at(-1)+rows[i-1].at(-1))/2*(rows[i][0]-rows[i-1][0]);
    }
    const oracle=area/(rows.at(-1)[0]-rows[0][0]);
    assert.ok(Math.abs(oracle-expected)<=1e-6,'oracle closed-form control');
    const b=bench(params); b.meterVoltage('signal','zero'); b.meterCurrent('R1','a'); b.advanceTo(T);
    assert.ok(Math.abs(b.meterVoltage('signal','zero')-oracle)<=5e-5);
    assert.ok(Math.abs(b.meterCurrent('R1','a')+oracle/1000)<=5e-8);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
