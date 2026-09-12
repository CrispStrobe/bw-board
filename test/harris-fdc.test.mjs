import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HarrisFDCAdapter} from '../src/experimental/harris-fdc-adapter.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {assembleRaw} from '../src/i8086-asm.js';
import {bitPins,bitDrives} from '../src/experimental/digital-circuit.js';
registerBusMemory();
const A=bitPins('a',24),D=bitPins('d',16);
function peer(){
    const fdc=new HarrisFDCAdapter({enabled:true});
    const pins={reset:0,ior_n:1,iow_n:1,m_io:0,bhe_n:1,...bitDrives(A,0x3f2),...bitDrives(D,0)};
    const update=(changes={})=>{Object.assign(pins,changes);return fdc.update(p=>pins[p]);};
    const port=(reg,value=0)=>({...bitDrives(A,0x3f0+reg),bhe_n:(reg&1)?0:1,...bitDrives(D,value<<((reg&1)*8))});
    const write=(reg,value)=>{update({...port(reg,value),iow_n:0});return update({iow_n:1});};
    const read=reg=>{const d=update({...port(reg),ior_n:0});update({ior_n:1});return D.slice((reg&1)*8,(reg&1)*8+8).reduce((v,p,i)=>v+(d[p]<<i),0);};
    return {fdc,update,port,write,read};
}
test('FDC requires gates and rejects overlapping port windows',()=>{
    assert.throws(()=>new HarrisFDCAdapter(),{code:'EXPERIMENT_DISABLED'});
    assert.throws(()=>new HarrisFDCAdapter({enabled:true,portBase:0x3f1}),RangeError);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,fdcDevice:peer().fdc}),/PIC\/I\/O/);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,intrEnabled:true,ioEnabled:true,
        interruptDevice:new Harris8259Adapter({enabled:true,portBase:0x3f0}),fdcDevice:peer().fdc}),{code:'IO_PORT_CONFLICT'});
});
test('DOR trailing edge raises IRQ once; four SENSE responses drain on upper byte lane',()=>{
    const p=peer();p.write(2,0);
    for(let i=0;i<8;i++)assert.equal(p.update({...p.port(2,12),iow_n:0}).irq6,0);
    assert.equal(p.update({iow_n:1}).irq6,1);assert.equal(p.fdc.inspect().writes,2);
    for(let drive=0;drive<4;drive++) {
        p.write(5,8);assert.equal(p.read(4)&0xc0,0xc0);
        for(let i=0;i<8;i++) {
            const d=p.update({...p.port(5),ior_n:0});
            assert.equal(D.slice(8).reduce((v,n,b)=>v+(d[n]<<b),0),0xc0+drive);
            assert.ok(D.slice(0,8).every(n=>d[n]==='Z'));
        }
        p.update({ior_n:1});assert.equal(p.read(5),0);
    }
    assert.equal(p.fdc.inspect().pendingInterrupts,0);assert.equal(p.fdc.inspect().irq6,0);
    p.write(5,3);p.write(5,0xdf);p.write(5,2);
    assert.equal(p.fdc.inspect().phase,'command');assert.equal(p.fdc.inspect().nonDma,false);
    assert.equal(p.fdc.inspect().srt,13);assert.equal(p.fdc.inspect().hlt,1);
});
test('IRQ gate retains pending reset; hardware reset cancels an uncommitted write',()=>{
    const p=peer();assert.equal(p.write(2,4).irq6,0);assert.equal(p.fdc.inspect().pendingInterrupts,4);
    assert.equal(p.write(2,12).irq6,1);assert.equal(p.fdc.inspect().pendingInterrupts,4);
    p.update({...p.port(5,3),iow_n:0});p.update({reset:1});p.update({reset:0,iow_n:1});
    assert.equal(p.fdc.inspect().writes,0);assert.deepEqual(p.fdc.inspect().commandBytes,[]);
    assert.equal(p.fdc.inspect().irq6,0);
});
test('seek/recalibrate completions and drive status use control FIFO, not media transfers',()=>{
    const p=peer();p.write(2,12);
    for(let i=0;i<4;i++){p.write(5,8);p.read(5);p.read(5);}
    p.write(5,15);p.write(5,0);p.write(5,12);
    assert.equal(p.fdc.inspect().irq6,1);p.write(5,8);
    assert.equal(p.read(5),0x20);assert.equal(p.read(5),12);
    p.write(5,7);p.write(5,0);p.write(5,8);
    assert.equal(p.read(5),0x20);assert.equal(p.read(5),0);
    p.write(5,4);p.write(5,0);assert.equal(p.read(5)&0x30,0x10); // track zero, no ready medium
    p.write(5,8);assert.equal(p.read(5),0x80); // queue really empty
});
test('selection cannot change during an active FIFO read or write',()=>{
    const p=peer();p.write(2,12);p.write(5,8);p.update({...p.port(5),ior_n:0});
    assert.throws(()=>p.update(p.port(4)),{code:'FDC_PORT_CHANGED'});
    const q=peer();q.update({...q.port(2,12),iow_n:0});
    assert.throws(()=>q.update(q.port(5,8)),{code:'FDC_PORT_CHANGED'});
    const r=peer();r.write(2,12);r.write(5,3);
    const state=r.fdc.inspect();state.commandBytes.push(6);
    assert.deepEqual(r.fdc.inspect().commandBytes,[3]);
});
test('data/DMA/PIO commands refuse before touching the command FIFO',()=>{
    for(const cmd of [2,5,6,9,10,12,13,0x46,0xc5,0xff]) {
        const p=peer();p.write(2,12);
        assert.throws(()=>p.write(5,cmd),{code:'UNSUPPORTED_FDC_COMMAND'});
        assert.deepEqual(p.fdc.inspect().commandBytes,[]);assert.equal(p.fdc.inspect().writes,1);
    }
    const p=peer();p.write(2,12);p.write(5,3);p.write(5,0xdf);p.write(5,3);
    assert.equal(p.fdc.inspect().nonDma,true);
    assert.throws(()=>p.write(5,6),{code:'UNSUPPORTED_FDC_COMMAND'});
});
test('word ports, malformed direction and missing data wires fail; DOR reads float',()=>{
    assert.throws(()=>peer().update({iow_n:0,bhe_n:0}),{code:'UNSUPPORTED_FDC_WORD_IO'});
    assert.throws(()=>peer().update({iow_n:0,d0:'Z'}),{code:'FLOATING'});
    assert.throws(()=>peer().update({iow_n:0,ior_n:0}),{code:'FDC_COMMAND_OVERLAP'});
    assert.throws(()=>peer().write(5,3),{code:'FDC_HELD_RESET'});
    assert.throws(()=>peer().write(4,0),{code:'FDC_READ_ONLY'});
    assert.throws(()=>peer().read(5),{code:'FDC_FIFO_DIRECTION'});
    assert.ok(D.every(d=>peer().update({ior_n:0})[d]==='Z'));
});
function fixture(editWires=w=>w){
    const fdc=peer().fdc,pic=new Harris8259Adapter({enabled:true}),rom=createHarrisBootROM();
    const body=`MOV SP,0800h
MOV AX,OFFSET handler
MOV [0038h],AX
MOV AX,0F000h
MOV [003Ah],AX
MOV AL,13h
OUT 20h,AL
MOV AL,8
OUT 21h,AL
MOV AL,1
OUT 21h,AL
MOV AL,0BFh
OUT 21h,AL
MOV DX,03F2h
MOV AL,0
OUT DX,AL
MOV AL,0Ch
OUT DX,AL
STI
NOP
waitirq: CMP BX,1
JNE waitirq
MOV CX,4
MOV DI,0500h
sense: MOV DX,03F5h
MOV AL,8
OUT DX,AL
IN AL,DX
MOV [DI],AL
INC DI
IN AL,DX
MOV [DI],AL
INC DI
LOOP sense
MOV AL,3
OUT DX,AL
MOV AL,0DFh
OUT DX,AL
MOV AL,2
OUT DX,AL
HLT
handler: INC BX
MOV AL,20h
OUT 20h,AL
IRET`;
    rom.set(assembleRaw(body,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,intrEnabled:true,ioEnabled:true,
        interruptDevice:pic,fdcDevice:fdc,editWires});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();return {cpu,board,fdc,pic};
}
test('owned guest resets FDC, receives physical IRQ6/vector 0Eh, drains four replies and specifies timings',()=>{
    const {cpu,board,fdc,pic}=fixture();assert.equal(cpu.run(14000).status,'halted');
    assert.equal(cpu.regs.bx,1);assert.equal(cpu.regs.sp,0x800);assert.equal(cpu.lastINTR,14);
    assert.equal(pic.inspect().pairs,1);assert.equal(pic.inspect().isr,0);
    assert.equal(fdc.inspect().pendingInterrupts,0);assert.equal(fdc.inspect().hlt,1);
    for(let drive=0;drive<4;drive++) {
        board.submit({kind:'memory-read',address:0x500+drive*2,width:2});
        let result;for(let i=0;i<16;i++){result=board.clock();if(result?.last)break;}
        assert.equal(result?.operand,0xc0+drive);
    }
});
test('disconnecting IRQ6 or a FIFO upper data bit never supplies hidden values',()=>{
    assert.throws(()=>fixture(w=>w.filter(x=>!(x.from==='fdc'&&x.fromTerminal==='irq6'))),{code:'FLOATING'});
    const {cpu}=fixture(w=>w.filter(x=>!(x.from==='fdc'&&x.fromTerminal==='d8')));
    assert.throws(()=>cpu.run(14000),{code:'FLOATING'});
});
test('external READY stretches FDC writes and FIFO reads without duplicate side effects',()=>{
    const {cpu,board,fdc}=fixture();assert.equal(cpu.run(14000).status,'halted');
    const transfer=(kind,address,value=0)=>{
        board.submit({kind,address,value,width:1});let result;
        for(let i=0;i<30;i++){result=board.clock({ready_n:Number(i<10)});if(result?.last)break;}
        assert.ok(result?.last);assert.ok(result.waits>0);return result.operand;
    };
    const count=fdc.inspect().writes;
    transfer('io-write',0x3f2,0);transfer('io-write',0x3f2,12);transfer('io-write',0x3f5,8);
    assert.equal(fdc.inspect().writes,count+3);const reads=fdc.inspect().reads;
    assert.equal(transfer('io-read',0x3f5),0xc0);assert.equal(fdc.inspect().reads,reads+1);
    assert.equal(transfer('io-read',0x3f5),0);assert.equal(fdc.inspect().reads,reads+2);
});
