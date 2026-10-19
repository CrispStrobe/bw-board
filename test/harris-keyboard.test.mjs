import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HarrisKeyboardAdapter} from '../src/experimental/harris-keyboard-adapter.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
import {assembleRaw} from '../src/i8086-asm.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
registerBusMemory();
function fixture(editWires=w=>w){
    const keyboard=new HarrisKeyboardAdapter({enabled:true}),pic=new Harris8259Adapter({enabled:true}),rom=createHarrisBootROM();
    rom.set(assembleRaw(`MOV SP,0800h
MOV AX,OFFSET handler
MOV [0024h],AX
MOV AX,0F000h
MOV [0026h],AX
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
HLT
CLI
HLT
handler: IN AL,60h
MOV BL,AL
IN AL,61h
MOV AH,AL
OR AL,80h
OUT 61h,AL
MOV AL,AH
OUT 61h,AL
MOV AL,20h
OUT 20h,AL
IRET`,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,intrEnabled:true,ioEnabled:true,interruptDevice:pic,keyboardDevice:keyboard,editWires});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();return {cpu,keyboard,pic};
}
test('scancode reaches guest through PPI, IRQ1, two INTA cycles and guest acknowledgement',()=>{
    const {cpu,keyboard,pic}=fixture();assert.equal(cpu.run(10000).status,'halted');keyboard.press(0x1c);
    for(let i=0;i<10000;i++){cpu.stepClock();if(cpu.status==='halted'&&!(cpu.flags&0x200))break;}
    assert.equal(cpu.status,'halted');assert.equal(cpu.flags&0x200,0);assert.equal(cpu.regs.bx,0x1c);
    assert.equal(cpu.intrCount,1);assert.equal(pic.inspect().pairs,1);assert.equal(pic.inspect().isr,0);
    assert.equal(keyboard.inspect().scan,null);assert.equal(keyboard.inspect().irq1,0);assert.equal(cpu.regs.sp,0x800);
});
test('keyboard gate, input validation, busy latch and unsupported PPI modes are explicit',()=>{
    assert.throws(()=>new HarrisKeyboardAdapter(),{code:'EXPERIMENT_DISABLED'});
    const k=new HarrisKeyboardAdapter({enabled:true});assert.throws(()=>k.press(256),RangeError);
    k.press(1);assert.throws(()=>k.press(2),{code:'KEYBOARD_BUSY'});
    assert.throws(()=>k.write(3,0x80),{code:'UNSUPPORTED_PPI_MODE'});k.reset();assert.equal(k.inspect().scan,null);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,keyboardDevice:k}),/PIC/);
});
test('missing keyboard IRQ wire is floating, not a fabricated idle interrupt',()=>{
    assert.throws(()=>fixture(w=>w.filter(x=>!(x.from==='keyboard'&&x.fromTerminal==='irq1'))),{code:'FLOATING'});
});
