/** Isolated owned digital memory-bank port. Not a board or analog backend. */
import {CircuitFault} from '../digital-circuit.js';
export const MEMORY_BANK_PINS=Object.freeze(['vcc','gnd','oeb','web','select',
    ...Array.from({length:15},(_,i)=>`a${i}`),...Array.from({length:8},(_,i)=>`d${i}`)]);
const SIZE=32768,WORDS=9;
export async function createNativeMemoryBanks({enabled=false,banks,wasmBytes}={}) {
    if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
    if(!Array.isArray(banks)||banks.length<1||banks.length>32)throw new RangeError('native banks 1..32');
    const descriptors=banks.map(({id,kind,contents=new Uint8Array(),readOnly=false},i)=>{
        if(!['62256','28c256'].includes(kind))throw new TypeError('owned 62256/28c256 bank required');
        if(typeof readOnly!=='boolean')throw new TypeError('readOnly');
        if(!(contents instanceof Uint8Array)||contents.length>SIZE)throw new RangeError('bank contents');
        id??=`bank${i}`;if(typeof id!=='string'||!id)throw new TypeError('bank id');
        return {id,kind,readOnly,contents:contents.slice()};
    });
    if(new Set(descriptors.map(b=>b.id)).size!==banks.length)throw new TypeError('duplicate bank id');
    if(!(wasmBytes instanceof Uint8Array))throw new TypeError('owned Wasm bytes required');
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports;
    if(e.memory_kernel_version?.()!==1)throw new TypeError('rebuild native memory kernel: ABI version mismatch');
    const count=descriptors.length,start=e.arena_ptr(),capacity=e.arena_capacity(),p={};let end=start;
    const reserve=(name,size)=>{end=Math.ceil(end/4)*4;p[name]=end;end+=size;};
    reserve('memory',count*SIZE);reserve('states',count*WORDS*4);reserve('staged',count*WORDS*4);reserve('protected',count);
    reserve('inputs',count*28);reserve('conflicts',count*28);reserve('drives',count*8);reserve('present',count);reserve('changed',count);reserve('fault',12);
    if(!Number.isSafeInteger(end)||start<0||end-start>capacity||end>e.memory.buffer.byteLength)throw new RangeError('native memory arena capacity');
    const bytes=(name,length)=>new Uint8Array(e.memory.buffer,p[name],length),view=new DataView(e.memory.buffer);
    const pinName=(bank,pin)=>pin===4?(descriptors[bank]?.kind==='62256'?'csb':'ceb'):MEMORY_BANK_PINS[pin]??null;
    const error=(code,bank,pin)=>{
        const codes={1:'FLOATING',2:'UNKNOWN',3:'CONTENTION',4:'MEMORY_POWER',5:'INVALID_DRIVER_LEVEL',6:'INVALID_MEMORY_STATE',
            7:'MEMORY_COUNTER_OVERFLOW',8:'INVALID_BANK_COUNT',9:'INVALID_MEMORY_CONFIG'};
        const id=descriptors[bank]?.id??`bank${bank}`,name=pinName(bank,pin);
        const fault=new CircuitFault(codes[code]??'NATIVE_MEMORY_ERROR',`${id}${name?'.'+name:''}`);fault.bank=id;fault.pin=name;return fault;
    };
    descriptors.forEach((bank,i)=>{
        const memory=new Uint8Array(e.memory.buffer,p.memory+i*SIZE,SIZE);memory.fill(bank.kind==='28c256'?255:0);memory.set(bank.contents);
        view.setUint32(p.states+(i*WORDS+2)*4,0xffffffff,true);bytes('protected',count)[i]=Number(bank.kind==='28c256'&&bank.readOnly);
    });
    const noConflicts=new Uint8Array(count*28);
    const preview=(inputs,conflicts=noConflicts)=>{
        if(!(inputs instanceof Uint8Array)||inputs.length!==count*28||!(conflicts instanceof Uint8Array)||conflicts.length!==inputs.length)
            throw new TypeError('native memory pin dimensions');
        for(let i=0;i<inputs.length;i++)if(inputs[i]>3||conflicts[i]>1||conflicts[i]&&inputs[i]!==2)throw error(5,Math.floor(i/28),i%28);
        bytes('inputs',inputs.length).set(inputs);bytes('conflicts',conflicts.length).set(conflicts);
        const result=e.preview_memory_banks(count,p.memory,p.states,p.staged,p.protected,p.inputs,p.conflicts,p.drives,p.present,p.changed,p.fault);
        if(result)throw error(result,view.getUint32(p.fault+4,true),view.getUint32(p.fault+8,true));
        return descriptors.map((_,i)=>({changed:!!bytes('changed',count)[i],
            drives:bytes('present',count)[i]?new Uint8Array(e.memory.buffer,p.drives+i*8,8).slice():null}));
    };
    const inspect=bank=>{
        if(!Number.isInteger(bank)||bank<0||bank>=count)throw new RangeError('bank index');
        const word=w=>view.getUint32(p.states+(bank*WORDS+w)*4,true),out=word(2);
        return {bytes:new Uint8Array(e.memory.buffer,p.memory+bank*SIZE,SIZE).slice(),cycle:['','idle','read','write'][word(0)],
            addr:word(1),out:out===0xffffffff?-1:out,armed:!!word(3),pending:word(4)?{a:word(5),byte:word(6)}:null,
            writes:word(8)*4294967296+word(7),drives:Uint8Array.from({length:8},(_,i)=>out===0xffffffff?3:(out>>>i)&1)};
    };
    return Object.freeze({capabilities:Object.freeze({experimental:true,digitalMemoryBanks:true,analog:false,cpu:false,board:false,resumableSnapshot:false}),preview,inspect});
}
