// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {meterQuadraticSegment,meterQuadraticIntegral} from '../src/meter-quadrature.js';
const f=x=>2+3*x+4*x*x,F=x=>2*x+1.5*x*x+4*x*x*x/3;
test('pure real Board quadrature recorder uses only supplied accepted maps and preserves legacy/refusal paths',()=>{
    // Extract only this metadata method, not Board or its simulation imports.
    const source=readFileSync(new URL('../src/board.js',import.meta.url),'utf8'),marker='  _acceptedMeterQuadrature(';
    assert.equal(source.split(marker).length-1,1);
    const begin=source.indexOf(marker),finish=source.indexOf('\n  }',begin)+4;
    const method=source.slice(begin,finish).replace('  _acceptedMeterQuadrature','function');
    const record=new Function('meterQuadraticSegment',`return (${method});`)(meterQuadraticSegment);
    const watch={hist:[{tSec:0,v:f(0)}]},mid={value:f(.5)},end={value:f(1)},calls=[];
    const mock={_transientAnalysisProfile:{id:'precision-v1'},_meterWatches:new Map([['v',watch]]),
        _meterValue(_watch,solution){calls.push(solution);return solution.value;}};
    const segments=record.call(mock,0,.5,1,mid,end);assert.equal(segments.size,1);
    assert.deepEqual(calls,[mid,end]);assert.equal(watch.hist.length,1,'no synthetic history publication');
    assert.ok(Math.abs(meterQuadraticIntegral(segments.get('v'),0,1)-F(1))<1e-13);
    const continuation=record.call(mock,5e-16,.5,1,mid,end);
    assert.equal(continuation.get('v').startSec,0,'legal endpoint gap retains actual earlier observation time');
    assert.ok(Math.abs(meterQuadraticIntegral(continuation.get('v'),0,1)-F(1))<1e-13);
    assert.equal(record.call(mock,2e-15,.5,1,mid,end).size,0,'larger unknown gap refuses');
    assert.equal(watch.failure,'meter-quadrature-start-not-observed');watch.failure=null;
    watch.hist[0].tSec=5e-16;
    assert.equal(record.call(mock,0,.5,1,mid,end).size,0,'future observations cannot become starts');
    assert.equal(watch.failure,'meter-quadrature-start-not-observed');watch.failure=null;watch.hist[0].tSec=0;
    calls.length=0;mock._transientAnalysisProfile.id='interactive-v2';
    assert.equal(record.call(mock,0,.5,1,mid,end),null);assert.deepEqual(calls,[]);
    mock._transientAnalysisProfile.id='precision-v1';mock._transientAccuracyUnmet={code:'failed'};
    assert.equal(record.call(mock,0,.5,1,mid,end),null);assert.deepEqual(calls,[]);
    mock._transientAccuracyUnmet=null;watch.hist[0].tSec=.1;
    assert.equal(record.call(mock,0,.5,1,mid,end).size,0);assert.equal(watch.failure,'meter-quadrature-start-not-observed');
    watch.failure=null;watch.hist[0].tSec=0;mock._meterValue=()=>{const error=new Error('ambiguous current');error.code='INDETERMINATE_BRANCH_CURRENT';throw error;};
    assert.equal(record.call(mock,0,.5,1,mid,end).size,0);assert.equal(watch.failure,'ambiguous current');
});
test('pure accepted meter quadrature integrates whole and clipped polynomials without time-origin bias',()=>{
    for(const midpoint of [.3,.5,.8]) {
        const s=meterQuadraticSegment(0,midpoint,1,f(0),f(midpoint),f(1));
        assert.ok(Object.isFrozen(s));
        for(const [a,b]of [[0,1],[0,.2],[.25,.75],[.9,1],[.6,.6]]) {
            assert.ok(Math.abs(meterQuadraticIntegral(s,a,b)-(F(b)-F(a)))<1e-13);
        }
    }
    const origin=1e6,mid=.125,end=.25,s=meterQuadraticSegment(origin,origin+mid,origin+end,f(0),f(mid),f(end));
    assert.ok(Math.abs(meterQuadraticIntegral(s,origin+.0625,origin+.1875)-(F(.1875)-F(.0625)))<1e-13);
    for(const value of [0,5,-.36]) {
        const flat=meterQuadraticSegment(0,.5,1,value,value,value);
        assert.equal(meterQuadraticIntegral(flat,0,1),value);
    }
});
test('pure accepted meter quadrature refuses missing/nonfinite/time-reversed/extrapolated authority',()=>{
    for(const args of [[0,0,1,0,1,2],[0,1,1,0,1,2],[-1,0,1,0,1,2],[0,.5,1,0,NaN,2],[0,.5,Infinity,0,1,2]]) {
        assert.throws(()=>meterQuadraticSegment(...args),/Invalid accepted/);
    }
    const s=meterQuadraticSegment(0,.5,1,0,1,2);
    for(const [a,b]of [[-1,1],[0,2],[.8,.2],[0,NaN]])assert.throws(()=>meterQuadraticIntegral(s,a,b),/observed clipped/);
    assert.throws(()=>meterQuadraticIntegral({...s,ym:NaN},0,1),/Invalid accepted/);
});
test('pure midpoint-omission mutation fails the independent polynomial integral caller',async()=>{
    const original=readFileSync(new URL('../src/meter-quadrature.js',import.meta.url),'utf8');
    const anchor='const slope=(ym-y0)/q,curve=(y1-y0-slope)/(1-q),linear=slope-curve*q;';
    assert.equal(original.split(anchor).length-1,1);
    const mutated=original.replace(anchor,'const slope=y1-y0,curve=0,linear=slope;');
    const mutant=await import(`data:text/javascript;base64,${Buffer.from(mutated).toString('base64')}`),s=meterQuadraticSegment(0,.5,1,f(0),f(.5),f(1));
    assert.throws(()=>assert.ok(Math.abs(mutant.meterQuadraticIntegral(s,0,1)-F(1))<1e-13),assert.AssertionError);
    assert.equal(readFileSync(new URL('../src/meter-quadrature.js',import.meta.url),'utf8'),original);
});
