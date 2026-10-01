import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {spiceSineIntegral} from '../src/source-waveforms.js';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const basic={wave:'spice-sine',offset:.002,amplitude:.001,freq:250,td:0,theta:0,phase:0};
function bench(params=basic,reverse=false,groundA=false) {
  const b=new BoardImpl(5); b.configureTransientAnalysis('precision-v1');
  b.setNetlist([
    {id:'I',kind:'isource',params:{...params},terminals:['pos','neg']},
    {id:'L',kind:'inductor',params:{henrys:.003},terminals:['a','b']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
  ],[
    {id:'a',terminals:[{part:'L',terminal:'a'},{part:'I',terminal:reverse?'neg':'pos'},
      ...(groundA?[{part:'G',terminal:'gnd'}]:[])]},
    {id:'b',terminals:[{part:'L',terminal:'b'},{part:'I',terminal:reverse?'pos':'neg'},
      ...(!groundA?[{part:'G',terminal:'gnd'}]:[])]},
  ]); b.setPower(true); return b;
}
function value(p,t) {
  const u=Math.max(0,t-p.td);
  return p.offset+p.amplitude*Math.exp(-p.theta*u)*Math.sin(2*Math.PI*p.freq*u+p.phase*Math.PI/180);
}
// Independent composite Simpson quadrature, split at delay; never calls the
// production integral/derivative. Voltage uses the fundamental theorem of calculus.
function area(p,from,to) {
  if(from<p.td && to>p.td) return area(p,from,p.td)+area(p,p.td,to);
  const n=20000,h=(to-from)/n;
  let sum=value(p,from)+value(p,to);
  for(let k=1;k<n;k++) sum+=(k%2?4:2)*value(p,from+k*h);
  return sum*h/3;
}
function near(actual,expected,tolerance=1e-11) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
}
for(const [label,p] of [['plain',basic],['delayed-damped-phase',{
  ...basic,td:.0031,theta:37,phase:73,amplitude:-.001,freq:173,
}]]) for(const reverse of [false,true]) for(const groundA of [false,true]) {
  test(`${label}: exact means, both polarities/ground placements, three caller schedules (${reverse}/${groundA})`,()=>{
    const end=7_000_000n,sign=reverse?-1:1;
    const expectedI=area(p,0,.007)/.007;
    const expectedV=.003*sign*(value(p,.007)-value(p,0))/.007;
    for(const stride of [end,700_000n,10_000n]) {
      const b=bench(p,reverse,groundA);
      assert.equal(b.meterVoltage('a','b'),b.nodeVoltage('a')-b.nodeVoltage('b'));
      b.meterVoltage('b','a');
      for(const [part,pin] of [['I','pos'],['I','neg'],['L','a'],['L','b']]) b.meterCurrent(part,pin);
      for(let t=stride;t<=end;t+=stride) b.advanceTo(t);
      near(b.meterVoltage('a','b'),expectedV);
      near(b.meterVoltage('b','a'),-expectedV);
      near(b.meterCurrent('I','pos'),expectedI);
      near(b.meterCurrent('I','neg'),-expectedI);
      near(b.meterCurrent('L','a'),-sign*expectedI);
      near(b.meterCurrent('L','b'),sign*expectedI);
      assert.equal(b.transientAnalysisStatus().integrationMode,'source-constrained-inductor-direct');
      assert.equal(b.transientAnalysisStatus().work.solves,0);
    }
  });
}
test('clipped 100 ms partial analytic segments do not use endpoints or the full watch',()=>{
  const p={...basic,freq:7,theta:2,phase:33,td:.02},b=bench(p);
  b.meterVoltage('a','b'); b.meterCurrent('L','a');
  b.advanceTo(70_000_000n); b.advanceTo(135_000_000n);
  near(b.meterVoltage('a','b'),.003*(value(p,.135)-value(p,.035))/.1);
  near(b.meterCurrent('L','a'),-area(p,.035,.135)/.1);
});
test('first watch after unwatched advances starts now, not at source origin',()=>{
  const b=bench(); b.advanceTo(3_000_000n);
  b.meterCurrent('L','a'); b.advanceTo(7_000_000n);
  near(b.meterCurrent('L','a'),-area(basic,.003,.007)/.004);
});
test('delay-only windows and tiny intervals remain stable',()=>{
  const p={...basic,td:.01,theta:30,phase:90};
  near(spiceSineIntegral(p,.001,.002),.003*.001,1e-17);
  assert.equal(spiceSineIntegral(p,.001,.002,true),0);
  for(const d of [1e-9,1e-12]) {
    near(spiceSineIntegral(basic,.003,.003+d)/d,value(basic,.003),1e-9);
  }
});
test('invalid integral intervals refuse rather than return a fabricated zero',()=>{
  for(const [a,b] of [[-1,0],[2,1],[0,NaN],[0,Infinity]])
    assert.throws(()=>spiceSineIntegral(basic,a,b),/finite ordered/);
});
test('parameter edits refuse active analytic history until reset; frozen segments do not drift',()=>{
  for(const [part,key,v] of [['I','amplitude',.003],['L','henrys',.006]]) {
    const b=bench(); b.meterCurrent('L','a'); b.meterVoltage('a','b'); b.advanceTo(7_000_000n);
    const segment=[...b._meterWatches.values()][0].hist.at(-1).analytic;
    b.setPartParam(part,key,v);
    assert.equal(segment.params.amplitude,.001);
    assert.throws(()=>b.meterCurrent('L','a'),/parameter-edit-unqualified/);
    assert.throws(()=>b.meterVoltage('a','b'),/parameter-edit-unqualified/);
    b.reset(); assert.equal(b._meterWatches.size,0);
  }
});
test('idle expiry discards analytic watch and unwatched work remains one attempt/zero solves',()=>{
  const b=bench(); b.meterCurrent('L','a'); b.advanceTo(2_100_000_000n);
  assert.equal(b._meterWatches.size,0);
  assert.equal(b.meterCurrent('L','a'),b.branchCurrent('L','a'));
  const unwatched=bench(); unwatched.advanceTo(7_000_000n);
  assert.deepEqual(unwatched.transientAnalysisStatus().work,{attempts:1,solves:0,advances:1});
});
test('missing analytic publication refuses instead of holding a prior endpoint',()=>{
  const b=bench(); b.meterCurrent('L','a'); b.advanceTo(7_000_000n);
  [...b._meterWatches.values()][0].hist.pop();
  assert.throws(()=>b.meterCurrent('L','a'),/inductor-meter-integral-unqualified/);
});
test('power-off combines the prior analytic area with the subsequent zero current',()=>{
  const b=bench(); b.meterCurrent('L','a'); b.advanceTo(3_000_000n);
  b.setPower(false); b.advanceTo(7_000_000n);
  near(b.meterCurrent('L','a'),-area(basic,0,.003)/.007);
});
test('analytic segments obey the same hard history capacity refusal',()=>{
  const b=bench(); b.meterCurrent('L','a'); b.advanceTo(99_999n);
  const watch=[...b._meterWatches.values()][0];
  const analytic=watch.hist.at(-1).analytic;
  watch.hist=Array.from({length:100000},(_,k)=>({tSec:k/1e9,v:-value(basic,k/1e9),before:-value(basic,k/1e9),analytic}));
  b.advanceTo(100_000n);
  assert.equal(watch.hist.length,100000);
  assert.throws(()=>b.meterCurrent('L','a'),/meter-history-limit-exceeded/);
});
const NGSPICE=process.env.NGSPICE || 'ngspice';
const probe=spawnSync(NGSPICE,['--version'],{encoding:'utf8'});
test('analytic inductor voltage/current means match live ngspice, not just local formulas',{
  skip:probe.error || probe.status!==0 ? 'ngspice unavailable' : false,
},()=>{
  const dir=mkdtempSync(join(tmpdir(),'inductor-meter-'));
  try {
    writeFileSync(join(dir,'reference.cir'),`Inductor meter independent reference
I1 0 a SIN(0.002 0.001 250)
L1 a 0 0.003
.control
set numdgt=15
set wr_singlescale
set wr_vecnames
tran 1u 7m 0 1u
linearize v(a) i(L1)
wrdata reference.csv v(a) i(L1)
quit
.endc
.end
`);
    const result=spawnSync(NGSPICE,['-b','reference.cir'],{cwd:dir,encoding:'utf8',timeout:30000});
    assert.ifError(result.error); assert.equal(result.status,0,result.stderr);
    const rows=readFileSync(join(dir,'reference.csv'),'utf8').trim().split('\n').slice(1)
      .map(line=>line.trim().split(/\s+/).map(Number)).filter(row=>row[0]>=.001-1e-12);
    assert.equal(rows.length,6001);
    assert.ok(rows.every(row=>row.length===3 && row.every(Number.isFinite)));
    let volts=0,amps=0;
    for(let k=1;k<rows.length;k++) {
      const d=rows[k][0]-rows[k-1][0]; assert.ok(d>0);
      volts+=d*(rows[k][1]+rows[k-1][1])/2;
      amps+=d*(rows[k][2]+rows[k-1][2])/2;
    }
    volts/=.006; amps/=.006;
    near(volts,.003*(value(basic,.007)-value(basic,.001))/.006,2e-9);
    near(amps,area(basic,.001,.007)/.006,1e-9);
    const b=bench(); b.advanceTo(1_000_000n); b.meterVoltage('a','b'); b.meterCurrent('L','a');
    b.advanceTo(7_000_000n);
    near(b.meterVoltage('a','b'),volts,2e-9);
    near(b.meterCurrent('L','a'),-amps,1e-9);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
