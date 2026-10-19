import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {assembleRaw} from '../src/i8086-asm.js';
registerBusMemory();
const make=options=>{const b=createHarrisMemoryBoard({enabled:true,...options});b.initialize();return b;};
function transfer(b,transaction) {
    b.submit(transaction);
    for(let i=0;i<20;i++){const r=b.clock();if(r?.last)return r.operand;}
    assert.fail('bounded transfer did not complete');
}
const write=(b,address,value,width=2)=>transfer(b,{kind:'memory-write',address,value,width});
const read=(b,address,width=2)=>transfer(b,{kind:'memory-read',address,width});
test('memory expansion requires explicit valid sizes; default inventory stays at 64 KiB',()=>{
    for(const ramBytes of [0,32768,65537,720896,NaN,'65536'])assert.throws(()=>createHarrisMemoryBoard({enabled:true,ramBytes}),RangeError);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,textRAM:1}),TypeError);
    const b=createHarrisMemoryBoard({enabled:true});
    assert.equal(b.capabilities.ramBytes,65536);assert.equal(b.capabilities.textRAM,false);
    assert.deepEqual(b.memoryMap.map(r=>r.chips),[['rom0','rom1'],['ram0','ram1']]);
    assert.throws(()=>b.memoryMap[1].chips.push('hidden'),TypeError);
});
test('640 KiB bank signatures and top word do not alias low RAM or neighbouring banks',()=>{
    const b=make({ramBytes:640*1024});
    for(let bank=0;bank<10;bank++)write(b,bank*65536+0x200,0x1230+bank);
    for(let bank=0;bank<10;bank++)assert.equal(read(b,bank*65536+0x200),0x1230+bank);
    write(b,0x9fffe,0xbeef);assert.equal(read(b,0x9fffe),0xbeef);
    assert.equal(read(b,0xfffe),0);assert.equal(b.inspectMemory('ram9_0').writes,2);
    assert.equal(b.inspectMemory('ram9_1').bytes[0x7fff],0xbe);
});
test('odd word crosses physical 64 KiB chip windows in order and preserves adjacent bytes',()=>{
    const b=make({ramBytes:128*1024});write(b,0xfffe,0xaaaa);write(b,0x10000,0xbbbb);
    write(b,0xffff,0x1234);
    assert.equal(read(b,0xffff),0x1234);assert.equal(read(b,0xfffe,1),0xaa);assert.equal(read(b,0x10001,1),0xbb);
    assert.equal(b.inspectMemory('ram1').bytes[0x7fff],0x34);assert.equal(b.inspectMemory('ram1_0').bytes[0],0x12);
});
test('upper-bank READY waits commit exactly once and leave lower banks unchanged',()=>{
    const b=make({ramBytes:128*1024});b.submit({kind:'memory-write',address:0x10200,value:0x1234,width:2});
    for(let i=0;i<8;i++){b.clock({ready_n:1});assert.equal(b.inspectMemory('ram1_0').writes,0);}
    for(let i=0;i<4;i++)b.clock({ready_n:0});
    assert.equal(read(b,0x10200),0x1234);assert.equal(b.inspectMemory('ram1_0').writes,1);
    assert.equal(b.inspectMemory('ram1_1').writes,1);assert.equal(b.inspectMemory('ram0').writes,0);
});
test('optional B8000 text RAM preserves character/attribute lanes without conventional RAM aliases',()=>{
    const b=make({textRAM:true});write(b,0xb8000,0x0741);write(b,0xbfffe,0x1f5a);
    assert.equal(read(b,0xb8000),0x0741);assert.equal(read(b,0xbfffe),0x1f5a);
    assert.equal(read(b,0x8000),0);assert.equal(b.inspectMemory('text0').bytes[0x4000],0x41);
    assert.equal(b.inspectMemory('text1').bytes[0x4000],7);assert.equal(b.capabilities.displayController,false);
});
test('RAM limit, video holes, option-ROM holes and absent low ROM alias remain unmapped',()=>{
    for(const [options,address] of [[{},0x10000],[{ramBytes:640*1024},0xa0000],
        [{textRAM:true},0xb7fff],[{textRAM:true},0xc0000],[{},0xb8000],[{},0xf0000],[{},0x100000]]) {
        const b=make(options);assert.throws(()=>read(b,address,1),{code:'FLOATING'});
    }
});
test('low ROM alias is explicit, immutable ROM stays separate from highest RAM bank',()=>{
    const rom=new Uint8Array(65536);rom[0xfffe]=0xa5;rom[0xffff]=0x5a;
    const b=make({rom,romLowAlias:true,ramBytes:640*1024});
    assert.deepEqual(b.memoryMap[0].aliases,[{start:0xf0000,end:0x100000}]);
    assert.equal(read(b,0xfffffe),0x5aa5);assert.equal(read(b,0xffffe),0x5aa5);
    write(b,0xffffe,0xffff);write(b,0x9fffe,0x1234);
    assert.equal(read(b,0xffffe),0x5aa5);assert.equal(read(b,0x9fffe),0x1234);
});
test('missing upper-bank select/address/data nets cannot be replaced by hidden RAM',()=>{
    for(const [id,pin] of [['ram1_0_decode','a16'],['ram1_0','csb'],['ram1_0','d0']]) {
        const b=make({ramBytes:128*1024,editWires:w=>w.filter(x=>!(x.to===id&&x.toTerminal===pin))});
        assert.throws(()=>write(b,0x10000,0x1234),{code:pin==='a16'?'UNKNOWN':'FLOATING'});
        assert.equal(b.inspectMemory('ram1_0').writes,0);assert.equal(b.inspectMemory('ram1_1').writes,0);
    }
});
test('split boundary fault preserves the first completed byte but cannot write a missing second chip',()=>{
    const b=make({ramBytes:128*1024,editWires:w=>w.filter(x=>!(x.to==='ram1_0'&&x.toTerminal==='d0'))});
    assert.throws(()=>write(b,0xffff,0x1234),{code:'FLOATING'});
    assert.equal(b.inspectMemory('ram1').bytes[0x7fff],0x34);
    assert.equal(b.inspectMemory('ram1').writes,1);assert.equal(b.inspectMemory('ram1_0').writes,0);
    assert.throws(()=>b.clock(),{code:'BOARD_FAULTED'});
});
test('owned guest relocates code to 9000:0200, far-calls with an upper-memory stack and writes text RAM',()=>{
    const rom=createHarrisBootROM();
    rom.set(assembleRaw(`MOV AX,8000h
MOV SS,AX
MOV SP,0FFF0h
MOV AX,0F000h
MOV DS,AX
MOV SI,OFFSET payload
MOV AX,9000h
MOV ES,AX
MOV DI,0200h
MOV CX,2
CLD
REP MOVSW
CALL 9000h:0200h
MOV BX,AX
MOV AX,0B800h
MOV ES,AX
MOV AX,0741h
MOV DI,0
STOSW
HLT
payload: MOV AX,0BEEFh
RETF`,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,ramBytes:640*1024,textRAM:true});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();
    assert.equal(cpu.run(1600).status,'halted');assert.equal(cpu.regs.bx,0xbeef);assert.equal(cpu.regs.sp,0xfff0);
    assert.equal(board.inspectMemory('ram9_0').bytes[0x100],0xb8);
    assert.equal(board.inspectMemory('ram9_1').bytes[0x101],0xcb);
    assert.equal(board.inspectMemory('ram8_0').writes,2);assert.equal(board.inspectMemory('ram8_1').writes,2);
    assert.equal(board.inspectMemory('text0').bytes[0x4000],0x41);assert.equal(board.inspectMemory('text1').bytes[0x4000],7);
});
