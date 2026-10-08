import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

function bench(sine=false){
  const b=new BoardImpl(5);
  b.setNetlist([
    {id:'V',kind:'vsource',params:sine?{volts:2,wave:'spice-sine',offset:2,amplitude:1,freq:1000,td:0,theta:0,phase:0}:{volts:5},terminals:['pos','neg']},
    {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
  ],[
    {id:'signal',terminals:[{part:'V',terminal:'pos'},{part:'R',terminal:'a'}]},
    {id:'ground',terminals:[{part:'V',terminal:'neg'},{part:'R',terminal:'b'},{part:'G',terminal:'gnd'}]},
  ]);b.setPower(true);return b;
}
const attach=(b,capture='envelope',extra={})=>b.addScopeChannel({type:'voltage',netId:'signal',
  sampleRateHz:100000,depth:8,capture,...extra});
function comparable(b,h){
  const d=b.getScopeData(h);
  return {...d,samples:[...d.samples]};
}

for(const capture of ['envelope','sample'])for(const elapsed of [0n,55000n,265500n])
test(`reset ${capture} late/partial/wrapped history at ${elapsed}ns matches fresh acquisition`,()=>{
  const b=bench(true);b.advanceTo(20000n);const h=attach(b,capture);
  b.advanceTo(20000n+elapsed);b.reset();
  const empty=b.getScopeData(h);
  assert.equal(b.getTime(),0n);assert.equal(empty.count,0);assert.equal(empty.writeIndex,0);
  assert.equal(empty.startTNs,0n);assert.ok([...empty.samples].every(Number.isNaN));
  const fresh=bench(true),other=attach(fresh,capture);
  for(const t of [10000n,80000n,170000n]){
    b.advanceTo(t);fresh.advanceTo(t);
    assert.deepEqual(comparable(b,h),comparable(fresh,other),'no old deadline/bucket/interpolation can survive');
  }
});

test('reset retains reference, rate, depth, handle and physical probe load',()=>{
  const b=bench(),h=attach(b,'sample',{referenceNetId:'ground',inputOhms:1000,inputFarads:1e-10});
  b.advanceTo(25000n);const before=b._scopeChannels.get(h);
  const options=Object.fromEntries(['type','netId','referenceNetId','inputOhms','inputFarads','sampleRateHz','intervalNs','capture','depth']
    .map(k=>[k,before[k]]));
  b.reset();assert.deepEqual(b.getScopeChannels(),[h]);assert.equal(b._scopeChannels.get(h),before);
  for(const [k,v] of Object.entries(options))assert.equal(before[k],v);
  assert.ok(b._solveParts.some(p=>p.id===`@scope:${h}:r`));
  assert.ok(b._solveParts.some(p=>p.id===`@scope:${h}:c`));
  assert.equal(b.getScopeData(h).count,0);b.advanceTo(10000n);
  assert.equal(b.getScopeData(h).count,1);assert.equal(b.getScopeData(h).startTNs,10000n);
});

test('reset clears manual-current history without inventing a new sampling cadence',()=>{
  const b=bench(),h=b.addScopeChannel({type:'current',partId:'R',terminal:'a',depth:8});
  for(let i=1;i<=20;i++){b.advanceTo(BigInt(i)*10000n);b.sampleCurrentChannels();}
  assert.equal(b.getScopeData(h).count,20);b.reset();
  const d=b.getScopeData(h);assert.equal(d.count,0);assert.equal(d.writeIndex,0);assert.equal(d.startTNs,0n);
  assert.ok([...d.samples].every(Number.isNaN));b.sampleCurrentChannels();
  // Current is signed leaving the part through terminal a (5mA enters R.a).
  assert.equal(b.getScopeData(h).count,1);assert.equal(b.getScopeData(h).samples[0],-.005);
});

test('reset clears digital history and publishes new epoch level once at time zero',()=>{
  const b=bench(),h=b.addScopeChannel({type:'digital',netId:'signal',threshold:2.5,depth:8});
  b.advanceTo(50000n);assert.ok(b.getScopeData(h).count>0);b.reset();
  const d=b.getScopeData(h);assert.equal(d.count,1);assert.equal(d.writeIndex,1);
  assert.equal(d.transitions[0],0);assert.equal(d.transitions[1],1);
  assert.ok([...d.transitions.slice(2)].every(Number.isNaN));
  b.advanceTo(10000n);assert.equal(b.getScopeData(h).count,1,'same level is not duplicated');
});

test('reset never blesses a genuinely refused finite capture',()=>{
  const b=bench(true),h=attach(b);
  assert.throws(()=>b.advanceToBounded(500000n,{maxAttempts:1,maxSolves:1,maxAdvances:1}));
  assert.ok(b.transientAnalysisStatus().failure,'real analysis refusal, not fabricated channel metadata');
  assert.throws(()=>b.getScopeData(h),error=>error.code==='SOLVE_FAILED_MEASUREMENT');
  const reason=b._scopeChannels.get(h).failure;b.reset();
  assert.throws(()=>b.getScopeData(h),error=>error.code==='SOLVE_FAILED_MEASUREMENT');
  assert.equal(b._scopeChannels.get(h).failure,reason);
  const fresh=bench(true),other=attach(fresh);fresh.advanceTo(10000n);
  assert.equal(fresh.getScopeData(other).count,1,'new valid board is the positive control');
});
