/** Isolated owned phase components. No complete clock runner or 82C288 claim. */
import {CircuitFault} from '../digital-circuit.js';
export const PHASE_INPUTS=Object.freeze(['reset','ready_n','s1_n','s0_n','cod_inta_n','m_io']);
export const LATCH_INPUTS=Object.freeze(['ale',...Array.from({length:24},(_,i)=>`a${i}`),'bhe_n','m_io']);
const KINDS=[null,'memory-read','memory-write','code-read','io-read','io-write','interrupt-acknowledge','shutdown','reserved','passive'];
export async function createNativePhaseComponents({enabled=false,ioEnabled=false,intrEnabled=false,wasmBytes}={}) {
    if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
    if(typeof ioEnabled!=='boolean'||typeof intrEnabled!=='boolean')throw new TypeError('ioEnabled/intrEnabled');
    if(!(wasmBytes instanceof Uint8Array))throw new TypeError('owned Wasm bytes required');
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports;
    if(e.phase_components_version?.()!==1)throw new TypeError('rebuild native phase components: ABI version mismatch');
    const base=e.arena_ptr(),p={state:base,inputs:base+24,conflicts:base+52,outputs:base+80,fault:base+108,
        ready:base+116,present:base+120,latch:base+124,latchOut:base+152};
    if(base<0||e.arena_capacity()<180||base+180>e.memory.buffer.byteLength)throw new RangeError('native phase arena capacity');
    const bytes=(name,n)=>new Uint8Array(e.memory.buffer,p[name],n),view=new DataView(e.memory.buffer);
    view.setUint32(p.state+4,1,true);bytes('latch',26).fill(2);
    const input=(levels,conflicts,pins)=>{
        if(!(levels instanceof Uint8Array)||levels.length!==pins.length||!(conflicts instanceof Uint8Array)||conflicts.length!==pins.length)throw new TypeError('phase input dimensions');
        for(let i=0;i<levels.length;i++)if(levels[i]>3||conflicts[i]>1||(conflicts[i]&&levels[i]!==2))throw new CircuitFault('INVALID_DRIVER_LEVEL',pins[i]);
        bytes('inputs',levels.length).set(levels);bytes('conflicts',levels.length).set(conflicts);
    };
    const check=(result,pins)=>{
        if(!result)return;
        const slot=view.getUint32(p.fault+4,true),code=({1:'FLOATING',2:'UNKNOWN',3:'CONTENTION',4:'INVALID_DRIVER_LEVEL',
            5:'INVALID_PHASE_STATE',6:'CLOCK_ORDER',7:'UNSUPPORTED_COMMAND',8:'STATUS_SEQUENCE',9:'PHASE_COUNTER_OVERFLOW'})[result];
        const error=new CircuitFault(code??'NATIVE_PHASE_ERROR',result===7||result===8?KINDS[slot]:pins[slot]??'owned phase component');
        if(result<=4)error.pin=pins[slot];throw error;
    };
    const outputs=()=>{
        const o=bytes('outputs',7);
        return {ale:o[0],mrd_n:o[1],mwr_n:o[2],...(ioEnabled?{ior_n:o[3],iow_n:o[4]}:{}),...(intrEnabled?{inta_n:o[5],inta_wait:o[6]}:{})};
    };
    const inspect=()=>{
        const word=i=>view.getUint32(p.state+i*4,true);
        return {state:['TI','TS','TC'][word(0)],phase:word(1),open:!!word(2),tcCount:word(4)*4294967296+word(3),kind:KINDS[word(5)]};
    };
    const phaseConflicts=new Uint8Array(6),latchConflicts=new Uint8Array(27);
    const beginClock=(levels,conflicts=phaseConflicts)=>{
        input(levels,conflicts,PHASE_INPUTS);check(e.begin_memory_phase(p.state,Number(ioEnabled),Number(intrEnabled),p.inputs,p.conflicts,p.outputs,p.fault),PHASE_INPUTS);
        return outputs();
    };
    const previewEnd=(levels,conflicts=phaseConflicts)=>{
        input(levels,conflicts,PHASE_INPUTS);check(e.preview_memory_phase_end(p.state,p.inputs,p.conflicts,p.ready,p.fault),PHASE_INPUTS);
        const ready=view.getUint32(p.ready,true);
        return {ready:ready===0xffffffff?null:ready,finish:()=>{
            check(e.finish_memory_phase(p.state,ready,p.outputs,p.present,p.fault),PHASE_INPUTS);
            return bytes('present',1)[0]?outputs():null;
        }};
    };
    const commands=()=>{e.read_memory_phase_commands(p.state,p.outputs);return outputs();};
    const updateLatch=(levels,conflicts=latchConflicts)=>{
        input(levels,conflicts,LATCH_INPUTS);check(e.update_address_latch(p.latch,p.inputs,p.conflicts,p.latchOut,p.fault),LATCH_INPUTS);
        return bytes('latchOut',26).slice();
    };
    return Object.freeze({capabilities:Object.freeze({experimental:true,idealAddressLatch:true,memoryPhaseController:true,
        full82C288:false,cpu:false,board:false,resumableSnapshot:false}),beginClock,previewEnd,commands,inspect,updateLatch,
        inspectLatch:()=>bytes('latch',26).slice()});
}
