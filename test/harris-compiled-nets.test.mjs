import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DigitalCircuit} from '../src/experimental/digital-circuit.js';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
registerBusMemory();
const wire=(from,to)=>({from,fromTerminal:'p',to,toTerminal:'p'});
const pair=options=>[new DigitalCircuit({enabled:true,...options}),new CompiledDigitalCircuit({enabled:true,...options})];
test('compiled net gate and board backend selection are explicit',()=>{
    assert.throws(()=>new CompiledDigitalCircuit({parts:[]}),{code:'EXPERIMENT_DISABLED'});
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,netBackend:'typo'}),/netBackend/);
    assert.equal(createHarrisMemoryBoard({enabled:true}).capabilities.netBackend,'reference');
});
test('indexed nets match reference for all three-driver logic combinations and wire orderings',()=>{
    for(const reverse of [false,true]) {
        const parts=['a','B','c','in'].map(id=>({id,pins:['p','q'],outputs:id==='in'?[]:['p']}));
        const wires=[wire('a','B'),wire('B','c'),wire('c','in')];
        const [ref,fast]=pair({parts:reverse?parts.reverse():parts,wires:reverse?wires.reverse():wires});
        for(const a of [0,1,'X','Z'])for(const b of [0,1,'X','Z'])for(const c of [0,1,'X','Z']) {
            for(const net of [ref,fast]){net.drive('a',{p:a});net.drive('B',{p:b});net.drive('c',{p:c});}
            assert.deepEqual(fast.resolve(),ref.resolve());assert.equal(fast.settle(),ref.settle());
            assert.deepEqual(fast.snapshot,ref.snapshot);assert.deepEqual(fast.drives,ref.drives);
            assert.deepEqual(fast.inspect('in','P'),ref.inspect('in','P'));
        }
    }
});
test('compiled deltas preserve simultaneous evaluation, omission release and settled diagnostics',()=>{
    const [ref,fast]=pair({parts:[{id:'in',pins:['p'],outputs:['p']},
        {id:'gate',pins:['p','q'],outputs:['q'],evaluate:r=>r('p')==='Z'?{}:{q:r('p')}},
        {id:'sink',pins:['p','q'],outputs:['q'],evaluate:r=>({q:r('p')})}],
        wires:[wire('in','gate'),{from:'gate',fromTerminal:'q',to:'sink',toTerminal:'p'}]});
    for(const value of [1,0,'X','Z',1]) {
        ref.drive('in',{p:value});fast.drive('in',{p:value});
        assert.deepEqual(fast.resolve(),ref.resolve());assert.deepEqual(fast.snapshot,ref.snapshot);
        assert.equal(fast.settle(),ref.settle());assert.deepEqual(fast.snapshot,ref.snapshot);
        const copy=fast.inspect('in','p');copy.drivers.length=0;copy.value='bad';
        assert.deepEqual(fast.inspect('in','p'),ref.inspect('in','p'));
    }
});
test('compiled batches remain atomic with case aliases and bound readers use settled values',()=>{
    const [ref,fast]=pair({parts:[{id:'a',pins:['P','q'],outputs:['P','q']}]});
    const bound=fast.bind('a');assert.equal(bound,fast.bind('a'));
    for(const net of [ref,fast]){net.drive('a',{P:1,q:0});net.settle();}
    for(const net of [ref,fast])assert.throws(()=>net.drive('a',{P:0,q:'bad'}),/invalid logic level/);
    bound.drive({p:0,P:1,q:0});assert.equal(bound.require('P'),1);
    assert.equal(fast.settle(),0);assert.deepEqual(fast.snapshot,ref.snapshot);
    assert.throws(()=>bound.read('missing'),/unknown terminal/);
});
test('compiled nonconvergence preserves published state and permits recovery',()=>{
    const [ref,fast]=pair({maxDeltas:4,parts:[{id:'in',pins:['p'],outputs:['p']},
        {id:'gate',pins:['p','q'],outputs:['q'],evaluate:r=>({q:r('p')===1?(r('q')===1?0:1):0})}],wires:[wire('in','gate')]});
    for(const net of [ref,fast]){net.drive('in',{p:1});assert.throws(()=>net.settle(),{code:'NON_CONVERGENT'});}
    assert.deepEqual(fast.snapshot,ref.snapshot);
    for(const net of [ref,fast]){net.drive('in',{p:0});net.settle();}
    assert.deepEqual(fast.snapshot,ref.snapshot);
});
test('compiled wired memory transactions retain every sampled bus output, READY wait and write',()=>{
    const [ref,fast]=['reference','compiled'].map(netBackend=>createHarrisMemoryBoard({enabled:true,netBackend,ramBytes:131072,textRAM:true}));
    ref.initialize();fast.initialize();
    for(const address of [0x501,0xffff,0x10000,0xb8001])for(const kind of ['memory-write','memory-read']) {
        const transaction={kind,address,width:2,value:kind==='memory-write'?0xbeef:0};ref.submit(transaction);fast.submit(transaction);
        let done=false;
        for(let i=0;i<32;i++) {
            const input={ready_n:Number(i<8)},a=ref.clock(input),b=fast.clock(input);
            assert.deepEqual(b,a);assert.deepEqual(fast.bus.outputs,ref.bus.outputs);
            assert.deepEqual(fast.circuit.snapshot,ref.circuit.snapshot);
            if(a?.last){done=true;break;}
        }
        assert.ok(done);assert.deepEqual(fast.bus.getTrace(),ref.bus.getTrace());
    }
    for(const id of ['ram0','ram1','ram1_0','ram1_1','text0','text1'])assert.deepEqual(fast.inspectMemory(id),ref.inspectMemory(id));
});
test('compiled missing READY wiring retains the named floating fault',()=>{
    for(const netBackend of ['reference','compiled']) {
        const board=createHarrisMemoryBoard({enabled:true,netBackend,editWires:w=>w.filter(x=>!(x.to==='cpu'&&x.toTerminal==='ready_n'))});
        board.initialize();board.submit({kind:'memory-read',address:0x500,width:1});
        assert.throws(()=>{for(let i=0;i<20;i++)board.clock();},{code:'FLOATING'});
    }
});
