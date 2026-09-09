import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DigitalCircuit} from '../src/experimental/digital-circuit.js';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {getDevice} from '../src/devices.js';
import {DigitalBusMemoryAdapter,settleBusMemories} from '../src/experimental/latched-memory-components.js';
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
for(const memoryScheduling of [false,true])test(`compiled wired memory transactions retain every sampled bus output, READY wait and write (scheduled=${memoryScheduling})`,()=>{
    const [ref,fast]=['reference','compiled'].map(netBackend=>createHarrisMemoryBoard({enabled:true,netBackend,memoryScheduling:netBackend==='compiled'&&memoryScheduling,ramBytes:131072,textRAM:true}));
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
    for(const netBackend of ['reference','compiled'])for(const memoryScheduling of netBackend==='compiled'?[false,true]:[false]) {
        const board=createHarrisMemoryBoard({enabled:true,netBackend,memoryScheduling,editWires:w=>w.filter(x=>!(x.to==='cpu'&&x.toTerminal==='ready_n'))});
        board.initialize();board.submit({kind:'memory-read',address:0x500,width:1});
        assert.throws(()=>{for(let i=0;i<20;i++)board.clock();},{code:'FLOATING'});
    }
});

test('compiled watchers report only published logic/conflict changes and validate all pins',()=>{
    const net=new CompiledDigitalCircuit({enabled:true,parts:['a','b'].map(id=>({id,pins:['p','q'],outputs:['p']})),wires:[wire('a','b')]});
    const watch=net.bind('a').watch(['p']);assert.equal(watch(),true);assert.equal(watch(),false);
    assert.throws(()=>net.bind('a').watch(['p','bad']),/unknown terminal/);
    net.drive('a',{p:'X'});net.resolve();assert.equal(watch(),false);net.settle();assert.equal(watch(),true);
    net.drive('a',{p:0});net.drive('b',{p:1});net.settle();assert.equal(watch(),true); // X -> conflicting X
    net.drive('a',{p:0});net.settle();assert.equal(watch(),false);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,memoryScheduling:true}),/compiled/);
});

test('scheduled memory skips stable idle, settles write edges, and invalidates custom update replacement',()=>{
    const model={...getDevice('62256')};
    const memory=new DigitalBusMemoryAdapter({enabled:true,id:'ram',kind:'62256',model});
    const pins=memory.part().pins;
    const net=new CompiledDigitalCircuit({enabled:true,parts:[memory.part(),{id:'source',pins,outputs:pins}],
        wires:pins.map(pin=>({from:'source',fromTerminal:pin,to:'ram',toTerminal:pin}))});
    const binding=memory.scheduledBinding(net.bind('ram'));
    let previews=0;const preview=memory.preview.bind(memory);memory.preview=read=>{previews++;return preview(read);};
    const drive=values=>{net.drive('source',values);settleBusMemories(net,[memory],8,[binding]);};
    drive(Object.fromEntries(pins.map(p=>[p,['vcc','csb','oeb','web','d0'].includes(p)?1:0])));
    const initial=previews;drive({});drive({a0:1});assert.equal(previews,initial);
    drive({csb:0,web:0});drive({});assert.equal(memory.inspect().writes,0);
    drive({web:1});assert.equal(memory.inspect().writes,1);assert.equal(memory.inspect().bytes[1],1);
    const done=previews;drive({});assert.equal(previews,done);
    model.update=(...args)=>model.eventDrivenUpdate(...args);
    drive({});assert.equal(previews,done+1);
    assert.throws(()=>drive({vcc:'Z'}),{code:'FLOATING'}); // idle power still checked
});

test('reverse evaluator scheduling preserves part order, deduplicates and recovers after a throw',()=>{
    for(const Circuit of [DigitalCircuit,CompiledDigitalCircuit]) {
        const calls=[];let fail=false;
        const net=new Circuit({enabled:true,parts:[{id:'in',pins:['p','q'],outputs:['p','q']},
            ...['first','second','unrelated'].map(id=>({id,pins:['p','q','out'],outputs:['out'],evaluate:r=>{
                calls.push(id);if(fail&&id==='first')throw new Error('probe');return {out:r('p')};
            }}))],wires:['first','second'].flatMap(id=>['p','q'].map(pin=>({from:'in',fromTerminal:pin,to:id,toTerminal:pin})))});
        net.drive('in',{q:0,p:0});net.settle();calls.length=0;
        net.drive('in',{q:1,p:1});net.settle();
        assert.deepEqual(calls,['first','second','first','second']); // output feedback requires the second delta
        calls.length=0;fail=true;net.drive('in',{p:0});assert.throws(()=>net.settle(),/probe/);
        fail=false;net.drive('in',{p:1});net.settle();
        assert.deepEqual(calls,['first','first','second']);
    }
});
