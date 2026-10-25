// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BoardImpl} from '../src/board.js';
import {registerAnalogAmps} from '../src/devices/analog-amps.js';

const terminal = (part,name) => ({part,terminal:name});
const part = (id,kind,params,terminals) => ({id,kind,params,terminals});
function resistor(volts=1) {
    const b=new BoardImpl(5);
    b.setNetlist([part('V','vsource',{volts},['pos','neg']),
        part('R','resistor',{ohms:1000},['a','b']),part('G','gnd',{},['gnd'])],
    [{id:'in',terminals:[terminal('V','pos'),terminal('R','a')]},
        {id:'zero',terminals:[terminal('V','neg'),terminal('R','b'),terminal('G','gnd')]}]);
    b.setPower(true);return b;
}
const copy = b => ({...b._mnaCache,branchCurrents:new Map([...b._mnaCache.branchCurrents]
    .map(([id,terms])=>[id,new Map(terms)]))});
function fault(solution,value) {
    if(value==='missing-map')solution.branchCurrents=undefined;
    else if(value==='missing-part')solution.branchCurrents.delete('R');
    else if(value==='missing-terminal')solution.branchCurrents.get('R').delete('a');
    else solution.branchCurrents.get('R').set('a',value);
    return solution;
}
const code = value => typeof value==='string'&&value.startsWith('missing-')
    ?'MISSING_BRANCH_CURRENT':'NONFINITE_BRANCH_CURRENT';
const currentWatch={kind:'i',part:'R',terminal:'a'};

test('real resistor represented zero and signed out-of-terminal currents remain measurements',()=>{
    for(const volts of [0,1,-1]) {
        const b=resistor(volts);
        assert.equal(b.meterCurrent('R','a'),volts===0?0:-volts/1000);
        assert.equal(b.meterCurrent('R','b'),volts/1000);
        b.advanceTo(1000n);
        assert.equal(b.meterCurrent('R','a'),volts===0?0:-volts/1000);
    }
    const b=resistor();for(const zero of [0,-0]) {
        const s=copy(b);s.branchCurrents.get('R').set('a',zero);
        assert(Object.is(b._meterValue(currentWatch,s),zero),'present signed zero is valid authority');
    }
    b.setPower(false);
    assert.equal(b.meterCurrent('R','a'),0);
    assert.equal(b._meterValue({kind:'i',part:'unrepresented',terminal:'port'}),0);
});

test('actual signal-model LM741 unmodelled supply current refuses while represented output remains signed',()=>{
    registerAnalogAmps();
    const b=new BoardImpl(5);
    b.configureTransientAnalysis('precision-v1');
    b.setNetlist([
        part('VP','vsource',{volts:15},['pos','neg']),part('VN','vsource',{volts:15},['pos','neg']),
        part('VIN','vsource',{volts:0},['pos','neg']),part('G','gnd',{},['gnd']),
        part('U','lm741',{transientModel:'linear-pole',inputOffsetV:0,supplyPositiveV:15,supplyNegativeV:-15},
            ['offset_1','inn','inp','vneg','offset_5','out','vpos','nc']),
        part('R','resistor',{ohms:10000},['a','b'])],
    [{id:'zero',terminals:[terminal('VP','neg'),terminal('VN','pos'),terminal('VIN','neg'),terminal('G','gnd'),terminal('R','b')]},
        {id:'positive',terminals:[terminal('VP','pos'),terminal('U','vpos')]},
        {id:'negative',terminals:[terminal('VN','neg'),terminal('U','vneg')]},
        {id:'input',terminals:[terminal('VIN','pos'),terminal('U','inp')]},
        {id:'out',terminals:[terminal('U','out'),terminal('U','inn'),terminal('R','a')]}]);
    assert.equal(b._mnaCache.branchCurrents.get('U').has('vpos'),false,'port is connected but no supply-current law exists');
    assert.throws(()=>b.meterCurrent('U','vpos'),e=>e.code==='MISSING_BRANCH_CURRENT'&&/U\.vpos/.test(e.message));
    assert.equal(b.meterCurrent('U','out'),0,'represented cold output zero stays valid');
    b.advanceTo(10000n);b.setControl('VIN',.01);b.advanceTo(10100n);
    assert(b.meterCurrent('U','out')>0,'actual represented output lead delivers current');
    assert(b.meterCurrent('R','a')<0,'load receives the output current');
    assert.throws(()=>b.meterCurrent('U','vpos'),e=>e.code==='MISSING_BRANCH_CURRENT');
});

test('missing and nonfinite maps are typed refusals after solve and determinacy checks',()=>{
    const b=resistor();
    for(const value of ['missing-map','missing-part','missing-terminal',NaN,Infinity,-Infinity,'0',undefined]) {
        assert.throws(()=>b._meterValue(currentWatch,fault(copy(b),value)),e=>e.code===code(value)&&/R\.a/.test(e.message));
    }
    const failed=fault(copy(b),'missing-terminal');failed.converged=false;
    assert.throws(()=>b._meterValue(currentWatch,failed),e=>e.code==='SOLVE_FAILED_MEASUREMENT');
    const source={kind:'i',part:'V',terminal:'pos'},indeterminate=copy(b);
    indeterminate.indeterminateBranchCurrents=new Set(['V']);indeterminate.branchCurrents.delete('V');
    assert.throws(()=>b._meterValue(source,indeterminate),e=>e.code==='INDETERMINATE_BRANCH_CURRENT');
});

for(const value of ['missing-map','missing-part','missing-terminal',NaN,Infinity]) {
    test(`accepted meter sample latches ${String(value)} without breaking another observer`,()=>{
        const b=resistor();b.meterCurrent('R','a');b.meterVoltage('in','zero');
        const w=[...b._meterWatches.values()].find(w=>w.kind==='i'),hist=structuredClone(w.hist);
        assert.doesNotThrow(()=>b._recordMeterSamples(0,fault(copy(b),value)));
        assert.match(w.failure,new RegExp(`${code(value)==='MISSING_BRANCH_CURRENT'?'missing':'nonfinite'} terminal current R\\.a`));
        const first=w.failure;assert.deepEqual(w.hist,hist,'invalid observation is not averaged as zero');
        b._recordMeterSamples(0,copy(b));assert.equal(w.failure,first,'recovery cannot erase first failed authority');
        assert.throws(()=>b.meterCurrent('R','a'),/meter mean refused/);
        assert.equal(b.meterVoltage('in','zero'),1);
        assert.doesNotThrow(()=>b.advanceTo(1000n),'ordinary simulation still advances');
    });
}
for(const position of ['midpoint','endpoint'])for(const value of ['missing-terminal',NaN]) {
    test(`accepted quadrature latches ${position} ${String(value)} without inventing a segment`,()=>{
        const b=resistor();b.configureTransientAnalysis('precision-v1');b.meterCurrent('R','a');b.meterVoltage('in','zero');
        const mid=copy(b),end=copy(b);fault(position==='midpoint'?mid:end,value);
        const key=[...b._meterWatches.keys()].find(k=>k.startsWith('i\0')),w=b._meterWatches.get(key),hist=structuredClone(w.hist);
        let segments;assert.doesNotThrow(()=>{segments=b._acceptedMeterQuadrature(0,.5e-6,1e-6,mid,end);});
        assert.equal(segments.has(key),false);assert.match(w.failure,/terminal current R\.a/);
        assert.deepEqual(w.hist,hist,'failed midpoint or end cannot create accepted current history');
        const first=w.failure;b._acceptedMeterQuadrature(0,.5e-6,1e-6,copy(b),copy(b));assert.equal(w.failure,first);
        assert.throws(()=>b.meterCurrent('R','a'),/meter mean refused/);
        assert.equal(b.meterVoltage('in','zero'),1);
    });
}

test('unknown exceptions still escape both observation helpers',()=>{
    const b=resistor();b.configureTransientAnalysis('precision-v1');b.meterCurrent('R','a');
    const original=b._meterValue,unexpected=new Error('unrelated programming fault');
    b._meterValue=()=>{throw unexpected;};
    try {
        assert.throws(()=>b._recordMeterSamples(0,copy(b)),e=>e===unexpected);
        assert.throws(()=>b._acceptedMeterQuadrature(0,.5e-6,1e-6,copy(b),copy(b)),e=>e===unexpected);
    }finally{b._meterValue=original;}
});

test('restored-old-fallback and reject-real-zero mutations fail current authority callers',()=>{
    const source=readFileSync(new URL('../src/board.js',import.meta.url),'utf8');
    const marker='  _meterValue(',begin=source.indexOf(marker),end=source.indexOf('\n  }',begin)+4;
    assert.equal(source.split(marker).length-1,1);
    const method=source.slice(begin,end).replace('  _meterValue','function');
    const anchor="    const currents = result.branchCurrents?.get(w.part);";
    const finish='    return i;';assert.equal(method.split(anchor).length-1,1);
    const old=method.slice(0,method.indexOf(anchor))+"    const i = result.branchCurrents.get(w.part)?.get(w.terminal) ?? 0;\n    return Number.isFinite(i) ? i : 0;"+method.slice(method.indexOf(finish)+finish.length);
    const b=resistor(),missing=fault(copy(b),'missing-terminal');
    const oldValue=new Function(`return (${old})`)();
    assert.throws(()=>assert.throws(()=>oldValue.call(b,currentWatch,missing),e=>e.code==='MISSING_BRANCH_CURRENT'),assert.AssertionError,
        'old fallback surviving would falsely certify missing current as zero');
    const zero=method.replace('if (!present || !Number.isFinite(i))','if (!present || !Number.isFinite(i) || i === 0)');
    assert.notEqual(zero,method);const rejectZero=new Function(`return (${zero})`)(),s=copy(b);s.branchCurrents.get('R').set('a',0);
    assert.throws(()=>assert.doesNotThrow(()=>rejectZero.call(b,currentWatch,s)),assert.AssertionError,
        'a blanket rejection cannot replace genuine represented zero');
    assert.equal(readFileSync(new URL('../src/board.js',import.meta.url),'utf8'),source);
});
