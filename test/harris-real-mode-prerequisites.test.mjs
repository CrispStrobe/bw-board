import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleRaw} from '../src/i8086-asm.js';
import {I8086} from '../src/i8086.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';

registerBusMemory();
function fixture(source) {
    const rom = createHarrisBootROM(); rom.set(assembleRaw(source,0x100),0x100);
    const board = createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true});
    const cpu = new HarrisBootCPU({enabled:true,board}); cpu.initialize();
    return {cpu,board,rom};
}
const byte = (board,a) => board.inspectMemory(a & 1 ? 'ram1' : 'ram0').bytes[a >> 1];
function reference(rom) {
    const memory = new Uint8Array(1 << 20); memory.set(rom,0xf0000);
    const cpu = new I8086({read:a=>memory[a],write:(a,v)=>{memory[a]=v;}},{variant:'80186'});
    for(let i=0;!cpu.halted && i<1000;i++) cpu.step();
    assert.ok(cpu.halted); return {cpu,memory};
}

test('byte high/low registers, all segment prefixes, stack and near return agree with independent decoder', () => {
    const {cpu,board,rom} = fixture(`MOV AX,0100h
MOV DS,AX
MOV ES,AX
MOV SS,AX
MOV SP,0D000h
MOV AX,1234h
PUSH AX
MOV AH,0ABh
MOV AL,0CDh
MOV DS:[0500h],AH
MOV ES:[0501h],AL
MOV SS:[0502h],AH
MOV AL,CS:[0101h]
MOV DS:[0503h],AL
CALL work
POP DX
HLT
work: MOV AX,0FFh
ADD AL,1
MOV CL,AH
XOR AH,0FFh
SUB AH,1
OR CL,2
AND AH,0Fh
SHL AH,1
SHR CL,1
RET`);
    assert.equal(cpu.run(10000).status,'halted');
    const r = reference(rom);
    for (const name of ['ax','cx','dx','sp']) assert.equal(cpu.regs[name],r.cpu[name],name);
    assert.equal(cpu.flags & 0x8c5,r.cpu.flags & 0x8c5,'defined final shift flags');
    for(let a=0x1500;a<0x1504;a++) assert.equal(byte(board,a),r.memory[a]);
});

test('all 256 byte ModR/M fields and high-byte register writes (decoder unit)', () => {
    const cpu = new HarrisBootCPU({enabled:true,board:{initialize(){},submit(){},clock(){}}}); cpu.initialize();
    const names = ['al','cl','dl','bl','ah','ch','dh','bh'];
    for(let code=0;code<256;code++) {
        cpu.ip=0x100; cpu.instructionBytes=0; const it=cpu._operand(1); let next=it.next();
        for(const b of [code,0,0]) {if(next.done) break; next=it.next(b);}
        assert.ok(next.done); assert.equal(next.value.reg,names[(code>>3)&7]);
        if(code>=192) assert.equal(next.value.operand.register,names[code&7]);
    }
    for(const name of names) {
        for(const r of ['ax','cx','dx','bx']) cpu.regs[r]=0x1234;
        cpu._set(name,0xab); assert.equal(cpu._get(name),0xab);
        const other=names[(names.indexOf(name)+4)%8];
        assert.equal(cpu._get(other),name.endsWith('l')?0x12:0x34);
    }
});

test('all short-branch conditions agree with independent flag predicates (decoder unit)', () => {
    const cpu = new HarrisBootCPU({enabled:true,board:{initialize(){},submit(){},clock(){}}});
    for(let bits=0;bits<32;bits++) {
        const [c,p,z,s,o]=[0,1,2,3,4].map(i=>!!(bits&(1<<i)));
        cpu.flags=Number(c)|Number(p)*4|Number(z)*64|Number(s)*128|Number(o)*2048;
        const expected=[o,!o,c,!c,z,!z,c||z,!(c||z),s,!s,p,!p,s!==o,s===o,z||(s!==o),!(z||(s!==o))];
        for(let i=0;i<16;i++) assert.equal(cpu._condition(i),expected[i]);
    }
});

test('PUSH waits before committing SP, stack bytes or retirement', () => {
    const {cpu,board}=fixture('MOV SP,0800h\nMOV AX,1234h\nPUSH AX\nHLT');
    let reached=false;
    for(let clocks=0;clocks<1000;clocks++) {
        cpu.stepClock();
        if (board.bus.pending?.kind === 'memory-write') {reached=true;break;}
    }
    // Use the submitted transaction rather than an assumed instruction clock.
    assert.ok(reached,'PUSH never submitted its stack write');
    const retired=cpu.retired;
    for(let i=0;i<5;i++) cpu.stepClock(1);
    assert.equal(cpu.regs.sp,0x800); assert.equal(cpu.retired,retired);
    assert.equal(byte(board,0x7fe),0); assert.equal(byte(board,0x7ff),0);
    assert.equal(cpu.run().status,'halted');
    assert.equal(cpu.regs.sp,0x7fe); assert.equal(byte(board,0x7fe),0x34); assert.equal(byte(board,0x7ff),0x12);
});

test('carry input participates in wired ADC/SBB and their output flags', () => {
    const {cpu}=fixture('MOV AX,0FFFFh\nSTC\nADC AX,0\nMOV BX,AX\nSBB AX,0\nHLT');
    assert.equal(cpu.run().status,'halted'); assert.equal(cpu.regs.bx,0); assert.equal(cpu.regs.ax,0xffff);
    assert.equal(cpu.flags & 0x8d5,0x95);
});
