/** Owned portable same-instance bus/phase/registered-memory reference fixture. */
import {registerBusMemory} from '../../src/devices/bus-memory.js';
import {getDevice} from '../../src/devices.js';
import {DigitalCircuit,CircuitFault,bitPins} from '../../src/experimental/digital-circuit.js';
import {Harris80C286Bus} from '../../src/experimental/harris-80c286-bus.js';
import {MemoryPhaseController,IdealAddressLatch,DigitalBusMemoryAdapter,settleBusMemories} from '../../src/experimental/latched-memory-components.js';
import {createHarrisMemoryDecoder} from '../../src/experimental/wired-kernel/evaluator-contract.js';
import {captureWiredNetImage} from '../../src/experimental/wired-net-image.js';
import {createNativeMemoryCircuit} from '../../src/experimental/wired-kernel/memory-circuit.js';
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const canonical=v=>ArrayBuffer.isView(v)?Array.from(v):Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b,label)=>{if(JSON.stringify(canonical(a))!==JSON.stringify(canonical(b)))throw new Error(`${label}: ${JSON.stringify(canonical(a))} != ${JSON.stringify(canonical(b))}`);};
const wire=(from,fromTerminal,to,toTerminal=fromTerminal)=>({from,fromTerminal,to,toTerminal});
export async function createBusCircuitOracle({wasmBytes,editWires=w=>w,editParts=p=>p,descriptor={},admittedGraph=false,incrementalGraph=false,maxWaitStates=1024}={}) {
    registerBusMemory();const bus=new Harris80C286Bus({enabled:true,traceEnabled:false,maxWaitStates});
    const banks=[{id:'low',kind:'62256'},{id:'high',kind:'62256'}];
    const refs=banks.map(b=>new DigitalBusMemoryAdapter({enabled:true,...b,model:getDevice(b.kind),writeJournal:true}));
    const controller=new MemoryPhaseController({enabled:true,id:'controller'}),latch=new IdealAddressLatch({enabled:true,id:'latch'});
    const A=bitPins('a',24),D=bitPins('d',16),status=['s1_n','s0_n','cod_inta_n','m_io'];
    const inputPins=['reset','ready_n','cpu_ready','hold','pereq','intr','nmi','busy_n','error_n','vcc','gnd',...D];
    const parts=[bus.part('cpu'),{id:'host',pins:inputPins,outputs:inputPins},controller.part(),latch.part(),...refs.map(r=>r.part()),
        ...banks.map((_,lane)=>createHarrisMemoryDecoder({id:`decode${lane}`,lane,start:0,end:65536}))];
    const wires=[...['reset','ready_n'].map(p=>wire('host',p,'controller')),
        ...['reset','ready_n','hold','pereq','intr','nmi','busy_n','error_n'].map(p=>wire('host',p,'cpu')),
        ...status.map(p=>wire('cpu',p,'controller')),...[...A,'bhe_n','m_io'].map(p=>wire('cpu',p,'latch')),
        wire('controller','ale','latch'),...D.map(p=>wire('host',p,'cpu'))];
    for(let lane=0;lane<2;lane++) {
        for(const p of [...A,'bhe_n','m_io'])wires.push(wire('latch',`q_${p}`,`decode${lane}`,p));
        for(const p of ['vcc','gnd'])wires.push(wire('host',p,banks[lane].id));
        for(let bit=0;bit<15;bit++)wires.push(wire('latch',`q_a${bit+1}`,banks[lane].id,`a${bit}`));
        for(let bit=0;bit<8;bit++)wires.push(wire('cpu',`d${lane*8+bit}`,banks[lane].id,`d${bit}`));
        wires.push(wire(`decode${lane}`,'ce_n',banks[lane].id,'csb'),wire('controller','mrd_n',banks[lane].id,'oeb'),wire('controller','mwr_n',banks[lane].id,'web'));
    }
    const circuit=new DigitalCircuit({enabled:true,parts:editParts(parts),wires:editWires(wires)});
    const passive={reset:0,ready_n:0,cpu_ready:0,hold:0,pereq:0,intr:0,nmi:0,busy_n:1,error_n:1,vcc:1,gnd:0,
        ...Object.fromEntries(D.map(p=>[p,'Z']))};
    circuit.drive('host',passive);circuit.drive('controller',controller.commands());circuit.drive('latch',latch.values);
    const kernel=await createNativeMemoryCircuit({enabled:true,circuit,banks,wasmBytes,admittedGraph,incrementalGraph,
        phase:{kind:'owned-latched-memory-v1',controller:'controller',latch:'latch'},
        bus:{kind:'owned-286-memory-bus-v1',cpu:'cpu',inputPart:'host',maxWaitStates,...descriptor}});
    let open=false,faulted=false,boundaries=0;
    const capture=()=>captureWiredNetImage({enabled:true,circuit});
    const check=()=>{
        const actual=kernel.inspect(),expected=capture();
        if(!same(actual.levels,expected.resolvedLevels)||!same(actual.conflicts,expected.resolvedConflicts)||!same(actual.driverLevels,expected.driverLevels))
            throw new Error(`bus circuit nets differ at ${boundaries}`);
        const {state,phase,open:busOpen,faulted:busFaulted,clock,resetClocks,initClocks,writeHold,address,pending}=bus;
        equal(kernel.inspectBus(),{state,phase,open:busOpen,faulted:busFaulted,clock,resetClocks,initClocks,writeHold,address,
            pending:pending?{index:pending.index,waits:pending.waits,bytes:pending.bytes,transferCount:pending.transfers.length}:null},'bus state');
        equal(kernel.inspectLifecycle(),{periodOpen:open,faulted},'board lifecycle');
        const {latch:latched,...p}=kernel.inspectPhase();
        equal(p,{state:controller.state,phase:controller.phase,open:controller.open,tcCount:controller.tcCount,kind:controller.kind,periodOpen:open,faulted},'controller state');
        equal(Array.from(latched),latch.signals.map(p=>latch.values[`q_${p}`]==='X'?2:latch.values[`q_${p}`]),'latch');
        refs.forEach((r,i)=>{
            const m=kernel.inspectMemory(i),s=r.state;
            if(!same(m.bytes,s.mem))throw new Error(`memory ${i} bytes differ`);
            const {bytes,...rest}=m;equal(rest,{cycle:s._cycle,addr:s.addr,out:s._out,armed:s._armed,pending:s._pending,writes:r.writes},'memory state');
        });
    };
    const referenceCall=(method,values={})=>{
        if(faulted)throw new CircuitFault('BOARD_FAULTED','reference fixture faulted');
        if(method==='beginClock') {
            if(open)throw new CircuitFault('CLOCK_ORDER','endClock required');
            try{
                circuit.drive('host',values);circuit.settle();
                circuit.drive('cpu',bus.beginClock(p=>circuit.require('cpu',p)));circuit.settle();
                circuit.drive('controller',controller.beginClock(p=>circuit.require('controller',p)));circuit.settle();
                circuit.drive('latch',latch.update(p=>circuit.require('latch',p)));settleBusMemories(circuit,refs);open=true;
            }catch(error){faulted=true;throw error;}
            return null;
        }
        if(!open)throw new CircuitFault('CLOCK_ORDER','beginClock required');open=false;
        try{
            const preview=controller.previewEnd(p=>circuit.require('controller',p));
            if(preview.ready!==null&&preview.ready!==circuit.require('cpu','ready_n'))throw new CircuitFault('READY_MISMATCH','CPU/controller READY differ');
            const result=bus.endClock(p=>circuit.require('cpu',p));
            const commands=preview.finish();if(commands){circuit.drive('controller',commands);circuit.settle();settleBusMemories(circuit,refs);}
            return result;
        }catch(error){faulted=true;throw error;}
    };
    const call=(method,values={})=>{
        let actual,expected,aerror,error;
        try{actual=kernel[method](values);}catch(e){aerror=e;}
        try{expected=referenceCall(method,values);}catch(e){error=e;}
        boundaries++;equal(aerror?.code??null,error?.code??null,`${method} error`);
        if(!error&&method==='endClock')equal(actual,expected,'completion');check();return {value:actual,error:aerror};
    };
    const period=values=>{const begin=call('beginClock',values);return begin.error?begin:call('endClock');};
    const initialize=()=>{for(let i=0;i<67;i++){const r=period({reset:Number(i<17)});if(r.error)throw r.error;}};
    const submit=transaction=>{bus.submit(transaction);kernel.submit(transaction);check();};
    const runUntilCompletion=options=>{
        const actual=kernel.runUntilCompletion(options);let periods=0;const completions=[];
        for(;periods<options.maxPeriods;) {
            referenceCall('beginClock',options.inputs);const result=referenceCall('endClock');periods++;boundaries+=2;
            if(result){completions.push(result);if(result.last)break;}
        }
        const completed=!!completions.at(-1)?.last;
        const expected={completed,stopReason:completed?'completed':'budget',periods,completions};equal(actual,expected,'bounded run');check();return actual;
    };
    return {kernel,circuit,controller,latch,bus,refs,passive,check,call,period,initialize,submit,runUntilCompletion,report:()=>({boundaries})};
}

export async function runNativeBusCircuitOracle(options) {
    const f=await createBusCircuitOracle(options);f.initialize();let transactions=0,completions=0;
    for(let sample=0;sample<16;sample++)for(const kind of ['memory-write','memory-read','code-read']) {
        const address=sample*17,width=sample%3===0?1:2,value=width===1?sample*11:sample*977;
        f.submit({kind,address,width,value});
        for(let bound=0;f.kernel.inspectBus().pending;bound++) {
            if(bound>=20)throw new Error('fixture transaction budget');
            const r=f.period({ready_n:Number(bound<4)});if(r.error)throw r.error;if(r.value)completions++;
        }
        transactions++;
    }
    return {accepted:true,...f.report(),transactions,completions,capacityClaim:false};
}
