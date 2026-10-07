import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {registerAnalogAmps} from '../src/devices/analog-amps.js';
registerAnalogAmps();
const net=(id,...pins)=>({id,terminals:pins.map(([part,terminal])=>({part,terminal}))});
function fixture() {
  const b=new BoardImpl(5);
  b.setNetlist([
    {id:'VP',kind:'vsource',params:{volts:15},terminals:['pos','neg']},
    {id:'VN',kind:'vsource',params:{volts:15},terminals:['pos','neg']},
    {id:'VIN',kind:'vsource',params:{volts:.25,wave:'spice-sine',offset:.25,
      amplitude:.5,freq:100,td:0,theta:0,phase:0},terminals:['pos','neg']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'U',kind:'lm741',params:{inputOffsetV:0},
      terminals:['offset_1','inn','inp','vneg','offset_5','out','vpos','nc']},
    {id:'R',kind:'resistor',params:{ohms:100000},terminals:['a','b']},
  ],[
    net('zero',['G','gnd'],['VP','neg'],['VN','pos'],['VIN','neg'],['R','b']),
    net('positive',['VP','pos'],['U','vpos']),net('negative',['VN','neg'],['U','vneg']),
    net('input',['VIN','pos'],['U','inp']),net('out',['U','out'],['U','inn'],['R','a']),
  ]);
  b.setPower(true);
  const scopes=['envelope','sample'].map(capture=>b.addScopeChannel({type:'voltage',
    netId:'out',referenceNetId:'zero',capture,sampleRateHz:100000,depth:16}));
  const current=b.addScopeChannel({type:'current',partId:'R',terminal:'a',depth:16});
  b.meterVoltage('out','zero');b.meterCurrent('R','a');
  return {b,scopes:[...scopes,current]};
}
const refused=fn=>assert.throws(fn,error=>error.code==='SOLVE_FAILED_MEASUREMENT'
  && /device sub-step budget exhausted/.test(error.message));

test('actual LM741 device overflow refuses prior and fresh analog captures and means',()=>{
  const {b,scopes}=fixture();b.advanceTo(50000000n);
  assert.equal(b.getTime(),50000000n,'ordinary caller clock contract is unchanged');
  assert.ok(b.getWarnings().some(w=>/Device sub-step limit reached/.test(w.message)));
  const status=b.transientAnalysisStatus();
  assert.equal(status.work.advances,200,'existing device cap, not an increased allowance');
  assert.equal(status.accuracyMet,false);assert.equal(status.failure.code,'device-substep-budget-exceeded');
  assert.ok(status.failure.timeSec<.05,'processed device horizon precedes requested destination');
  assert.equal(status.failure.requestedTimeSec,.05);
  for(const handle of scopes)refused(()=>b.getScopeData(handle));
  refused(()=>b.sampleCurrentChannels());
  refused(()=>b.meterVoltage('out','zero'));refused(()=>b.meterCurrent('R','a'));
  refused(()=>b.meterVoltage('input','zero'),'a fresh watch must not bless skipped history');
  b.clearScopeChannels();
  const fresh=b.addScopeChannel({type:'voltage',netId:'out',sampleRateHz:100000,depth:16});
  refused(()=>b.getScopeData(fresh));
  // Later solves, power cycling and the historical reset cannot reconstruct
  // omitted device history. Recovery requires a newly initialized Board.
  b.setControl('VIN',.2);refused(()=>b.getScopeData(fresh));
  b.setPower(false);refused(()=>b.meterVoltage('out','zero'));
  b.setPower(true);refused(()=>b.meterVoltage('out','zero'));
  b.reset();refused(()=>b.meterVoltage('out','zero'));
});

test('completed small LM741 advances still expose genuine numeric measurements',()=>{
  const {b,scopes}=fixture();
  for(let t=1000n;t<=100000n;t+=1000n)b.advanceTo(t);
  assert.equal(b.getTime(),100000n);
  assert.equal(b.getWarnings().some(w=>/Device sub-step limit reached/.test(w.message)),false);
  assert.equal(b.transientAnalysisStatus().failure,null);
  assert.equal(b.transientAnalysisStatus().accuracyMet,true);
  for(const handle of scopes.slice(0,2)){
    const data=b.getScopeData(handle);assert.ok(data.count>0);
    assert.ok([...data.samples].some(Number.isFinite));
  }
  assert.ok(Number.isFinite(b.meterVoltage('out','zero')));
  assert.ok(Number.isFinite(b.meterCurrent('R','a')));
  assert.equal(b.sampleCurrentChannels().size,1);
});

test('bounded incomplete capture retains its named refusal and failure receipt',()=>{
  const {b,scopes}=fixture();
  assert.throws(()=>b.advanceToBounded(50000000n,{maxAttempts:20000,maxSolves:60001,maxAdvances:200}),
    /incomplete device\/transient work/);
  const receipt=b.transientAnalysisStatus().boundedAdvance;
  assert.equal(receipt.completed,false);assert.equal(receipt.failure,'whole-advance-refused');
  assert.equal(b.transientAnalysisStatus().failure.code,'whole-advance-refused');
  for(const handle of scopes)assert.throws(()=>b.getScopeData(handle),/scope capture refused/);
});
