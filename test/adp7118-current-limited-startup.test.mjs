import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BoardImpl} from '../src/board.js';
import {registerPowerDevices} from '../src/devices/power.js';
import {solveMNA} from '../src/mna.js';

registerPowerDevices();
const terminals=['vout_1','vout_2','sense_adj','gnd','en','ss','vin_7','vin_8'];
const params={vOut:5,rOut:.05,currentLimit:.36,startupModel:'current-limited-envelope'};
const net=(id,...pins)=>({id,terminals:pins.map(([part,terminal])=>({part,terminal}))});
const near=(actual,expected,tolerance,label)=>assert.ok(Math.abs(actual-expected)<=tolerance,
  `${label}: ${actual} versus ${expected} (tolerance ${tolerance})`);

function rig({R=500,C=2.2e-6,inputR=4,internalR=0,shift=0,parameters={},edit=null}={}){
  const b=new BoardImpl(5);
  const parts=[
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'VIN',kind:'vsource',params:{volts:8,rInternal:internalR},terminals:['pos','neg']},
    {id:'EN',kind:'vsource',params:{volts:3.3},terminals:['pos','neg']},
    {id:'U',kind:'adp7118',params:{...params,...parameters},terminals},
    {id:'RL',kind:'resistor',params:{ohms:R},terminals:['a','b']},
    {id:'C',kind:'capacitor',params:{farads:C},terminals:['a','b']},
    ...(inputR? [{id:'RS',kind:'resistor',params:{ohms:inputR},terminals:['a','b']}] : []),
    ...(shift? [{id:'REF',kind:'vsource',params:{volts:shift},terminals:['pos','neg']}] : []),
  ];
  const nets=[
    net('gnd',...(shift?[['REF','pos']]:[['G','gnd']]),['VIN','neg'],['EN','neg'],['U','gnd'],['RL','b'],['C','b']),
    net('vin',['U','vin_7'],['U','vin_8'],...(inputR?[['RS','b']]:[['VIN','pos']])),
    net('en',['EN','pos'],['U','en']),
    net('out',['U','vout_1'],['U','vout_2'],['U','sense_adj'],['RL','a'],['C','a']),
    ...(inputR?[net('source',['VIN','pos'],['RS','a'])]:[]),
    ...(shift?[net('zero',['G','gnd'],['REF','neg'])]:[]),
  ];
  edit?.({parts,nets,b});
  b.setNetlist(parts,nets);
  return b;
}

// Independent continuous RC solution. Transition roots are bracketed from
// these analytic segments, never inferred from the simulator's waveform.
function oracle(R,C,{A=5,r=.05,I=.36,duration=.0012}={}){
  const tau=300e-6/Math.log(9),delay=Math.round((80e-6+tau*Math.log(.9))*1e9)/1e9;
  const k=R/(R+r),rho=C*R*r/(R+r);
  const target=x=>A*(1-Math.exp(-x/tau));
  const initial=x=>A*k*(1-(tau*Math.exp(-x/tau)-rho*Math.exp(-x/rho))/(tau-rho));
  const bisect=(f,a,b)=>{for(let i=0;i<70;i++){const m=(a+b)/2;if(f(m)>0)b=m;else a=m;}return(a+b)/2;};
  let entry=null,release=null;
  const f=x=>target(x)-initial(x)-r*I;
  for(let x=1e-6;x<=duration;x+=1e-6)if(f(x)>0){entry=bisect(f,x-1e-6,x);break;}
  const limited=x=>I*R+(initial(entry)-I*R)*Math.exp(-(x-entry)/(R*C));
  if(entry!==null){const g=x=>-(target(x)-limited(x)-r*I);
    for(let x=entry+1e-6;x<=duration;x+=1e-6)if(g(x)>0){release=bisect(g,x-1e-6,x);break;}}
  const P=x=>A*k*(1-tau*Math.exp(-x/tau)/(tau-rho));
  const voltage=t=>{const x=t-delay;if(x<=0)return 0;if(entry===null||x<=entry)return initial(x);
    if(release===null||x<=release)return limited(x);
    return P(x)+(limited(release)-P(release))*Math.exp(-(x-release)/rho);};
  const F0=x=>A*k*(x+(tau*tau*Math.exp(-x/tau)-rho*rho*Math.exp(-x/rho))/(tau-rho));
  const F1=x=>I*R*x-(initial(entry)-I*R)*R*C*Math.exp(-(x-entry)/(R*C));
  const F2=x=>A*k*(x+tau*tau*Math.exp(-x/tau)/(tau-rho))
    -(limited(release)-P(release))*rho*Math.exp(-(x-release)/rho);
  const integrate=(f,a,b)=>f(b)-f(a),x=duration-delay,
    e=entry===null?x:Math.min(x,entry),l=release===null?x:Math.min(x,release);
  const integral=integrate(F0,0,e)+(entry===null||x<=entry?0:integrate(F1,entry,l))
    +(release===null||x<=release?0:integrate(F2,release,x));
  return {voltage,mean:integral/duration,entry:entry===null?null:entry+delay,
    release:release===null?null:release+delay};
}

function currents(b,{R,inputR=4,internalR=0,shift=0,I=.36}={}){
  const q=b.branchCurrent('U','vout_1')+b.branchCurrent('U','vout_2');
  const iin=-b.branchCurrent('U','vin_7')-b.branchCurrent('U','vin_8');
  const iq=50e-6+130e-6*Math.min(q,.2)/.2;
  assert.ok(q>=-1e-9&&q<=I+1e-8,`output ceiling: ${q}`);
  near(iin,q+iq,1e-10,'simultaneous VIN delivered current plus IQ');
  near(b.branchCurrent('U','gnd'),iq,1e-10,'actual GND IQ');
  near(terminals.reduce((s,t)=>s+b.branchCurrent('U',t),0),0,1e-10,'eight-terminal KCL');
  near(q+b.branchCurrent('RL','a')+b.branchCurrent('C','a'),0,1e-10,'output load/capacitor KCL');
  near(b.nodeVoltage('vin')-b.nodeVoltage('gnd'),8-(inputR+internalR)*iin,1e-9,'finite input source resistance');
  near(b.nodeVoltage('gnd'),shift,1e-9,'reference potential');
  for(const t of ['sense_adj','en','ss'])near(b.branchCurrent('U',t),0,1e-12,`${t} input current`);
  return q;
}

test('explicit current-limited ADP startup matches independently transitioned RC samples and capture mean',t=>{
  for(const [R,C,tolerance,meanTolerance] of [[10,2.2e-6,1e-4,3e-5],[500,22e-6,5e-6,1e-5],[500,2.2e-6,1e-5,1e-4]]){
    const expected=oracle(R,C),b=rig({R,C});
    if(R===10){near(expected.entry,217.30757602325912e-6,1e-12,'analytic overload entry');assert.equal(expected.release,null);}
    else if(C===22e-6){near(expected.entry,66.26866414968961e-6,1e-12,'analytic inrush entry');
      near(expected.release,329.1432340371157e-6,1e-12,'analytic inrush release');}
    else assert.equal(expected.entry,null,'linear control never enters limit');
    const h=b.addScopeChannel({type:'voltage',netId:'out',referenceNetId:'gnd',sampleRateHz:100000,capture:'sample',depth:122});
    near(b.meterVoltage('out','gnd'),0,1e-12,'cold output');
    b.advanceTo(1200000n);
    const status=b.transientAnalysisStatus();
    assert.equal(status.accuracyMet,true);assert.equal(status.failure,null);
    assert.equal(status.profile.maxAttempts,20000);assert.equal(status.profile.minStepSec,1e-8);
    assert.equal(b._deviceSubstepOverflow,false);assert.notEqual(b._transientAttemptOverflow,true);
    const data=b.getScopeData(h),pairs=Array.from(data.samples).filter(Number.isFinite);
    assert.equal(data.count,120);assert.equal(pairs.length,240);
    let maxSampleError=0;
    for(let i=0;i<120;i++){
      assert.equal(pairs[2*i],pairs[2*i+1]);
      maxSampleError=Math.max(maxSampleError,Math.abs(pairs[2*i]-expected.voltage((i+1)*1e-5)));
      near(pairs[2*i],expected.voltage((i+1)*1e-5),tolerance,`RC sample ${i+1} (${R} ohm/${C} F)`);
    }
    near(b.meterVoltage('out','gnd'),expected.mean,meanTolerance,'capture-window analytic integral');
    currents(b,{R});
    t.diagnostic(JSON.stringify({R,C,samples:data.count,maxSampleError,
      meanError:b.meterVoltage('out','gnd')-expected.mean,attempts:status.work.attempts,solves:status.work.solves}));
  }
});

function acquisitionProof({R,C,inputR,partitioned,profile='interactive-v1'},sampleTolerance,meanTolerance){
  const b=rig({R,C,inputR,edit:({b})=>b.configureTransientAnalysis(profile)}),expected=oracle(R,C);
  const h=b.addScopeChannel({type:'voltage',netId:'out',referenceNetId:'gnd',
    sampleRateHz:100000,capture:'sample',depth:122});
  // Register the mean before advancing: a newly requested meter is an endpoint,
  // not a retrospective capture-window average.
  near(b.meterVoltage('out','gnd'),0,1e-12,'cold registered capture mean');
  if(partitioned)for(let i=1;i<=120;i++)b.advanceTo(BigInt(i)*10000n);
  else b.advanceTo(1200000n);
  const status=b.transientAnalysisStatus();
  assert.equal(status.profile.id,profile);
  assert.equal(status.accuracyMet,true);assert.equal(status.failure,null);
  assert.equal(status.profile.maxAttempts,20000);
  assert.equal(b._deviceSubstepOverflow,false);assert.notEqual(b._transientAttemptOverflow,true);
  const data=b.getScopeData(h),pairs=Array.from(data.samples).filter(Number.isFinite);
  assert.equal(data.count,120);assert.equal(pairs.length,240);
  let maxError=0;
  for(let i=0;i<120;i++){
    assert.equal(pairs[2*i],pairs[2*i+1]);
    const value=expected.voltage((i+1)*1e-5);
    maxError=Math.max(maxError,Math.abs(pairs[2*i]-value));
    near(pairs[2*i],value,sampleTolerance,`source/acquisition RC sample ${i+1}`);
  }
  const meanError=b.meterVoltage('out','gnd')-expected.mean;
  near(meanError,0,meanTolerance,'source/acquisition capture mean');
  currents(b,{R,inputR});
  return {R,C,inputR,partitioned,profile,maxError,meanError,attempts:status.work.attempts};
}

test('ideal and finite VIN preserve analytic acquisition across interactive bulk and partitions',t=>{
  // This broader matrix uses the existing partition waveform/control mean
  // bounds. It does NOT replace the tighter 4ohm bulk fixture proofs above.
  for(const [R,C] of [[10,2.2e-6],[500,22e-6],[500,2.2e-6]])
    for(const inputR of [0,1,4])for(const partitioned of [false,true])
      t.diagnostic(JSON.stringify(acquisitionProof({R,C,inputR,partitioned},1.2e-4,1e-4)));
});

test('existing precision profile independently resolves ideal VIN and partitioned clamp transitions',t=>{
  for(const [R,C,inputR] of [[10,2.2e-6,0],[500,22e-6,0],[500,22e-6,4]])
    for(const partitioned of [false,true])
      t.diagnostic(JSON.stringify(acquisitionProof({R,C,inputR,partitioned,profile:'precision-v1'},5e-7,1e-6)));
});

test('bypassing precision selection fails the actual analytic waveform oracle',()=>{
  for(const partitioned of [false,true]){
    // Execute the caller with its precision selection removed. A synthetic
    // profile label or a receipt-field assertion alone cannot prove accuracy.
    assert.throws(()=>acquisitionProof({R:500,C:22e-6,inputR:0,partitioned},5e-7,1e-6),
      error=>error.name==='AssertionError'&&/source\/acquisition RC sample/.test(error.message));
  }
});

test('caller-sampled ceiling and coherent supply survive shifted reference and partitioned advances',()=>{
  for(const [R,C] of [[10,2.2e-6],[500,22e-6]]){
    const big=rig({R,C}),partitioned=rig({R,C,shift:2.5,internalR:1});
    big.advanceTo(1200000n);
    const expected=oracle(R,C);
    for(let i=1;i<=120;i++){
      partitioned.advanceTo(BigInt(i)*10000n);
      currents(partitioned,{R,shift:2.5,internalR:1});
      near(partitioned.nodeVoltage('out')-2.5,expected.voltage(i*1e-5),R===10?1.2e-4:5e-6,'partitioned analytic output');
    }
    near(big.nodeVoltage('out'),partitioned.nodeVoltage('out')-2.5,1e-7,'one large versus partitioned advance');
    assert.equal(partitioned.transientAnalysisStatus().accuracyMet,true);
  }
});

test('every accepted adaptive solution preserves the ceiling and simultaneous terminal currents',t=>{
  const original=BoardImpl.prototype._updateDevices;
  try{
    for(const [R,C] of [[10,2.2e-6],[500,22e-6]]){
      let count=0,seenLimit=false,seenReleased=false;
      BoardImpl.prototype._updateDevices=function(atNs,solution,measurementOnly,acceptedTransient){
        if(acceptedTransient){
          const observation={nodeVoltage:id=>solution.nodeVoltages.get(id)??0,
            branchCurrent:(id,t)=>solution.branchCurrents.get(id)?.get(t)??0};
          const q=currents(observation,{R});
          count++;if(q>=.36-1e-9)seenLimit=true;
          if(seenLimit&&q<.35)seenReleased=true;
        }
        return original.apply(this,arguments);
      };
      const b=rig({R,C});b.advanceTo(1200000n);
      assert.ok(count>10,'actual accepted adaptive solutions were observed');
      assert.equal(seenLimit,true);assert.equal(seenReleased,R===500);
      assert.equal(b.transientAnalysisStatus().accuracyMet,true);
      t.diagnostic(JSON.stringify({R,C,acceptedSolutions:count,seenLimit,seenReleased}));
    }
  }finally{BoardImpl.prototype._updateDevices=original;}
  assert.equal(BoardImpl.prototype._updateDevices,original);
});

test('limits above and below the independent unbounded inrush peak select the expected region',()=>{
  const R=500,C=22e-6,r=.05,tau=300e-6/Math.log(9),k=R/(R+r),rho=C*R*r/(R+r);
  const B=k*tau/(tau-rho)-1,D=-k*rho/(tau-rho);
  const peakX=Math.log(-D*tau/(B*rho))/(1/rho-1/tau);
  const target=5*(1-Math.exp(-peakX/tau));
  const output=5*k*(1-(tau*Math.exp(-peakX/tau)-rho*Math.exp(-peakX/rho))/(tau-rho));
  const peak=(target-output)/r;
  const original=BoardImpl.prototype._updateDevices;
  try{
    for(const factor of [.995,1.005]){
      const limit=factor*peak;let max=0;
      BoardImpl.prototype._updateDevices=function(atNs,solution,measurementOnly,acceptedTransient){
        if(acceptedTransient){
          const observation={nodeVoltage:id=>solution.nodeVoltages.get(id)??0,
            branchCurrent:(id,t)=>solution.branchCurrents.get(id)?.get(t)??0};
          max=Math.max(max,currents(observation,{R,inputR:1,I:limit}));
        }
        return original.apply(this,arguments);
      };
      const b=rig({R,C,inputR:1,parameters:{currentLimit:limit}});b.advanceTo(200000n);
      assert.equal(b.transientAnalysisStatus().accuracyMet,true);
      if(factor<1)near(max,limit,1e-9,'below-peak control enters upper clamp');
      else assert.ok(max<limit-peak*.002,'above-peak control remains below upper clamp');
    }
  }finally{BoardImpl.prototype._updateDevices=original;}
});

const removeLead=(nets,lead)=>{for(const n of nets)n.terminals=n.terminals.filter(t=>!(t.part==='U'&&t.terminal===lead));};
test('new current-limited admission rejects missing or distinct leads and unsupported terminal topology',()=>{
  for(const lead of ['vin_7','vin_8','vout_1','vout_2','gnd','en']){
    assert.throws(()=>rig({edit:({nets})=>removeLead(nets,lead)}),error=>/ADP7118/.test(error.message)&&error.message.toLowerCase().includes(lead));
  }
  for(const lead of ['vin_8','vout_2'])assert.throws(()=>rig({edit:({nets})=>{
    removeLead(nets,lead);nets.push(net(`separate-${lead}`,['U',lead]));
  }}),/ADP7118.*(bond|same|duplicate)/i);
  assert.throws(()=>rig({edit:({nets})=>nets[0].terminals.push({part:'U',terminal:'ss'})}),/ADP7118.*SS/i);
  assert.throws(()=>rig({edit:({nets})=>removeLead(nets,'sense_adj')}),/ADP7118.*SENSE/i);
  assert.throws(()=>rig({edit:({parts,nets})=>{
    parts.push({id:'L',kind:'inductor',params:{henries:1e-3},terminals:['a','b']});
    nets.find(n=>n.id==='out').terminals.push({part:'L',terminal:'a'});nets[0].terminals.push({part:'L',terminal:'b'});
  }}),/ADP7118.*(load|topology|passive|RC|resistor|capacitor)/i);
  for(const id of ['RL','C'])assert.throws(()=>rig({edit:({parts,nets})=>{
    parts.splice(parts.findIndex(p=>p.id===id),1);for(const n of nets)n.terminals=n.terminals.filter(t=>t.part!==id);
  }}),/ADP7118.*(load|RC|resistor|capacitor)/i);
});

test('current-limited admission refuses implicit parameters and unsupported source authorities',()=>{
  for(const parameters of [{rOut:undefined},{currentLimit:undefined},{rOut:0},{currentLimit:NaN},
    {adjustable:true},{vOut:6},{softStartCapacitanceF:1e-9}])assert.throws(()=>rig({parameters}),/ADP7118/i);
  for(const [id,changes] of [['VIN',{volts:5}],['VIN',{volts:21}],['VIN',{wave:'sine'}],
    ['VIN',{rInternal:-1}],['VIN',{iLimit:.5}],['EN',{volts:1}],['EN',{wave:'pulse'}],['EN',{rInternal:1}]]){
    assert.throws(()=>rig({edit:({parts})=>Object.assign(parts.find(p=>p.id===id).params,changes)}),/ADP7118/i);
  }
  for(const [id,key,value] of [['RL','ohms',0],['RL','ohms',Infinity],['C','farads',0],['C','farads',NaN]]){
    assert.throws(()=>rig({edit:({parts})=>{parts.find(p=>p.id===id).params[key]=value;}}),error=>
      /ADP7118/.test(error.message)||(id==='C'&&Number.isNaN(value)&&/Part "C": farads/.test(error.message)));
  }
  assert.throws(()=>rig({inputR:10}),/ADP7118.*headroom/i);
  assert.doesNotThrow(()=>rig({inputR:0,edit:({parts})=>{parts.find(p=>p.id==='VIN').params.wave='dc';}}));
});

test('extra qualified and test source injections are rejected by the actual solve topology',()=>{
  const b=rig(),options={deviceStates:b._deviceStates,capVoltages:b.capVoltages};
  assert.throws(()=>solveMNA(b._solveParts,b._solveNets,new Map(),b.controls,5,{...options,
    qualifiedSources:new Map([['U',new Map([['vout_1',{vTh:1,rTh:1}]])]])}),/ADP7118.*(source|injection|drive)/i);
  assert.throws(()=>solveMNA(b._solveParts,b._solveNets,new Map(),b.controls,5,{...options,
    testNodeA:'out',testNodeB:'gnd',testCurrent:1e-3}),/ADP7118.*(source|injection|test)/i);
  assert.throws(()=>rig({edit:({parts,nets})=>{
    parts.push({id:'MCU',kind:'mcu',params:{},terminals:['D2']});
    nets.find(n=>n.id==='out').terminals.push({part:'MCU',terminal:'D2'});
  }}),/ADP7118.*(source|pin|foreign|topology|load)/i);
});

test('caught manual source control refuses and invalidates old meter and scope observations',()=>{
  for(const id of ['VIN','EN']){
    const b=rig(),h=b.addScopeChannel({type:'voltage',netId:'out',referenceNetId:'gnd',sampleRateHz:100000,capture:'sample'});
    b.meterVoltage('out','gnd');b.meterCurrent('U','vin_7');b.advanceTo(100000n);
    assert.ok(b.getScopeData(h).count>0);
    assert.throws(()=>b.setControl(id,id==='VIN'?8:3.3),/ADP7118.*(control|constant|source)/i);
    assert.ok(b._liveSolveError);
    for(const read of [()=>b.meterVoltage('out','gnd'),()=>b.meterCurrent('U','vin_7'),()=>b.getScopeData(h)]){
      assert.throws(read,/measurement unavailable|scope capture refused|circuit solve failed/);
    }
  }
});

test('authored capacitor prebias refuses through the actual snapshot restoration boundary',()=>{
  const b=rig(),snap=b.snapshot();
  snap.capVoltages=[['C',1]];
  assert.throws(()=>b.restore(snap),/ADP7118.*prebias/i);
  assert.throws(()=>b.meterVoltage('out','gnd'),/measurement unavailable|circuit solve failed/);
});

test('public mutable device state cannot add a driver or silently replace the selected current law',()=>{
  for(const alteration of [state=>{state.drives.vout_1={vTh:.1,rTh:1,ref:'gnd'};},
    state=>{state.startupModel='datasheet-envelope';}]){
    const b=rig();alteration(b.getDeviceState('U'));
    assert.throws(()=>b.restore(b.snapshot()),/ADP7118.*(state drive|initialized model state)/i);
    assert.throws(()=>b.meterVoltage('out','gnd'),/measurement unavailable|circuit solve failed/);
  }
  const b=rig();
  assert.throws(()=>solveMNA(b._solveParts,b._solveNets,new Map(),b.controls,5,
    {capVoltages:b.capVoltages}),/ADP7118.*initialized model state/i);
  assert.doesNotThrow(()=>b.restore(b.snapshot()),'unchanged real snapshot restoration remains admitted');
});

test('production ADP limiter mutations fail real Board callers and restore the registered model',async()=>{
  const pristine=readFileSync(new URL('../src/devices/power.js',import.meta.url),'utf8');
  const mutations=[
    ['upper ceiling removed', [['const amps = Math.min(limit, Math.max(0, demand));',
      'const amps = Math.max(0, demand);'],
      ['demand > 0 && demand < limit ? -1 / resistance : 0','demand > 0 ? -1 / resistance : 0']], ()=>{
      const b=rig({R:10});b.advanceTo(250000n);currents(b,{R:10});
      near(b.nodeVoltage('out'),oracle(10,2.2e-6).voltage(.00025),1e-4,'overload output');
    }],
    ['previous-step VIN current restored', [["['vin_7', -amps - iq]","['vin_7', -state._inputAmps]"],
      ["['vin_7', row(-1 - iqSlope)]","['vin_7', new Map()]"]], ()=>{
      const original=BoardImpl.prototype._updateDevices;
      try{
        BoardImpl.prototype._updateDevices=function(atNs,solution,measurementOnly,acceptedTransient){
          if(acceptedTransient)currents({nodeVoltage:id=>solution.nodeVoltages.get(id)??0,
            branchCurrent:(id,t)=>solution.branchCurrents.get(id)?.get(t)??0},{R:500});
          return original.apply(this,arguments);
        };
        const b=rig({R:500,C:22e-6});b.advanceTo(100000n);
      }finally{BoardImpl.prototype._updateDevices=original;}
    }],
    ['startup target clock bypassed', [['const target = adp7118StartupTarget(part, state, ctx.tSeconds);',
      'const target = part.params.vOut ?? 5;']], ()=>{
      const b=rig();near(b.branchCurrent('U','vout_1')+b.branchCurrent('U','vout_2'),0,1e-12,'cold delayed current');
    }],
    ['source domain admission removed', [['assertAdp7118CurrentLimitedDomain(ctx, part);','void ctx;']], ()=>{
      assert.throws(()=>rig({inputR:10}),/ADP7118.*headroom/i);
    }],
    ['final prebias guard removed', [['if (out > target + 1e-6 || out < -1e-6)', 'if (false)']], ()=>{
      const b=rig(),snap=b.snapshot();snap.capVoltages=[['C',1]];
      assert.throws(()=>b.restore(snap),/ADP7118.*prebias/i);
    }],
    ['additional state drive guard removed', [['if (Object.values(state.drives ?? {}).some(Boolean))', 'if (false)']], ()=>{
      const b=rig();b.getDeviceState('U').drives.vout_1={vTh:.1,rTh:1,ref:'gnd'};
      assert.throws(()=>b.restore(b.snapshot()),/ADP7118.*state drive/i);
    }],
  ];
  for(const [name,patches,prove] of mutations){
    let source=pristine;
    for(const [anchor,replacement] of patches){
      assert.equal(source.split(anchor).length-1,1,`${name}: unique production anchor`);
      source=source.replace(anchor,replacement);
    }
    source=source.replace(/from '(\.\.\/[^']+)'/g,
      (_,relative)=>`from ${JSON.stringify(new URL(relative,new URL('../src/devices/power.js',import.meta.url)).href)}`);
    try{
      const mutant=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
      mutant.registerPowerDevices();
      assert.throws(()=>assert.doesNotThrow(prove),{name:'AssertionError'},`${name}: real Board caller must red`);
    }finally{registerPowerDevices();}
    const healthy=rig({R:10});healthy.advanceTo(400000n);currents(healthy,{R:10});
  }
  assert.equal(readFileSync(new URL('../src/devices/power.js',import.meta.url),'utf8'),pristine);
});
