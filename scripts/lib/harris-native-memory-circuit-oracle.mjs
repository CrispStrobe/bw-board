/** Actual-net differential fixture for the coupled native memory loop. */
import {registerBusMemory} from '../../src/devices/bus-memory.js';
import {getDevice} from '../../src/devices.js';
import {DigitalCircuit,bitPins,bitDrives} from '../../src/experimental/digital-circuit.js';
import {DigitalBusMemoryAdapter,settleBusMemories} from '../../src/experimental/latched-memory-components.js';
import {createHarrisMemoryDecoder} from '../../src/experimental/wired-kernel/evaluator-contract.js';
import {captureWiredNetImage} from '../../src/experimental/wired-net-image.js';
import {createNativeMemoryCircuit} from '../../src/experimental/wired-kernel/memory-circuit.js';
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const wire=(from,fromTerminal,to,toTerminal=fromTerminal)=>({from,fromTerminal,to,toTerminal});
export async function createMemoryCircuitOracle({wasmBytes,Circuit=DigitalCircuit,swapAddress=false,shortLanes=false,readOnly=false,admittedGraph=false,incrementalGraph=false}={}) {
    registerBusMemory();
    const banks=[{id:'low',kind:'62256'},{id:'high',kind:'28c256',readOnly}];
    const refs=banks.map(b=>new DigitalBusMemoryAdapter({enabled:true,...b,model:getDevice(b.kind),writeJournal:true}));
    const A=bitPins('a',24),D=bitPins('d',16),pins=[...A,...D,'vcc','gnd','oeb','web','bhe_n','m_io','late_vcc'];
    const parts=[{id:'host',pins,outputs:pins},...refs.map(r=>r.part()),...banks.map((b,lane)=>createHarrisMemoryDecoder({id:`decode${lane}`,lane,start:0,end:65536}))];
    const wires=[];
    for(let b=0;b<2;b++) {
        for(const p of [...A,'bhe_n','m_io'])wires.push(wire('host',p,`decode${b}`));
        for(const p of ['vcc','gnd','oeb','web'])wires.push(wire('host',b===1&&p==='vcc'?'late_vcc':p,banks[b].id,p));
        for(let bit=0;bit<15;bit++)wires.push(wire('host',`a${1+(swapAddress?(bit===0?1:bit===1?0:bit):bit)}`,banks[b].id,`a${bit}`));
        for(let bit=0;bit<8;bit++)wires.push(wire('host',`d${b*8+bit}`,banks[b].id,`d${bit}`));
        wires.push(wire(`decode${b}`,'ce_n',banks[b].id,b===0?'csb':'ceb'));
    }
    if(shortLanes)wires.push(wire('low','d0','high','d0'));
    const circuit=new Circuit({enabled:true,parts,wires});
    circuit.drive('host',{...bitDrives(A,0),...Object.fromEntries(D.map(p=>[p,'Z'])),vcc:1,late_vcc:1,gnd:0,oeb:1,web:1,bhe_n:0,m_io:1});
    const kernel=await createNativeMemoryCircuit({enabled:true,circuit,banks,wasmBytes,admittedGraph,incrementalGraph});let comparisons=0,faults=0;
    const capture=()=>captureWiredNetImage({enabled:true,circuit});
    const check=(ok,detail)=>{if(!ok)throw new Error(`native memory circuit ${detail} at comparison ${comparisons}`);};
    const pass=(values={},maxPasses=8)=>{
        circuit.drive('host',values);let actualError,error;
        try{kernel.settleMemories(capture().driverLevels,maxPasses);}catch(e){actualError=e;}
        try{settleBusMemories(circuit,refs,maxPasses);}catch(e){error=e;}
        comparisons++;check(actualError?.code===error?.code,`fault mismatch ${actualError?.code}/${error?.code}`);if(error)faults++;
        const actual=kernel.inspect(),expected=capture();
        check(same(actual.levels,expected.resolvedLevels)&&same(actual.conflicts,expected.resolvedConflicts)&&same(actual.driverLevels,expected.driverLevels),'net/driver mismatch');
        refs.forEach((r,b)=>{
            const a=kernel.inspectMemory(b),s=r.state;
            check(same(a.bytes,s.mem),'storage mismatch');
            check(a.cycle===s._cycle&&a.addr===s.addr&&a.out===s._out&&a.armed===s._armed&&a.writes===r.writes&&
                JSON.stringify(a.pending)===JSON.stringify(s._pending),'state mismatch');
        });
        return actualError;
    };
    return {circuit,kernel,refs,pass,A,D,report:()=>({comparisons,faults})};
}
export async function runNativeMemoryCircuitOracle({wasmBytes,yieldTask=()=>Promise.resolve(),stopped=()=>false,swapAddress=false,admittedGraph=false,incrementalGraph=false}={}) {
    const f=await createMemoryCircuitOracle({wasmBytes,swapAddress,admittedGraph,incrementalGraph});f.pass();
    for(let byte=0;byte<256;byte++) {
        if(stopped())throw new Error('native memory circuit oracle cancelled');
        const address=(byte*254)&65534,value=byte|((255-byte)<<8);
        f.pass({...bitDrives(f.A,address),...bitDrives(f.D,value),oeb:1,web:0,bhe_n:0});
        if(byte===127){if(f.pass({web:1,late_vcc:'Z'})?.code!=='FLOATING')throw new Error('late-peer fault absent');}
        f.pass({web:1,late_vcc:1});
        f.pass({...Object.fromEntries(f.D.map(p=>[p,'Z'])),oeb:0});
        const decoded=Array.from({length:16},(_,i)=>f.circuit.require('host',`d${i}`)).reduce((v,b,i)=>v|(b<<i),0);
        if(decoded!==value)throw new Error('wired read byte lanes disagree');
        f.pass({oeb:1});
        if(byte%8===0)await yieldTask();
    }
    return {accepted:true,...f.report(),byteValues:256,swapAddress,capacityClaim:false,
        scope:'coupled owned net/combinational/memory fixed-point loop; no native CPU or board clock'};
}
