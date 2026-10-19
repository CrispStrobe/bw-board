import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HarrisDMAAdapter} from '../src/experimental/harris-dma-adapter.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {Harris8254Adapter} from '../src/experimental/harris-8254-adapter.js';
import {HarrisFDCAdapter} from '../src/experimental/harris-fdc-adapter.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {assembleRaw} from '../src/i8086-asm.js';
import {bitPins,bitDrives} from '../src/experimental/digital-circuit.js';
registerBusMemory();
const A=bitPins('a',24),D=bitPins('d',16);
function peer(){
    const dma=new HarrisDMAAdapter({enabled:true});
    const pins={reset:0,dreq2:0,ior_n:1,iow_n:1,m_io:0,bhe_n:1,...bitDrives(A,4),...bitDrives(D,0)};
    const update=(changes={})=>{Object.assign(pins,changes);return dma.update(p=>pins[p]);};
    const port=(reg,value=0)=>({...bitDrives(A,reg),bhe_n:(reg&1)?0:1,...bitDrives(D,value<<((reg&1)*8))});
    const write=(reg,value)=>{update({...port(reg,value),iow_n:0});update({iow_n:1});};
    const read=reg=>{const d=update({...port(reg),ior_n:0});update({ior_n:1});return D.slice((reg&1)*8,(reg&1)*8+8).reduce((v,p,i)=>v+(d[p]<<i),0);};
    return {dma,update,port,write,read};
}
test('DMA registers require explicit board gates and non-overlapping windows',()=>{
    assert.throws(()=>new HarrisDMAAdapter(),{code:'EXPERIMENT_DISABLED'});
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,dmaDevice:peer().dma}),/PIC\/I\/O/);
    for(const portBase of [0,4,0x80])assert.throws(()=>createHarrisMemoryBoard({enabled:true,intrEnabled:true,ioEnabled:true,
        interruptDevice:new Harris8259Adapter({enabled:true,portBase}),dmaDevice:peer().dma}),{code:'IO_PORT_CONFLICT'});
});
test('address and count share one low/high byte pointer; stalled reads toggle only once',()=>{
    const p=peer();p.write(4,0x34);p.write(5,0x12);
    assert.equal(p.dma.inspect().channel2.baseAddr,0x34);assert.equal(p.dma.inspect().channel2.baseCount,0x1200);
    p.write(12,0);p.write(4,0x78);p.write(4,0x56);p.write(12,0);
    for(let i=0;i<10;i++) {
        const d=p.update({...p.port(4),ior_n:0});
        assert.equal(D.slice(0,8).reduce((v,n,b)=>v+(d[n]<<b),0),0x78);
        assert.ok(D.slice(8).every(n=>d[n]==='Z'));
    }
    assert.equal(p.dma.inspect().reads,1);assert.equal(p.dma.inspect().byteHigh,true);
    p.update({ior_n:1});assert.equal(p.read(4),0x56);assert.equal(p.dma.inspect().byteHigh,false);
});
test('stretched writes commit once, page is separate and master clear preserves it',()=>{
    const p=peer();p.write(0x81,5);
    for(let i=0;i<10;i++)p.update({...p.port(5,0xff),iow_n:0});
    assert.equal(p.dma.inspect().channel2.baseCount,0);p.update({iow_n:1});
    assert.equal(p.dma.inspect().channel2.baseCount,255);assert.equal(p.dma.inspect().writes,2);
    p.write(5,1);assert.equal(p.dma.inspect().channel2.baseCount,511);
    p.write(13,0);assert.equal(p.dma.inspect().channel2.page,5);assert.equal(p.dma.inspect().channel2.masked,true);
    p.update({...p.port(4,0x22),iow_n:0});p.update({reset:1});p.update({reset:0,iow_n:1});
    assert.equal(p.dma.inspect().channel2.baseAddr,0);assert.equal(p.dma.inspect().channel2.page,0);
});
test('unsupported channels/modes/pages and all transfer requests fail before admission',()=>{
    for(const [reg,value,code] of [[0,1,'UNSUPPORTED_DMA_CHANNEL'],[8,0x10,'UNSUPPORTED_DMA_MODE'],
        [9,6,'UNSUPPORTED_DMA_TRANSFER'],[10,0,'UNSUPPORTED_DMA_CHANNEL'],[11,0x56,'UNSUPPORTED_DMA_MODE'],
        [14,0,'UNSUPPORTED_DMA_CHANNEL'],[15,0,'UNSUPPORTED_DMA_CHANNEL'],[0x81,16,'UNSUPPORTED_DMA_PAGE']]) {
        const p=peer();const before=p.dma.inspect();assert.throws(()=>p.write(reg,value),{code});assert.deepEqual(p.dma.inspect(),before);
    }
    for(const masked of [true,false]){const p=peer();if(!masked)p.write(10,2);
        assert.throws(()=>p.update({dreq2:1}),{code:'UNSUPPORTED_DMA_TRANSFER'});assert.equal(p.dma.inspect().hrq,false);}
});
test('undefined/page reads float without pointer side effects; direction and wiring faults remain visible',()=>{
    const p=peer();p.write(4,1);assert.equal(p.dma.inspect().byteHigh,true);
    for(const reg of [12,13,0x81]){assert.ok(D.every(d=>p.update({...p.port(reg),ior_n:0})[d]==='Z'));p.update({ior_n:1});}
    assert.equal(p.dma.inspect().byteHigh,true);
    assert.throws(()=>peer().update({iow_n:0,bhe_n:0}),{code:'UNSUPPORTED_DMA_WORD_IO'});
    assert.throws(()=>peer().update({iow_n:0,d0:'Z'}),{code:'FLOATING'});
    assert.throws(()=>peer().update({ior_n:0,iow_n:0}),{code:'DMA_COMMAND_OVERLAP'});
    const q=peer();q.update({...q.port(4),ior_n:0});assert.throws(()=>q.update(q.port(5)),{code:'DMA_PORT_CHANGED'});
});
const program=`MOV AL,6
OUT 0Ah,AL
MOV AL,0
OUT 0Ch,AL
OUT 04h,AL
MOV AL,7Ch
OUT 04h,AL
MOV AL,0FFh
OUT 05h,AL
MOV AL,1
OUT 05h,AL
MOV AL,4
OUT 81h,AL
MOV AL,46h
OUT 0Bh,AL
MOV AL,2
OUT 0Ah,AL
MOV AL,0
OUT 0Ch,AL
IN AL,04h
MOV BL,AL
IN AL,04h
MOV BH,AL
IN AL,05h
MOV DL,AL
IN AL,05h
MOV DH,AL
HLT`;
function fixture(editWires=w=>w){
    const dma=peer().dma,rom=createHarrisBootROM();rom.set(assembleRaw(program,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,intrEnabled:true,ioEnabled:true,
        interruptDevice:new Harris8259Adapter({enabled:true}),timerDevice:new Harris8254Adapter({enabled:true}),
        fdcDevice:new HarrisFDCAdapter({enabled:true}),dmaDevice:dma,editWires});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();return {cpu,board,dma};
}
test('owned guest programs channel 2 over both physical lanes while PIC/PIT/FDC remain connected',()=>{
    const {cpu,board,dma}=fixture();assert.equal(cpu.run(8000).status,'halted');
    assert.equal(cpu.regs.bx,0x7c00);assert.equal(cpu.regs.dx,511);
    const c=dma.inspect().channel2;assert.equal(c.curAddr,0x7c00);assert.equal(c.curCount,511);
    assert.equal(c.page,4);assert.equal(c.masked,false);assert.equal(c.autoinit,false);
    assert.equal(board.capabilities.dma,false);assert.equal(board.capabilities.dmaRegisters,true);
    assert.equal(dma.inspect().hrq,false);assert.equal(dma.inspect().status,0);
    c.curAddr=0;assert.equal(dma.inspect().channel2.curAddr,0x7c00);
});
test('physical DREQ2 and missing request/data wires cannot trigger callback DMA',()=>{
    const {cpu,board}=fixture();board.circuit.drive('dma_inputs',{dreq2:1});
    assert.throws(()=>cpu.stepClock(),{code:'UNSUPPORTED_DMA_TRANSFER'});
    assert.throws(()=>fixture(w=>w.filter(x=>!(x.to==='dma'&&x.toTerminal==='dreq2'))),{code:'FLOATING'});
    const f=fixture(w=>w.filter(x=>!(x.from==='dma'&&x.fromTerminal==='d8')));
    assert.throws(()=>f.cpu.run(8000),{code:'FLOATING'});
});
