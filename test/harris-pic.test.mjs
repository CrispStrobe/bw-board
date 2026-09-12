import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {assembleRaw} from '../src/i8086-asm.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {bitPins,bitDrives} from '../src/experimental/digital-circuit.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
registerBusMemory();
const A=bitPins('a',24),D=bitPins('d',16),IR=bitPins('ir',8);
function peer() {
    const pic=new Harris8259Adapter({enabled:true});
    const pins={reset:0,inta_n:1,ior_n:1,iow_n:1,m_io:0,bhe_n:1,
        ...bitDrives(A,0x20),...bitDrives(D,0),...bitDrives(IR,0)};
    const update=(changes={})=>{Object.assign(pins,changes);return pic.update(p=>pins[p]);};
    const port=(reg,value=0)=>({...bitDrives(A,0x20+reg),bhe_n:1-reg,...bitDrives(D,value<<(8*reg))});
    const write=(reg,value)=>{update({...port(reg,value),iow_n:0});update({iow_n:1});};
    const init=()=>{write(0,0x13);write(1,0x40);write(1,1);};
    const ack=()=>{update({inta_n:0});update({inta_n:1});const data=update({inta_n:0});update({inta_n:1});return data;};
    return {pic,pins,update,port,write,init,ack};
}
const byte=(data,lane=0)=>D.slice(lane,lane+8).reduce((v,p,i)=>v+(data[p]<<i),0);
test('PIC and I/O wiring require explicit opt-ins',()=>{
    assert.throws(()=>new Harris8259Adapter(),{code:'EXPERIMENT_DISABLED'});
    assert.throws(()=>new Harris8259Adapter({enabled:true,portBase:0x21}),RangeError);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,intrEnabled:true,interruptDevice:peer().pic}),/ioEnabled/);
    const b=createHarrisMemoryBoard({enabled:true});b.initialize();b.submit({kind:'io-write',address:0x20,value:0x13});
    assert.throws(()=>b.clock(),{code:'UNSUPPORTED_COMMAND'});
});
test('PIC commits one write at WR trailing edge and reads odd port on upper lane',()=>{
    const p=peer();p.init();const count=p.pic.inspect().writes;
    for(let i=0;i<10;i++)p.update({...p.port(1,0xa5),iow_n:0});
    assert.equal(p.pic.inspect().imr,0);assert.equal(p.pic.inspect().writes,count);
    p.update({iow_n:1});assert.equal(p.pic.inspect().imr,0xa5);assert.equal(p.pic.inspect().writes,count+1);
    const data=p.update({...p.port(1),ior_n:0});assert.equal(byte(data,8),0xa5);
    for(const d of D.slice(0,8))assert.equal(data[d],'Z');
    assert.ok(D.every(d=>p.update({ior_n:1})[d]==='Z'));
});
test('first INTA sets ISR without data; second holds vector despite a new higher IRQ',()=>{
    const p=peer();p.init();p.update({ir3:1});
    const first=p.update({inta_n:0});assert.ok(D.every(d=>first[d]==='Z'));assert.equal(p.pic.inspect().isr,8);
    p.update({inta_n:1,ir0:1});
    for(let i=0;i<8;i++)assert.equal(byte(p.update({inta_n:0})),0x43);
    assert.equal(p.pic.inspect().isr,8);p.update({inta_n:1});assert.equal(p.pic.inspect().pairs,1);
    assert.equal(byte(p.ack()),0x40);assert.equal(p.pic.inspect().isr,9);
});
test('masking, fixed priority, specific/non-specific EOI and held-edge suppression',()=>{
    const p=peer();p.init();p.write(1,2);p.update({ir1:1,ir3:1});
    assert.equal(byte(p.ack()),0x43);assert.equal(p.pic.inspect().irr,2);
    p.write(1,0);assert.equal(byte(p.ack()),0x41);assert.equal(p.pic.inspect().isr,10);
    p.write(0,0x61);assert.equal(p.pic.inspect().isr,8);p.write(0,0x20);assert.equal(p.pic.inspect().isr,0);
    for(let i=0;i<10;i++)assert.equal(p.update().intr,0);
    p.update({ir1:0});assert.equal(p.update({ir1:1}).intr,1);
});
test('poll read is consumed once across wait/settle updates',()=>{
    const p=peer();p.init();p.update({ir2:1});p.write(0,0x0c);
    for(let i=0;i<12;i++)assert.equal(byte(p.update({...p.port(0),ior_n:0})),0x82);
    assert.equal(p.pic.inspect().reads,1);assert.equal(p.pic.inspect().isr,4);
    p.update({ior_n:1});p.write(0,0x0b);assert.equal(byte(p.update({...p.port(0),ior_n:0})),4);
});
test('early request withdrawal gives spurious IRQ7 without an ISR bit',()=>{
    const p=peer();p.init();p.update({ir2:1});p.update({ir2:0});
    assert.equal(byte(p.ack()),0x47);assert.equal(p.pic.inspect().isr,0);
});
test('RESET cancels partial writes and acknowledge pairs; reinitialization needs a fresh edge',()=>{
    const p=peer();p.init();p.update({ir1:1,inta_n:0});
    p.update({reset:1});assert.equal(p.pic.inspect().pulse,0);assert.equal(p.pic.inspect().initialized,false);
    p.update({reset:0,inta_n:1});p.init();assert.equal(p.update().intr,0);
    p.update({...p.port(1,255),iow_n:0});p.update({reset:1});p.update({reset:0,iow_n:1});
    assert.equal(p.pic.inspect().imr,0);assert.equal(p.pic.inspect().writes,0);
});
test('unsupported PIC modes, malformed commands, word I/O and floating write data fail explicitly',()=>{
    for(const icw of [0x11,0x12,0x1b])assert.throws(()=>peer().write(0,icw),{code:'UNSUPPORTED_PIC_MODE'});
    for(const icw of [0,3,9,0x11]){const p=peer();p.write(0,0x13);p.write(1,0x40);assert.throws(()=>p.write(1,icw),{code:'UNSUPPORTED_PIC_MODE'});}
    const p=peer();p.init();assert.throws(()=>p.write(0,0xa0),{code:'UNSUPPORTED_PIC_MODE'});
    assert.throws(()=>peer().update({iow_n:0,bhe_n:0}),{code:'UNSUPPORTED_PIC_WORD_IO'});
    assert.throws(()=>peer().update({iow_n:0,d0:'Z'}),{code:'FLOATING'});
    assert.throws(()=>peer().update({iow_n:0,ior_n:0}),{code:'PIC_COMMAND_OVERLAP'});
});

const setup=`MOV SP,0800h
MOV AX,OFFSET irqhandler
MOV [0100h],AX
MOV AX,0F000h
MOV [0102h],AX
MOV AL,13h
OUT 20h,AL
MOV AL,40h
OUT 21h,AL
MOV AL,1
OUT 21h,AL`;
function fixture(body='STI\nHLT\nHLT',handler='INC BX\nMOV AL,20h\nOUT 20h,AL\nIRET',options={}) {
    const pic=new Harris8259Adapter({enabled:true}),rom=createHarrisBootROM();
    rom.set(assembleRaw(`${setup}\n${body}\nirqhandler: ${handler}`,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,intrEnabled:true,ioEnabled:true,interruptDevice:pic,...options});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();return {cpu,board,pic};
}
const clocks=(cpu,n=8,ready=0)=>{for(let i=0;i<n;i++)cpu.stepClock(ready);};
const until=(cpu,predicate)=>{for(let i=0;i<8000;i++){if(predicate())return;cpu.stepClock();}assert.fail('condition not reached');};
test('guest programs PIC through OUT, wakes on wired IRQ, sends EOI and returns through IRET',()=>{
    const {cpu,board,pic}=fixture();assert.equal(cpu.run(6000).status,'halted');assert.equal(pic.inspect().initialized,true);
    board.circuit.drive('irq_inputs',{ir0:1});clocks(cpu);
    until(cpu,()=>pic.inspect().isr===1);assert.equal(pic.inspect().pulse,1);
    assert.equal(cpu.run(6000).status,'halted');assert.equal(cpu.regs.bx,1);assert.equal(cpu.regs.sp,0x800);
    assert.equal(cpu.lastINTR,0x40);assert.equal(pic.inspect().pairs,1);assert.equal(pic.inspect().isr,0);
    clocks(cpu,20);assert.equal(cpu.intrCount,1);
});
test('guest reads mask on port 21h, unmasks pending IRQ, and performs ISR readback',()=>{
    const {cpu,board,pic}=fixture(`MOV AL,0FFh
OUT 21h,AL
IN AL,21h
MOV DL,AL
STI
waitirq: IN AL,20h
TEST AL,1
JZ waitirq
MOV AL,0FEh
OUT 21h,AL
HLT
HLT`, `MOV AL,0Bh
OUT 20h,AL
IN AL,20h
MOV CL,AL
MOV AL,20h
OUT 20h,AL
IRET`);
    until(cpu,()=>cpu.regs.dx===255);assert.equal(pic.inspect().imr,255);
    board.circuit.drive('irq_inputs',{ir0:1});clocks(cpu,4);assert.equal(cpu.intrCount,0);assert.equal(pic.inspect().irr,1);
    assert.equal(cpu.run(6000).status,'halted');
    if(!cpu.intrCount){clocks(cpu,8);assert.equal(cpu.run(6000).status,'halted');}
    assert.equal(cpu.regs.cx&255,1);assert.equal(cpu.intrCount,1);assert.equal(pic.inspect().imr,0xfe);
});
test('wired READY stretches OUT without early or repeated PIC commits',()=>{
    const {cpu,board,pic}=fixture('MOV AL,0A5h\nOUT 21h,AL\nHLT');
    until(cpu,()=>pic.inspect().initialized&&board.bus.pending?.kind==='io-write'&&cpu.regs.ax%256===0xa5);
    const before=pic.inspect().writes;
    clocks(cpu,16,1);assert.equal(pic.inspect().writes,before);assert.equal(pic.inspect().imr,0);
    assert.equal(cpu.run(6000).status,'halted');assert.equal(pic.inspect().imr,0xa5);assert.equal(pic.inspect().writes,before+1);
});
test('a second wired IRQ stays blocked when the guest omits EOI',()=>{
    const {cpu,board,pic}=fixture('STI\nHLT\nHLT\nHLT',`INC BX
CMP BX,1
JNE done
STI
HLT
MOV AL,20h
OUT 20h,AL
IRET
done: MOV AL,20h
OUT 20h,AL
IRET`);
    cpu.run(6000);board.circuit.drive('irq_inputs',{ir0:1});clocks(cpu);
    assert.equal(cpu.run(6000).status,'halted');assert.equal(pic.inspect().isr,1);
    board.circuit.drive('irq_inputs',{ir0:0});clocks(cpu);
    board.circuit.drive('irq_inputs',{ir0:1});clocks(cpu,12);
    assert.equal(cpu.intrCount,1);assert.equal(pic.inspect().irr,1);assert.equal(cpu.status,'halted');
});
test('guest delayed EOI releases a queued same-level edge',()=>{
    const {cpu,board,pic}=fixture('STI\nHLT\nHLT',`INC BX
CMP BX,1
JNE eoi
waitedge: IN AL,20h
TEST AL,1
JZ waitedge
eoi: MOV AL,20h
OUT 20h,AL
IRET`);
    cpu.run(6000);board.circuit.drive('irq_inputs',{ir0:1});clocks(cpu);
    until(cpu,()=>cpu.regs.bx===1);assert.equal(pic.inspect().isr,1);
    board.circuit.drive('irq_inputs',{ir0:0});clocks(cpu);
    board.circuit.drive('irq_inputs',{ir0:1});clocks(cpu,4);
    assert.equal(cpu.intrCount,1);assert.equal(pic.inspect().irr,1);
    assert.equal(cpu.run(6000).status,'halted');assert.equal(cpu.regs.bx,2);
    assert.equal(cpu.intrCount,2);assert.equal(pic.inspect().isr,0);
});
test('PIC I/O never asserts memory strobes; unmapped reads float and aligned word PIC accesses fail',()=>{
    const {cpu,board,pic}=fixture('HLT');
    until(cpu,()=>board.bus.pending?.kind==='io-write');
    const before=pic.inspect().writes;
    while(pic.inspect().writes===before) {
        cpu.stepClock();assert.equal(board.circuit.require('controller','mrd_n'),1);
        assert.equal(board.circuit.require('controller','mwr_n'),1);
    }
    for(const [body,code] of [['IN AL,22h\nHLT','FLOATING'],['OUT 20h,AX\nHLT','UNSUPPORTED_PIC_WORD_IO']]) {
        const f=fixture(body);assert.throws(()=>f.cpu.run(6000),{code});
    }
});
test('disconnected command and odd-lane data wires fail rather than using hidden PIC writes',()=>{
    for(const pin of ['iow_n','d8','q_a0']) {
        assert.throws(()=>{
            const {cpu}=fixture(undefined,undefined,{editWires:w=>w.filter(x=>!(pin==='d8'?x.from==='pic'&&x.fromTerminal===pin:
                pin==='q_a0'?x.to==='pic'&&x.fromTerminal===pin:x.from==='controller'&&x.fromTerminal===pin))});
            cpu.run(6000);
        },{code:'FLOATING'});
    }
});
