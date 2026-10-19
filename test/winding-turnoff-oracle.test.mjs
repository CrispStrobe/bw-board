import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {BoardImpl} from '../src/board.js';

// This is an authored, explicitly probe-loaded circuit, not the GPIO motor
// lesson. Late ringing samples are deliberately NOT claimed by this gate.
const times = [500000n,1000000n,1001200n,1010000n,1050000n,1100000n,3100000n];
const ngspice = process.env.NGSPICE || 'ngspice';
const available = spawnSync(ngspice,['--version'],{encoding:'utf8',timeout:5000}).status === 0;
const net = (id,...pins) => ({id,terminals:pins.map(([part,terminal])=>({part,terminal}))});

function capture({henrys=.005,pw=.001,intermediate=false}={}) {
    const b = new BoardImpl(5);
    b.setNetlist([
        {id:'V',kind:'vsource',params:{volts:5},terminals:['pos','neg']},
        {id:'G',kind:'gnd',params:{},terminals:['gnd']},
        {id:'P',kind:'vsource',params:{wave:'spice-pulse',v1:0,v2:5,td:0,tr:1e-6,tf:1e-6,pw,per:.003},terminals:['pos','neg']},
        {id:'RB',kind:'resistor',params:{ohms:22700},terminals:['a','b']},
        {id:'Q',kind:'npn',params:{model:'shockley',is:1e-14,beta:100,br:1,vaf:100},terminals:['base','collector','emitter']},
        {id:'L',kind:'inductor',params:{henrys},terminals:['a','b']},
        {id:'R',kind:'resistor',params:{ohms:10},terminals:['a','b']},
        {id:'D',kind:'diode',params:{model:'shockley',is:1e-12,n:1,rs:.568,vf:.7},terminals:['anode','cathode']},
        {id:'CP',kind:'capacitor',params:{farads:12e-12},terminals:['a','b']},
        {id:'RP',kind:'resistor',params:{ohms:1e7},terminals:['a','b']},
    ],[
        net('supply',['V','pos'],['L','a'],['D','cathode']),
        net('zero',['V','neg'],['P','neg'],['G','gnd'],['Q','emitter'],['CP','b'],['RP','b']),
        net('drive',['P','pos'],['RB','a']),net('base',['RB','b'],['Q','base']),
        net('winding',['L','b'],['R','a']),
        net('collector',['R','b'],['Q','collector'],['D','anode'],['CP','a'],['RP','a']),
    ]);
    b.setPower(true); b.reset();
    const rows=[];
    const endpoints=intermediate?[...times.slice(0,-1),1200000n,1500000n,2000000n,times.at(-1)]:times;
    for(const ns of endpoints) {
        let receipt,continuations=0;
        try {
            do {
                receipt=b.advanceToLive(ns,{maxSteps:16});
                assert.ok(++continuations<=1000,'live continuation backstop');
            } while(!receipt.completed);
        } catch(error) {
            error.message+=` at requested ${ns} ns: ${JSON.stringify(b.transientAnalysisStatus())}`;
            throw error;
        }
        assert.equal(b.timeNs,ns);
        assert.equal(b.transientAnalysisStatus().profile.id,'interactive-v2');
        assert.equal(b.transientAnalysisStatus().accuracyMet,true);
        if(times.includes(ns)) rows.push({ns,I:b.inductorCurrents.get('L'),V:b.nodeVoltage('collector')});
    }
    return rows;
}

function oracle(maxStep) {
    // Independent model cards and thermal constants: no circuit exporter or
    // engine-generated references. Explicit shared physical parameters above.
    const temp=.02585*1.602176634e-19/1.380649e-23-273.15;
    const deck=[
        'Authored probe-loaded winding flyback control',
        `.options temp=${temp.toPrecision(12)} tnom=${temp.toPrecision(12)} method=gear maxord=2 reltol=1e-7 abstol=1e-12 vntol=1e-9`,
        'VCC supply 0 5','VP drive 0 PULSE(0 5 0 1u 1u 1m 3m)',
        'RB drive base 22700','Q1 collector base 0 QM','LW supply winding 5m',
        'RW winding collector 10','DF collector supply DM',
        'CP collector 0 12p','RP collector 0 10meg',
        '.model QM NPN(IS=1e-14 BF=100 BR=1 VAF=100)',
        '.model DM D(IS=1e-12 N=1 RS=.568)',
        '.control',`tran ${maxStep} 3.1m 0 ${maxStep}`,
        ...times.flatMap((ns,i)=>[
            `meas tran i${i} FIND i(LW) AT=${Number(ns)*1e-9}`,
            `meas tran v${i} FIND v(collector) AT=${Number(ns)*1e-9}`,
        ]),'.endc','.end','',
    ].join('\n');
    const r=spawnSync(ngspice,['-n','-b'],{input:deck,encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
    assert.equal(r.error,undefined,String(r.error));
    assert.equal(r.status,0,r.stderr||r.stdout);
    assert.doesNotMatch(r.stdout+r.stderr,/timestep too small|out of interval|Error:/i);
    const scalar=name=>{
        const match=r.stdout.match(new RegExp(`^${name}\\s*=\\s*([-+\\deE.]+)`,'m'));
        assert.ok(match,`missing ${name} measurement`);
        const value=Number(match[1]); assert.ok(Number.isFinite(value)); return value;
    };
    return times.map((ns,i)=>({ns,I:scalar(`i${i}`),V:scalar(`v${i}`)}));
}

function agrees(actual,reference,currentBound,voltageBound) {
    assert.equal(actual.length,reference.length);
    for(let i=0;i<reference.length;i++) {
        assert.equal(actual[i].ns,reference[i].ns);
        for(const [key,bound] of [['I',currentBound],['V',voltageBound]]) {
            assert.ok(Number.isFinite(actual[i][key]));
            assert.ok(Math.abs(actual[i][key]-reference[i][key])<=bound,
                `${key} at ${actual[i].ns} ns: ${actual[i][key]} vs ${reference[i][key]}`);
        }
    }
}

test('probe-loaded winding settled/flyback/restart samples match a refined independent SPICE reference',
    {skip:!available},()=>{
        const coarse=oracle(1e-7),fine=oracle(5e-8);
        // Reference convergence is tested FIRST, separately from agreement.
        // Includes rounding of ngspice meas output. Not a late-ring bound.
        agrees(coarse,fine,25e-9,25e-6);
        const actual=capture({intermediate:true});
        agrees(actual,fine,1e-6,100e-6);
        assert.ok(actual[2].V>5.5&&actual[5].V>5.5,'flyback collector above supply');
        assert.ok(actual[2].I>actual[3].I&&actual[3].I>actual[4].I&&actual[4].I>actual[5].I,
            'positive winding current decays during clamp conduction');
        assert.ok(Math.abs(actual[6].I-actual[0].I)<1e-8,'restart returns to on current');
        // Actual electrical callers, not altered reference numbers: a wrong L
        // and a missing turn-off edge must each fail against the fixed oracle.
        assert.throws(()=>agrees(capture({henrys:.01,intermediate:true}),fine,1e-6,100e-6),/I at|V at/);
        assert.throws(()=>agrees(capture({pw:.002,intermediate:true}),fine,1e-6,100e-6),/I at|V at/);
    });

test('probe-loaded winding reaches restart without caller-inserted ringing checkpoints',()=>{
    const direct=capture();
    const sampled=capture({intermediate:true});
    agrees(direct,sampled,1e-6,100e-6);
});
