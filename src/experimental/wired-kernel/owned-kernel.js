/** Native owned combinational prototype. Not a CPU/stateful board backend. */
import {CircuitFault} from '../digital-circuit.js';
import {captureKernelEvaluatorImage,EVALUATOR_STRIDE} from './evaluator-image.js';
import {validateWiredNetImage} from './net-resolver.js';
import {DigitalCircuit} from '../digital-circuit.js';
import {CompiledDigitalCircuit} from '../compiled-digital-circuit.js';
export async function createNativeOwnedKernel({enabled=false,circuit,wasmBytes}={}) {
    captureKernelEvaluatorImage({enabled,circuit}); // Refuse unknown evaluators before running any of them.
    const prototype=circuit instanceof CompiledDigitalCircuit?CompiledDigitalCircuit.prototype:DigitalCircuit.prototype;
    if(circuit.resolve!==prototype.resolve||circuit.settle!==prototype.settle)throw new CircuitFault('UNSUPPORTED_KERNEL_OVERRIDE','custom resolution/settling');
    circuit.settle(); // The prototype compiles from a canonical settled pure-logic boundary.
    const image=captureKernelEvaluatorImage({enabled,circuit});
    if(!(wasmBytes instanceof Uint8Array))throw new TypeError('owned Wasm bytes required');
    const {nets,drivers}=validateWiredNetImage(image),maxDeltas=image.maxDeltas;
    if(!Number.isInteger(maxDeltas)||maxDeltas<1||maxDeltas>1024)throw new RangeError('native maxDeltas 1..1024');
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports;
    if(e.owned_kernel_version?.()!==1)throw new TypeError('rebuild owned native kernel: ABI version mismatch');
    const start=e.arena_ptr(),capacity=e.arena_capacity(),p={};let end=start;
    const reserve=(name,bytes)=>{end=Math.ceil(end/4)*4;p[name]=end;end+=bytes;};
    reserve('offsets',(nets+1)*4);reserve('ids',drivers*4);reserve('ops',image.operations.byteLength);
    reserve('dependencyOffsets',image.dependencyOffsets.byteLength);reserve('dependencies',image.dependencies.byteLength);
    reserve('drivers',drivers);reserve('live',nets);reserve('liveConflicts',nets);reserve('staged',drivers);
    reserve('published',nets);reserve('publishedConflicts',nets);
    reserve('previous',nets);reserve('changed',nets);
    if(!Number.isSafeInteger(end)||start<0||end-start>capacity||end>e.memory.buffer.byteLength)throw new RangeError('native kernel arena capacity');
    const view=new DataView(e.memory.buffer);
    for(const [name,array] of [['offsets',image.netOffsets],['ids',image.netDriverIds],['ops',image.operations],['dependencyOffsets',image.dependencyOffsets],['dependencies',image.dependencies]])
        for(let i=0;i<array.length;i++)view.setUint32(p[name]+4*i,array[i],true);
    const bytes=(name,length)=>new Uint8Array(e.memory.buffer,p[name],length);
    bytes('previous',nets).set(image.resolvedLevels);
    const inspect=()=>({levels:bytes('published',nets).slice(),conflicts:bytes('publishedConflicts',nets).slice()});
    const settle=levels=>{
        if(levels!==undefined){
            if(!(levels instanceof Uint8Array)||levels.length!==drivers)throw new TypeError('driver dimensions');
            for(const code of levels)if(code>3)throw new CircuitFault('INVALID_DRIVER_LEVEL','four-state code required before input mutation');
            bytes('drivers',drivers).set(levels);
        }
        const result=e.settle_owned(nets,drivers,p.offsets,p.ids,p.drivers,p.live,p.liveConflicts,
            image.operations.length/EVALUATOR_STRIDE,p.ops,p.staged,p.published,p.publishedConflicts,maxDeltas,
            p.dependencyOffsets,p.dependencies,image.dependencies.length,p.previous,p.changed)>>>0;
        if(result&0x80000000) {
            const codes={1:'INVALID_NET_IMAGE',2:'INVALID_DRIVER_LEVEL',3:'NON_CONVERGENT',4:'INVALID_KERNEL_OPERATION',5:'INVALID_DELTA_LIMIT'};
            throw new CircuitFault(codes[result&0x7fffffff]??'NATIVE_KERNEL_ERROR','owned native settling failed; published state unchanged');
        }
        return {delta:result-1,...inspect(),driverLevels:bytes('drivers',drivers).slice()};
    };
    settle(image.driverLevels);
    return Object.freeze({capabilities:Object.freeze({experimental:true,netResolution:true,combinationalEvaluation:true,
        statefulDevices:false,cpu:false,board:false}),settle,inspect});
}
