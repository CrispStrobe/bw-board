import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {assembleRaw} from '../src/i8086-asm.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
registerBusMemory();
function wired(body,handler='INC BX\nIRET',options={}) {
    const rom=createHarrisBootROM();
    rom.set(assembleRaw(`MOV SP,0800h
MOV AX,OFFSET handler
MOV [8],AX
MOV AX,0F000h
MOV [10],AX
${body}
handler: ${handler}`,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,nmiEnabled:true,...options});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();return {cpu,board};
}
const word=(b,a)=>b.inspectMemory('ram0').bytes[a>>1]|(b.inspectMemory('ram1').bytes[a>>1]<<8);
function clocks(cpu,board,nmi,count=4) {
    board.circuit.drive('inputs',{nmi});for(let i=0;i<count;i++)cpu.stepClock();
}
function until(cpu,predicate) {
    for(let i=0;i<5000;i++){if(predicate())return;cpu.stepClock();}
    assert.fail('condition not reached');
}
test('wired NMI wakes HLT with IF clear, saves following IP and returns without INTA',()=>{
    const {cpu,board}=wired('CLI\nHLT\nMOV DX,1234h\nHLT');
    assert.equal(cpu.run(3000).status,'halted');const ip=cpu.ip,retired=cpu.retired;
    clocks(cpu,board,1);assert.equal(cpu.status,'running');assert.equal(cpu.retired,retired);
    assert.equal(cpu.run(3000).status,'halted');assert.equal(cpu.regs.bx,1);assert.equal(cpu.regs.dx,0x1234);
    assert.equal(cpu.regs.sp,0x800);assert.equal(word(board,0x7fa),ip);assert.equal(word(board,0x7fc),0xf000);
    assert.equal(word(board,0x7fe)&0x200,0);assert.equal(cpu.nmiCount,1);
    assert.equal(board.bus.getTrace().entries.some(e=>e.completion?.kind==='interrupt-acknowledge'),false);
});
test('held-high NMI does not retrigger; a qualified new edge does',()=>{
    const {cpu,board}=wired('HLT\nHLT\nHLT');cpu.run(3000);
    clocks(cpu,board,1);cpu.run(3000);assert.equal(cpu.regs.bx,1);
    clocks(cpu,board,1,12);assert.equal(cpu.status,'halted');assert.equal(cpu.regs.bx,1);
    clocks(cpu,board,0);clocks(cpu,board,1);cpu.run(3000);assert.equal(cpu.regs.bx,2);
});
test('one additional NMI is remembered while blocked and delivered only after IRET',()=>{
    const {cpu,board}=wired('HLT\nHLT','INC BX\nNOP\nNOP\nNOP\nIRET');cpu.run(3000);
    clocks(cpu,board,1);until(cpu,()=>cpu.nmiCount===1);
    clocks(cpu,board,0);clocks(cpu,board,1);
    assert.equal(cpu.nmiBlocked,true);assert.equal(cpu.nmiCount,1);
    assert.equal(cpu.run(3000).status,'halted');assert.equal(cpu.regs.bx,2);assert.equal(cpu.nmiCount,2);
    assert.equal(cpu.regs.sp,0x800);
});
for(const body of ['MOV SS,AX','PUSH AX\nPOP SS']) {
    test(`${body.replaceAll('\n','; ')} shadows NMI through the following instruction`,()=>{
        const {cpu,board}=wired(`MOV AX,0\n${body}\nMOV SP,0900h\nHLT`,'MOV DX,SP\nIRET');
        until(cpu,()=>cpu.ssShadow===1);
        clocks(cpu,board,1);
        assert.equal(cpu.nmiCount,0);
        assert.equal(cpu.run(3000).status,'halted');assert.equal(cpu.regs.dx,0x8fa);assert.equal(cpu.regs.sp,0x900);
    });
}
test('NMI cannot interrupt a waiting store before the physical write commits',()=>{
    const {cpu,board}=wired('MOV AX,1234h\nMOV [0500h],AX\nHLT','MOV DX,[0500h]\nIRET');
    until(cpu,()=>board.bus.pending?.kind==='memory-write'&&board.bus.pending.transfers[0].address===0x500);
    const retired=cpu.retired;
    board.circuit.drive('inputs',{nmi:1});for(let i=0;i<8;i++)cpu.stepClock(1);
    assert.equal(word(board,0x500),0);assert.equal(cpu.retired,retired);assert.equal(cpu.nmiCount,0);
    assert.equal(cpu.run(3000).status,'halted');assert.equal(cpu.regs.dx,0x1234);assert.equal(cpu.nmiCount,1);
});
test('REP NMI saves first-prefix IP and resumes remaining elements without duplicating stores',()=>{
    const {cpu,board}=wired(`MOV AX,1234h
MOV SI,0500h
MOV DI,0600h
MOV CX,3
MOV [0500h],AX
MOV [0502h],AX
MOV [0504h],AX
MOV BP,OFFSET repeated
repeated: DB 03Eh,0F3h,0A5h
HLT`,'MOV DX,CX\nIRET');
    until(cpu,()=>board.bus.pending?.kind==='memory-write'&&board.bus.pending.transfers[0].address===0x600);
    board.circuit.drive('inputs',{nmi:1});for(let i=0;i<8;i++)cpu.stepClock(1);
    assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.regs.dx,2);
    assert.equal(word(board,0x7fa),cpu.regs.bp);assert.equal(cpu.regs.cx,0);
    assert.equal(cpu.regs.si,0x506);assert.equal(cpu.regs.di,0x606);
    for(const address of [0x600,0x602,0x604])assert.equal(word(board,address),0x1234);
    assert.equal(cpu.nmiCount,1);
    assert.equal(board.inspectMemory('ram0').writes,11);assert.equal(board.inspectMemory('ram1').writes,11);
});
test('NMI stays default-off and requires an actual connected input net',()=>{
    const {cpu,board}=wired('HLT','IRET',{nmiEnabled:false});
    board.circuit.drive('inputs',{nmi:1});assert.throws(()=>cpu.stepClock(),{code:'UNSUPPORTED_INPUT'});
    assert.throws(()=>wired('HLT','IRET',{editWires:w=>w.filter(x=>!(x.to==='cpu'&&x.toTerminal==='nmi'))}),{code:'FLOATING'});
});
test('short high pulse does not wake halted CPU or modify its stack',()=>{
    const {cpu,board}=wired('HLT\nHLT');cpu.run(3000);const sp=cpu.regs.sp;
    clocks(cpu,board,1,3);clocks(cpu,board,0,4);
    assert.equal(cpu.status,'halted');assert.equal(cpu.nmiCount,0);assert.equal(cpu.regs.sp,sp);
});
test('several blocked NMI edges coalesce into one pending interrupt',()=>{
    const {cpu,board}=wired('HLT\nHLT','INC BX\nMOV AX,[0500h]\nIRET');cpu.run(3000);
    clocks(cpu,board,1);
    until(cpu,()=>board.bus.pending?.kind==='memory-read'&&board.bus.pending.transfers[0].address===0x500);
    for(let pulse=0;pulse<3;pulse++) {
        board.circuit.drive('inputs',{nmi:0});for(let i=0;i<4;i++)cpu.stepClock(1);
        board.circuit.drive('inputs',{nmi:1});for(let i=0;i<4;i++)cpu.stepClock(1);
    }
    assert.equal(cpu.nmiCount,1);assert.equal(cpu.nmiBlocked,true);
    assert.equal(cpu.run(3000).status,'halted');assert.equal(cpu.nmiCount,2);assert.equal(cpu.regs.bx,2);
});
test('invalid NMI table limit stops explicitly rather than pretending delivery succeeded',()=>{
    const {cpu,board}=wired('HLT\nHLT');cpu.run(3000);cpu.idtr.limit=0;
    assert.throws(()=>clocks(cpu,board,1),{code:'UNSUPPORTED_NESTED_FAULT'});
    assert.equal(cpu.status,'faulted');assert.equal(cpu.nmiCount,0);assert.equal(cpu.regs.sp,0x800);
});
