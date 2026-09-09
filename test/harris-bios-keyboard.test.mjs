// BIOS input integration, not a POST/boot fixture.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildBios} from '../scripts/build-bios.mjs';
import {assembleRaw} from '../src/i8086-asm.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {HarrisKeyboardAdapter} from '../src/experimental/harris-keyboard-adapter.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
registerBusMemory();
for(const netBackend of ['reference','compiled'])test(`${netBackend}: BIOS keyboard IRQ translation and two paced INT 16h reads return Enter`,()=>{
    const bios=buildBios({picMode:'single-unbuffered'}),rom=bios.bytes.slice(),sym=n=>bios.symbols.get(n).value;
    const code=assembleRaw(`CLI
XOR AX,AX
MOV DS,AX
MOV ES,AX
MOV SS,AX
MOV SP,7000h
MOV WORD PTR [24h],${sym('int09')}
MOV WORD PTR [26h],0F000h
MOV WORD PTR [58h],${sym('int16')}
MOV WORD PTR [5Ah],0F000h
MOV WORD PTR [41Ah],1Eh
MOV WORD PTR [41Ch],1Eh
MOV WORD PTR [480h],1Eh
MOV WORD PTR [482h],3Eh
MOV AL,99h
OUT 63h,AL
MOV AL,13h
OUT 20h,AL
MOV AL,8
OUT 21h,AL
MOV AL,1
OUT 21h,AL
MOV AL,0FDh
OUT 21h,AL
STI
XOR AX,AX
INT 16h
MOV BX,AX
XOR AX,AX
INT 16h
MOV CX,AX
CLI
HLT`,0x6000);
    assert.ok(rom.slice(0x6000,0x6000+code.length).every(b=>b===0));rom.set(code,0x6000);rom.set([0xea,0,0x60,0,0xf0],0xfff0);
    const pic=new Harris8259Adapter({enabled:true}),keyboard=new HarrisKeyboardAdapter({enabled:true});
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,intrEnabled:true,ioEnabled:true,interruptDevice:pic,keyboardDevice:keyboard,netBackend});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();let keys=2;
    for(let i=0;i<30000;i++){
        cpu.stepClock();
        if(keys&&cpu.cs===0xf000&&cpu.ip===sym('int16')&&keyboard.inspect().scan===null){
            const b=board.inspectMemory('ram0').bytes;
            if(b[0x41a>>1]===b[0x41c>>1]){keyboard.press(0x1c);keys--;}
        }
        if(cpu.status==='halted'&&!(cpu.flags&0x200))break;
    }
    assert.equal(cpu.status,'halted');assert.equal(cpu.flags&0x200,0,JSON.stringify({keys,cs:cpu.cs,ip:cpu.ip,regs:cpu.regs,pic:pic.inspect(),keyboard:keyboard.inspect(),bda:[...board.inspectMemory('ram0').bytes.slice(0x208,0x220)],bdaHigh:[...board.inspectMemory('ram1').bytes.slice(0x208,0x220)]}));assert.equal(keys,0);
    assert.equal(cpu.regs.bx,0x1c0d);assert.equal(cpu.regs.cx,0x1c0d);assert.equal(cpu.regs.sp,0x7000);
    assert.equal(pic.inspect().pairs,2);assert.equal(pic.inspect().isr,0);assert.equal(keyboard.inspect().scan,null);
});
