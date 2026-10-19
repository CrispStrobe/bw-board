import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {BoardImpl} from '../src/board.js';

// Explicit circuit loading, not an implicit scope input model. The reference
// does not call the engine, exporter, or its numerical integration helpers.
const L=.005,C=12e-12,R=10,G=1e-7,amplitude=5,delay=1e-6,rise=1e-6;
const alpha=(R/L+G/C)/2;
const omega=Math.sqrt((1+R*G)/(L*C)-alpha*alpha);
const gain=1/(1+R*G);
function step(t) {
    return t<=0?0:gain*(1-Math.exp(-alpha*t)
        *(Math.cos(omega*t)+alpha/omega*Math.sin(omega*t)));
}
function integratedStep(t) {
    if(t<=0)return 0;
    const e=Math.exp(-alpha*t),s=Math.sin(omega*t),c=Math.cos(omega*t);
    const d=alpha*alpha+omega*omega;
    const ic=(alpha+e*(-alpha*c+omega*s))/d;
    const is=(omega+e*(-alpha*s-omega*c))/d;
    return gain*(t-ic-alpha/omega*is);
}
function reference(t) {
    const a=t-delay,b=a-rise;
    const V=amplitude/rise*(integratedStep(a)-integratedStep(b));
    return {V,I:C*amplitude/rise*(step(a)-step(b))+G*V};
}
function meanReference(intervals) {
    let sum=0;
    for(let i=0;i<=intervals;i++)
        sum+=(i===0||i===intervals?1:i%2?4:2)*reference(5e-6*i/intervals).V;
    return sum/(3*intervals);
}
const expectedMean=meanReference(10000);
const net=(id,...pins)=>({id,terminals:pins.map(([part,terminal])=>({part,terminal}))});
function capture({profile='precision-v1',inductance=L,phase=delay,
    scopeNet='out',scopeRef='zero',meterNet='out',meterRef='zero'}={}) {
    const b=new BoardImpl(5);
    b.configureTransientAnalysis(profile,profile==='precision-v1'?{maxStepSec:5e-10}:undefined);
    b.setNetlist([
        {id:'P',kind:'vsource',params:{volts:0,wave:'spice-pulse',v1:0,v2:5,td:phase,tr:rise,tf:1e-6,pw:1e-5,per:3e-5},terminals:['pos','neg']},
        {id:'G',kind:'gnd',params:{},terminals:['gnd']},
        {id:'L',kind:'inductor',params:{henrys:inductance},terminals:['a','b']},
        {id:'R',kind:'resistor',params:{ohms:R},terminals:['a','b']},
        {id:'CP',kind:'capacitor',params:{farads:C},terminals:['a','b']},
        {id:'RP',kind:'resistor',params:{ohms:1/G},terminals:['a','b']},
    ],[
        net('input',['P','pos'],['L','a']),net('winding',['L','b'],['R','a']),
        net('out',['R','b'],['CP','a'],['RP','a']),
        net('zero',['P','neg'],['G','gnd'],['CP','b'],['RP','b']),
    ]);
    b.setPower(true);b.reset();
    assert.equal(b.initializeTransientFromOperatingPoint().converged,true);
    const scope=b.addScopeChannel({type:'voltage',netId:scopeNet,referenceNetId:scopeRef,
        capture:'sample',sampleRateHz:40000000,depth:256});
    b.meterVoltage(meterNet,meterRef); // Establish the watched averaging epoch.
    let currentError=0;
    const receipt=b.advanceToBoundedStream(5000n,
        {maxAttempts:20000,maxSolves:60001,maxAdvances:200},
        {stepNs:25n,onStep:({timeNs})=>{
            const actual=b.inductorCurrents.get('L');
            assert.ok(Number.isFinite(actual));
            currentError=Math.max(currentError,Math.abs(actual-reference(Number(timeNs)*1e-9).I));
        }});
    assert.equal(receipt.completed,true);
    assert.equal(receipt.failure,null);
    assert.equal(b.timeNs,5000n);
    assert.equal(receipt.work.advances,200);
    assert.ok(receipt.work.attempts<=20000&&receipt.work.solves<=60001);
    const data=b.getScopeData(scope);
    assert.equal(data.count,200);
    assert.equal(data.startTNs,25n);
    assert.equal(data.sampleIntervalNs,25n);
    let voltageError=0;
    for(let i=0;i<data.count;i++) {
        const expected=reference(Number(data.startTNs+BigInt(i)*data.sampleIntervalNs)*1e-9).V;
        for(const value of [data.samples[2*i],data.samples[2*i+1]]) {
            assert.ok(Number.isFinite(value));
            voltageError=Math.max(voltageError,Math.abs(value-expected));
        }
    }
    const mean=b.meterVoltage(meterNet,meterRef);
    assert.ok(Number.isFinite(mean));
    return {voltageError,currentError,meanError:Math.abs(mean-expectedMean)};
}
function agrees(actual,voltageBound=5e-6,currentBound=1e-9,meanBound=1e-6) {
    assert.ok(actual.voltageError<=voltageBound,`scope voltage error ${actual.voltageError}`);
    assert.ok(actual.currentError<=currentBound,`winding current error ${actual.currentError}`);
    assert.ok(actual.meanError<=meanBound,`watched DC mean error ${actual.meanError}`);
}

test('actual RLC sampled scope and watched DC mean match an independent closed form',()=>{
    assert.ok(Math.abs(expectedMean-meanReference(20000))<1e-9,'quadrature refinement');
    agrees(capture());
    // Preserve the measured difference between public policies; no default
    // tuning, silent precision substitution, or global accuracy claim.
    agrees(capture({profile:'interactive-v2'}),5e-3,5e-7,100e-6);
});
test('fixed instrument reference rejects wrong inductance and excitation phase',()=>{
    assert.throws(()=>agrees(capture({inductance:2*L})),/scope voltage error/);
    assert.throws(()=>agrees(capture({phase:delay+250e-9})),/scope voltage error/);
});
test('scope and meter independently reject wrong measurement wiring',()=>{
    const wrongScope=capture({scopeNet:'input'});
    assert.ok(wrongScope.meanError<1e-6,'correct meter remains independently correct');
    assert.throws(()=>agrees(wrongScope),/scope voltage error/);
    const wrongMeter=capture({meterNet:'input'});
    assert.ok(wrongMeter.voltageError<5e-6,'correct scope remains independently correct');
    assert.throws(()=>agrees(wrongMeter),/watched DC mean error/);
});
test('fixed output reference rejects reversed scope and meter polarity',()=>{
    const reversedScope=capture({scopeNet:'zero',scopeRef:'out'});
    assert.ok(reversedScope.meanError<1e-6);
    assert.throws(()=>agrees(reversedScope),/scope voltage error/);
    const reversedMeter=capture({meterNet:'zero',meterRef:'out'});
    assert.ok(reversedMeter.voltageError<5e-6);
    assert.throws(()=>agrees(reversedMeter),/watched DC mean error/);
});

const ngspice=process.env.NGSPICE||'ngspice';
const available=spawnSync(ngspice,['--version'],{encoding:'utf8',timeout:5000}).status===0;
const times=[25n,1000n,1250n,1500n,2000n,2500n,3000n,4000n,5000n];
function oracle(maxStep) {
    const deck=['Independent passive RLC ramp control',
        '.options method=gear maxord=2 reltol=1e-9 abstol=1e-14 vntol=1e-11',
        'VP input 0 PULSE(0 5 1u 1u 1u 10u 30u)',
        'LW input winding 5m','RW winding out 10','CP out 0 12p','RP out 0 10meg',
        '.control',`tran ${maxStep} 5.1u 0 ${maxStep}`,
        ...times.flatMap((ns,i)=>[
            `meas tran v${i} FIND v(out) AT=${Number(ns)*1e-9}`,
            `meas tran i${i} FIND i(LW) AT=${Number(ns)*1e-9}`,
        ]),'.endc','.end',''].join('\n');
    const r=spawnSync(ngspice,['-n','-b'],{input:deck,encoding:'utf8',timeout:15000,maxBuffer:1048576});
    assert.equal(r.error,undefined,String(r.error));assert.equal(r.status,0,r.stderr);
    assert.doesNotMatch(r.stdout+r.stderr,/Error:|timestep too small|out of interval/i);
    const scalar=name=>{
        const m=r.stdout.match(new RegExp(`^${name}\\s*=\\s*([-+\\deE.]+)`,'m'));
        assert.ok(m,`missing ${name}`);
        const v=Number(m[1]);assert.ok(Number.isFinite(v));return v;
    };
    return times.map((ns,i)=>({V:scalar('v'+i),I:scalar('i'+i)}));
}
test('closed-form RLC reference is independently checked by refined live SPICE',
    {skip:!available},()=>{
        const coarse=oracle(125e-12),fine=oracle(62.5e-12);
        for(let i=0;i<times.length;i++) {
            const expected=reference(Number(times[i])*1e-9);
            // Includes rounding of ngspice's printed measurement scalars.
            for(const [key,refinement,agreement] of [['V',5e-6,2e-6],['I',1e-9,1e-9]]) {
                assert.ok(Math.abs(coarse[i][key]-fine[i][key])<=refinement,`${key} reference refinement at ${times[i]}`);
                assert.ok(Math.abs(fine[i][key]-expected[key])<=agreement,`${key} analytic agreement at ${times[i]}`);
            }
        }
    });
