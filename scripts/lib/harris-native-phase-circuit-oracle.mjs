/** Test-only actual-net latched-memory clock oracle; no CPU/peripheral clock. */
import {registerBusMemory} from '../../src/devices/bus-memory.js';
import {getDevice} from '../../src/devices.js';
import {DigitalCircuit,CircuitFault,bitPins,bitDrives} from '../../src/experimental/digital-circuit.js';
import {MemoryPhaseController,IdealAddressLatch,DigitalBusMemoryAdapter,settleBusMemories} from '../../src/experimental/latched-memory-components.js';
import {createHarrisMemoryDecoder} from '../../src/experimental/wired-kernel/evaluator-contract.js';
import {captureWiredNetImage} from '../../src/experimental/wired-net-image.js';
import {createNativeMemoryCircuit} from '../../src/experimental/wired-kernel/memory-circuit.js';
import {HARRIS_80C286_STATUS} from '../../src/experimental/harris-80c286-contract.js';
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const wire=(from,fromTerminal,to,toTerminal=fromTerminal)=>({from,fromTerminal,to,toTerminal});
export async function createPhaseCircuitOracle({wasmBytes,Circuit=DigitalCircuit,editWires=w=>w}={}) {
    registerBusMemory();
    const banks=[{id:'low',kind:'62256'},{id:'high',kind:'62256'}];
    const refs=banks.map(b=>new DigitalBusMemoryAdapter({enabled:true,...b,model:getDevice(b.kind),writeJournal:true}));
    const controller=new MemoryPhaseController({enabled:true,id:'controller',ioEnabled:true,intrEnabled:true}),latch=new IdealAddressLatch({enabled:true,id:'latch'});
    const A=bitPins('a',24),D=bitPins('d',16),status=['s1_n','s0_n','cod_inta_n','m_io'];
    const pins=[...A,...D,...status,'vcc','gnd','reset','ready_n','bhe_n'];
    const parts=[{id:'host',pins,outputs:pins},controller.part(),latch.part(),...refs.map(r=>r.part()),
        ...banks.map((_,lane)=>createHarrisMemoryDecoder({id:`decode${lane}`,lane,start:0,end:65536}))];
    const wires=[...['reset','ready_n',...status].map(p=>wire('host',p,'controller')),
        ...[...A,'bhe_n','m_io'].map(p=>wire('host',p,'latch')),wire('controller','ale','latch')];
    for(let b=0;b<2;b++) {
        for(const p of [...A,'bhe_n','m_io'])wires.push(wire('latch',`q_${p}`,`decode${b}`,p));
        for(const p of ['vcc','gnd'])wires.push(wire('host',p,banks[b].id));
        for(let bit=0;bit<15;bit++)wires.push(wire('latch',`q_a${bit+1}`,banks[b].id,`a${bit}`));
        for(let bit=0;bit<8;bit++)wires.push(wire('host',`d${b*8+bit}`,banks[b].id,`d${bit}`));
        wires.push(wire(`decode${b}`,'ce_n',banks[b].id,'csb'),wire('controller','mrd_n',banks[b].id,'oeb'),wire('controller','mwr_n',banks[b].id,'web'));
    }
    const circuit=new Circuit({enabled:true,parts,wires:editWires(wires)});
    const passive={reset:0,ready_n:0,s1_n:1,s0_n:1,cod_inta_n:0,m_io:0};
    circuit.drive('host',{...passive,...bitDrives(A,0),...Object.fromEntries(D.map(p=>[p,'Z'])),vcc:1,gnd:0,bhe_n:0});
    circuit.drive('controller',controller.commands());circuit.drive('latch',latch.values);
    const kernel=await createNativeMemoryCircuit({enabled:true,circuit,banks,wasmBytes,
        phase:{kind:'owned-latched-memory-v1',controller:'controller',latch:'latch',ioEnabled:true,intrEnabled:true}});
    let periodOpen=false,faulted=false,comparisons=0,faults=0;
    const capture=()=>captureWiredNetImage({enabled:true,circuit});
    const check=(ok,detail)=>{if(!ok)throw new Error(`native phase circuit ${detail} at boundary ${comparisons}`);};
    const call=(method,values={})=>{
        if(method==='beginClock')circuit.drive('host',values);
        let actual,error,aerror,ready=null;
        try{actual=method==='beginClock'?kernel.beginClock(capture().driverLevels):kernel.endClock();}catch(e){aerror=e;}
        try{
            if(faulted)throw new CircuitFault('BOARD_FAULTED','oracle board faulted');
            if(method==='beginClock') {
                if(periodOpen)throw new CircuitFault('CLOCK_ORDER','endClock required');
                try{
                    circuit.settle();circuit.drive('controller',controller.beginClock(p=>circuit.require('controller',p)));circuit.settle();
                    circuit.drive('latch',latch.update(p=>circuit.require('latch',p)));settleBusMemories(circuit,refs);periodOpen=true;
                }catch(e){faulted=true;throw e;}
            }else {
                if(!periodOpen)throw new CircuitFault('CLOCK_ORDER','beginClock required');
                periodOpen=false;
                try{
                    const preview=controller.previewEnd(p=>circuit.require('controller',p));ready=preview.ready;
                    const commands=preview.finish();if(commands){circuit.drive('controller',commands);circuit.settle();settleBusMemories(circuit,refs);}
                }catch(e){faulted=true;throw e;}
            }
        }catch(e){error=e;}
        comparisons++;check(aerror?.code===error?.code,`fault mismatch ${aerror?.code}/${error?.code}`);if(error)faults++;
        const a=kernel.inspect(),b=capture();
        check(same(a.levels,b.resolvedLevels)&&same(a.conflicts,b.resolvedConflicts)&&same(a.driverLevels,b.driverLevels),'net/driver mismatch');
        const phase=kernel.inspectPhase(),expected={state:controller.state,phase:controller.phase,open:controller.open,tcCount:controller.tcCount,
            kind:controller.kind,periodOpen,faulted};const {latch:latched,...observed}=phase;
        check(JSON.stringify(observed)===JSON.stringify(expected),'phase state mismatch');
        check(latched.every((v,i)=>v===(latch.values[`q_${latch.signals[i]}`]==='X'?2:latch.values[`q_${latch.signals[i]}`])),'latch mismatch');
        refs.forEach((ref,i)=>{
            const m=kernel.inspectMemory(i),s=ref.state;
            check(same(m.bytes,s.mem)&&m.writes===ref.writes&&m.cycle===s._cycle&&m.addr===s.addr&&m.out===s._out&&m.armed===s._armed&&
                JSON.stringify(m.pending)===JSON.stringify(s._pending),'memory mismatch');
        });
        if(!error&&method==='endClock')check(actual.ready===ready,'sampled READY mismatch');
        return aerror;
    };
    const period=values=>{const error=call('beginClock',values);return error??call('endClock');};
    return {circuit,kernel,controller,latch,refs,A,D,passive,call,period,report:()=>({comparisons,faults})};
}
export async function runNativePhaseCircuitOracle({wasmBytes,yieldTask=()=>Promise.resolve(),stopped=()=>false}={}) {
    const f=await createPhaseCircuitOracle({wasmBytes});f.period({...f.passive,reset:1});f.period(f.passive);
    let transactions=0;
    for(let sample=0;sample<64;sample++) {
        if(stopped())throw new Error('native phase circuit oracle cancelled');
        const address=sample*254,value=(sample*977)&65535,waits=sample%3;
        for(const kind of ['memory-write','memory-read']) {
            const active={...f.passive,...HARRIS_80C286_STATUS[kind],...bitDrives(f.A,address),bhe_n:0,
                ...(kind==='memory-write'?bitDrives(f.D,value):Object.fromEntries(f.D.map(p=>[p,'Z'])))};
            f.period(active);f.period(active);
            for(let i=0;i<2*(waits+1);i++) {
                // The address bus can change after ALE closes; storage must not follow it.
                f.call('beginClock',{...f.passive,...bitDrives(f.A,0xab00),ready_n:Number(i<2*waits)});
                if(kind==='memory-read') {
                    const observed=f.D.reduce((v,p,i)=>v|(f.circuit.require('host',p)<<i),0);
                    if(observed!==value)throw new Error('latched memory read mismatch');
                }
                f.call('endClock');
            }
            transactions++;
        }
        if(sample%4===0)await yieldTask();
    }
    return {accepted:true,...f.report(),transactions,capacityClaim:false,
        scope:'actual-net ideal controller/latch/memory clock boundaries; CPU bus and peripheral clocks not ported'};
}
