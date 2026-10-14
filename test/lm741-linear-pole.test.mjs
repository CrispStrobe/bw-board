// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LM741_CARD, lm741LinearParameters, expandLm741LinearPoles,
    assertLm741LinearTopology, assertLm741LinearSolution} from '../src/lm741-linear-pole.js';
import {getDevice} from '../src/devices.js';
import {registerAnalogAmps} from '../src/devices/analog-amps.js';

const terminals = ['offset_1','inn','inp','vneg','offset_5','out','vpos','nc'];
function fixture() {
    const net = (id,...pins) => ({id,terminals:pins.map(([part,terminal])=>({part,terminal}))});
    return {parts:[
        {id:'G',kind:'gnd',params:{},terminals:['gnd']},
        {id:'VP',kind:'vsource',params:{volts:15},terminals:['pos','neg']},
        {id:'VN',kind:'vsource',params:{volts:15},terminals:['pos','neg']},
        {id:'VIN',kind:'vsource',params:{volts:0},terminals:['pos','neg']},
        {id:'U',kind:'lm741',params:{transientModel:'linear-pole',inputOffsetV:0,supplyPositiveV:15,supplyNegativeV:-15},terminals},
        {id:'RL',kind:'resistor',params:{ohms:10000},terminals:['a','b']}
    ],nets:[net('zero',['G','gnd'],['VP','neg'],['VN','pos'],['VIN','neg'],['RL','b']),
        net('positive',['VP','pos'],['U','vpos']),net('negative',['VN','neg'],['U','vneg']),
        net('input',['VIN','pos'],['U','inp']),net('out',['U','out'],['U','inn'],['RL','a'])]};
}
// Pure topology fixture; no solver execution. Actual topology is also tested
// below through Board, not certified by this manufactured inspector alone.
function context(view) {
    const netFor=(part,pin)=>view.nets.find(n=>n.terminals.some(t=>t.part===part&&t.terminal===pin))?.id;
    return {netFor:pin=>netFor('U',pin),topology:{referenceNet:'zero',powerOff:false,net:id=>{
        const n=view.nets.find(n=>n.id===id);
        return n&&{id,extraSources:[],terminals:n.terminals.map(t=>{
            const p=view.parts.find(p=>p.id===t.part),params=p.params;
            return {...t,kind:p.kind,connections:Object.fromEntries(p.terminals.map(pin=>[pin,netFor(p.id,pin)])),
                electrical:{wave:params.wave,rInternal:params.rInternal,iLimit:params.iLimit,
                    ccClampPresent:false,controlPresent:false,effectiveVolts:params.volts}};
        })};
    }}};
}
const values=()=>({vpos:15,vneg:-15,inp:.01,inn:.009,out:.009,__linear_pole:.00954});
const part=()=>fixture().parts.find(p=>p.id==='U');

test('pure LM741 linear pole preserves the nominal card and caller topology; absent mode is identity',()=>{
    registerAnalogAmps();
    assert.deepEqual(LM741_CARD,{a0:200000,gbwHz:1e6,slewVPerUs:.5,inputR:2e6,rOut:600,
        tickNs:300n,settledV:1e-6,minSupply:10,commonHeadroom:3,outputHeadroom:2,defaultOffsetV:.001});
    assert.ok(Object.isFrozen(LM741_CARD));
    const legacy=fixture();delete legacy.parts[4].params.transientModel;
    const unchanged=expandLm741LinearPoles(legacy.parts,legacy.nets);
    assert.equal(unchanged.parts,legacy.parts);assert.equal(unchanged.nets,legacy.nets);
    const model=getDevice('lm741'),state=model.init(legacy.parts[4]);
    assert.equal(state._spec,LM741_CARD);assert.deepEqual(state.drives.out,{vTh:0,rTh:1e9});
    assert.equal(state.transientModel,undefined);
    const f=fixture(),before=structuredClone(f),view=expandLm741LinearPoles(f.parts,f.nets);
    assert.deepEqual(f,before);assert.equal(view.parts.length,f.parts.length+5);
    assert.ok(view.parts.includes(f.parts[4]),'physical package retained for input-current/admission stamps');
    const byId=new Map(view.parts.map(p=>[p.id,p]));
    const gm=byId.get('@lm741:U:gm').params.gm,cap=byId.get('@lm741:U:cap').params.farads;
    assert.equal(gm/cap,2*Math.PI*1e6);assert.equal(gm*byId.get('@lm741:U:rp').params.ohms,200000);
    assert.equal(byId.get('@lm741:U:rout').params.ohms,600);
    assert.deepEqual(byId.get('@lm741:U:buffer').params,{gain:1},'no silent rail/current clipping');
    assert.equal(context(view).netFor('__linear_pole'),'@lm741:U:pole');
    assert.doesNotThrow(()=>assertLm741LinearTopology(f.parts[4],context(view)));
    const linearState=model.init(f.parts[4]);assert.equal(linearState.drives.out,null);
    assert.equal(model.update(f.parts[4],linearState,()=>0,100n),false);
    assert.equal(linearState._wakeNs,null);assert.equal(linearState._beta,null);
    const ctx=context(view);ctx.conductance=()=>{};
    assert.doesNotThrow(()=>model.stamp(ctx,f.parts[4],linearState));
    linearState.drives.out={vTh:0,rTh:600};
    assert.throws(()=>model.stamp(ctx,f.parts[4],linearState),/initialized mode\/drive authority changed/);
    assert.equal(model.branchCurrents(f.parts[4],{},pin=>values()[pin]).get('out'),(.00954-.009)/600);
});

test('pure LM741 linear pole refuses parameter, topology and solved-domain false successes',()=>{
    for(const edit of [p=>{p.transientModel='unknown';},p=>{delete p.inputOffsetV;},p=>{p.inputOffsetV=.001;},
        p=>{p.supplyPositiveV=NaN;},p=>{p.supplyNegativeV=14;},p=>{p.supplyPositiveV=30;},p=>{p.gbw=2e6;}]) {
        const p=part();edit(p.params);assert.throws(()=>lm741LinearParameters(p),/LM741 U linear-pole:/);
    }
    for(const edit of [f=>{f.nets=f.nets.filter(n=>n.id!=='zero');},
        f=>{f.nets=f.nets.filter(n=>n.id!=='input');},
        f=>{f.nets[0].terminals.push({part:'U',terminal:'offset_1'});},
        f=>{f.parts.push({id:'@lm741:U:cap',kind:'resistor',params:{ohms:1},terminals:['a','b']});},
        f=>{f.nets.push({id:'@lm741:U:pole',terminals:[]});}]) {
        const f=fixture();edit(f);assert.throws(()=>expandLm741LinearPoles(f.parts,f.nets),/LM741 U linear-pole:/);
    }
    for(const edit of [f=>{f.parts[1].params.wave='spice-pulse';},f=>{f.parts[1].params.volts=14;},
        f=>{f.parts[1].params.rInternal=1;},f=>{f.parts[1].params.iLimit=.1;}]) {
        const f=fixture();edit(f);const view=expandLm741LinearPoles(f.parts,f.nets);
        assert.throws(()=>assertLm741LinearTopology(f.parts[4],context(view)),/fixed ideal vpos/);
    }
    assert.doesNotThrow(()=>assertLm741LinearSolution(part(),pin=>values()[pin]));
    for(const [pin,value,reason] of [['vpos',14,'solved supplies'],['vneg',NaN,'finite'],
        ['inp',13,'common-mode'],['out',14,'output swing'],['inp',1,'slew'],['out',1,'output load']]) {
        const v=values();v[pin]=value;
        assert.throws(()=>assertLm741LinearSolution(part(),pin=>v[pin]),new RegExp(reason));
    }
});

test('pure wrong-pole and removed-slew-admission mutants fail actual callers',async()=>{
    const original=readFileSync(new URL('../src/lm741-linear-pole.js',import.meta.url),'utf8');
    const poleAnchor='const gm = 2*Math.PI*LM741_CARD.gbwHz*CINT;';
    const slewAnchor='if (Math.abs(derivative) > LM741_CARD.slewVPerUs*1e6*(1+1e-8))';
    for(const [anchor,replacement,verify] of [
        [poleAnchor,'const gm = Math.PI*LM741_CARD.gbwHz*CINT;',mutant=>{
            const f=fixture(),view=mutant.expandLm741LinearPoles(f.parts,f.nets);
            const gm=view.parts.find(p=>p.id==='@lm741:U:gm').params.gm;
            assert.equal(gm/30e-12,2*Math.PI*1e6);
        }],
        [slewAnchor,'if (false)',mutant=>{
            const v=values();v.inp=1;
            assert.throws(()=>mutant.assertLm741LinearSolution(part(),pin=>v[pin]),/slew outside/);
        }]
    ]) {
        assert.equal(original.split(anchor).length-1,1);
        const mutant=await import(`data:text/javascript;base64,${Buffer.from(original.replace(anchor,replacement)).toString('base64')}`);
        assert.throws(()=>verify(mutant),assert.AssertionError);
    }
    assert.equal(readFileSync(new URL('../src/lm741-linear-pole.js',import.meta.url),'utf8'),original);
});

test('hosted LM741 linear pole has real hidden history, no wake, and refuses changed rail/input authority',async()=>{
    const {BoardImpl}=await import('../src/board.js');registerAnalogAmps();
    const make=()=>{const f=fixture(),b=new BoardImpl(5);b.configureTransientAnalysis('precision-v1');b.setNetlist(f.parts,f.nets);return b;};
    const b=make();assert.equal(b.getParts().find(p=>p.id==='U').terminals.length,8);
    assert.equal(b.getDeviceState('U').drives.out,null);assert.equal(b.getDeviceState('U')._wakeNs,null);
    assert.equal(b.capVoltages.get('@lm741:U:cap'),0);
    b.advanceTo(10000n);b.setControl('VIN',.01);b.advanceTo(10100n);
    assert.ok(b.nodeVoltage('out')>.004&&b.nodeVoltage('out')<.005,'continuous 100 ns response, not a zero-drive hold');
    assert.ok(b.capVoltages.get('@lm741:U:cap')>0);assert.equal(b.getDeviceState('U')._wakeNs,null);
    assert.ok(Math.abs(b.branchCurrent('U','out')-b.branchCurrent('@lm741:U:rout','b'))<1e-12,
        'physical output lead exposes the exact hidden resistor current');
    assert.ok(Math.abs(b.branchCurrent('U','out')+b.branchCurrent('U','inn')+b.branchCurrent('RL','a'))<1e-10,
        'instrument currents balance at the package output net');
    b.setControl('VIN',0);b.reset();assert.ok(Math.abs(b.nodeVoltage('out'))<1e-10,'reset uses cold hidden capacitor');
    assert.throws(()=>make().setControl('VP',14),/fixed ideal vpos/);
    assert.throws(()=>make().setControl('VIN',1),/slew outside linear envelope/);
    const invalid=fixture();Object.assign(invalid.parts[1].params,
        {wave:'spice-pulse',v1:15,v2:15,td:1e-6,tr:1e-9,tf:1e-9,pw:1e-6,per:3e-6});
    assert.throws(()=>new BoardImpl(5).setNetlist(invalid.parts,invalid.nets),/fixed ideal vpos/);
});
