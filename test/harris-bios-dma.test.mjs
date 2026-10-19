// Owned BIOS-driver integration fixture. This deliberately uses a microguest
// entry and fast guest-programmed PIT divisor; it is NOT POST or DOS acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildBios} from '../scripts/build-bios.mjs';
import {assembleRaw} from '../src/i8086-asm.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {Harris8254Adapter} from '../src/experimental/harris-8254-adapter.js';
import {HarrisDMAAdapter} from '../src/experimental/harris-dma-adapter.js';
import {HarrisFDCAdapter} from '../src/experimental/harris-fdc-adapter.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
registerBusMemory();
for(const [netBackend,memoryScheduling,memoryWriteJournal=false,decoderSpecialization=false,deviceScheduling=false,packedBus=false] of [['reference',false],['compiled',false],['compiled',true],['compiled',true,true],['compiled',true,false,true],['compiled',true,false,false,true],['compiled',true,false,false,true,true]])test(`${netBackend}/${memoryScheduling}/${memoryWriteJournal}/${decoderSpecialization}/${deviceScheduling}/${packedBus}: owned guest invokes unmodified BIOS INT 13h and reads a sector through DMA/IRQ6`,()=>{
    const bios=buildBios({picMode:'single-unbuffered'}),rom=bios.bytes.slice(),sym=n=>bios.symbols.get(n).value;
    const vectors=[[8,'int08'],[14,'int0e'],[0x13,'int13'],[0x1c,'int1c'],[0x1e,'dpt']];
    const code=assembleRaw(`CLI
XOR AX,AX
MOV DS,AX
MOV ES,AX
MOV SS,AX
MOV SP,7000h
${vectors.map(([v,n])=>`MOV WORD PTR [${v*4}],${sym(n)}\nMOV WORD PTR [${v*4+2}],0F000h`).join('\n')}
MOV AL,13h
OUT 20h,AL
MOV AL,8
OUT 21h,AL
MOV AL,1
OUT 21h,AL
MOV AL,0BEh
OUT 21h,AL
MOV AL,36h
OUT 43h,AL
MOV AL,0
OUT 40h,AL
MOV AL,4
OUT 40h,AL
STI
MOV AX,0201h
MOV BX,0500h
MOV CX,1
XOR DX,DX
INT 13h
MOV BP,AX
PUSHF
POP SI
CLI
HLT`,0x6000);
    assert.ok(rom.slice(0x6000,0x6000+code.length).every(b=>b===0));
    rom.set(code,0x6000);rom.set([0xea,0,0x60,0,0xf0],0xfff0);
    const media=new Uint8Array(40*2*9*512);for(let i=0;i<512;i++)media[i]=(i*29+17)&255;
    const pic=new Harris8259Adapter({enabled:true}),timer=new Harris8254Adapter({enabled:true}),
        dma=new HarrisDMAAdapter({enabled:true,transferEnabled:true}),fdc=new HarrisFDCAdapter({enabled:true,transferEnabled:true});
    fdc.loadMedia(media,{cylinders:40,heads:2,sectors:9,bytesPerSector:512});
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,intrEnabled:true,ioEnabled:true,holdEnabled:true,netBackend,memoryScheduling,memoryWriteJournal,decoderSpecialization,deviceScheduling,packedBus,
        interruptDevice:pic,timerDevice:timer,timerClockHalfPeriod:1,dmaDevice:dma,fdcDevice:fdc});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();assert.equal(cpu.run(200000).status,'halted');
    assert.equal(cpu.regs.si&1,0);assert.equal(cpu.regs.bp,1);assert.equal(cpu.regs.sp,0x7000);
    assert.equal(dma.inspect().transferred,512);assert.equal(dma.inspect().tcPulses,1);assert.equal(fdc.inspect().dmaBytes,512);
    assert.ok(pic.inspect().pairs>=4);assert.equal(pic.inspect().isr,0);
    const low=board.inspectMemory('ram0').bytes,high=board.inspectMemory('ram1').bytes;
    for(let i=0;i<512;i++){const a=0x500+i;assert.equal((a&1?high:low)[a>>1],media[i]);}
    assert.ok(low[0x46c>>1]>=17,'guest BIOS timer wait must really elapse');
});
