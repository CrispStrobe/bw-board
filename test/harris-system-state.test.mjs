import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {assembleRaw} from '../src/i8086-asm.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';

registerBusMemory();
function wired(source) {
    const rom=createHarrisBootROM();rom.set(assembleRaw(source,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();return {cpu,board};
}
const word=(b,a)=>b.inspectMemory('ram0').bytes[a>>1]|(b.inspectMemory('ram1').bytes[a>>1]<<8);
function semantic(bytes,{registers={},ram=[],idtr,msw=0xfff0,es=0}={}) {
    const cpu=new HarrisBootCPU({enabled:true,board:{initialize(){},clock(){},submit(){}}});
    cpu.regs={ax:0,bx:0,cx:0,dx:0,sp:0x800,bp:0,si:0,di:0,...registers};
    Object.assign(cpu,{cs:0,csBase:0,ds:0,es,ss:0,ip:0x100,flags:0x202,msw,status:'running'});
    if(idtr)cpu.idtr=idtr;
    const memory=new Map([...bytes.map((b,i)=>[0x100+i,b]),...ram]);
    const transfers=[],iterator=cpu._instructions();let response;
    for(let i=0;i<200;i++) {
        const next=iterator.next(response);if(next.done)return {cpu,memory,transfers};
        const t=next.value;transfers.push(t);
        if(t.kind.endsWith('read'))response=(memory.get(t.address)??0)|((t.width===2?(memory.get(t.address+1)??0):0)<<8);
        else {for(let b=0;b<t.width;b++)memory.set(t.address+b,(t.value>>>(8*b))&255);response=undefined;}
    }
    assert.fail('owned semantic budget exhausted');
}
const vector=(n,handler=0x300)=>[[n*4,handler&255],[n*4+1,handler>>>8],[n*4+2,0],[n*4+3,0],[handler,0xf4]];

test('wired SMSW/LMSW/CLTS preserve flags and update only the low configuration bits',()=>{
    const {cpu,board}=wired(`STC
DB 00Fh,001h,0E3h
MOV AX,0FFFEh
DB 00Fh,001h,0F0h
DB 00Fh,001h,026h,000h,005h
DB 00Fh,006h
DB 00Fh,001h,0E1h
HLT`);
    assert.equal(cpu.run(3000).status,'halted');assert.equal(cpu.regs.bx,0xfff0);
    assert.equal(word(board,0x500),0xfffe);assert.equal(cpu.regs.cx,0xfff6);
    assert.equal(cpu.flags,3);assert.equal(cpu.msw,0xfff6);
});
test('wired LGDT/SGDT loads a 24-bit base, ignores byte six and stores six bytes',()=>{
    const {cpu,board}=wired(`MOV AX,1234h
MOV [0500h],AX
MOV AX,5678h
MOV [0502h],AX
MOV AX,0AB9Ah
MOV [0504h],AX
DB 00Fh,001h,016h,000h,005h
DB 00Fh,001h,006h,000h,006h
HLT`);
    assert.equal(cpu.run(4000).status,'halted');assert.deepEqual(cpu.gdtr,{base:0x9a5678,limit:0x1234});
    assert.equal(word(board,0x600),0x1234);assert.equal(word(board,0x602),0x5678);
    assert.equal(word(board,0x604),0xff9a); // undefined high byte is model policy
    const state=cpu.inspect();state.gdtr.base=0;state.idtr.limit=0;
    assert.equal(cpu.gdtr.base,0x9a5678);assert.equal(cpu.idtr.limit,0x3ff);
});
test('wired LIDT relocates actual INT/IRET table reads; SIDT exports the loaded state',()=>{
    const {cpu,board}=wired(`MOV SP,0800h
MOV AX,03FFh
MOV [0500h],AX
MOV AX,01000h
MOV [0502h],AX
MOV AX,0
MOV [0504h],AX
MOV AX,OFFSET handler
MOV [01120h],AX
MOV AX,0F000h
MOV [01122h],AX
DB 00Fh,001h,01Eh,000h,005h
DB 00Fh,001h,00Eh,000h,006h
INT 048h
HLT
handler: MOV DX,0BEEFh
IRET`);
    assert.equal(cpu.run(5000).status,'halted');assert.equal(cpu.regs.dx,0xbeef);
    assert.equal(cpu.regs.sp,0x800);assert.deepEqual(cpu.idtr,{base:0x1000,limit:0x3ff});
    assert.equal(word(board,0x600),0x3ff);assert.equal(word(board,0x602),0x1000);
});
test('LMSW rejects PE before changing mode or executing the following instruction',()=>{
    const {cpu}=wired('MOV AX,1\nDB 00Fh,001h,0F0h\nMOV BX,1234h\nHLT');
    assert.throws(()=>cpu.run(2000),{code:'UNSUPPORTED_PROTECTED_MODE'});
    assert.equal(cpu.status,'faulted');assert.equal(cpu.msw,0xfff0);assert.equal(cpu.regs.bx,0);
    assert.throws(()=>semantic([0xf4],{msw:0xfff1}),{code:'UNSUPPORTED_PROTECTED_MODE'});
});
test('protected-only operations and invalid table register forms deliver real-mode vector 6',()=>{
    for(const bytes of [[0x0f,0,0xc0],[0x0f,2,0xc0],[0x0f,3,0xc0],[0x63,0xc0],
        ...[0xc0,0xc8,0xd0,0xd8,0xe8,0xf8].map(modrm=>[0x0f,1,modrm])]) {
        const {cpu,memory}=semantic([0x3e,...bytes],{ram:vector(6)});
        assert.equal(cpu.ip,0x301);assert.equal(memory.get(0x7fa),0);assert.equal(memory.get(0x7fb),1);
        assert.equal(cpu.regs.sp,0x7fa);
    }
});
test('IDT limit rejects an out-of-range vector before any partial stack frame',()=>{
    const {cpu,memory}=semantic([0xcd,0x40],{idtr:{base:0,limit:55},ram:vector(13)});
    assert.equal(cpu.ip,0x301);assert.equal(cpu.regs.sp,0x7fa);
    assert.equal(memory.get(0x7fa),0);assert.equal(memory.get(0x7fb),1);
    assert.throws(()=>semantic([0xcd,0x40],{idtr:{base:0,limit:0}}),{code:'UNSUPPORTED_NESTED_FAULT'});
});
test('IDTR physical base reaches above 1 MiB and wraps at the 24-bit bus boundary',()=>{
    for(const base of [0x120000,0xffffff]) {
        const ram=[[base,0],[((base+1)&0xffffff),3],[((base+2)&0xffffff),0],[((base+3)&0xffffff),0],[0x300,0xf4]];
        const {cpu}=semantic([0xcd,0],{idtr:{base,limit:3},ram});assert.equal(cpu.ip,0x301);
    }
});
test('descriptor operand crossing faults before committing table state or destination bytes',()=>{
    for(const operation of [0,1,2,3]) {
        const {cpu,memory,transfers}=semantic([0x0f,1,6+(operation<<3),0xfd,0xff],{ram:vector(13)});
        assert.deepEqual(cpu.gdtr,{base:0,limit:0});assert.deepEqual(cpu.idtr,{base:0,limit:0x3ff});
        assert.equal(cpu.ip,0x301);assert.equal(memory.has(0xfffd),false);
        assert.equal(transfers.some(t=>t.kind==='memory-write'&&t.address>=0xfffd),false);
    }
});
test('memory LMSW and ES-prefixed descriptor operands use decoded memory, not instruction bytes',()=>{
    const {cpu}=semantic([0x0f,1,0x36,0,5,0x26,0x0f,1,0x16,2,5,0xf4],{
        es:0x100,ram:[[0x500,10],[0x501,0],[0x1502,0x34],[0x1503,0x12],[0x1504,0x78],[0x1505,0x56],[0x1506,0xab],[0x1507,0xcd]]
    });
    assert.equal(cpu.msw,0xfffa);assert.deepEqual(cpu.gdtr,{limit:0x1234,base:0xab5678});
});
function waitAt(cpu,board,kind,address) {
    let found=false;
    for(let i=0;i<3000;i++) {
        const pending=board.bus.pending;
        if(pending?.kind===kind&&pending.transfers[pending.index].address===address){found=true;break;}
        cpu.stepClock();
    }
    assert.ok(found,`missing ${kind} at ${address.toString(16)}`);
    const retired=cpu.retired;
    for(let i=0;i<8;i++)cpu.stepClock(1);
    assert.equal(cpu.retired,retired);return retired;
}
test('LGDT state waits for the final external operand word and SGDT retires after its final store',()=>{
    const {cpu,board}=wired(`MOV AX,1234h
MOV [0500h],AX
MOV AX,5678h
MOV [0502h],AX
MOV AX,09Ah
MOV [0504h],AX
DB 00Fh,001h,016h,000h,005h
DB 00Fh,001h,006h,000h,006h
HLT`);
    waitAt(cpu,board,'memory-read',0x504);assert.deepEqual(cpu.gdtr,{base:0,limit:0});
    waitAt(cpu,board,'memory-write',0x604);
    assert.deepEqual(cpu.gdtr,{base:0x9a5678,limit:0x1234});
    assert.equal(word(board,0x600),0x1234);assert.equal(word(board,0x602),0x5678);
    assert.equal(word(board,0x604),0);
    assert.equal(cpu.run().status,'halted');assert.equal(word(board,0x604),0xff9a);
});
test('memory LMSW cannot update configuration during READY waits',()=>{
    const {cpu,board}=wired('MOV AX,0Eh\nMOV [0500h],AX\nDB 00Fh,001h,036h,000h,005h\nHLT');
    waitAt(cpu,board,'memory-read',0x500);assert.equal(cpu.msw,0xfff0);
    assert.equal(cpu.run().status,'halted');assert.equal(cpu.msw,0xfffe);
});
test('SMSW word at segment end faults instead of writing a wrapped operand',()=>{
    const {cpu,transfers}=semantic([0x0f,1,0x26,0xff,0xff],{ram:vector(13)});
    assert.equal(cpu.ip,0x301);assert.equal(transfers.some(t=>t.kind==='memory-write'&&t.address===65535),false);
});
