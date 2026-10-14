// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CASES,CARD,TIMES_NS,WINDOW,LIMITS,reference,compareCapture,parseArguments,runCase}
    from '../scripts/qualify-adp7118-instruments.mjs';
const keys=['voltage','outputCurrent','inputCurrent'];
function fixture(id='adp-inrush-r4') {
    return{caseId:id,status:{profile:{id:'precision-v1'},accuracyMet:true,failure:null},
        receipt:{completed:true,failure:null,requestedTimeNs:'1200000',limits:{...LIMITS},
            work:{attempts:1000,solves:3000,advances:194},stream:{observerCalls:80,stepNs:'15000'}},
        modelState:{startupModel:'current-limited-envelope',enabled:true},
        instrumentMetadata:Array.from({length:3},(_,i)=>({count:200,writeIndex:200,startTNs:'6000',
            sampleIntervalNs:'6000',capture:'sample',...(i?{currentClock:'simulation'}:{})})),
        observations:Array.from({length:80},(_,i)=>{
            const timeNs=(i+1)*15000,v=reference(id).point(timeNs),row=CASES.find(c=>c.id===id);
            return{timeNs,qualified:false,converged:true,dirty:false,voltage:v.voltage,vin:8-row.inputR*v.inputCurrent,
                currents:{output:v.outputCurrent,duplicateOutput:0,input:-v.inputCurrent,duplicateInput:0,
                    ground:v.inputCurrent-v.outputCurrent,source:v.inputCurrent,load:-v.voltage/row.R,
                    capacitor:v.voltage/row.R-v.outputCurrent}};
        }),samples:TIMES_NS.map(t=>reference(id).point(t)),mean:{...reference(id).mean}};
}
test('pure ADP reference preserves case/region authority and independent integral controls',()=>{
    assert.equal(CASES.length,6);assert.equal(new Set(CASES.map(c=>c.id)).size,6);
    assert.ok(Object.isFrozen(CASES)&&CASES.every(Object.isFrozen)&&Object.isFrozen(CARD));
    assert.deepEqual(parseArguments([]),CASES.map(c=>c.id));
    for(const row of CASES){
        const ref=reference(row.id);
        if(row.mode==='linear')assert.equal(ref.entrySec,null);
        else if(row.mode==='inrush'){
            assert.ok(Math.abs(ref.entrySec-66.26866414968961e-6)<1e-12);
            assert.ok(Math.abs(ref.releaseSec-329.1432340371157e-6)<1e-12);
        }else{assert.ok(Math.abs(ref.entrySec-217.30757602325912e-6)<1e-12);assert.equal(ref.releaseSec,null);}
        let integrals={voltage:0,outputCurrent:0,inputCurrent:0};const step=25;
        for(let t=WINDOW.startNs;t<WINDOW.endNs;t+=step){const a=ref.point(t),b=ref.point(t+step);
            for(const key of keys)integrals[key]+=(a[key]+b[key])*step/2;}
        for(const key of keys)assert.ok(Math.abs(integrals[key]/(WINDOW.endNs-WINDOW.startNs)-ref.mean[key])<2e-8,
            `${row.id} independently quadrature-checked ${key} mean`);
        assert.equal(compareCapture(row.id,fixture(row.id)).agreement,true);
        const other=reference(row.id.replace(/r[04]$/,row.inputR?'r0':'r4'));
        assert.deepEqual(TIMES_NS.map(t=>ref.point(t)),TIMES_NS.map(t=>other.point(t)),
            'headroom-qualified supply resistance does not change authored output/current law');
    }
    for(const args of [['--case'],['--case','unknown'],['--budget','400'],['--case','adp-linear-r0','extra']])assert.throws(()=>parseArguments(args));
    assert.throws(()=>reference('adp-linear-r0').point(NaN));
});
test('pure ADP comparison refuses partial/profile/grid/work/current/mean false successes',()=>{
    for(const edit of [e=>{e.receipt.completed=false;},e=>{e.receipt.work.advances=201;},e=>{e.receipt.limits.maxSolves++;},
        e=>{e.receipt.stream.observerCalls=79;},e=>{e.status.profile.id='interactive-v2';},e=>{e.modelState.enabled=false;},
        e=>{e.samples.pop();},e=>{delete e.samples[199];},e=>{e.samples[199].timeNs--;},
        e=>{e.samples[199].inputCurrent=NaN;},e=>{e.mean.startNs=0;},e=>{e.observations.pop();},
        e=>{delete e.observations[79];},e=>{delete e.instrumentMetadata[2];},
        e=>{e.observations[79].currents.ground+=.001;},e=>{e.instrumentMetadata[2].currentClock='display';}]) {
        const e=fixture();edit(e);assert.throws(()=>compareCapture(e.caseId,e));
    }
    for(const key of keys){const e=fixture();e.samples[199][key]+=.001;assert.equal(compareCapture(e.caseId,e).agreement,false);
        const m=fixture();m.mean[key]+=.001;assert.equal(compareCapture(m.caseId,m).agreement,false);}
});
test('pure changed-IQ and omitted-final-current mutants red real comparison callers',async()=>{
    const original=readFileSync(new URL('../scripts/qualify-adp7118-instruments.mjs',import.meta.url),'utf8');
    for(const [anchor,replacement,verify,reason] of [
        ['iqBase:50e-6','iqBase:500e-6',mutant=>assert.equal(mutant.compareCapture('adp-inrush-r4',fixture()).agreement,true),
            /Simultaneous ADP output\/load\/supply KCL or IQ authority failed/],
        ['comparisons.every(passed)','comparisons.slice(0,-1).every(passed)',mutant=>{
            const e=fixture();e.samples[199].inputCurrent+=.001;assert.equal(mutant.compareCapture(e.caseId,e).agreement,false);
        },assert.AssertionError]
    ]){assert.equal(original.split(anchor).length-1,1);
        const mutant=await import(`data:text/javascript;base64,${Buffer.from(original.replace(anchor,replacement)).toString('base64')}`);
        assert.throws(()=>verify(mutant),reason);}
    assert.equal(readFileSync(new URL('../scripts/qualify-adp7118-instruments.mjs',import.meta.url),'utf8'),original);
});
test('hosted ADP native output/supply waveforms and means match the independent continuous law',async t=>{
    const json=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?String(v):v),failures=[];
    for(const {id} of CASES){const report=await runCase(id),{engine,comparisons,...summary}=report;
        t.diagnostic(json({record:'adp-native-summary',...summary,engine:engine&&{...engine,samples:undefined,observations:undefined}}));
        for(const row of engine?.observations||[])t.diagnostic(json({record:'adp-native-observation',id,...row}));
        for(const row of comparisons||[])t.diagnostic(json({record:'adp-native-comparison',id,...row}));
        if(!report.agreement)failures.push({id,failure:report.failure||'continuous-law-disagreement'});
    }
    assert.deepEqual(failures,[],'a partial/rejected current capture is not successful qualification');
    const original=readFileSync(new URL('../scripts/qualify-adp7118-instruments.mjs',import.meta.url),'utf8');
    const anchor='farads:row.C';assert.equal(original.split(anchor).length-1,1);
    const source=original.replace(anchor,'farads:row.C*1.5')
        .replaceAll("'../src/board.js'",JSON.stringify(new URL('../src/board.js',import.meta.url).href))
        .replaceAll("'../src/devices/power.js'",JSON.stringify(new URL('../src/devices/power.js',import.meta.url).href));
    const mutant=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`),changed=await mutant.runCase('adp-inrush-r4');
    assert.equal(changed.failure,undefined);assert.equal(changed.engine.receipt.completed,true);assert.equal(changed.agreement,false);
    t.diagnostic(json({record:'adp-native-capacitance-mutant',completed:true,agreement:false}));
    assert.equal(readFileSync(new URL('../scripts/qualify-adp7118-instruments.mjs',import.meta.url),'utf8'),original);
    // Restore the old meter integration on a real Board caller, keeping
    // device law, scope grid, solver profile and whole budget identical.
    const boardURL=new URL('../src/board.js',import.meta.url),boardOriginal=readFileSync(boardURL,'utf8');
    const quadAnchor="if (this._transientAnalysisProfile.id !== 'precision-v1' || !this._meterWatches.size";
    assert.equal(boardOriginal.split(quadAnchor).length-1,1);
    const boardMutant=boardOriginal.replace(quadAnchor,"if (true || this._transientAnalysisProfile.id !== 'precision-v1' || !this._meterWatches.size")
        .replace(/(from\s*|import\(\s*)(['"])(\.\.?\/[^'"]+)\2/g,(_all,prefix,_quote,relative)=>prefix+JSON.stringify(new URL(relative,boardURL).href));
    const boardURI=`data:text/javascript;base64,${Buffer.from(boardMutant).toString('base64')}`;
    const runner=original.replace("'../src/board.js'",JSON.stringify(boardURI))
        .replace("'../src/devices/power.js'",JSON.stringify(new URL('../src/devices/power.js',import.meta.url).href));
    const oldQuadrature=await import(`data:text/javascript;base64,${Buffer.from(runner).toString('base64')}`);
    const refusedMean=await oldQuadrature.runCase('adp-linear-r0');
    assert.equal(refusedMean.failure,undefined);assert.equal(refusedMean.engine.receipt.completed,true);
    assert.equal(refusedMean.agreement,false);assert.equal(refusedMean.means.voltage.passed,false);
    assert.ok(refusedMean.comparisons.every(row=>keys.every(key=>row[key].passed)),'mutant fails the mean, not waveform acquisition');
    t.diagnostic(json({record:'adp-native-quadrature-mutant',completed:true,agreement:false,
        voltageMeanError:refusedMean.means.voltage.absoluteError,work:refusedMean.engine.receipt.work}));
    assert.equal(readFileSync(boardURL,'utf8'),boardOriginal);
});
