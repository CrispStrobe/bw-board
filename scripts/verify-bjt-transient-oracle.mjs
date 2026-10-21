#!/usr/bin/env node
/** Matched transistor model/initial-state/sampling comparison; requires ngspice. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {organBench,amplifierBench,envelopeEdges} from '../test/fixtures/school-circuits/benches.mjs';

const directory=mkdtempSync(path.join(tmpdir(),'bw-bjt-oracle-'));
const results=[];
try{
 for(const kind of ['npn','pnp'])for(const junction of ['be','bc','tf']){
  const sign=kind==='npn'?1:-1,drive=junction==='bc'?'collector':'base',other=drive==='base'?'collector':'base';
  const volts=junction==='tf'?.6:.2;
  const charge={cje:junction==='be'?1e-6:0,cjc:junction==='bc'?1e-6:0,tf:junction==='tf'?1e-3:0};
  const part=(id,kind,params,terminals)=>({id,kind,params,terminals});
  const parts=[part('V','vsource',{volts:sign*volts},['pos','neg']),part('R','resistor',{ohms:1000},['a','b']),part('G','gnd',{},['gnd']),
   part('Q',kind,{model:'shockley',is:1e-14,beta:100,br:1,...charge},['base','collector','emitter'])];
  const nets=[{id:'v',terminals:[{part:'V',terminal:'pos'},{part:'R',terminal:'a'}]},
   {id:'signal',terminals:[{part:'R',terminal:'b'},{part:'Q',terminal:drive}]},
   {id:'g',terminals:[{part:'V',terminal:'neg'},{part:'G',terminal:'gnd'},{part:'Q',terminal:other},{part:'Q',terminal:'emitter'}]}];
  const deck=`Matched ${kind} ${junction} transient\nV1 v 0 ${sign*volts}\nR1 v signal 1k\nQ1 ${drive==='collector'?'signal':'0'} ${drive==='base'?'signal':'0'} 0 QMODEL\n.model QMODEL ${kind.toUpperCase()}(IS=1e-14 BF=100 BR=1 CJE=${charge.cje} CJC=${charge.cjc} TF=${charge.tf})\n.options reltol=1e-7 abstol=1e-14 method=trap\n.control\nset filetype=ascii\ntran 0.01u 10u uic\nwrdata trace.dat v(signal)\n.endc\n.end\n`;
  writeFileSync(path.join(directory,'bench.cir'),deck);
  const log=execFileSync('ngspice',['-b','bench.cir'],{cwd:directory,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
  assert.ok(!/aborted|timestep too small/i.test(log),'SPICE must complete');
  const rows=readFileSync(path.join(directory,'trace.dat'),'utf8').trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
  assert.ok(rows.at(-1)[0]>=1e-5*(1-1e-6),'SPICE must reach the requested endpoint');
  const at=t=>{let i=1;while(i<rows.length-1&&rows[i][0]<t)i++;const a=rows[i-1],b=rows[i];return a[1]+(t-a[0])/(b[0]-a[0])*(b[1]-a[1]);};
  const board=new BoardImpl(5);board.setNetlist(parts,nets);
  const samples=[];
  for(const ns of [1000n,5000n,10000n]){
   board.advanceTo(ns);assert.equal(board.transientAnalysisStatus().accuracyMet,true);const actual=board.nodeVoltage('signal'),expected=at(Number(ns)/1e9);
   const tolerance=1e-7+.003*Math.abs(expected);
   assert.ok(Math.abs(actual-expected)<=tolerance,`${kind} ${junction} ${ns} ns: ${actual} vs ${expected}`);
   const kcl=['base','collector','emitter'].reduce((sum,t)=>sum+board.branchCurrent('Q',t),0);
   assert.ok(Math.abs(kcl)<1e-10,'transistor terminal current KCL');
   samples.push({timeNs:String(ns),actual,spice:expected,errorVolts:actual-expected,tolerance});
  }
  results.push({kind,junction,samples});
 }
 if(process.argv.includes('--school')) {
  const model = '.model QN NPN(IS=1e-14 BF=100 BR=1 CJE=10p CJC=4p TF=.3n RB=10 RC=1)\n.model QP PNP(IS=1e-14 BF=100 BR=1 CJE=10p CJC=4p TF=.3n RB=10 RC=1)';
  const runDeck = deck => {
   writeFileSync(path.join(directory,'bench.cir'),deck);
   const log=execFileSync('ngspice',['-b','bench.cir'],{cwd:directory,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
   assert.ok(!/aborted|timestep too small/i.test(log),'SPICE school circuit must complete');
   return readFileSync(path.join(directory,'trace.dat'),'utf8').trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
  };
  for(const [trim,key] of [[1000000,1],[500000,1],[150000,1],[500000,0]]) {
   const b=organBench({trim,key}),ch=b.addScopeChannel({type:'voltage',netId:'out',sampleRateHz:100000,depth:4096});
   b.advanceTo(20_000_000n);assert.equal(b.transientAnalysisStatus().accuracyMet,true);const data=b.getScopeData(ch),nativeEdges=envelopeEdges(data);
   const rows=runDeck(`Matched OPITEC oscillator\nV vcc 0 PWL(0 0 10u 9)\nQN drive base 0 QN\nQP out drive vcc QP\nRbleed base 0 1meg\nRseries base keys 180k\nRtrim keys contact ${trim}\nRkey contact vcc ${key?.001:1e12}\nRload out 0 8\nCsmall drive out 3.3n\nCfeedback out base 10n\n${model}\n.options method=trap reltol=1e-6 abstol=1e-13\n.control\nset filetype=ascii\ntran .2u 20m\nwrdata trace.dat v(out)\n.endc\n.end\n`);
   assert.ok(rows.at(-1)[0]>=.02*(1-1e-6));
   const edges=[];for(let i=1;i<rows.length;i++)if(rows[i][0]>=.004&&rows[i-1][1]<4&&rows[i][1]>=4)edges.push(rows[i][0]);
   if(!key){assert.equal(nativeEdges.length,0);assert.equal(edges.length,0);results.push({kind:'organ',trim,key,oscillates:false});continue;}
   assert.ok(nativeEdges.length>=2&&edges.length>=2,'sustained organ periods');
   const frequency=e=>(e.length-1)/(e.at(-1)-e[0]),actual=frequency(nativeEdges),expected=frequency(edges);
   assert.ok(Math.abs(actual-expected)/expected<.005,`organ ${trim}: ${actual} vs ${expected} Hz`);
   const max=Math.max(...data.samples.filter(Number.isFinite)),spiceMax=Math.max(...rows.map(r=>r[1]));
   assert.ok(Math.abs(max-spiceMax)<.005,`organ peak ${max} vs ${spiceMax}`);
   results.push({kind:'organ',trim,key,actualHz:actual,spiceHz:expected,peakVolts:max,spicePeakVolts:spiceMax});
  }
  const board=amplifierBench();board.initializeTransientFromOperatingPoint();
  const h=board.addScopeChannel({type:'voltage',netId:'out',capture:'sample',sampleRateHz:20000,depth:1024});
  board.advanceTo(60_000_000n);assert.equal(board.transientAnalysisStatus().accuracyMet,true);const data=board.getScopeData(h),depth=data.samples.length/2,count=Math.min(data.count,depth),oldest=(data.writeIndex-count+depth)%depth;
  const rows=runDeck(`Matched Winkler 101455 amplifier\nV vcc 0 9\nVin mic 0 SIN(0 1m 1k)\nRmic mic input 8\nR1 vcc u 10k\nR2 u 0 10k\nR3 vcc c1 4.7k\nR4 c1 b1 1meg\nR5 b1 0 1meg\nR6 vcc c2 1k\nR7 c2 b2 100k\nR8 b2 0 47k\nR9 e2 0 100\nR10 vcc c3 10\nR11 c3 b3 47k\nRpTop volume wiper 50k\nRpBottom wiper 0 50k\nC1 input 0 10n\nC2 input b1 1u\nC3 c1 volume 4.7u\nC4 wiper b2 4.7u\nC5 e2 0 4.7u\nC6 c2 b3 10u\nC7 vcc 0 47u\nQ1 c1 b1 0 QN\nQ2 c2 b2 e2 QN\nQ3 c3 b3 out QN\nRload out 0 8\n${model}\n.options method=trap reltol=1e-6 abstol=1e-13\n.control\nset filetype=ascii\ntran 1u 60m\nwrdata trace.dat v(out)\n.endc\n.end\n`);
  let index=1,maxError=0,sumError=0,points=0;const actual=[],expected=[];
  for(let i=0;i<count;i++){
   const time=Number(data.startTNs)/1e9+i*Number(data.sampleIntervalNs)/1e9;
   if(time<.02)continue;
   while(index<rows.length-1&&rows[index][0]<time)index++;
   const a=rows[index-1],b=rows[index],reference=a[1]+(time-a[0])/(b[0]-a[0])*(b[1]-a[1]);
   const value=data.samples[((oldest+i)%depth)*2],error=Math.abs(value-reference);
   maxError=Math.max(maxError,error);sumError+=error*error;points++;actual.push(value);expected.push(reference);
  }
  assert.ok(points>500,'compare the settled amplifier waveform');
  assert.ok(maxError<.001,`amplifier waveform maximum error ${maxError} V`);
  const gain=v=>(Math.max(...v)-Math.min(...v))/.002;
  results.push({kind:'amplifier',points,maxErrorVolts:maxError,rmsErrorVolts:Math.sqrt(sumError/points),actualGain:gain(actual),spiceGain:gain(expected)});
 }
 console.log(JSON.stringify({ok:true,model:'matched IS=1e-14 BF=100 BR=1; explicit CJE/CJC/TF; zero initial charge',results},null,2));
}finally{rmSync(directory,{recursive:true,force:true});}
