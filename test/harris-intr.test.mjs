import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {assembleRaw} from '../src/i8086-asm.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {bitPins,bitDrives} from '../src/experimental/digital-circuit.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
registerBusMemory();
const D=bitPins('d',8),released=()=>Object.fromEntries(D.map(p=>[p,'Z']));

// Independent laboratory interrupt peer, NOT an 8259. It sees only RESET
// and the resolved INTA command. The CPU receives its vector solely on D0-D7.
class InterruptPeer {
    constructor(){this.requested=false;this.vector=0x40;this.previous=1;this.pulse=0;this.pairs=0;this.hold=false;}
    part(){return {id:'irq_peer',pins:['reset','inta_n','intr',...D],outputs:['intr',...D]};}
    update(read){
        if(read('reset')){this.previous=1;this.pulse=0;this.pairs=0;this.requested=false;return {intr:0,...released()};}
        const level=read('inta_n');
        if(this.previous===1&&level===0)this.pulse++;
        if(this.previous===0&&level===1&&this.pulse===2){this.pairs++;this.pulse=0;if(!this.hold)this.requested=false;}
        this.previous=level;
        return {intr:Number(this.requested),...(level===0&&this.pulse===2?bitDrives(D,this.vector):released())};
    }
}
function fixture(body='STI\nHLT\nMOV DX,1234h\nHLT',handler='INC BX\nIRET',options={}) {
    const peer=new InterruptPeer(),rom=createHarrisBootROM();
    rom.set(assembleRaw(`MOV SP,0800h
MOV AX,OFFSET irqhandler
MOV [0100h],AX
MOV AX,0F000h
MOV [0102h],AX
MOV AX,OFFSET nmihandler
MOV [8],AX
MOV AX,0F000h
MOV [10],AX
${body}
irqhandler: ${handler}
nmihandler: INC SI
IRET`,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,intrEnabled:true,interruptDevice:peer,...options});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();board.bus.traceLimit=8192;
    return {cpu,board,peer};
}
const word=(b,a)=>b.inspectMemory('ram0').bytes[a>>1]|(b.inspectMemory('ram1').bytes[a>>1]<<8);
function clocks(cpu,count=4,ready=0){for(let i=0;i<count;i++)cpu.stepClock(ready);}
function until(cpu,predicate){for(let i=0;i<6000;i++){if(predicate())return;cpu.stepClock();}assert.fail('condition not reached');}
test('wired INTR wakes STI/HLT, obtains vector from two INTA pulses, stacks and returns',()=>{
    const {cpu,board,peer}=fixture();assert.equal(cpu.run(4000).status,'halted');const ip=cpu.ip,retired=cpu.retired;
    peer.requested=true;clocks(cpu);assert.equal(cpu.status,'running');assert.equal(cpu.retired,retired);
    assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.regs.bx,1);assert.equal(cpu.regs.dx,0x1234);
    assert.equal(peer.pairs,1);assert.equal(cpu.intrCount,1);assert.equal(cpu.lastINTR,0x40);
    assert.equal(cpu.regs.sp,0x800);assert.equal(word(board,0x7fa),ip);assert.equal(word(board,0x7fc),0xf000);
    assert.equal(word(board,0x7fe)&0x200,0x200);
    const ack=board.bus.getTrace().entries.flatMap(e=>e.completion?.kind==='interrupt-acknowledge'?[e.completion]:[]);
    assert.deepEqual(ack.map(c=>[c.ackIndex,c.waits,c.last]),[[0,1,false],[1,1,true]]);
});
test('IF clear keeps halted CPU masked; deasserted INTR is not an edge latch',()=>{
    const {cpu,peer}=fixture('CLI\nHLT\nHLT');cpu.run(4000);
    peer.requested=true;clocks(cpu,8);assert.equal(cpu.status,'halted');assert.equal(peer.pairs,0);
    peer.requested=false;clocks(cpu);cpu.flags|=0x200;clocks(cpu,8);
    assert.equal(cpu.status,'halted');assert.equal(cpu.intrCount,0);
});
test('STI shadow lets following CLI execute before pending INTR',()=>{
    const {cpu,peer}=fixture('STI\nCLI\nHLT');peer.requested=true;
    assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.flags&0x200,0);assert.equal(peer.pairs,0);
});
for(const instruction of ['MOV SS,AX','PUSH AX\nPOP SS']) {
    test(`INTR waits through ${instruction.replaceAll('\n','; ')} and the following SP load`,()=>{
        const {cpu,peer}=fixture(`STI\nNOP\nMOV AX,0\n${instruction}\nMOV SP,0900h\nHLT`,'MOV DX,SP\nIRET');
        until(cpu,()=>cpu.ssShadow===1);peer.requested=true;clocks(cpu);
        assert.equal(cpu.intrCount,0);assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.regs.dx,0x8fa);
        assert.equal(cpu.regs.sp,0x900);
    });
}
test('simultaneously qualified NMI precedes INTR and NMI does not emit an acknowledge pair',()=>{
    const {cpu,board,peer}=fixture('STI\nHLT\nHLT','MOV DI,SI\nIRET',{nmiEnabled:true});cpu.run(4000);
    peer.requested=true;board.circuit.drive('inputs',{nmi:1});clocks(cpu);
    until(cpu,()=>cpu.nmiCount===1);assert.equal(peer.pairs,0);assert.equal(cpu.intrCount,0);
    assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.regs.si,1);assert.equal(cpu.regs.di,1);
    assert.equal(cpu.intrCount,1);assert.equal(peer.pairs,1);
});
test('memory strobes stay inactive during INTA and extra external READY holds preserve the frame',()=>{
    const {cpu,board,peer}=fixture();cpu.run(4000);peer.requested=true;clocks(cpu);
    until(cpu,()=>peer.pulse===2);const retired=cpu.retired;
    for(let i=0;i<8;i++) {
        cpu.stepClock(1);assert.equal(cpu.regs.sp,0x800);assert.equal(cpu.retired,retired);
        assert.equal(board.circuit.require('controller','mrd_n'),1);assert.equal(board.circuit.require('controller','mwr_n'),1);
        assert.equal(board.circuit.require('controller','ale'),0);
    }
    assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.regs.bx,1);assert.equal(peer.pairs,1);
});
test('missing vector wire and missing READY link fail on resolved nets',()=>{
    const {cpu,peer}=fixture(undefined,undefined,{editWires:w=>w.filter(x=>!(x.from==='irq_peer'&&x.fromTerminal==='d0'))});
    cpu.run(4000);peer.requested=true;clocks(cpu);
    assert.throws(()=>cpu.run(4000),{code:'FLOATING'});assert.equal(cpu.intrCount,0);assert.equal(cpu.regs.sp,0x800);
    const broken=fixture(undefined,undefined,{editWires:w=>w.filter(x=>!(x.from==='controller'&&x.fromTerminal==='inta_wait'))});
    assert.throws(()=>broken.cpu.run(4000),e=>['UNKNOWN','FLOATING'].includes(e.code));
});
test('REP resumes at first prefix after a complete committed element',()=>{
    const {cpu,board,peer}=fixture(`STI
MOV AX,1234h
MOV [0500h],AX
MOV [0502h],AX
MOV [0504h],AX
MOV SI,0500h
MOV DI,0600h
MOV CX,3
MOV BP,OFFSET repeated
repeated: DB 03Eh,0F3h,0A5h
HLT`,'MOV DX,CX\nIRET');
    until(cpu,()=>board.bus.pending?.kind==='memory-write'&&board.bus.pending.transfers[0].address===0x600);
    peer.requested=true;clocks(cpu,8,1);assert.equal(word(board,0x600),0);assert.equal(cpu.intrCount,0);
    assert.equal(cpu.run(5000).status,'halted');assert.equal(cpu.regs.dx,2);assert.equal(cpu.regs.cx,0);
    assert.equal(cpu.regs.si,0x506);assert.equal(cpu.regs.di,0x606);assert.equal(word(board,0x7fa),cpu.regs.bp);
    for(const a of [0x600,0x602,0x604])assert.equal(word(board,a),0x1234);
    assert.equal(board.inspectMemory('ram0').writes,13);assert.equal(board.inspectMemory('ram1').writes,13);
});
test('changing the external vector selects a different guest handler, not a hard-coded IRQ',()=>{
    const {cpu,peer}=fixture();cpu.run(4000);peer.vector=2;peer.requested=true;clocks(cpu);
    assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.regs.si,1);assert.equal(cpu.regs.bx,0);
    assert.equal(cpu.lastINTR,2);assert.equal(cpu.intrCount,1);assert.equal(cpu.nmiCount,0);
});
test('held INTR retriggers after IRET restores IF, until the external source deasserts',()=>{
    const {cpu,peer}=fixture();cpu.run(4000);peer.hold=true;peer.requested=true;clocks(cpu);
    until(cpu,()=>cpu.intrCount===2);peer.requested=false;
    assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.regs.bx,2);assert.equal(peer.pairs,2);
});
test('invalid IDT limit stops after acknowledgement without fabricating an interrupt frame',()=>{
    const {cpu,peer}=fixture();cpu.run(4000);cpu.idtr.limit=0;peer.requested=true;clocks(cpu);
    assert.throws(()=>cpu.run(4000),{code:'UNSUPPORTED_NESTED_FAULT'});
    assert.equal(peer.pairs,1);assert.equal(cpu.intrCount,0);assert.equal(cpu.regs.sp,0x800);
});
