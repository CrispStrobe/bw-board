import test from 'node:test';
import assert from 'node:assert/strict';
import {HARRIS_BROWSER_CLOCK,measureHarrisBrowserRun,summarizeHarrisBrowserSamples} from '../scripts/lib/harris-browser-measurement.mjs';
const stamp=ticks=>({ticks,...HARRIS_BROWSER_CLOCK});
const input=overrides=>({before:stamp(0),initialized:stamp(67),after:stamp(167),
    run:{clocks:100,activeMS:10},initializationActiveMS:2,wallMS:112,...overrides});
const sample=timing=>({clocks:100,initializationPeriods:timing.initializationPeriods,
    measurement:timing.measurement,elapsedMS:timing.measurement.wallMS,periodsPerSecond:timing.measurement.wallTicksPerSecond});

test('browser measurement includes initialization periods and time, but excludes yield delays from active capacity',()=>{
    const result=measureHarrisBrowserRun(input());
    assert.equal(result.accepted,true);assert.equal(result.initializationPeriods,67);
    const m=result.measurement;
    assert.equal(m.elapsedTicks,167);assert.equal(m.activeMS,12);assert.equal(m.wallMS,112);
    assert.equal(m.activeTicksPerSecond,167/12*1000);assert.equal(m.wallTicksPerSecond,167/112*1000);
    assert.equal(m.capacityRealTimeFactor,m.activeTicksPerSecond/9545454);
    assert.equal(m.pacingRealTimeFactor,m.wallTicksPerSecond/9545454);
    assert.ok(m.capacityRealTimeFactor>m.pacingRealTimeFactor);assert.ok(Object.isFrozen(result));
});

test('actual stamp/count disagreements, reset epochs and wrong clock frequency refuse',()=>{
    assert.equal(measureHarrisBrowserRun(input({after:stamp(168)})).code,'period-count-mismatch');
    assert.equal(measureHarrisBrowserRun(input({run:{clocks:100.5,activeMS:10}})).code,'period-count-mismatch');
    assert.equal(measureHarrisBrowserRun(input({initialized:{...stamp(67),domain:'reset-1'}})).code,'clock-domain-changed');
    assert.equal(measureHarrisBrowserRun(input({before:{...stamp(0),hz:4772727},initialized:{...stamp(67),hz:4772727},
        after:{...stamp(167),hz:4772727}})).code,'unexpected-harris-clock');
    assert.equal(measureHarrisBrowserRun(input({wallMS:11})).code,'active-exceeds-wall');
});

test('browser summaries revalidate transported rates and retain clearly wall-paced legacy fields',()=>{
    const a=sample(measureHarrisBrowserRun(input())),b=sample(measureHarrisBrowserRun(input({wallMS:212})));
    const summary=summarizeHarrisBrowserSamples([a,b]);
    assert.equal(summary.medianMS,162);assert.equal(summary.medianActiveMS,12);
    assert.equal(summary.activeTicksPerSecond,a.measurement.activeTicksPerSecond);
    assert.equal(summary.periodsPerSecond,(a.measurement.wallTicksPerSecond+b.measurement.wallTicksPerSecond)/2);
    assert.equal(summary.xtCapacityFactor,summary.capacityRealTimeFactor);
    assert.ok(Object.isFrozen(summary));assert.equal(a.clocks,100); // Existing state count is untouched.
    for(const bad of [{...a,initializationPeriods:0},{...a,periodsPerSecond:a.measurement.activeTicksPerSecond},
        {...a,measurement:{...a.measurement,capacityRealTimeFactor:999}},
        {...a,measurement:{...a.measurement,elapsedTicks:100}}]) {
        assert.throws(()=>summarizeHarrisBrowserSamples([bad]),TypeError);
    }
});

test('unknown zero-duration rates stay null in browser summaries rather than dropping samples',()=>{
    const timing=measureHarrisBrowserRun(input({run:{clocks:100,activeMS:0},initializationActiveMS:0,wallMS:0}));
    assert.equal(timing.accepted,true);
    const summary=summarizeHarrisBrowserSamples([sample(timing)]);
    assert.equal(summary.periodsPerSecond,null);assert.equal(summary.capacityRealTimeFactor,null);
    assert.equal(summary.pacingRealTimeFactor,null);assert.equal(summary.xtCapacityFactor,null);
});

test('cancelled partial runs retain valid measurements without needing to complete the program',()=>{
    const result=measureHarrisBrowserRun(input({after:stamp(74),run:{clocks:7,activeMS:1,status:'stopped'}}));
    assert.equal(result.accepted,true);assert.equal(result.measurement.elapsedTicks,74);
    assert.equal(result.measurement.activeMS,3);
});
