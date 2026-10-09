import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {registerAnalogAmps} from '../src/devices/analog-amps.js';
import {registerLogicGates} from '../src/devices/logic-gates.js';

registerAnalogAmps();
registerLogicGates();
const net = (id, ...pins) => ({id, terminals: pins.map(([part, terminal]) => ({part, terminal}))});
function follower() {
  const b = new BoardImpl(5);
  b.setNetlist([
    {id:'VP',kind:'vsource',params:{volts:15},terminals:['pos','neg']},
    {id:'VN',kind:'vsource',params:{volts:15},terminals:['pos','neg']},
    {id:'VIN',kind:'vsource',params:{wave:'spice-sine',offset:.25,amplitude:.5,
      freq:100,td:0,theta:0,phase:0},terminals:['pos','neg']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'U',kind:'lm741',params:{inputOffsetV:0},
      terminals:['offset_1','inn','inp','vneg','offset_5','out','vpos','nc']},
    {id:'R',kind:'resistor',params:{ohms:100000},terminals:['a','b']},
  ], [
    net('zero',['G','gnd'],['VP','neg'],['VN','pos'],['VIN','neg'],['R','b']),
    net('positive',['VP','pos'],['U','vpos']),net('negative',['VN','neg'],['U','vneg']),
    net('input',['VIN','pos'],['U','inp']),net('out',['U','out'],['U','inn'],['R','a']),
  ]);
  b.setPower(true);
  const scope = b.addScopeChannel({type:'voltage',netId:'out',referenceNetId:'zero',
    sampleRateHz:100000,depth:16});
  b.meterVoltage('out','zero');
  return {b,scope};
}
function ring() {
  const b = new BoardImpl(5);
  const parts = [{id:'V',kind:'vcc',params:{},terminals:['vcc']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']}];
  const nets = [net('vcc',['V','vcc']),net('zero',['G','gnd'])];
  for(let i=0;i<3;i++) {
    parts.push({id:`N${i}`,kind:'gate_not',params:{tpdNs:[100,120,140][i]},terminals:['in0','out']});
    nets.push(net(`n${i}`,[`N${i}`,'out'],[`N${(i+1)%3}`,'in0']));
  }
  b.setNetlist(parts,nets);
  const scope = b.addScopeChannel({type:'digital',netId:'n0',depth:2048});
  return {b,scope};
}
function pwm() {
  const b = new BoardImpl(5);
  b.setNetlist([
    {id:'M',kind:'mcu',params:{},terminals:['P1.0']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
  ],[net('pin',['M','P1.0'],['R','a']),net('zero',['G','gnd'],['R','b'])]);
  b.setPower(true);
  b.setPwm('P1.0',25,{hz:1000});
  return b;
}
function finish(b,target,maxSteps) {
  for(let i=0;i<2000;i++) if(b.advanceToLive(target,{maxSteps}).completed)return;
  assert.fail('live clock failed to finish within the test invocation bound');
}

test('LM741 live quanta continue at actual horizons and match ordinary event-by-event capture',()=>{
  const live = follower(), reference = follower();
  const boundaries = [];
  live.b.onChange(e=>{if(e.type==='time') boundaries.push(live.b.getTime());});
  const target=250000n;
  let calls=0, processed=0n;
  while(processed<target) {
    const r=live.b.advanceToLive(target,{maxSteps:32});
    assert.ok(Object.isFrozen(r));
    assert.equal(r.startedTimeNs,processed.toString());
    assert.equal(r.requestedTimeNs,target.toString());
    assert.equal(r.processedTimeNs,live.b.getTime().toString());
    assert.ok(r.steps>0&&r.steps<=32);
    assert.equal(r.completed,live.b.getTime()===target);
    if(calls===0) assert.equal(r.completed,false,'no fictitious jump to250us');
    processed=live.b.getTime();calls++;
    assert.ok(calls<100,'bounded test invocation count');
  }
  assert.ok(calls>1);
  for(const t of boundaries) reference.b.advanceTo(t);
  assert.deepEqual(live.b.getScopeData(live.scope),reference.b.getScopeData(reference.scope));
  assert.equal(live.b.meterVoltage('out','zero'),reference.b.meterVoltage('out','zero'));
  const expected=(.25+.5*Math.sin(2*Math.PI*100*.00025))*200000/200001;
  assert.ok(Math.abs(live.b.nodeVoltage('out')-expected)<.004,'independent finite-gain endpoint');
  assert.equal(live.b._deviceSubstepOverflow,false);
  assert.equal(live.b.transientAnalysisStatus().failure,null);
  assert.equal(live.b.transientAnalysisStatus().accuracyMet,true);
});

test('scheduled ring transitions retain their actual event times across live yields',()=>{
  const live=ring(),ordinary=ring();
  let first=live.b.advanceToLive(100000n,{maxSteps:1});
  assert.equal(first.processedTimeNs,'100');
  assert.equal(first.completed,false);
  finish(live.b,100000n,128);
  // Ordinary short advances cannot exhaust200 events in a1us interval.
  for(let t=1000n;t<=100000n;t+=1000n) ordinary.b.advanceTo(t);
  assert.deepEqual(live.b.getScopeData(live.scope).transitions,
    ordinary.b.getScopeData(ordinary.scope).transitions);
  const transitions=live.b.getScopeData(live.scope).transitions;
  assert.ok(transitions.length>100,'the oscillator genuinely ran');
  assert.equal(live.b._deviceSubstepOverflow,false);
});

test('PWM edges limit each quantum and preserve time-first switching and ordinary results',()=>{
  const live=pwm(),ordinary=pwm();
  const seen=[];
  live.onChange(e=>{if(e.type==='time')seen.push([live.getTime(),live.readPin('P1.0')]);});
  const first=live.advanceToLive(10000000n,{maxSteps:1});
  assert.equal(first.processedTimeNs,'250000','first PWM falling edge, not1ms');
  assert.equal(first.completed,false);
  assert.deepEqual(seen,[[250000n,1],[250000n,0]],'time first, switched level second');
  assert.equal(live.readPin('P1.0'),0);
  finish(live,10000000n,3);
  ordinary.advanceTo(10000000n);
  assert.equal(live.nodeVoltage('pin'),ordinary.nodeVoltage('pin'));
  assert.deepEqual(live.getPwm('P1.0'),ordinary.getPwm('P1.0'));
  assert.equal(live.branchCurrent('R','a'),ordinary.branchCurrent('R','a'));
});

test('passive quanta have fixed span/count ceilings and no-op does no work',()=>{
  const b=new BoardImpl(5);let calls=0;
  b.onChange(()=>calls++);
  assert.deepEqual(b.advanceToLive(100000000n,{maxSteps:2}),{
    startedTimeNs:'0',requestedTimeNs:'100000000',processedTimeNs:'2000000',
    completed:false,steps:2,maxSteps:2});
  const before=calls;
  const zero=b.advanceToLive(b.getTime());
  assert.equal(zero.completed,true);assert.equal(zero.steps,0);assert.equal(calls,before);
  const defaultQuantum=b.advanceToLive(100000000n);
  assert.equal(defaultQuantum.maxSteps,32);assert.equal(defaultQuantum.steps,32);
  assert.equal(defaultQuantum.processedTimeNs,'34000000');
});

test('actual RC charge retains ordinary interval equivalence and its independent exponential',()=>{
  function rc(){
    const b=new BoardImpl(5);
    b.setNetlist([
      {id:'V',kind:'vsource',params:{volts:1},terminals:['pos','neg']},
      {id:'G',kind:'gnd',params:{},terminals:['gnd']},
      {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
      {id:'C',kind:'capacitor',params:{farads:1e-6},terminals:['a','b']},
    ],[net('zero',['G','gnd'],['V','neg'],['C','b']),
      net('input',['V','pos'],['R','a']),net('out',['R','b'],['C','a'])]);
    b.setPower(true);
    return b;
  }
  const live=rc(),ordinary=rc();
  for(let t=2000000n;t<=10000000n;t+=2000000n){
    const receipt=live.advanceToLive(t,{maxSteps:2});
    ordinary.advanceTo(t-1000000n);ordinary.advanceTo(t);
    assert.equal(receipt.completed,true);
    assert.equal(live.nodeVoltage('out'),ordinary.nodeVoltage('out'));
    assert.ok(Math.abs(live.nodeVoltage('out')-(1-Math.exp(-Number(t)/1e6)))<1e-4);
    assert.equal(live.transientAnalysisStatus().failure,null);
  }
});

test('invalid targets/options refuse before any state is advanced',()=>{
  const b=new BoardImpl(5);
  for(const options of [null,[],{unknown:1},{maxSteps:0},{maxSteps:129},
    {maxSteps:1.5},{maxSteps:NaN},{maxSteps:Infinity},{maxSteps:null},
    {maxSteps:false},{maxSteps:'32'}]) {
    assert.throws(()=>b.advanceToLive(1000n,options),/maxSteps/);
    assert.equal(b.getTime(),0n);
  }
  for(const target of [-1n,1000,null,BigInt(Number.MAX_SAFE_INTEGER)+1n])
    assert.throws(()=>b.advanceToLive(target),/bigint target/);
  b.advanceToLive(1000n);assert.throws(()=>b.advanceToLive(999n),/bigint target/);
});

test('reactive waveform quanta use public bounds and resume at actual committed times',()=>{
  function rig(maxStepSec) {
    const b=new BoardImpl(5);
    if(maxStepSec!==undefined)b.configureTransientAnalysis('interactive-v2',{maxStepSec});
    b.setNetlist([
      {id:'V',kind:'vsource',params:{wave:'spice-pulse',v1:0,v2:1,td:0,tr:1e-6,tf:1e-6,pw:.001,per:.003},terminals:['pos','neg']},
      {id:'G',kind:'gnd',params:{},terminals:['gnd']},
      {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
      {id:'C',kind:'capacitor',params:{farads:1e-6},terminals:['a','b']},
    ],[net('zero',['G','gnd'],['V','neg'],['C','b']),
      net('input',['V','pos'],['R','a']),net('out',['R','b'],['C','a'])]);
    b.setPower(true);return b;
  }
  for(const [authored,span] of [[undefined,100000n],[20e-6,20000n]]) {
    const live=rig(authored),ordinary=rig(authored),endpoints=[];
    live.onChange(e=>{if(e.type==='time')endpoints.push(live.getTime());});
    const first=live.advanceToLive(500000n,{maxSteps:1});
    assert.equal(first.processedTimeNs,String(span));
    assert.equal(first.steps,1);assert.equal(first.completed,false);
    finish(live,500000n,2);
    let previous=0n;
    for(const at of endpoints){assert.ok(at>previous&&at-previous<=span);ordinary.advanceTo(at);previous=at;}
    assert.equal(previous,500000n);
    assert.equal(live.nodeVoltage('out'),ordinary.nodeVoltage('out'));
    // Closed-form response to the authored 1 us linear rise then constant 1 V.
    const tau=.001,rise=1e-6,t=.0005;
    const atRise=1-tau/rise*(1-Math.exp(-rise/tau));
    const expected=1+(atRise-1)*Math.exp(-(t-rise)/tau);
    assert.ok(Math.abs(live.nodeVoltage('out')-expected)<1e-4);
    assert.equal(live.transientAnalysisStatus().failure,null);
    assert.equal(live.transientAnalysisStatus().profile.maxAttempts,20000);
  }
  const subNs=rig(1e-10);
  assert.equal(subNs.advanceToLive(10n,{maxSteps:1}).processedTimeNs,'1',
    'sub-nanosecond solver bound cannot create a zero-span clock loop');
});

test('time-varying algebraic circuits retain the historical1ms live span',()=>{
  const b=new BoardImpl(5);
  b.setNetlist([
    {id:'V',kind:'vsource',params:{wave:'spice-sine',offset:1,amplitude:.5,freq:100,td:0,theta:0,phase:0},terminals:['pos','neg']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
  ],[net('zero',['G','gnd'],['V','neg'],['R','b']),net('out',['V','pos'],['R','a'])]);
  assert.equal(b.advanceToLive(5000000n,{maxSteps:1}).processedTimeNs,'1000000');
  assert.ok(Math.abs(b.nodeVoltage('out')-(1+.5*Math.sin(2*Math.PI*.1)))<1e-8);
});

test('precision and completed finite analysis cannot become renewable live work',()=>{
  const precision=new BoardImpl(5);precision.configureTransientAnalysis('precision-v1');
  assert.throws(()=>precision.advanceToLive(1000n),/analysis reuse/);
  const finite=new BoardImpl(5);
  finite.advanceToBounded(1000n,{maxAttempts:20000,maxSolves:60001,maxAdvances:200});
  assert.throws(()=>finite.advanceToLive(2000n),/analysis reuse/);
  assert.equal(finite.getTime(),1000n);
  const active=new BoardImpl(5);let refused=false;
  active.advanceToBoundedStream(1000n,{maxAttempts:20000,maxSolves:60001,maxAdvances:200},
    {stepNs:1000n,onStep:()=>{
      assert.throws(()=>active.advanceToLive(2000n),/analysis reuse/);refused=true;
    }});
  assert.equal(refused,true);assert.equal(active.getTime(),1000n);
});

test('an actual inconsistent circuit refuses live work before acquiring history',()=>{
  const b=new BoardImpl(5);
  b.setNetlist([
    {id:'A',kind:'vsource',params:{volts:5},terminals:['pos','neg']},
    {id:'B',kind:'vsource',params:{volts:6},terminals:['pos','neg']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
  ],[net('zero',['G','gnd'],['A','neg'],['B','neg'],['R','b']),
    net('rail',['A','pos'],['B','pos'],['R','a'])]);
  assert.throws(()=>b.advanceToLive(1000000n),error=>error.code==='SOLVE_FAILED_MEASUREMENT');
  assert.equal(b.getTime(),0n);assert.equal(b._liveAdvanceContext,undefined);
});

test('an option getter cannot move finite-analysis authority past the admission check',()=>{
  const b=new BoardImpl(5);let reads=0;
  const options={get maxSteps(){
    reads++;
    b.advanceToBounded(1000n,{maxAttempts:20000,maxSolves:60001,maxAdvances:200});
    return 1;
  }};
  assert.throws(()=>b.advanceToLive(2000n,options),/analysis reuse/);
  assert.equal(reads,1);assert.equal(b.getTime(),1000n,'no live work after finite capture');
  assert.equal(b.transientAnalysisStatus().boundedAdvance.completed,true);
});

test('already skipped device history stays refused without clearing failure state',()=>{
  const {b}=follower();b.advanceTo(50000000n);
  const failure=b.transientAnalysisStatus().failure;
  assert.throws(()=>b.advanceToLive(60000000n),error=>error.code==='SOLVE_FAILED_MEASUREMENT');
  assert.equal(b.getTime(),50000000n);
  assert.deepEqual(b.transientAnalysisStatus().failure,failure);
});

for(const nested of ['ordinary','live']) test(`caught ${nested} listener reentry stops the outer quantum`,()=>{
  const b=new BoardImpl(5);let caught;
  const observer=()=>{
    try { nested==='ordinary'?b.advanceTo(5000000n):b.advanceToLive(5000000n); }
    catch(error){caught=error;}
  };
  b.onChange(observer);
  assert.throws(()=>b.advanceToLive(10000000n),error=>error===caught);
  assert.ok(caught);assert.equal(b.getTime(),1000000n,'nested call never advances');
  assert.equal(b._liveAdvanceContext,null);
  b.offChange(observer);
  assert.equal(b.advanceToLive(2000000n).completed,true,'context released, no history was skipped');
});

test('ordinary callback failure propagates unchanged and releases live context',()=>{
  const b=new BoardImpl(5),error=new Error('original advance failure');
  const original=b.advanceTo;b.advanceTo=()=>{throw error;};
  assert.throws(()=>b.advanceToLive(1000n),actual=>actual===error);
  assert.equal(b._liveAdvanceContext,null);assert.equal(b.getTime(),0n);
  b.advanceTo=original;assert.equal(b.advanceToLive(1000n).completed,true);
});
