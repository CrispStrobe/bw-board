import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisStoreLoopROM} from '../src/experimental/harris-boot-rom.js';
import {createHarrisNativeMemoryBoard} from '../src/experimental/harris-native-memory-board.js';
import {runHarrisTransactions} from '../src/experimental/harris-run-transactions.js';
import {assertProducerCounterABI} from '../src/experimental/wired-kernel/memory-circuit.js';
import {createPhaseCircuitOracle} from '../scripts/lib/harris-native-phase-circuit-oracle.mjs';

registerBusMemory();
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build current native module and set HARRIS_NET_WASM'};
const zeroProducers=()=>Object.fromEntries(['other','busExternal','busOutput','phaseController','phaseLatch','memoryBank',
    'phaseSchedule','evaluator','fullScan'].map(name=>[name,{attempts:0,changes:0}]));
const zeroMemory=()=>Object.fromEntries(['settleCalls','passes','previewCalls','previewBanks','presentBanks','changedBanks',
    'postMemorySettles','postMemorySettlesWithoutDriverChange'].map(name=>[name,0]));

test('producer counter ABI fails closed on missing or stale diagnostic exports',()=>{
    const good={producer_work_counters_version:()=>1,memory_pass_counters_version:()=>1,
        producer_work_counters_ptr(){},memory_pass_counters_ptr(){},reset_producer_work_counters(){},
        reset_memory_pass_counters(){},write_owned_driver_tagged(){}};
    assert.doesNotThrow(()=>assertProducerCounterABI(good));
    for(const name of Object.keys(good))assert.throws(()=>assertProducerCounterABI({...good,[name]:undefined}),
        /producer counters: ABI version\/exports mismatch/,name);
    assert.throws(()=>assertProducerCounterABI({...good,producer_work_counters_version:()=>2}),/version\/exports mismatch/);
});

const runCPU=async mode=>{
    const iterations=4,board=await createHarrisNativeMemoryBoard({enabled:true,rom:createHarrisStoreLoopROM(iterations),
        romLowAlias:true,wasmBytes,...mode});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();
    board.resetWorkCounters();board.resetProducerCounters();
    const run=await runHarrisTransactions({cpu,maxPeriods:iterations*32+100,batchPeriods:32,wallBudgetMS:1000});
    assert.equal(run.status,'halted');
    return {board,run,work:board.inspectWorkCounters(),diagnostic:board.inspectProducerCounters()};
};
const reconcile=({work,diagnostic})=>{
    const values=Object.values(diagnostic.producers);
    assert.equal(values.reduce((sum,value)=>sum+value.attempts,0)>>>0,work.driverComparisons);
    assert.equal(values.reduce((sum,value)=>sum+value.changes,0)>>>0,work.valueChangingDriverWrites);
};

test('cooperative producer labels reconcile with exact call-path dimensions in every settle mode',native,async()=>{
    for(const mode of [{},{admittedGraph:true},{admittedGraph:true,incrementalGraph:true}]){
        const receipt=await runCPU(mode),{board,run,diagnostic}=receipt;reconcile(receipt);
        const p=diagnostic.producers,memory=diagnostic.memory,incremental=mode.incrementalGraph===true;
        assert.deepEqual(p.other,{attempts:0,changes:0});
        assert.equal(p.busExternal.attempts,run.periods*10,'ten ideal external drivers are staged per physical period');
        assert.equal(p.busOutput.attempts,run.periods*48,'all 48 CPU bus outputs are staged per physical period');
        assert.equal(p.phaseLatch.attempts,run.periods*26,'the owned latch publishes 26 outputs per physical period');
        assert.equal(p.memoryBank.attempts,memory.presentBanks*8,'each present memory bank publishes eight output drivers');
        assert.ok(p.phaseController.attempts>=run.periods*3&&p.phaseController.attempts%3===0,
            'the memory-only controller publishes its three admitted outputs at active boundaries');
        assert.equal(p.phaseSchedule.attempts,0);assert.equal(p.fullScan.attempts===0,incremental);
        assert.equal(p.evaluator.attempts>0,incremental);
        assert.ok(memory.settleCalls>0);assert.ok(memory.passes>memory.settleCalls);
        assert.equal(memory.passes,memory.previewCalls);assert.equal(memory.previewBanks,memory.previewCalls*4);
        assert.equal(memory.postMemorySettles,memory.previewCalls);
        assert.ok(memory.presentBanks>0);assert.ok(memory.changedBanks>0);assert.ok(memory.changedBanks<memory.presentBanks);
        assert.ok(memory.postMemorySettlesWithoutDriverChange>0);
        assert.ok(memory.postMemorySettlesWithoutDriverChange<memory.postMemorySettles,
            'the fixture contains both output-changing and output-stable post-memory settles');
        const stableWork=board.inspectWorkCounters();board.resetProducerCounters();
        assert.deepEqual(board.inspectProducerCounters(),{producers:zeroProducers(),memory:zeroMemory()});
        assert.deepEqual(board.inspectWorkCounters(),stableWork,'diagnostic reset does not alter stable work counters');
    }
});

test('phase schedule has a positive isolated producer identity',native,async()=>{
    const scheduled=await createPhaseCircuitOracle({wasmBytes,schedule:true});
    const steps=[{values:{...scheduled.passive,reset:1}},{values:scheduled.passive}];
    scheduled.kernel.resetWorkCounters();scheduled.kernel.resetProducerCounters();
    const handle=scheduled.kernel.compileSchedule(steps);scheduled.kernel.runSchedule(handle);
    const receipt={work:scheduled.kernel.inspectWorkCounters(),diagnostic:scheduled.kernel.inspectProducerCounters()};reconcile(receipt);
    assert.equal(receipt.diagnostic.producers.phaseSchedule.attempts,handle.encodedUpdates);
    assert.ok(handle.encodedUpdates>0);assert.equal(receipt.diagnostic.producers.other.attempts,0);
});

test('faulted partial work stays observable and diagnostic reset cannot clear the circuit fault',native,async()=>{
    const board=await createHarrisNativeMemoryBoard({enabled:true,wasmBytes,admittedGraph:true,incrementalGraph:true,
        editWires:wires=>wires.filter(wire=>!(wire.from==='cpu'&&wire.fromTerminal==='d0'&&wire.to==='ram0'))});
    board.initialize();board.resetWorkCounters();board.resetProducerCounters();
    board.submit({kind:'memory-write',address:0,value:0x12});
    assert.throws(()=>board.runUntilCompletion({maxPeriods:32}),{code:'FLOATING'});
    const receipt={work:board.inspectWorkCounters(),diagnostic:board.inspectProducerCounters()};reconcile(receipt);
    assert.ok(receipt.work.driverComparisons>0);assert.ok(receipt.diagnostic.memory.previewCalls>0);
    const lifecycle=board.inspectLifecycle();assert.equal(lifecycle.faulted,true);
    board.resetProducerCounters();assert.deepEqual(board.inspectProducerCounters(),{producers:zeroProducers(),memory:zeroMemory()});
    assert.deepEqual(board.inspectLifecycle(),lifecycle,'diagnostic reset cannot clear or rebind faulted execution state');
});

test('producer counter ABI rejects stale modules and tagged writes validate before counting',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports;
    assert.equal(e.producer_work_counters_version(),1);assert.equal(e.memory_pass_counters_version(),1);
    e.reset_producer_work_counters();
    const base=e.arena_ptr(),view=new DataView(e.memory.buffer),driver=base+256,
        counters=new Uint32Array(e.memory.buffer,e.producer_work_counters_ptr(),18),
        stable=new Uint32Array(e.memory.buffer,e.incremental_work_counters_ptr(),12);
    view.setUint32(base+4,1,true);view.setUint32(base+4*4,driver,true);view.setUint32(base+31*4,0,true);
    new Uint8Array(e.memory.buffer,driver,1)[0]=0;
    const before=Array.from(counters);assert.equal(e.write_owned_driver_tagged(base,0,0,9),3);
    assert.deepEqual(Array.from(counters),before,
        'an invalid producer tag is refused before diagnostic mutation');
    counters[0]=0xffffffff;counters[9]=0xffffffff;
    assert.equal(e.write_owned_driver_tagged(base,0,1,0),0);
    assert.deepEqual([counters[0],counters[9]],[0,0],'attempt and change counters wrap independently modulo 2^32');
    e.reset_producer_work_counters();e.reset_incremental_work_counters();
    assert.equal(e.write_owned_driver_tagged(base,1,0,0),1);assert.equal(e.write_owned_driver_tagged(base,0,4,0),2);
    assert.deepEqual(Array.from(counters),new Array(18).fill(0));assert.deepEqual(Array.from(stable),new Array(12).fill(0));
    assert.equal(new Uint8Array(e.memory.buffer,driver,1)[0],1,'invalid ID/code cannot mutate the driver');
    assert.equal(e.write_owned_driver(base,0,0),0,'the legacy writer is classified as other');
    assert.deepEqual([counters[0],counters[9],stable[0],stable[1]],[1,1,1,1]);
});
