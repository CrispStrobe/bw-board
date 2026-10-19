import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
registerBusMemory();
const make=driveLayouts=>new CompiledDigitalCircuit({enabled:true,driveLayouts,
    parts:[{id:'a',pins:['p','q','r','s','in'],outputs:['p','q','r','s']}],
    wires:[{from:'a',fromTerminal:'p',to:'a',toTerminal:'q'}]});
test('drive-layout gate is explicit and cached batches preserve four-state/partial/alias updates',()=>{
    assert.throws(()=>make('yes'),/driveLayouts/);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,driveLayouts:true}),/compiled/);
    const ref=make(false),fast=make(true);
    for(let n=0;n<1024;n++) {
        const values={};for(let i=0;i<4;i++)if(n&(1<<i))values[['p','q','r','s'][i]]=[0,1,'X','Z'][(n>>>(i+4))&3];
        if(n%7===0)values.P=1; // Case alias, same driver, original assignment order.
        for(const net of [ref,fast]){net.drive('a',values);net.settle();}
        assert.deepEqual(fast.drives,ref.drives);assert.deepEqual(fast.snapshot,ref.snapshot);
    }
});
test('cold and warm layouts preserve fault ordering and reject the whole invalid batch',()=>{
    const ref=make(false),fast=make(true);
    for(const values of [{p:1,q:0},{p:'bad',missing:0},{p:0,q:'bad'},{p:1,in:0},{p:1,q:0},{p:0,q:undefined},{P:0,p:'bad'}]) {
        const errors=[];
        for(const net of [ref,fast]){
            const before=net.drives;try{net.bind('a').drive(values);errors.push(null);}catch(e){errors.push(e.message);assert.deepEqual(net.drives,before);}
            net.settle();
        }
        assert.equal(errors[1],errors[0]);assert.deepEqual(fast.snapshot,ref.snapshot);assert.deepEqual(fast.drives,ref.drives);
    }
});
test('cold and warm reentrant getters cannot overwrite an active drive batch',()=>{
    const ref=make(false),fast=make(true);
    for(let round=0;round<3;round++) {
        for(const net of [ref,fast]) {
            const values={p:1,get q(){net.drive('a',{p:0,q:1});return 0;}};
            net.drive('a',values);net.settle();assert.equal(net.drives.get('a.p'),1);assert.equal(net.drives.get('a.q'),0);
        }
        assert.deepEqual(fast.snapshot,ref.snapshot);
    }
    for(const net of [ref,fast])assert.throws(()=>net.drive('a',{p:0,get q(){throw new Error('getter fault');}}),/getter fault/);
    assert.deepEqual(fast.drives,ref.drives);
});
test('drive layouts preserve every settled net and bus trace through odd writes and READY waits',()=>{
    const boards=[false,true].map(driveLayouts=>createHarrisMemoryBoard({enabled:true,netBackend:'compiled',
        memoryScheduling:true,packedBus:true,driveLayouts,ramBytes:131072,textRAM:true}));
    for(const board of boards)board.initialize();
    for(const address of [0x501,0xffff,0x10000,0xb8001])for(const kind of ['memory-write','memory-read']) {
        for(const board of boards)board.submit({kind,address,width:2,value:0xbeef});
        let complete=false;
        for(let clock=0;clock<32;clock++) {
            const result=boards.map(board=>board.clock({ready_n:Number(clock<8)}));
            assert.deepEqual(result[1],result[0]);assert.deepEqual(boards[1].circuit.snapshot,boards[0].circuit.snapshot);
            assert.deepEqual(boards[1].bus.getTrace(),boards[0].bus.getTrace());
            if(result[0]?.last){complete=true;break;}
        }
        assert.ok(complete);
    }
    for(const region of boards[0].memoryMap)for(const id of region.chips)assert.deepEqual(boards[1].inspectMemory(id),boards[0].inspectMemory(id));
});
test('drive layouts preserve late peer-bank failure before any word write commits',()=>{
    for(const driveLayouts of [false,true]) {
        const board=createHarrisMemoryBoard({enabled:true,netBackend:'compiled',memoryScheduling:true,packedBus:true,driveLayouts,
            editWires:wires=>wires.filter(w=>!(w.to==='ram1'&&w.toTerminal==='d0'))});
        board.initialize();board.submit({kind:'memory-write',address:0x500,width:2,value:0xbeef});
        assert.throws(()=>{for(let clock=0;clock<20;clock++)board.clock();},{code:'FLOATING'});
        assert.equal(board.inspectMemory('ram0').writes,0);assert.equal(board.inspectMemory('ram1').writes,0);
    }
});
