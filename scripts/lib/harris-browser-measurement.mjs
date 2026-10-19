/** Browser benchmark clock authority, not a CPU instruction/timing assertion. */
import {measureExecutionSlice} from '../../src/execution-measurement.js';
export const HARRIS_BROWSER_CLOCK=Object.freeze({domain:'harris-modeled-periods',hz:9545454});
const refuse=(code,reason)=>Object.freeze({accepted:false,code,reason});
const count=value=>Number.isSafeInteger(value)&&value>=0;
export function measureHarrisBrowserRun({before,initialized,after,run,initializationActiveMS,wallMS}) {
    const init=measureExecutionSlice({before,after:initialized,activeMS:initializationActiveMS,wallMS:initializationActiveMS});
    if(!init.accepted)return init;
    const execution=measureExecutionSlice({before:initialized,after,activeMS:run?.activeMS,wallMS:wallMS-initializationActiveMS});
    if(!execution.accepted)return execution;
    if(!count(run.clocks)||run.clocks!==execution.elapsedTicks)return refuse('period-count-mismatch','Executed bus periods differ from chunk-runner clocks.');
    const measurement=measureExecutionSlice({before,after,activeMS:initializationActiveMS+run.activeMS,wallMS});
    if(!measurement.accepted)return measurement;
    if(measurement.domain!==HARRIS_BROWSER_CLOCK.domain||measurement.hz!==HARRIS_BROWSER_CLOCK.hz)
        return refuse('unexpected-harris-clock','Benchmark requires the declared modeled-period domain and reference frequency.');
    return Object.freeze({accepted:true,measurement,initializationPeriods:init.elapsedTicks});
}
const median=values=>{
    if(values.some(v=>v===null))return null;
    const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);
    return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;
};
/** Revalidate transported samples; do not trust rates copied from worker JSON. */
export function summarizeHarrisBrowserSamples(samples) {
    if(!Array.isArray(samples)||!samples.length)throw new TypeError('measured samples required');
    for(const sample of samples) {
        const m=sample.measurement;
        if(!m?.accepted||!count(sample.clocks)||!count(sample.initializationPeriods)||
            !count(sample.clocks+sample.initializationPeriods)||m.elapsedTicks!==sample.clocks+sample.initializationPeriods||
            m.domain!==HARRIS_BROWSER_CLOCK.domain||m.hz!==HARRIS_BROWSER_CLOCK.hz)
            throw new TypeError('invalid browser measurement provenance/count');
        const checked=measureExecutionSlice({before:{ticks:0,domain:m.domain,hz:m.hz},
            after:{ticks:m.elapsedTicks,domain:m.domain,hz:m.hz},activeMS:m.activeMS,wallMS:m.wallMS});
        if(!checked.accepted||Object.entries(checked).some(([key,value])=>m[key]!==value)||
            sample.elapsedMS!==m.wallMS||sample.periodsPerSecond!==m.wallTicksPerSecond)
            throw new TypeError('invalid browser measurement arithmetic/legacy wall fields');
    }
    const wall=samples.map(s=>s.measurement.wallMS),active=samples.map(s=>s.measurement.activeMS);
    const metric=name=>median(samples.map(s=>s.measurement[name]));
    return Object.freeze({medianMS:median(wall),minMS:Math.min(...wall),maxMS:Math.max(...wall),
        medianActiveMS:median(active),minActiveMS:Math.min(...active),maxActiveMS:Math.max(...active),
        periodsPerSecond:metric('wallTicksPerSecond'),wallTicksPerSecond:metric('wallTicksPerSecond'),
        activeTicksPerSecond:metric('activeTicksPerSecond'),capacityRealTimeFactor:metric('capacityRealTimeFactor'),
        pacingRealTimeFactor:metric('pacingRealTimeFactor'),xtCapacityFactor:metric('capacityRealTimeFactor')});
}
