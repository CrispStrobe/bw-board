/** Portable bounded-schedule oracle against every-period actual-net execution. */
import {bitDrives} from '../../src/experimental/digital-circuit.js';
import {HARRIS_80C286_STATUS} from '../../src/experimental/harris-80c286-contract.js';
import {createPhaseCircuitOracle} from './harris-native-phase-circuit-oracle.mjs';
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export async function runNativePhaseScheduleOracle({wasmBytes,yieldTask=()=>Promise.resolve(),stopped=()=>false}={}) {
    const f=await createPhaseCircuitOracle({wasmBytes,schedule:true}),reference=await createPhaseCircuitOracle({wasmBytes});
    const steps=[{values:{...f.passive,reset:1}},{values:f.passive}];
    for(let i=0;i<32;i++)for(const kind of ['memory-write','memory-read']) {
        const value=(i*977+0x1234)&65535,active={...f.passive,...HARRIS_80C286_STATUS[kind],...bitDrives(f.A,i*2),bhe_n:0,
            ...(kind==='memory-write'?bitDrives(f.D,value):Object.fromEntries(f.D.map(p=>[p,'Z'])))};
        steps.push({values:active},{values:active},{values:f.passive,read:kind==='memory-read'?value:null},{values:f.passive,read:kind==='memory-read'?value:null});
    }
    const handle=f.kernel.compileSchedule(steps);
    for(let i=0;i<steps.length;i++) {
        if(stopped())throw new Error('native schedule oracle cancelled');
        const error=reference.period(steps[i].values);if(error)throw error;
        if(i%16===0)await yieldTask();
    }
    if(stopped())throw new Error('native schedule oracle cancelled');
    const result=f.kernel.runSchedule(handle),expected=reference.kernel.inspect();
    if(result.periods!==steps.length||result.reads!==64||!same(result.levels,expected.levels)||!same(result.conflicts,expected.conflicts)||
        !same(result.driverLevels,expected.driverLevels)||JSON.stringify(f.kernel.inspectPhase())!==JSON.stringify(reference.kernel.inspectPhase()))throw new Error('native schedule final state mismatch');
    for(let bank=0;bank<2;bank++) {
        const {bytes,...state}=f.kernel.inspectMemory(bank),{bytes:expectedBytes,...expectedState}=reference.kernel.inspectMemory(bank);
        if(!same(bytes,expectedBytes)||JSON.stringify(state)!==JSON.stringify(expectedState))throw new Error('native schedule memory mismatch');
    }
    return {accepted:true,periods:result.periods,reads:result.reads,capacityClaim:false,
        scope:'bounded synthetic input schedule; every period executes, no CPU/device runner'};
}
