import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
const part=(id,kind,params,terminals)=>({id,kind,params,terminals});
function bench(kind,charge={cje:1e-6,cjc:0,tf:0},drive='base'){
 const sign=kind==='npn'?1:-1,other=drive==='base'?'collector':'base';
 const parts=[part('V','vsource',{volts:sign*.2},['pos','neg']),part('R','resistor',{ohms:1000},['a','b']),part('G','gnd',{},['gnd']),part('Q',kind,{model:'shockley',is:1e-14,beta:100,br:1,...charge},['base','collector','emitter'])];
 const nets=[{id:'v',terminals:[{part:'V',terminal:'pos'},{part:'R',terminal:'a'}]},{id:'signal',terminals:[{part:'R',terminal:'b'},{part:'Q',terminal:drive}]},{id:'g',terminals:[{part:'V',terminal:'neg'},{part:'G',terminal:'gnd'},{part:'Q',terminal:other},{part:'Q',terminal:'emitter'}]}];
 const b=new BoardImpl(5);b.setNetlist(parts,nets);return {b,sign};
}
for(const kind of ['npn','pnp'])for(const junction of ['be','bc'])test(`${kind} ${junction} charge stores energy instead of teleporting to DC`,()=>{
 const {b,sign}=bench(kind,junction==='be'?{cje:1e-6,cjc:0,tf:0}:{cje:0,cjc:1e-6,tf:0},junction==='be'?'base':'collector');
 assert.equal(b._transientIntegrationMode(),'adaptive');
 b.advanceTo(1000n);const voltage=sign*b.nodeVoltage('signal');
 assert.ok(voltage>.00019&&voltage<.00021,`1 us into a 1 ms RC should be ~0.2 mV, got ${voltage}`);
 const currents=['base','collector','emitter'].map(t=>b.branchCurrent('Q',t));
 assert.ok(Math.abs(currents.reduce((a,b)=>a+b,0))<1e-10,'terminal charge currents conserve KCL');
 const resistor=b.branchCurrent('R','b'),transistor=b.branchCurrent('Q',junction==='be'?'base':'collector');
 assert.ok(Math.abs(resistor+transistor)<1e-10,'reported storage current balances the resistor');
});

test('zero charge parameters preserve the memoryless model',()=>{
 const {b}=bench('npn',{cje:0,cjc:0,tf:0});assert.equal(b._transientIntegrationMode(),'algebraic-direct');
 b.advanceTo(1000n);assert.ok(Math.abs(b.nodeVoltage('signal')-.2)<1e-6);
});

test('instantaneous edits cannot replace stored charge with a DC reading',()=>{
 const {b}=bench('npn');
 assert.throws(()=>b.nodeVoltage('signal'),/junction charge needs an accepted transient step/);
 b.advanceTo(1000n);const before=b.nodeVoltage('signal');
 b.setPartParam('V','volts',.1);
 assert.throws(()=>b.branchCurrent('Q','base'),/junction charge needs an accepted transient step/);
 b.advanceTo(2000n);
 assert.ok(b.nodeVoltage('signal')>before&&b.nodeVoltage('signal')<.001);
});

test('scope capture can recover from not-ready storage without making a sticky solver failure',()=>{
 const {b}=bench('npn');const ch=b.addScopeChannel({type:'voltage',netId:'signal',capture:'sample',sampleRateHz:1e6,depth:64});
 assert.throws(()=>b.getScopeData(ch),/accepted transient step/);
 b.advanceTo(10000n);assert.ok(b.getScopeData(ch).count>=9);
});

test('stored charge differentiates to the same capacitances used by AC',async()=>{
 const {ebersMollCharges,ebersMollChargeCompanion,ebersMollParams}=await import('../src/mna.js');
 const p=ebersMollParams({kind:'npn',params:{model:'shockley',is:1e-14,beta:100,br:1,cje:1e-9,cjc:2e-9,tf:1e-6,vaf:80,ikf:.01}});
 for(const vbe of [-.2,.2,.375,.6])for(const vbc of [-1,.2,.5]){
  const h=1e-6,q=ebersMollChargeCompanion(vbe,vbc,p);
  const derivative=(field,axis)=>{
   const a=ebersMollCharges(vbe+(axis==='be'?h:0),vbc+(axis==='bc'?h:0),p);
   const b=ebersMollCharges(vbe-(axis==='be'?h:0),vbc-(axis==='bc'?h:0),p);return (a[field]-b[field])/(2*h);
  };
  for(const [actual,expected]of [[derivative('qbe','be'),q.cbe],[derivative('qbe','bc'),q.cbeVbc],[derivative('qbc','bc'),q.cbc]])
   assert.ok(Math.abs(actual-expected)<1e-15+Math.abs(expected)*1e-5,`${vbe},${vbc}: ${actual} vs ${expected}`);
 }
});

test('PNP base and collector series resistance mirror the NPN model',()=>{
 const results=[];
 for(const kind of ['npn','pnp']){
  const sign=kind==='npn'?1:-1;
  const parts=[part('VB','vsource',{volts:sign*.8},['pos','neg']),part('VC','vsource',{volts:sign*5},['pos','neg']),
   part('RB','resistor',{ohms:10000},['a','b']),part('RC','resistor',{ohms:1000},['a','b']),part('G','gnd',{},['gnd']),
   part('Q',kind,{model:'shockley',is:1e-14,beta:100,br:1,rb:1000,rc:100},['base','collector','emitter'])];
  const ends=(...pairs)=>pairs.map(([part,terminal])=>({part,terminal}));
  const b=new BoardImpl(5);b.setNetlist(parts,[{id:'vb',terminals:ends(['VB','pos'],['RB','a'])},{id:'vc',terminals:ends(['VC','pos'],['RC','a'])},
   {id:'base',terminals:ends(['RB','b'],['Q','base'])},{id:'collector',terminals:ends(['RC','b'],['Q','collector'])},
   {id:'g',terminals:ends(['VB','neg'],['VC','neg'],['G','gnd'],['Q','emitter'])}]);
  results.push({vb:sign*b.nodeVoltage('base'),vc:sign*b.nodeVoltage('collector'),ib:sign*b.branchCurrent('Q','base'),ic:sign*b.branchCurrent('Q','collector')});
 }
 for(const key of ['vb','vc','ib','ic'])assert.ok(Math.abs(results[0][key]-results[1][key])<1e-9,key);
});

test('non-UIC initialization seeds intrinsic charge from the DC operating point',()=>{
 const {b}=bench('npn');b.initializeTransientFromOperatingPoint();
 const before=b.nodeVoltage('signal');b.advanceTo(1000n);
 assert.ok(Math.abs(b.nodeVoltage('signal')-before)<1e-8);
 assert.ok(Math.abs(b.capVoltages.get('@bjt:Q:be')-before)<1e-8);
});

test('invalid or piecewise charge declarations are refused on transient execution',()=>{
 for(const charge of [{cje:-1,cjc:0,tf:0},{cje:1e-6,cjc:0,tf:0,model:'pwl'}]){
  const {b}=bench('npn',charge);
  assert.throws(()=>b.advanceTo(1000n),/finite nonnegative|valid explicit exponential/);
 }
});

test('reset clears and restore preserves intrinsic stored voltages',()=>{
 const {b}=bench('npn');b.advanceTo(100000n);const snapshot=b.snapshot();
 const stored=b.capVoltages.get('@bjt:Q:be');assert.ok(stored>.01);
 b.advanceTo(200000n);const expected=b.nodeVoltage('signal');
 b.restore(snapshot);assert.equal(b.capVoltages.get('@bjt:Q:be'),stored);
 b.advanceTo(200000n);assert.ok(Math.abs(b.nodeVoltage('signal')-expected)<1e-6);
 b.reset();b.advanceTo(1000n);assert.ok(b.nodeVoltage('signal')<.001);
});

test('charge integration converges when the maximum step is reduced',()=>{
 const values=[];
 for(const step of [1e-5,1e-6]){
  const {b}=bench('npn');b.configureTransientAnalysis('precision-v1',{maxStepSec:step});b.advanceTo(100000n);values.push(b.nodeVoltage('signal'));
 }
 assert.ok(Math.abs(values[0]-values[1])<1e-7,`${values}`);
});

test('the designer live clock may advance a not-ready charge state into a valid capture',()=>{
 const {b}=bench('npn');assert.throws(()=>b.nodeVoltage('signal'),/accepted transient step/);
 const receipt=b.advanceToLive(1000n,{maxSteps:16});assert.equal(receipt.completed,true);
 assert.ok(b.nodeVoltage('signal')<.001);
 b.setPartParam('V','volts',.1);const next=b.advanceToLive(2000n,{maxSteps:16});assert.equal(next.completed,true);
 assert.ok(b.nodeVoltage('signal')<.001);
});
