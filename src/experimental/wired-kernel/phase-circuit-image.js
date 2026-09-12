/** Private actual-net bindings for the explicit owned latched-memory model. */
import {CircuitFault} from '../digital-circuit.js';
import {PHASE_INPUTS,LATCH_INPUTS} from './phase-components.js';
import {preparePhaseSchedule} from './phase-schedule.js';
const OUTPUTS=['ale','mrd_n','mwr_n','ior_n','iow_n','inta_n','inta_wait'];
const KINDS=[null,'memory-read','memory-write','code-read','io-read','io-write','interrupt-acknowledge','shutdown','reserved','passive'];
export function preparePhaseCircuit({circuit,image,phase}) {
    if(phase?.kind!=='owned-latched-memory-v1')throw new TypeError('explicit owned latched-memory descriptor required');
    const {controller,latch,ioEnabled=false,intrEnabled=false}=phase;
    if(typeof controller!=='string'||typeof latch!=='string'||controller===latch||typeof ioEnabled!=='boolean'||typeof intrEnabled!=='boolean')throw new TypeError('phase descriptor');
    const activeOutputs=OUTPUTS.filter((_,i)=>i<3||(i<5?ioEnabled:intrEnabled)),latchOutputs=LATCH_INPUTS.slice(1).map(p=>`q_${p}`);
    for(const [id,pins,outputs] of [[controller,[...PHASE_INPUTS,...activeOutputs],activeOutputs],[latch,[...LATCH_INPUTS,...latchOutputs],latchOutputs]]) {
        const part=circuit.parts.get(id);
        if(!part||part.evaluate||part.pins.length!==pins.length||!pins.every(p=>part.pins.includes(p))||part.outputs.length!==outputs.length||
            !outputs.every(p=>part.outputs.includes(p)))throw new TypeError('exact owned phase pin/output contract required');
    }
    const terminals=new Map(image.terminals.map(t=>[t.name,t]));
    const mapping=(id,pins,field)=>Uint32Array.from(pins,p=>terminals.get(`${id}.${p}`)?.[field]??0xffffffff);
    const maps={phaseInputNets:mapping(controller,PHASE_INPUTS,'net'),phaseOutputIds:mapping(controller,OUTPUTS,'driver'),
        latchInputNets:mapping(latch,LATCH_INPUTS,'net'),latchOutputIds:mapping(latch,latchOutputs,'driver')};
    const schedule=preparePhaseSchedule({circuit,image,phase});
    return {
        reserve(reserve){
            for(const [name,array] of Object.entries(maps))reserve(name,array.byteLength);
            reserve('phaseState',24);reserve('latchValues',26);reserve('phaseInputs',27);reserve('phaseConflicts',27);reserve('phaseOutputs',27);
            reserve('phaseFault',8);reserve('phaseReady',4);reserve('phasePresent',1);reserve('phaseLifecycle',8);reserve('phaseContext',64);
            schedule?.reserve(reserve);
        },
        initialize({e,p,put,inspect,setDriverLevels,memoryFault}) {
            if(e.phase_circuit_version?.()!==1||e.phase_components_version?.()!==1)throw new TypeError('rebuild native phase circuit: ABI version mismatch');
            for(const [name,array] of Object.entries(maps))put(name,array);
            const v=new DataView(e.memory.buffer),word=(name,i=0)=>v.getUint32(p[name]+4*i,true);
            v.setUint32(p.phaseState+4,1,true);new Uint8Array(e.memory.buffer,p.latchValues,26).fill(2);
            put('phaseContext',[p.context,p.phaseState,Number(ioEnabled),Number(intrEnabled),p.phaseInputNets,p.phaseOutputIds,p.latchInputNets,
                p.latchOutputIds,p.latchValues,p.phaseInputs,p.phaseConflicts,p.phaseOutputs,p.phaseFault,p.phaseReady,p.phasePresent,p.phaseLifecycle]);
            const fault=result=>{
                if(result<5)return memoryFault(result);
                const code=word('fault',1),component=word('fault',2),slot=word('fault',3);
                if(result===6)throw new CircuitFault(code===1?'BOARD_FAULTED':'CLOCK_ORDER','owned latched-memory clock order');
                const name=({1:'FLOATING',2:'UNKNOWN',3:'CONTENTION',4:'INVALID_DRIVER_LEVEL',5:'INVALID_PHASE_STATE',6:'CLOCK_ORDER',
                    7:'UNSUPPORTED_COMMAND',8:'STATUS_SEQUENCE',9:'PHASE_COUNTER_OVERFLOW'})[code];
                const pin=(component===0?PHASE_INPUTS:LATCH_INPUTS)[slot],part=component===0?controller:latch;
                const error=new CircuitFault(name??'NATIVE_PHASE_ERROR',code===7||code===8?KINDS[slot]:`${part}.${pin??'phase'}`);
                if(code<=4){error.part=part;error.pin=pin;}throw error;
            };
            const beginClock=levels=>{
                if(word('phaseLifecycle',1))throw new CircuitFault('BOARD_FAULTED','reconstruct native latched-memory circuit');
                if(word('phaseLifecycle'))throw new CircuitFault('CLOCK_ORDER','endClock required');
                setDriverLevels(levels);const result=e.begin_latched_memory_clock(p.phaseContext,p.fault);if(result)fault(result);return inspect();
            };
            const endClock=()=>{
                const result=e.end_latched_memory_clock(p.phaseContext,p.fault);if(result)fault(result);
                const ready=word('phaseReady');return {ready:ready===0xffffffff?null:ready,...inspect()};
            };
            const inspectPhase=()=>({state:['TI','TS','TC'][word('phaseState')],phase:word('phaseState',1),open:!!word('phaseState',2),
                tcCount:word('phaseState',4)*4294967296+word('phaseState',3),kind:KINDS[word('phaseState',5)],
                periodOpen:!!word('phaseLifecycle'),faulted:!!word('phaseLifecycle',1),latch:new Uint8Array(e.memory.buffer,p.latchValues,26).slice()});
            return {beginClock,endClock,inspectPhase,...schedule?.initialize({e,p,put,inspect,fault})};
        }
    };
}
