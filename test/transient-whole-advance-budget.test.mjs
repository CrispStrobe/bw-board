import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {registerPowerDevices} from '../src/devices/power.js';

registerPowerDevices();
const limits={maxAttempts:20000,maxSolves:60001,maxAdvances:200};
const net=(id,...pins)=>({id,terminals:pins.map(([part,terminal])=>({part,terminal}))});
function fixture(timed=false){
  const b=new BoardImpl(5);b.configureTransientAnalysis('precision-v1');
  const parts=[{id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'V',kind:'vsource',params:{volts:8},terminals:['pos','neg']},
    {id:'R',kind:'resistor',params:{ohms:500},terminals:['a','b']},
    {id:'C',kind:'capacitor',params:{farads:22e-6},terminals:['a','b']}];
  const nets=[net('zero',['G','gnd'],['V','neg'],['R','b'],['C','b']),
    net('out',['R','a'],['C','a'])];
  if(timed){
    parts.push({id:'EN',kind:'vsource',params:{volts:3.3},terminals:['pos','neg']},
      {id:'U',kind:'adp7118',params:{vOut:5,rOut:.05,currentLimit:.36,
        startupModel:'current-limited-envelope'},
      terminals:['vout_1','vout_2','sense_adj','gnd','en','ss','vin_7','vin_8']});
    nets[0].terminals.push({part:'U',terminal:'gnd'},{part:'EN',terminal:'neg'});
    nets[1].terminals.push(...['vout_1','vout_2','sense_adj'].map(terminal=>({part:'U',terminal})));
    nets.push(net('vin',['V','pos'],['U','vin_7'],['U','vin_8']),net('en',['EN','pos'],['U','en']));
  }else{
    parts.push({id:'RS',kind:'resistor',params:{ohms:1000},terminals:['a','b']});
    nets[1].terminals.push({part:'RS',terminal:'b'});
    nets.push(net('vin',['V','pos'],['RS','a']));
  }
  b.setNetlist(parts,nets);
  const scope=b.addScopeChannel({type:'voltage',netId:'out',referenceNetId:'zero',
    sampleRateHz:100000,depth:122,capture:'sample'});
  b.meterVoltage('out','zero');
  return {b,scope};
}

test('bounded/default captures are bit-exact across passive and timed subintervals',()=>{
  for(const timed of [false,true]){
    const a=fixture(timed),b=fixture(timed);
    const target=timed?1200000n:20000n;
    a.b.advanceTo(target);
    const receipt=b.b.advanceToBounded(target,limits);
    assert.deepEqual(b.b.getScopeData(b.scope),a.b.getScopeData(a.scope));
    assert.equal(b.b.meterVoltage('out','zero'),a.b.meterVoltage('out','zero'));
    assert.equal(b.b.nodeVoltage('out'),a.b.nodeVoltage('out'));
    const {boundedAdvance,...status}=b.b.transientAnalysisStatus();
    assert.deepEqual(status,a.b.transientAnalysisStatus());assert.equal(boundedAdvance,receipt);
    assert.equal(receipt.completed,true);assert.equal(receipt.failure,null);
    assert.equal(receipt.requestedTimeNs,target.toString());
    assert.equal(receipt.work.attempts,status.work.attempts);
    assert.equal(receipt.work.advances,status.work.advances);
    assert.ok(receipt.work.solves>=status.work.solves,'includes device-triggered MNA too');
    assert.ok(timed?receipt.work.advances>100:receipt.work.advances===1);
    assert.ok(Object.isFrozen(receipt)&&Object.isFrozen(receipt.work)&&Object.isFrozen(receipt.limits));
    assert.throws(()=>{receipt.work.solves=0;},TypeError);
    assert.throws(()=>b.b.advanceToBounded(1300000n,limits),/fresh Board/);
  }
});

function stopOracle(counter){
  const {b,scope}=fixture(true);
  const original=b._solveLiveMNA;
  let entered=0;
  b._solveLiveMNA=function(...args){entered++;return original.apply(this,args);};
  const key=`max${counter[0].toUpperCase()}${counter.slice(1)}`;
  let failure;
  assert.throws(()=>b.advanceToBounded(200000n,{...limits,[key]:1}),error=>{
    failure=error;return error.code==='WHOLE_ADVANCE_BUDGET_EXCEEDED'&&error.message.includes(counter);
  });
  const status=b.transientAnalysisStatus(),receipt=status.boundedAdvance;
  assert.equal(receipt.completed,false);assert.equal(receipt.failure,'whole-advance-budget-exceeded');
  assert.equal(receipt.work[counter],1,'refused work is not executed or billed');
  assert.equal(status.accuracyMet,false);assert.equal(status.failure.code,'whole-advance-budget-exceeded');
  assert.equal(b._boundedAdvanceContext,null,'budget context always released');
  assert.throws(()=>b.getScopeData(scope),/work budget exceeded/);
  assert.throws(()=>b.meterVoltage('out','zero'),/work budget exceeded/);
  assert.throws(()=>b.branchCurrent('R','a'),/work budget exceeded/);
  const fresh=b.addScopeChannel({type:'voltage',netId:'out',referenceNetId:'zero',depth:2});
  assert.throws(()=>b.getScopeData(fresh),/work budget exceeded/);
  assert.throws(()=>b.advanceToBounded(1200000n,limits),/fresh Board/);
  if(counter==='solves')assert.equal(entered,2,'second MNA boundary refuses before solving');
  assert.equal(b._liveSolveError,failure,'original failure identity retained');
}
for(const counter of ['attempts','solves','advances'])
  test(`whole-capture ${counter} stops before exceeding its budget`,()=>stopOracle(counter));

test('malformed budgets and targets refuse before consuming capture state',()=>{
  const {b}=fixture();
  for(const bad of [null,[],{}, {...limits,maxAttempts:0},{...limits,maxSolves:60002},
    {...limits,maxAdvances:201},{...limits,maxAttempts:1.5},{...limits,maxSolves:Infinity},
    {...limits,unknown:1}])assert.throws(()=>b.advanceToBounded(1000n,bad),/bounded max/);
  for(const target of [0n,-1n,1000,null,BigInt(Number.MAX_SAFE_INTEGER)+1n])
    assert.throws(()=>b.advanceToBounded(target,limits),/positive bigint/);
  assert.equal(b.timeNs,0n);assert.equal(b.transientAnalysisStatus().boundedAdvance,undefined);
  b.drivenPwm.set('test',{});
  assert.throws(()=>b.advanceToBounded(1000n,limits),/driven PWM/);
  b.drivenPwm.clear();
  assert.equal(b.advanceToBounded(1000n,limits).completed,true);
});

test('reentrant capture and ordinary failures preserve identity and cleanup',()=>{
  const {b}=fixture();const advance=b.advanceTo;
  b.advanceTo=function(target){
    assert.throws(()=>this.advanceToBounded(target,limits),/reentrant/);
    return advance.call(this,target);
  };
  assert.equal(b.advanceToBounded(1000n,limits).completed,true);
  const {b:failed,scope}=fixture();const error=Object.freeze(new Error('original callback refusal'));
  failed.advanceTo=()=>{throw error;};
  assert.throws(()=>failed.advanceToBounded(1000n,limits),actual=>actual===error);
  assert.equal(failed._boundedAdvanceContext,null);
  assert.equal(failed.transientAnalysisStatus().boundedAdvance.failure,'whole-advance-refused');
  assert.throws(()=>failed.getScopeData(scope),/original callback refusal/);
});

test('budget getters are sampled once and direct analysis solves cannot bypass the cap',()=>{
  const {b}=fixture();let reads=0;
  const selected={...limits,get maxSolves(){reads++;return reads===1?1:60001;}};
  assert.throws(()=>b.advanceToBounded(1000n,selected),/solves limit 1/);
  assert.equal(reads,1);assert.equal(b.transientAnalysisStatus().boundedAdvance.limits.maxSolves,1);
  for(const call of [b=>b.biasPointVoltages(),b=>b._solveMNA(true),
    b=>b._solveDcOperatingPoint({parts:b._solveParts,controls:b.controls,deviceStates:b._deviceStates,tSeconds:0})]){
    const {b:probe}=fixture();
    probe.advanceTo=()=>{call(probe);call(probe);};
    assert.throws(()=>probe.advanceToBounded(1000n,{...limits,maxSolves:1}),/solves limit 1/);
    assert.equal(probe.transientAnalysisStatus().boundedAdvance.work.solves,1);
  }
});

test('three isolated counter-charge mutants fail actual hard-stop caller oracles',()=>{
  const original=BoardImpl.prototype._chargeBoundedAdvanceWork;
  try{
    for(const counter of ['attempts','solves','advances']){
      BoardImpl.prototype._chargeBoundedAdvanceWork=function(key){
        if(key!==counter)return original.call(this,key);
      };
      assert.throws(()=>stopOracle(counter),{name:'AssertionError'},`${counter} bypass must be observable`);
    }
  }finally{BoardImpl.prototype._chargeBoundedAdvanceWork=original;}
  assert.equal(BoardImpl.prototype._chargeBoundedAdvanceWork,original);
  for(const counter of ['attempts','solves','advances'])stopOracle(counter);
});

test('omitting whole-capture invalidation fails the partial-observation caller oracle',()=>{
  const original=BoardImpl.prototype._invalidateLiveMeasurements;
  try{
    BoardImpl.prototype._invalidateLiveMeasurements=function(error){
      if(error.code!=='WHOLE_ADVANCE_BUDGET_EXCEEDED')return original.call(this,error);
    };
    assert.throws(()=>stopOracle('advances'),{name:'AssertionError'});
  }finally{BoardImpl.prototype._invalidateLiveMeasurements=original;}
  stopOracle('advances');
});

test('an existing incomplete device backstop cannot become a completed bounded capture',()=>{
  const {b,scope}=fixture();const advance=b.advanceTo;
  b.advanceTo=function(target){advance.call(this,target);this._deviceSubstepOverflow=true;};
  assert.throws(()=>b.advanceToBounded(1000n,limits),/incomplete device\/transient work/);
  assert.equal(b.transientAnalysisStatus().boundedAdvance.completed,false);
  assert.throws(()=>b.getScopeData(scope),/incomplete device\/transient work/);
});
