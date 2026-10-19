import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBusCircuitOracle,runNativeBusCircuitOracle} from '../scripts/lib/harris-native-bus-circuit-oracle.mjs';
import {assertBusCircuitABI,assertDistinctBusDrivers} from '../src/experimental/wired-kernel/bus-circuit-image.js';
const wasmBytes=process.env.HARRIS_NET_WASM?readFileSync(process.env.HARRIS_NET_WASM):null;
const optional={skip:!wasmBytes&&'set HARRIS_NET_WASM to owned bus bridge build'};
const atSample=f=>f.kernel.inspectBus().state==='TC'&&f.kernel.inspectBus().phase===2;
const advanceToSample=f=>{for(let i=0;!atSample(f);i++){assert.ok(i<20);assert.equal(f.period().error,undefined);}};

test('sparse bus output admission rejects aliased owned driver mappings',()=>{
    assert.doesNotThrow(()=>assertDistinctBusDrivers({busOutputIds:[0,31,32,47],busExternalIds:[48,49]}));
    for(const maps of [
        {busOutputIds:[0,31,31,47],busExternalIds:[48,49]},
        {busOutputIds:[0,31,32,47],busExternalIds:[48,48]},
        {busOutputIds:[0,31,32,47],busExternalIds:[47,48]}
    ])assert.throws(()=>assertDistinctBusDrivers(maps),/must be distinct/);
});
test('sparse bus output bridge refuses stale modules without the mask ABI',()=>{
    const good={bus_circuit_version:()=>2,bus_sequencer_version:()=>1,bus_output_change_word(){}};
    assert.doesNotThrow(()=>assertBusCircuitABI(good));
    for(const name of Object.keys(good))assert.throws(()=>assertBusCircuitABI({...good,[name]:undefined}),/ABI mismatch/,name);
    assert.throws(()=>assertBusCircuitABI({...good,bus_circuit_version:()=>1}),/ABI mismatch/);
});

test('same-instance bus/actual-net/controller/memory oracle compares every boundary',optional,async()=>{
    for(const mode of [{},{admittedGraph:true,incrementalGraph:true}]) {
    const report=await runNativeBusCircuitOracle({wasmBytes,...mode});
    assert.equal(report.boundaries,830);assert.equal(report.transactions,48);assert.equal(report.completions,63);
    }
});
test('CPU output frontier publishes the full first image then skips an identical reset image',optional,async()=>{
    const f=await createBusCircuitOracle({wasmBytes,admittedGraph:true,incrementalGraph:true});
    f.kernel.resetWorkCounters();f.kernel.resetProducerCounters();
    assert.equal(f.call('beginClock',{reset:1}).error,undefined);
    let diagnostic=f.kernel.inspectProducerCounters();
    assert.deepEqual(diagnostic.producers.busOutput,{attempts:48,changes:32},
        'the first begin publishes every output, including 16 already-matching drivers');
    assert.equal(f.call('endClock').error,undefined);
    f.kernel.resetWorkCounters();f.kernel.resetProducerCounters();
    assert.equal(f.call('beginClock',{reset:1}).error,undefined);
    diagnostic=f.kernel.inspectProducerCounters();
    assert.deepEqual(diagnostic.producers.busOutput,{attempts:0,changes:0},
        'the same final output image schedules no writer calls or driver comparisons');
    assert.equal(f.call('endClock').error,undefined);
});
test('same-instance bridge retains actual swapped address wiring in admitted/incremental modes',optional,async()=>{
    const editWires=w=>w.map(item=>item.to==='low'&&['a0','a1'].includes(item.toTerminal)?
        {...item,toTerminal:item.toTerminal==='a0'?'a1':'a0'}:item);
    for(const incrementalGraph of [false,true]) {
        const f=await createBusCircuitOracle({wasmBytes,editWires,admittedGraph:true,incrementalGraph});f.initialize();
        f.submit({kind:'memory-write',address:2,width:2,value:0x1234});
        const write=f.runUntilCompletion({maxPeriods:20});assert.equal(write.completed,true);
        assert.equal(f.kernel.inspectMemory(0).bytes[2],0x34);assert.equal(f.kernel.inspectMemory(0).bytes[1],0);
        f.submit({kind:'code-read',address:2,width:2});
        assert.equal(f.runUntilCompletion({maxPeriods:20}).completions.at(-1).operand,0x1234);
    }
});
test('bounded native run preserves each period and resumes waits or partial odd words without skipping',optional,async()=>{
    const f=await createBusCircuitOracle({wasmBytes});f.initialize();f.submit({kind:'memory-write',address:1,width:2,value:0xabcd});
    const wait=f.runUntilCompletion({maxPeriods:7,inputs:{ready_n:1}});
    assert.deepEqual(wait,{completed:false,stopReason:'budget',periods:7,completions:[]});
    assert.equal(f.kernel.inspectMemory(1).writes,0);
    const first=f.runUntilCompletion({maxPeriods:1,inputs:{ready_n:0}});
    assert.equal(first.completed,false);assert.equal(first.completions.length,1);assert.equal(first.completions[0].last,false);
    assert.equal(f.kernel.inspectMemory(1).writes,1);assert.equal(f.kernel.inspectMemory(0).writes,0);
    const second=f.runUntilCompletion({maxPeriods:4});assert.equal(second.completed,true);
    assert.equal(second.completions[0].operand,0xabcd);assert.equal(f.kernel.inspectMemory(0).writes,1);
});
test('controller READY mismatch prevents bus sample and trailing-edge memory commit',optional,async()=>{
    const editWires=w=>w.map(item=>item.from==='host'&&item.fromTerminal==='ready_n'&&item.to==='cpu'?
        {...item,fromTerminal:'cpu_ready'}:item);
    const f=await createBusCircuitOracle({wasmBytes,editWires});f.initialize();
    f.submit({kind:'memory-write',address:0,value:0x31});advanceToSample(f);
    const clock=f.kernel.inspectBus().clock;
    assert.equal(f.call('beginClock',{ready_n:1,cpu_ready:0}).error,undefined);
    assert.equal(f.call('endClock').error.code,'READY_MISMATCH');
    assert.equal(f.kernel.inspectBus().clock,clock);assert.equal(f.kernel.inspectBus().open,true);
    assert.equal(f.kernel.inspectMemory(0).writes,0);assert.ok(f.kernel.inspectMemory(0).pending);
    assert.equal(f.circuit.require('controller','mwr_n'),0);
    assert.equal(f.call('beginClock',{reset:1}).error.code,'BOARD_FAULTED');
});
test('controller READY fault precedes CPU counter mutation and aborts memory trailing edge',optional,async()=>{
    const f=await createBusCircuitOracle({wasmBytes});f.initialize();
    f.submit({kind:'memory-write',address:0,value:0x31});advanceToSample(f);
    const clock=f.kernel.inspectBus().clock;f.call('beginClock',{ready_n:'X'});
    assert.equal(f.call('endClock').error.code,'UNKNOWN');
    assert.equal(f.kernel.inspectBus().clock,clock);assert.equal(f.kernel.inspectMemory(0).writes,0);
    assert.equal(f.kernel.inspectBus().faulted,false);assert.equal(f.kernel.inspectBus().open,true);
});
test('CPU data contention after valid memory preview aborts without committing the write edge',optional,async()=>{
    // Deliberately wire the memory bit to a distinct known source; CPU bit 0 can
    // then contend without causing the memory preview itself to fail first.
    const editWires=w=>w.map(item=>item.from==='cpu'&&item.fromTerminal==='d0'&&item.to==='low'?
        {...item,from:'host',fromTerminal:'cpu_ready'}:item);
    const f=await createBusCircuitOracle({wasmBytes,editWires});f.initialize();
    f.submit({kind:'memory-write',address:0,value:0});advanceToSample(f);
    const clock=f.kernel.inspectBus().clock;
    assert.equal(f.call('beginClock',{d0:1,cpu_ready:0}).error,undefined);
    assert.equal(f.call('endClock').error.code,'CONTENTION');
    assert.equal(f.kernel.inspectBus().clock,clock+1);assert.equal(f.kernel.inspectBus().faulted,true);
    assert.equal(f.kernel.inspectMemory(0).writes,0);assert.ok(f.kernel.inspectMemory(0).pending);
    assert.equal(f.circuit.require('controller','mwr_n'),0);
});
test('missing memory data line faults on read sampling, preserving completed first odd byte',optional,async()=>{
    const editWires=w=>w.filter(item=>!(item.from==='cpu'&&item.fromTerminal==='d0'&&item.to==='low'));
    const f=await createBusCircuitOracle({wasmBytes,editWires});f.initialize();f.submit({kind:'memory-read',address:1,width:2});
    let first;for(let i=0;!first;i++){assert.ok(i<8);const r=f.period();assert.equal(r.error,undefined);first=r.value;}
    assert.equal(first.last,false);advanceToSample(f);f.call('beginClock');
    assert.equal(f.call('endClock').error.code,'FLOATING');
    assert.deepEqual(f.kernel.inspectBus().pending.bytes,[0]);
});
test('descriptor refuses undeclared components and unsupported options; public methods cannot bypass bus',optional,async()=>{
    for(const descriptor of [{kind:'unknown'},{holdEnabled:true},{maxWaitStates:0},{cpu:'controller'},{inputPart:'low'}])
        await assert.rejects(createBusCircuitOracle({wasmBytes,descriptor}),TypeError);
    await assert.rejects(createBusCircuitOracle({wasmBytes,editParts:p=>[...p,{id:'timer',pins:['out'],outputs:['out']}]}),TypeError);
    const f=await createBusCircuitOracle({wasmBytes});f.initialize();
    for(const name of ['settleMemories','previewEndClock','finishEndClock','abortEndClock','compileSchedule','runSchedule'])assert.equal(f.kernel[name],undefined);
    const before=f.kernel.inspectBus();
    assert.throws(()=>f.kernel.beginClock({reset:1,not_an_external_pin:0}),{code:'INVALID_DRIVER_LEVEL'});
    assert.deepEqual(f.kernel.inspectBus(),before);assert.equal(f.kernel.inspectLifecycle().faulted,false);
    f.submit({kind:'memory-read',address:0});
    for(const maxPeriods of [0,8193,1.5])assert.throws(()=>f.kernel.runUntilCompletion({maxPeriods}),RangeError);
    f.period();assert.throws(()=>f.kernel.submit({kind:'io-read',address:0}),{code:'BUS_UNAVAILABLE'});
});

test('bounded fault receipt preserves previous physical completion and exact successful period count',optional,async()=>{
    const editWires=w=>w.filter(item=>!(item.from==='cpu'&&item.fromTerminal==='d0'&&item.to==='low'));
    const f=await createBusCircuitOracle({wasmBytes,editWires});f.initialize();f.submit({kind:'memory-read',address:1,width:2});
    let error;try{f.kernel.runUntilCompletion({maxPeriods:20});}catch(e){error=e;}
    assert.equal(error.code,'FLOATING');
    assert.deepEqual(error.progress,{stopReason:'fault',periods:7,
        completions:[{kind:'memory-read',address:1,width:1,data:0,waits:0,last:false}],busClock:75});
    assert.deepEqual(f.kernel.inspectBus().pending.bytes,[0]);
    assert.ok(Object.isFrozen(error.progress));assert.ok(Object.isFrozen(error.progress.completions));
    assert.ok(Object.isFrozen(error.progress.completions[0]));
});

test('bounded open/order and invalid updates do not mutate pending state or native drivers',optional,async()=>{
    const f=await createBusCircuitOracle({wasmBytes});f.initialize();f.submit({kind:'memory-read',address:0});
    const snapshot=()=>({bus:f.kernel.inspectBus(),nets:f.kernel.inspect(),life:f.kernel.inspectLifecycle()});
    let before=snapshot();
    assert.throws(()=>f.kernel.runUntilCompletion({maxPeriods:2,inputs:{ready_n:1,typo:0}}),{code:'INVALID_DRIVER_LEVEL'});
    assert.deepEqual(snapshot(),before);
    f.call('beginClock');before=snapshot();
    assert.throws(()=>f.kernel.runUntilCompletion({maxPeriods:2,inputs:{reset:1}}),{code:'CLOCK_ORDER'});
    assert.deepEqual(snapshot(),before);f.call('endClock');
});
