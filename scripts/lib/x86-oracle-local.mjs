import {I8086} from '../../src/i8086.js';
import {HarrisBootCPU} from '../../src/experimental/harris-80c286-boot-cpu.js';
import {probeInitial} from './x86-owned-oracle-probes.mjs';

export function localProbe(model,probe) {
    if(!probe.models.includes(model))throw new Error('probe/model unsupported');
    const {regs,ram}=probeInitial(probe),memory=new Uint8Array(1<<20);
    for(const [a,v] of ram)memory[a]=v;
    if(model!=='80286') {
        const cpu=new I8086({read:a=>memory[a],write:(a,v)=>{memory[a]=v;},
            in(){throw new Error('oracle probe I/O unsupported');},out(){throw new Error('oracle probe I/O unsupported');}},
            {variant:model});
        cpu.reset();for(const [r,v] of Object.entries(regs))cpu[r]=v;
        cpu.step();
        return {registers:Object.fromEntries(Object.keys(regs).map(r=>[r,cpu[r]&65535])),memory};
    }
    // Architectural adapter only, deliberately NOT physical-board acceptance.
    const cpu=new HarrisBootCPU({enabled:true,coprocessor:'inactive-lines',
        board:{semanticTestAdapter:true,initialize(){},submit(){},clock(){}}});
    cpu.regs=Object.fromEntries(['ax','bx','cx','dx','sp','bp','si','di'].map(r=>[r,regs[r]]));
    for(const r of ['cs','ds','ss','es','ip','flags'])cpu[r]=regs[r];
    cpu.csBase=cpu.cs*16;cpu.msw=0xfff0;cpu.status='running';
    const iterator=cpu._instructions();let response,done=false;
    for(let transfers=0;transfers<4096;transfers++) {
        const next=iterator.next(response);
        if(cpu.retired===1){done=true;break;}
        if(next.done)throw new Error('unexpected instruction termination');
        const {kind,address,width,value}=next.value;
        if(address<0||address+width>memory.length)throw new Error('probe memory window exceeded');
        if(kind==='code-read'||kind==='memory-read')response=memory[address]|(width===2?memory[address+1]<<8:0);
        else if(kind==='memory-write') {for(let i=0;i<width;i++)memory[address+i]=(value>>>(i*8))&255;response=undefined;}
        else throw new Error(`probe transfer unsupported: ${kind}`);
    }
    if(!done)throw new Error('probe transfer budget exhausted');
    return {registers:{...cpu.regs,...Object.fromEntries(['cs','ds','ss','es','ip','flags'].map(r=>[r,cpu[r]&65535]))},memory};
}
