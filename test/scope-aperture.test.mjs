import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopeAperture,advanceScopeAperture,edgeScopeAperture} from '../src/scope-aperture.js';
import {BoardImpl} from '../src/board.js';
const near=(a,b,tolerance=1e-12)=>assert.ok(Math.abs(a-b)<tolerance,`${a} vs ${b}`);
function acquisition(interval=10n){const state=createScopeAperture(interval,0n),samples=[];const emit=(end,value)=>samples.push({end,value});return {state,samples,push:(t,v)=>advanceScopeAperture(state,t,v,emit),edge:(t,v)=>edgeScopeAperture(state,t,v,emit)};}

test('apertures integrate a ramp through partial intervals and multiple crossed buckets',()=>{
 const a=acquisition();a.push(0,2);a.push(35e-9,5.5);
 assert.deepEqual(a.samples.map(s=>s.end),[10n,20n,30n]);
 a.samples.forEach((s,i)=>near(s.value,2.5+i));a.push(40e-9,6);near(a.samples[3].value,5.5);
});
for(const phase of [1,4,9.75])test(`narrow pulse area is retained at sample phase ${phase}ns`,()=>{
 const a=acquisition();a.push(0,0);a.push(phase*1e-9,0);a.push((phase+.5)*1e-9,4);a.push((phase+1)*1e-9,0);a.push(30e-9,0);
 near(a.samples.reduce((sum,s)=>sum+s.value*10e-9,0),2e-9,1e-22);
 assert.ok(a.samples.some(s=>s.value>0));assert.ok(a.samples.every(s=>s.value>=0&&s.value<=4));
});
test('unobserved aperture prefixes never manufacture a sample',()=>{
 const a=acquisition();a.push(5e-9,3);a.push(30e-9,3);
 assert.deepEqual(a.samples.map(s=>s.end),[20n,30n]);a.samples.forEach(s=>near(s.value,3));
});
test('control edges preserve the preceding hold and introduce no fictitious ramp',()=>{
 const a=acquisition();a.push(0,1);a.edge(12e-9,3);a.push(20e-9,3);
 near(a.samples[0].value,1);near(a.samples[1].value,2.6);
 const n=a.samples.length;a.edge(20e-9,-2);assert.equal(a.samples.length,n);a.push(30e-9,-2);near(a.samples[2].value,-2);
});
test('subdividing the same accepted linear path does not change its area',()=>{
 const a=acquisition(),b=acquisition();a.push(0,-2);a.push(40e-9,6);
 for(const ns of [0,3,7,14,21,33,40])b.push(ns*1e-9,-2+ns*.2);
 a.samples.forEach((s,i)=>near(s.value,b.samples[i].value));
});
test('nonfinite and backwards observations refuse',()=>{
 assert.throws(()=>createScopeAperture(0n,0n));const a=acquisition();a.push(1e-9,2);
 for(const [t,v]of [[0,2],[NaN,2],[2e-9,Infinity]])assert.throws(()=>a.push(t,v));
});
function board(depth=16){
 const b=new BoardImpl(5);b.configureTransientAnalysis('precision-v1');
 b.setNetlist([
  {id:'V',kind:'vsource',params:{wave:'spice-pwl',points:[[0,0],[25e-6,0],[26e-6,4],[27e-6,0],[60e-6,0]]},terminals:['pos','neg']},
  {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
  {id:'G',kind:'gnd',params:{},terminals:['gnd']},
 ],[
  {id:'signal',terminals:[{part:'V',terminal:'pos'},{part:'R',terminal:'a'}]},
  {id:'ground',terminals:[{part:'V',terminal:'neg'},{part:'R',terminal:'b'},{part:'G',terminal:'gnd'}]},
 ]);
 const handles=Object.fromEntries(['sample','envelope','average'].map(capture=>[capture,b.addScopeChannel({type:'voltage',netId:'signal',referenceNetId:'ground',sampleRateHz:100000,depth,capture})]));
 return {b,handles};
}
const points=data=>Array.from({length:Math.min(data.count,data.samples.length/2)},(_,i)=>{
 const depth=data.samples.length/2,index=(data.writeIndex-Math.min(data.count,depth)+depth+i)%depth;
 return {time:data.startTNs+BigInt(i)*data.sampleIntervalNs,min:data.samples[index*2],max:data.samples[index*2+1]};
});
test('actual source pulses survive an aperture while instantaneous samples remain unchanged',()=>{
 const {b,handles}=board();b.advanceTo(60000n);
 const avg=b.getScopeData(handles.average),sample=b.getScopeData(handles.sample),envelope=b.getScopeData(handles.envelope);
 assert.equal(avg.capture,'average');assert.equal(avg.apertureNs,10000n);assert.equal(avg.channelType,'voltage');
 const mean=points(avg).find(p=>p.time===30000n);assert.ok(mean);near(mean.min,.4,1e-8);assert.equal(mean.min,mean.max);
 assert.ok(points(sample).every(p=>Math.abs(p.min)<1e-8));assert.ok(points(envelope).some(p=>p.max>3.99));
 assert.equal(b.transientAnalysisStatus().accuracyMet,true);
 const count=avg.count;for(let i=0;i<3;i++)b.getScopeData(handles.average);assert.equal(b.getScopeData(handles.average).count,count,'readout does not add samples');
});
test('ring wrap labels the final complete aperture endpoints',()=>{
 const {b,handles}=board(2);b.advanceTo(60000n);const d=b.getScopeData(handles.average);
 assert.deepEqual(points(d).map(p=>p.time),[50000n,60000n]);assert.equal(d.startTNs,50000n);assert.ok(d.count>=5);
});
test('reset discards partial aperture history and matches a fresh capture',()=>{
 const first=board();first.b.advanceTo(35500n);first.b.reset();const d=first.b.getScopeData(first.handles.average);
 assert.equal(d.count,0);assert.ok([...d.samples].every(Number.isNaN));
 const fresh=board();first.b.advanceTo(60000n);fresh.b.advanceTo(60000n);
 assert.deepEqual(points(first.b.getScopeData(first.handles.average)),points(fresh.b.getScopeData(fresh.handles.average)));
});
test('a failed solve cannot append data or clear a capture failure',()=>{
 const {b,handles}=board();b.advanceTo(20000n);const ch=b._scopeChannels.get(handles.average),count=ch.count;
 b._updateScopeChannels(30000n,null,{converged:false});assert.equal(ch.count,count);
 assert.throws(()=>b.getScopeData(handles.average),/refused/);
 b._updateScopeChannels(40000n);assert.equal(ch.count,count);assert.throws(()=>b.getScopeData(handles.average),/refused/);
});
test('apertures cannot be requested as current or digital captures',()=>{
 const {b}=board();for(const type of ['current','digital'])assert.throws(()=>b.addScopeChannel({type,capture:'average'}),/voltage channel/);
});

test('differential aperture voltage retains the existing physical probe load',()=>{
 const b=new BoardImpl(5);b.setNetlist([
  {id:'A',kind:'vsource',params:{volts:5},terminals:['pos','neg']},
  {id:'B',kind:'vsource',params:{volts:2},terminals:['pos','neg']},
  {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
  {id:'G',kind:'gnd',params:{},terminals:['gnd']},
 ],[
  {id:'tip',terminals:[{part:'A',terminal:'pos'},{part:'R',terminal:'a'}]},
  {id:'ref',terminals:[{part:'B',terminal:'pos'},{part:'R',terminal:'b'}]},
  {id:'gnd',terminals:[{part:'A',terminal:'neg'},{part:'B',terminal:'neg'},{part:'G',terminal:'gnd'}]},
 ]);
 near(b.branchCurrent('A','pos'),.003,1e-10);
 const h=b.addScopeChannel({type:'voltage',netId:'tip',referenceNetId:'ref',inputOhms:1000,sampleRateHz:100000,depth:8,capture:'average'});
 near(b.branchCurrent('A','pos'),.006,1e-10);b.advanceTo(30000n);
 const d=b.getScopeData(h);assert.ok(d.count>=2);points(d).forEach(p=>near(p.min,3));
 b.removeScopeChannel(h);near(b.branchCurrent('A','pos'),.003,1e-10);
});

test('an aperture never publishes into an invalid ring',()=>{
 const {b}=board();for(const depth of [0,NaN,.5])assert.throws(()=>b.addScopeChannel({type:'voltage',netId:'signal',capture:'average',depth}),/positive integer depth/);
});

test('an unavailable or nonfinite voltage cannot be averaged as zero',()=>{
 for(const value of [NaN,Infinity,undefined]){
  const {b,handles}=board(),ch=b._scopeChannels.get(handles.average);
  b.nodeVoltages.set('signal',value);b._updateScopeChannels(10000n);
  assert.equal(ch.count,0);assert.throws(()=>b.getScopeData(handles.average),/refused/);
 }
});
