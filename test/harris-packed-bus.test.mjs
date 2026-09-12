import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Harris80C286Bus} from '../src/experimental/harris-80c286-bus.js';
import {DigitalCircuit,bitPins,bitDrives} from '../src/experimental/digital-circuit.js';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
registerBusMemory();
const D=bitPins('d',16),inputs=['reset','ready_n','hold','intr','nmi','pereq','busy_n','error_n'];
function fixture(packedDrives) {
    const bus=new Harris80C286Bus({enabled:true,packedDrives,intrEnabled:true,nmiEnabled:true,holdEnabled:true,traceLimit:1024});
    const pins=[...inputs,...D],net=new DigitalCircuit({enabled:true,parts:[bus.part(),{id:'peer',pins,outputs:pins}],
        wires:pins.map(pin=>({from:'peer',fromTerminal:pin,to:'cpu',toTerminal:pin}))});
    net.drive('peer',{reset:0,ready_n:0,hold:0,intr:0,nmi:0,pereq:0,busy_n:1,error_n:1,...Object.fromEntries(D.map(p=>[p,'Z']))});
    return {bus,clock(values={}){net.drive('peer',values);net.settle();net.drive('cpu',bus.beginClock(p=>net.require('cpu',p)));net.settle();return bus.endClock(p=>net.require('cpu',p));}};
}
test('packed bus preserves complete traces through odd writes, waits, HOLD, INTA, NMI and reset',()=>{
    const ref=fixture(false),fast=fixture(true);
    const clock=(values={})=>{const a=ref.clock(values),b=fast.clock(values);assert.deepEqual(b,a);assert.deepEqual(fast.bus.outputs,ref.bus.outputs);return a;};
    for(let i=0;i<17;i++)clock({reset:1});for(let i=0;i<50;i++)clock({reset:0});
    const run=(transaction,values)=>{
        ref.bus.submit(transaction);fast.bus.submit(transaction);let done=false;
        for(let i=0;i<64;i++)if(clock(values(i))?.last){done=true;break;}
        assert.ok(done);assert.deepEqual(fast.bus.getTrace(),ref.bus.getTrace());
    };
    run({kind:'memory-write',address:0x501,width:2,value:0xbeef},i=>({ready_n:Number(i<8)}));
    run({kind:'memory-read',address:0x500,width:2},i=>({hold:Number(i<4),...bitDrives(D,0x1234)}));
    run({kind:'interrupt-acknowledge'},()=>({ready_n:Number(ref.bus.pending.index===1&&ref.bus.pending.waits===0),...bitDrives(D,0x27)}));
    for(let i=0;i<4;i++)clock({nmi:0});for(let i=0;i<4;i++)clock({nmi:1});
    assert.equal(fast.bus.nmiPending,true);assert.equal(ref.bus.nmiPending,true);
    clock({reset:1});assert.throws(()=>ref.clock({reset:0}),{code:'SHORT_RESET'});assert.throws(()=>fast.clock({reset:0}),{code:'SHORT_RESET'});
    assert.deepEqual(fast.bus.getTrace(),ref.bus.getTrace());
});
test('packed vectors retain four-state resolution, whole-vector validation and edited shorts',()=>{
    const options={enabled:true,parts:[{id:'a',pins:['p','q','r'],outputs:['p','q','r']}],wires:[{from:'a',fromTerminal:'p',to:'a',toTerminal:'q'}]};
    const ref=new DigitalCircuit(options),fast=new CompiledDigitalCircuit(options),drive=fast.bind('a').vectorDriver(['p','q','r']);
    for(let sample=0;sample<64;sample++) {
        let value=0,z=0,x=0;const values={};
        for(let i=0;i<3;i++){const level=(sample>>>(i*2))&3;values[['p','q','r'][i]]=[0,1,'X','Z'][level];if(level===1)value|=1<<i;if(level===2)x|=1<<i;if(level===3)z|=1<<i;}
        ref.drive('a',values);drive(value,z,x);ref.settle();fast.settle();assert.deepEqual(fast.snapshot,ref.snapshot);
    }
    const before=fast.drives;assert.throws(()=>drive(8),RangeError);assert.throws(()=>drive(0,1,1),RangeError);assert.deepEqual(fast.drives,before);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,packedBus:true}),/compiled/);
});

test('packed board cannot bypass disconnected READY or a missing RAM write-data pin',()=>{
    for(const [part,pin] of [['cpu','ready_n'],['ram1','d0']]) {
        const board=createHarrisMemoryBoard({enabled:true,netBackend:'compiled',packedBus:true,memoryScheduling:true,
            editWires:wires=>wires.filter(w=>!(w.to===part&&w.toTerminal===pin))});
        board.initialize();board.submit({kind:'memory-write',address:0x500,width:2,value:0x1234});
        assert.throws(()=>{for(let i=0;i<20;i++)board.clock();},{code:'FLOATING'});
        assert.equal(board.inspectMemory('ram0').writes,0);assert.equal(board.inspectMemory('ram1').writes,0);
    }
});
