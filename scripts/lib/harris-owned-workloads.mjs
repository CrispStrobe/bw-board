/** Owned, media-free programs for full-board performance/correctness workloads. */
import assert from 'node:assert/strict';
import {assembleRaw} from '../../src/i8086-asm.js';
import {createHarrisBootROM} from '../../src/experimental/harris-boot-rom.js';
import {createHarrisMemoryBoard} from '../../src/experimental/harris-80c286-memory-board.js';
import {HarrisBootCPU} from '../../src/experimental/harris-80c286-boot-cpu.js';
import {Harris8259Adapter} from '../../src/experimental/harris-8259-adapter.js';
import {Harris8254Adapter} from '../../src/experimental/harris-8254-adapter.js';
import {HarrisFDCAdapter} from '../../src/experimental/harris-fdc-adapter.js';
import {HarrisDMAAdapter} from '../../src/experimental/harris-dma-adapter.js';
import {HarrisKeyboardAdapter} from '../../src/experimental/harris-keyboard-adapter.js';
import {registerBusMemory} from '../../src/devices/bus-memory.js';

export const ownedWorkloads=Object.freeze(['memory','io','dma','interrupt','idle']);
const out=(port,values)=>`MOV DX,${port}\n`+values.map(v=>`MOV AL,${v}\nOUT DX,AL`).join('\n')+'\n';
export function createOwnedWorkload(name,{netBackend='reference',memoryScheduling=false,memoryWriteJournal=false,decoderSpecialization=false,busTraceEnabled=false}={}) {
    if(!ownedWorkloads.includes(name))throw new RangeError('owned workload');
    registerBusMemory();
    const pic=new Harris8259Adapter({enabled:true}),timer=new Harris8254Adapter({enabled:true});
    const fdc=new HarrisFDCAdapter({enabled:true,transferEnabled:true}),dma=new HarrisDMAAdapter({enabled:true,transferEnabled:true});
    const keyboard=new HarrisKeyboardAdapter({enabled:true});
    const sector=Uint8Array.from({length:512},(_,i)=>(i*37+18)&255);
    fdc.loadMedia(sector,{cylinders:1,heads:1,sectors:1,bytesPerSector:512});
    const pit=out(0x43,[0x34])+out(0x40,[128,0]);
    let program;
    if(name==='memory')program=`MOV CX,512
MOV AX,1
MOV BX,0
again: MOV [0501h],AX
MOV DX,[0501h]
ADD BX,DX
INC AX
LOOP again
MOV [0510h],BX
HLT`;
    if(name==='io')program=pit+`MOV CX,128
again: MOV AL,0
OUT 43h,AL
IN AL,40h
IN AL,40h
LOOP again
HLT`;
    if(name==='dma')program=out(0x3f2,[0,12])+out(0x3f5,[3,0xdf,2])+out(0x0a,[6])+out(0x0c,[0])+
        out(4,[1,5])+out(5,[255,1])+out(0x81,[0])+out(0x0b,[0x46])+out(0x0a,[2])+
        out(0x3f2,[0x1c])+out(0x3f5,[0x46,0,0,0,1,2,1,0x2a,0xff])+
        `MOV DX,03F4h\nagain: IN AL,DX\nAND AL,0C0h\nCMP AL,0C0h\nJNE again\nHLT`;
    if(name==='interrupt')program=`MOV SP,0800h
MOV AX,OFFSET handler
MOV [0100h],AX
MOV AX,0F000h
MOV [0102h],AX
${pit}${out(0x20,[0x13])}${out(0x21,[0x40,1,0xfe])}
STI
again: HLT
CMP BX,3
JB again
CLI
HLT
handler: INC BX
MOV AL,20h
OUT 20h,AL
IRET`;
    if(name==='idle')program=pit+out(0x20,[0x13])+out(0x21,[0x40,1,0xff])+'STI\nHLT';
    const rom=createHarrisBootROM();rom.fill(255,0x100,0xfff0);rom.set(assembleRaw('CLI\n'+program,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,ramBytes:640*1024,textRAM:true,
        intrEnabled:true,ioEnabled:true,holdEnabled:true,interruptDevice:pic,timerDevice:timer,timerClockHalfPeriod:4,
        fdcDevice:fdc,dmaDevice:dma,keyboardDevice:keyboard,netBackend,memoryScheduling,memoryWriteJournal,decoderSpecialization,busTraceEnabled});
    const cpu=new HarrisBootCPU({enabled:true,board});
    const finished=clocks=>cpu.status==='halted'&&(name==='interrupt'?cpu.regs.bx===3&&!(cpu.flags&0x200):name==='idle'?clocks>=10000:true);
    const verify=()=>{
        const low=board.inspectMemory('ram0').bytes,high=board.inspectMemory('ram1').bytes;
        const byte=a=>(a&1?high:low)[a>>1];
        assert.ok(cpu.retired>0);assert.equal(cpu.status,'halted');
        if(name==='memory'){assert.equal(byte(0x510)|(byte(0x511)<<8),256);assert.equal(byte(0x501)|(byte(0x502)<<8),512);}
        if(name==='io'){assert.equal(timer.inspect().reads,256);assert.equal(timer.inspect().writes,131);}
        if(name==='dma'){
            assert.equal(dma.inspect().transferred,512);assert.equal(dma.inspect().tcPulses,1);
            for(let i=0;i<512;i++)assert.equal(byte(0x501+i),sector[i]);
        }
        if(name==='interrupt'){assert.equal(cpu.intrCount,3);assert.equal(pic.inspect().pairs,3);assert.equal(pic.inspect().isr,0);assert.equal(cpu.regs.sp,0x800);}
        if(name==='idle'){assert.equal(cpu.intrCount,0);assert.ok(timer.inspect().ticks>1000);}
    };
    return {cpu,board,finished,verify,devices:{pic,timer,fdc,dma,keyboard}};
}
