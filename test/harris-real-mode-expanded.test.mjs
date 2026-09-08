import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HarrisBootCPU,harrisByteDivideOverflow} from '../src/experimental/harris-80c286-boot-cpu.js';
import {assembleRaw} from '../src/i8086-asm.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';

registerBusMemory();
const stub = {initialize(){},submit(){},clock(){}};
function wired(source) {
    const rom=createHarrisBootROM();rom.set(assembleRaw(source,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();return {cpu,board};
}
const word=(b,a)=>b.inspectMemory('ram0').bytes[a>>1]|(b.inspectMemory('ram1').bytes[a>>1]<<8);

// Owned semantic driver, independent of the SST reader and its comparison masks.
function semantic(bytes, registers = {}, ram = []) {
    const cpu=new HarrisBootCPU({enabled:true,board:stub});
    cpu.regs={ax:0,bx:0,cx:0,dx:0,sp:0x800,bp:0,si:0,di:0,...registers};
    cpu.cs=0;cpu.csBase=0;cpu.ss=0;cpu.ds=0;cpu.es=0;cpu.ip=0x100;cpu.flags=2;cpu.status='running';
    const memory=new Map([...bytes.map((b,i)=>[0x100+i,b]),...ram]);
    const transfers=[], iterator=cpu._instructions();let response;
    for(let count=0;count<200;count++) {
        const next=iterator.next(response);if(next.done)return {cpu,memory,transfers};
        const t=next.value;transfers.push(t);
        if(t.kind==='io-read') response=t.address===65535?0x34:0x12;
        else if(t.kind.endsWith('read')) response=(memory.get(t.address)??0)|((t.width===2?(memory.get(t.address+1)??0):0)<<8);
        else if(t.kind==='memory-write') {
            for(let i=0;i<t.width;i++)memory.set(t.address+i,(t.value>>>(8*i))&255);
            response=undefined;
        } else response=undefined;
    }
    assert.fail('owned semantic program exceeded budget');
}
test('word port access at FFFF splits and wraps; values and directions are explicit',()=>{
    const {cpu,transfers}=semantic([0xed,0xef,0xf4],{dx:65535});
    assert.equal(cpu.regs.ax,0x1234);
    assert.deepEqual(transfers.filter(t=>t.kind.startsWith('io-')).map(({kind,address,width,value})=>[kind,address,width,value]),[
        ['io-read',65535,1,0],['io-read',0,1,0],['io-write',65535,1,0x34],['io-write',0,1,0x12]
    ]);
});
test('DF reverses REP byte copies and zero count performs no operand transfers',()=>{
    const {cpu,memory}=semantic([0xfd,0xf3,0xa4,0xf4],{si:0x501,di:0x601,cx:2},[[0x500,0x12],[0x501,0x34]]);
    assert.equal(memory.get(0x600),0x12);assert.equal(memory.get(0x601),0x34);
    assert.equal(cpu.regs.si,0x4ff);assert.equal(cpu.regs.di,0x5ff);assert.equal(cpu.regs.cx,0);
    assert.equal(semantic([0xf3,0xa5,0xf4],{si:65535,di:65535,cx:0}).transfers.filter(t=>t.kind.startsWith('memory-')).length,0);
});
test('AAM zero preserves AX and saves Harris pre-final-shift flag observations',()=>{
    for(const [ax,flags] of [[0xb09a,6],[0x1b4a,2],[0xffff,2]]) {
        const {cpu,memory}=semantic([0xd4,0],{ax},[[0,0],[1,3],[2,0],[3,0],[0x300,0xf4]]);
        assert.equal(cpu.regs.ax,ax);assert.equal(cpu.flags,flags);
        assert.equal(memory.get(0x7fe),flags);assert.equal(memory.get(0x7fa),0);assert.equal(memory.get(0x7fb),1);
    }
});

test('ADC/SBB exhaustive byte pairs and word boundaries match independent signed/nibble arithmetic',()=>{
    const cpu=new HarrisBootCPU({enabled:true,board:stub});
    for(const width of [1,2]) {
        const size=width===1?256:65536,half=size/2;
        const values=width===1?Array.from({length:256},(_,i)=>i):[0,1,15,16,255,256,32767,32768,65534,65535];
        for(const a of values) for(const b of values) for(const carry of [0,1]) for(const subtract of [false,true]) {
            cpu.flags=0x602|carry;const actual=cpu._alu(subtract?3:2,a,b,width);
            const raw=subtract?a-b-carry:a+b+carry, result=((raw%size)+size)%size;
            const signed=v=>v>=half?v-size:v;
            const signedResult=subtract?signed(a)-signed(b)-carry:signed(a)+signed(b)+carry;
            const nibble=subtract?(a%16)-(b%16)-carry:(a%16)+(b%16)+carry;
            const parity=(result%256).toString(2).replaceAll('0','').length%2===0;
            const flags=Number(raw<0||raw>=size)|Number(parity)*4|Number(nibble<0||nibble>=16)*16|
                Number(result===0)*64|Number(result>=half)*128|Number(signedResult < -half || signedResult >= half)*2048;
            assert.equal(actual.result,result);assert.equal(actual.flags&0x8d5,flags);assert.equal(actual.flags&0x602,0x602);
        }
    }
});
test('shift count masking, carry rotates and sign fill have owned boundary results',()=>{
    const cpu=new HarrisBootCPU({enabled:true,board:stub});cpu.flags=0x8d7;
    assert.deepEqual(cpu._shift(4,0x81,32,1),{result:0x81,flags:0x8d7});
    assert.equal(cpu._shift(4,0x81,33,1).result,2);
    assert.equal(cpu._shift(7,0x8001,31,2).result,0xffff);
    assert.equal(cpu._shift(2,0x80,1,1).result,1);
    assert.equal(cpu._shift(3,1,1,1).result,0x80);
    assert.equal(cpu._shift(0,0x81,8,1).result,0x81);
});
for(const [vector,body] of [[0,'DIV BX'],[6,'DB 08Eh,0C8h'],[13,'MOV AX,[0FFFFh]']]) {
    test(`wired fault ${vector} saves first-prefix IP and real stack contents`,()=>{
        const {cpu,board}=wired(`MOV SP,0800h
MOV AX,OFFSET handler
MOV [${vector*4}],AX
MOV AX,0F000h
MOV [${vector*4+2}],AX
MOV AX,1234h
MOV BX,0
MOV DI,OFFSET faulting
faulting: DB 03Eh
${body}
HLT
handler: POP BP
POP DX
POP CX
HLT`);
        assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.regs.bp,cpu.regs.di);
        assert.equal(cpu.regs.dx,0xf000);assert.equal(cpu.regs.sp,0x800);assert.equal(cpu.regs.ax,0x1234);
        assert.equal(word(board,0x7fa),cpu.regs.di);assert.equal(word(board,0x7fc),0xf000);
    });
}
test('wired INT/IRET returns to following instruction and restores flags/SP',()=>{
    const {cpu}=wired(`MOV SP,0800h
MOV AX,OFFSET handler
MOV [0120h],AX
MOV AX,0F000h
MOV [0122h],AX
MOV BX,0
STC
INT 048h
ADC BX,0
HLT
handler: MOV DX,0ABCDh
IRET`);
    assert.equal(cpu.run(4000).status,'halted');assert.equal(cpu.regs.dx,0xabcd);
    assert.equal(cpu.regs.bx,1);assert.equal(cpu.regs.sp,0x800);
});
test('wired REP MOVSW copies actual RAM, preserves source and advances both indices/count',()=>{
    const {cpu,board}=wired(`MOV AX,1234h
MOV [0500h],AX
MOV AX,5678h
MOV [0502h],AX
MOV SI,0500h
MOV DI,0600h
MOV CX,2
CLD
REP MOVSW
HLT`);
    assert.equal(cpu.run(4000).status,'halted');assert.equal(word(board,0x600),0x1234);assert.equal(word(board,0x602),0x5678);
    assert.equal(word(board,0x500),0x1234);assert.equal(cpu.regs.cx,0);assert.equal(cpu.regs.si,0x504);assert.equal(cpu.regs.di,0x604);
});
test('memory ADC flags and retirement wait for the physical write edge',()=>{
    const {cpu,board}=wired('MOV AX,0FFFFh\nMOV [0500h],AX\nSTC\nADC WORD PTR [0500h],0\nHLT');
    let found=false;
    for(let i=0;i<1000;i++) {cpu.stepClock();if(cpu.retired===4 && board.bus.pending?.kind==='memory-write'){found=true;break;}}
    assert.ok(found);const flags=cpu.flags;
    for(let i=0;i<8;i++)cpu.stepClock(1);
    assert.equal(cpu.flags,flags);assert.equal(word(board,0x500),0xffff);assert.equal(cpu.retired,4);
    assert.equal(cpu.run().status,'halted');assert.equal(word(board,0x500),0);assert.equal(cpu.flags&0x8d5,0x55);
});
test('Harris byte divider anomaly is derived for overflow operands, never a hash lookup',()=>{
    for (const [n,d,remainder] of [[-32319,124,-63],[-29600,103,-32],[-20253,30,-29],[25529,-71,57]])
        assert.deepEqual(harrisByteDivideOverflow(n,d),{quotient:-128,remainder});
    assert.equal(harrisByteDivideOverflow(123,0),null);
    assert.equal(harrisByteDivideOverflow(32767,1),null);
    assert.equal(harrisByteDivideOverflow(-32767,1),null);
});
