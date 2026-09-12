/** Explicit owned bank descriptors plus actual-net wiring, not a board backend. */
import {CircuitFault,DigitalCircuit} from '../digital-circuit.js';
import {CompiledDigitalCircuit} from '../compiled-digital-circuit.js';
import {captureKernelEvaluatorImage,EVALUATOR_STRIDE} from './evaluator-image.js';
import {validateWiredNetImage} from './net-resolver.js';
import {MEMORY_BANK_PINS} from './memory-banks.js';
import {preparePhaseCircuit} from './phase-circuit-image.js';
const SIZE=32768,WORDS=9;
const WORK_COUNTERS=['driverComparisons','valueChangingDriverWrites','dirtyNetResolutions','netDriverVisits','evaluatorRows','dependencyProbes',
    'stagedDriverCopies','committedEvaluatorOutputs','publishNetCopies','deltas'];
export async function createNativeMemoryCircuit({enabled=false,circuit,banks,wasmBytes,phase=null,admittedGraph=false,incrementalGraph=false}={}) {
    captureKernelEvaluatorImage({enabled,circuit});
    if(typeof admittedGraph!=='boolean')throw new TypeError('admittedGraph');
    if(typeof incrementalGraph!=='boolean'||incrementalGraph&&!admittedGraph)throw new TypeError('incrementalGraph requires admittedGraph:true');
    const prototype=circuit instanceof CompiledDigitalCircuit?CompiledDigitalCircuit.prototype:DigitalCircuit.prototype;
    if(circuit.resolve!==prototype.resolve||circuit.settle!==prototype.settle)throw new CircuitFault('UNSUPPORTED_KERNEL_OVERRIDE','custom resolution/settling');
    if(!Array.isArray(banks)||banks.length<1||banks.length>32)throw new RangeError('native banks 1..32');
    // Descriptors explicitly choose the owned native model. No JS model/state
    // import is accepted, and a part name alone never selects its semantics.
    const descriptors=banks.map(({id,kind,contents=new Uint8Array(),readOnly=false,model,state})=>{
        if(model!==undefined||state!==undefined)throw new TypeError('live/custom memory model import unsupported');
        if(!['62256','28c256'].includes(kind))throw new TypeError('owned 62256/28c256 descriptor required');
        if(typeof id!=='string'||!id||typeof readOnly!=='boolean')throw new TypeError('bank id/readOnly');
        if(!(contents instanceof Uint8Array)||contents.length>SIZE)throw new RangeError('bank contents');
        const part=circuit.parts.get(id),pins=MEMORY_BANK_PINS.map(p=>p==='select'?(kind==='62256'?'csb':'ceb'):p);
        if(!part||part.evaluate||part.pins.length!==pins.length||!pins.every(p=>part.pins.includes(p))||part.outputs.length!==8||
            !Array.from({length:8},(_,i)=>`d${i}`).every(p=>part.outputs.includes(p)))throw new TypeError('exact memory pin/output contract required');
        return {id,kind,readOnly,contents:contents.slice(),pins};
    });
    if(new Set(descriptors.map(b=>b.id)).size!==banks.length)throw new TypeError('duplicate bank id');
    if(!(wasmBytes instanceof Uint8Array))throw new TypeError('owned Wasm bytes required');
    circuit.settle();
    const image=captureKernelEvaluatorImage({enabled,circuit}),{nets,drivers}=validateWiredNetImage(image);
    const phaseBinding=phase===null?null:preparePhaseCircuit({circuit,image,phase});
    if(!Number.isInteger(image.maxDeltas)||image.maxDeltas<1||image.maxDeltas>1024)throw new RangeError('native maxDeltas 1..1024');
    const terminals=new Map(image.terminals.map(t=>[t.name,t]));
    const inputNets=Uint32Array.from(descriptors.flatMap(b=>b.pins.map(pin=>terminals.get(`${b.id}.${pin}`).net)));
    const outputIds=Uint32Array.from(descriptors.flatMap(b=>Array.from({length:8},(_,i)=>terminals.get(`${b.id}.d${i}`).driver)));
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports;
    if(e.memory_circuit_version?.()!==2||e.memory_kernel_version?.()!==1||e.owned_kernel_version?.()!==1)throw new TypeError('rebuild native memory circuit: ABI version mismatch');
    if(incrementalGraph&&e.incremental_kernel_version?.()!==1)throw new TypeError('rebuild native incremental kernel: ABI version mismatch');
    if(e.incremental_work_counters_version?.()!==1)throw new TypeError('rebuild native work counters: ABI version mismatch');
    const start=e.arena_ptr(),capacity=e.arena_capacity(),p={},count=descriptors.length;let end=start;
    const reserve=(name,size)=>{end=Math.ceil(end/4)*4;p[name]=end;end+=size;};
    for(const [name,array] of [['offsets',image.netOffsets],['ids',image.netDriverIds],['ops',image.operations],
        ['dependencyOffsets',image.dependencyOffsets],['dependencies',image.dependencies],['inputNets',inputNets],['outputIds',outputIds]])reserve(name,array.byteLength);
    for(const name of ['drivers','staged'])reserve(name,drivers);
    for(const name of ['live','liveConflicts','published','publishedConflicts','previous','changed'])reserve(name,nets);
    reserve('memory',count*SIZE);reserve('states',count*WORDS*4);reserve('memoryStaged',count*WORDS*4);reserve('protected',count);
    reserve('inputs',count*28);reserve('conflicts',count*28);reserve('drives',count*8);reserve('present',count);reserve('memoryChanged',count);
    reserve('memoryFault',12);reserve('fault',16);reserve('context',32*4);
    phaseBinding?.reserve(reserve);
    if(!Number.isSafeInteger(end)||start<0||end-start>capacity||end>e.memory.buffer.byteLength)throw new RangeError('native memory circuit arena capacity');
    const view=new DataView(e.memory.buffer),bytes=(name,length)=>new Uint8Array(e.memory.buffer,p[name],length);
    const put=(name,array)=>array.forEach((v,i)=>view.setUint32(p[name]+4*i,v,true));
    for(const [name,array] of [['offsets',image.netOffsets],['ids',image.netDriverIds],['ops',image.operations],
        ['dependencyOffsets',image.dependencyOffsets],['dependencies',image.dependencies],['inputNets',inputNets],['outputIds',outputIds]])put(name,array);
    bytes('drivers',drivers).set(image.driverLevels);bytes('previous',nets).set(image.resolvedLevels);
    bytes('published',nets).set(image.resolvedLevels);bytes('publishedConflicts',nets).set(image.resolvedConflicts);
    descriptors.forEach((b,i)=>{
        const storage=new Uint8Array(e.memory.buffer,p.memory+i*SIZE,SIZE);storage.fill(b.kind==='28c256'?255:0);storage.set(b.contents);
        view.setUint32(p.states+(i*WORDS+2)*4,0xffffffff,true);bytes('protected',count)[i]=Number(b.kind==='28c256'&&b.readOnly);
    });
    put('context',[nets,drivers,p.offsets,p.ids,p.drivers,p.live,p.liveConflicts,image.operations.length/EVALUATOR_STRIDE,p.ops,p.staged,
        p.published,p.publishedConflicts,image.maxDeltas,p.dependencyOffsets,p.dependencies,image.dependencies.length,p.previous,p.changed,
        count,p.memory,p.states,p.memoryStaged,p.protected,p.inputs,p.conflicts,p.drives,p.present,p.memoryChanged,p.memoryFault,p.inputNets,p.outputIds,incrementalGraph?2:Number(admittedGraph)]);
    if(admittedGraph&&(e.admit_owned_context(p.context)>>>0)!==0)throw new CircuitFault('INVALID_KERNEL_ADMISSION','private graph admission failed');
    const inspect=()=>({levels:bytes('published',nets).slice(),conflicts:bytes('publishedConflicts',nets).slice(),driverLevels:bytes('drivers',drivers).slice()});
    let hostValueChangingDriverWrites=0;
    const inspectWorkCounters=()=>{
        const values=new Uint32Array(e.memory.buffer,e.incremental_work_counters_ptr(),WORK_COUNTERS.length);
        return Object.freeze(Object.fromEntries(WORK_COUNTERS.map((name,i)=>[name,(values[i]+(i===1?hostValueChangingDriverWrites:0))>>>0])));
    };
    const resetWorkCounters=()=>{hostValueChangingDriverWrites=0;e.reset_incremental_work_counters();};
    const inspectMemory=bank=>{
        if(!Number.isInteger(bank)||bank<0||bank>=count)throw new RangeError('bank index');
        const word=w=>view.getUint32(p.states+(bank*WORDS+w)*4,true),out=word(2);
        return {bytes:new Uint8Array(e.memory.buffer,p.memory+bank*SIZE,SIZE).slice(),cycle:['','idle','read','write'][word(0)],
            addr:word(1),out:out===0xffffffff?-1:out,armed:!!word(3),pending:word(4)?{a:word(5),byte:word(6)}:null,
            writes:word(8)*4294967296+word(7)};
    };
    const setDriverLevels=levels=>{
        if(levels!==undefined){
            if(!(levels instanceof Uint8Array)||levels.length!==drivers)throw new TypeError('driver dimensions');
            for(const code of levels)if(code>3)throw new CircuitFault('INVALID_DRIVER_LEVEL','four-state driver code required');
            const current=bytes('drivers',drivers);for(let i=0;i<drivers;i++)if(current[i]!==levels[i])hostValueChangingDriverWrites++;
            current.set(levels);
        }
    };
    const memoryFault=result=>{
        if(result){
            const code=view.getUint32(p.fault+4,true),bank=view.getUint32(p.fault+8,true),pin=view.getUint32(p.fault+12,true);
            const name=result===1?({1:'INVALID_NET_IMAGE',2:'INVALID_DRIVER_LEVEL',3:'NON_CONVERGENT',4:'INVALID_KERNEL_OPERATION',5:'INVALID_DELTA_LIMIT',6:'INVALID_KERNEL_ADMISSION'}[code]):
                result===2?({1:'FLOATING',2:'UNKNOWN',3:'CONTENTION',4:'MEMORY_POWER',5:'INVALID_DRIVER_LEVEL',6:'INVALID_MEMORY_STATE',7:'MEMORY_COUNTER_OVERFLOW'}[code]):
                result===3?'MEMORY_NON_CONVERGENT':'INVALID_MEMORY_MAPPING';
            const fault=new CircuitFault(name??'NATIVE_MEMORY_CIRCUIT_ERROR','owned native memory settling failed');
            if(result===2){fault.bank=descriptors[bank]?.id;fault.pin=descriptors[bank]?.pins[pin]??null;}throw fault;
        }
    };
    const settleMemories=(levels,maxPasses=8)=>{
        if(!Number.isInteger(maxPasses)||maxPasses<1||maxPasses>1024)throw new RangeError('maxPasses 1..1024');
        setDriverLevels(levels);memoryFault(e.settle_memory_circuit(p.context,maxPasses,p.fault));return inspect();
    };
    const phaseMethods=phaseBinding?.initialize({e,p,put,inspect,setDriverLevels,memoryFault});
    return Object.freeze({capabilities:Object.freeze({experimental:true,netResolution:true,combinationalEvaluation:true,digitalMemoryBanks:true,
        latchedMemoryClocks:!!phaseBinding,admittedGraph,incrementalGraph,cpu:false,board:false,resumableSnapshot:false}),...(phaseMethods??{settleMemories}),
        inspect,inspectMemory,inspectWorkCounters,resetWorkCounters});
}
