import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bitDrives} from '../src/experimental/digital-circuit.js';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {HARRIS_80C286_STATUS} from '../src/experimental/harris-80c286-contract.js';
import {createPhaseCircuitOracle,runNativePhaseCircuitOracle} from '../scripts/lib/harris-native-phase-circuit-oracle.mjs';
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build phase circuit prototype and set HARRIS_NET_WASM; native gate not exercised'};
test('coupled native controller/latch/memory preserves every begin/end boundary through waits',native,async()=>{
    const report=await runNativePhaseCircuitOracle({wasmBytes});assert.equal(report.accepted,true);assert.equal(report.transactions,128);
    assert.equal(report.comparisons,1532);assert.equal(report.faults,0);assert.equal(report.capacityClaim,false);
});
test('native latched clock-order errors allow recovery but sampled circuit faults latch',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes});
    assert.equal(f.call('endClock')?.code,'CLOCK_ORDER');f.call('beginClock',f.passive);
    assert.equal(f.call('beginClock')?.code,'CLOCK_ORDER');f.call('endClock');
    assert.equal(f.call('beginClock',{...f.passive,reset:'Z'})?.code,'FLOATING');
    assert.equal(f.call('endClock')?.code,'BOARD_FAULTED');assert.equal(f.call('beginClock')?.code,'BOARD_FAULTED');
});
test('native reset ends an armed write pulse without rolling memory back',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes,Circuit:CompiledDigitalCircuit});f.period(f.passive);
    const active={...f.passive,...HARRIS_80C286_STATUS['memory-write'],...bitDrives(f.A,0x500),...bitDrives(f.D,0xabcd)};
    f.period(active);f.period(active);f.period({...f.passive,ready_n:1});
    assert.equal(f.kernel.inspectMemory(0).writes,0);
    f.period({...f.passive,reset:1});assert.equal(f.kernel.inspectMemory(0).writes,1);assert.equal(f.kernel.inspectMemory(1).writes,1);
    assert.equal(f.kernel.inspectMemory(0).bytes[0x280],0xcd);assert.equal(f.kernel.inspectMemory(1).bytes[0x280],0xab);
});
test('native latched clock samples READY only at TC2 and fails without trailing-edge commitment',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes});f.period(f.passive);
    const active={...f.passive,...HARRIS_80C286_STATUS['memory-write'],...bitDrives(f.A,0x500),...bitDrives(f.D,0x1234)};
    f.period(active);f.period(active);f.period({...f.passive,ready_n:'Z'});
    f.call('beginClock');assert.equal(f.call('endClock')?.code,'FLOATING');
    assert.equal(f.kernel.inspectMemory(0).writes,0);assert.equal(f.kernel.inspectMemory(1).writes,0);
});
test('edited latch address wiring cannot be replaced by a hidden CPU address',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes,editWires:w=>w.filter(x=>!(x.to==='latch'&&x.toTerminal==='a7'))});f.period(f.passive);
    const active={...f.passive,...HARRIS_80C286_STATUS['memory-read'],...bitDrives(f.A,0x500)};
    f.period(active);assert.equal(f.call('beginClock',active)?.code,'FLOATING');assert.equal(f.kernel.inspectPhase().faulted,true);
});
test('I/O and INTA controller cycles keep memory deselected on the native clock path',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes});f.period(f.passive);
    for(const kind of ['io-read','io-write','interrupt-acknowledge']){
        const active={...f.passive,...HARRIS_80C286_STATUS[kind],...bitDrives(f.A,0x20)};
        f.period(active);f.period(active);for(let i=0;i<6;i++)f.period({...f.passive,ready_n:Number(i<4)});
        assert.equal(f.kernel.inspectMemory(0).writes,0);assert.equal(f.kernel.inspectMemory(1).writes,0);
    }
});
