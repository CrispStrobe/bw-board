import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HarrisDMAAdapter} from '../src/experimental/harris-dma-adapter.js';
import {HarrisFDCAdapter} from '../src/experimental/harris-fdc-adapter.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {assembleRaw} from '../src/i8086-asm.js';
registerBusMemory();
const out=(port,values)=>`MOV DX,${port}\n`+values.map(v=>`MOV AL,${v}\nOUT DX,AL`).join('\n')+'\n';
function fixture({count=4,address=0x501,mode=0x46,roundTrip=false,netBackend='reference',memoryScheduling=false,memoryWriteJournal=false,decoderSpecialization=false,editWires=w=>w}={}){
    const dma=new HarrisDMAAdapter({enabled:true,transferEnabled:true}),fdc=new HarrisFDCAdapter({enabled:true,transferEnabled:true});
    const bytes=Uint8Array.from({length:512},(_,i)=>(i*37+18)&255);
    fdc.loadMedia(bytes,{cylinders:1,heads:1,sectors:1,bytesPerSector:512});
    const rom=createHarrisBootROM();
    const waitResult=`MOV DX,03F4h\nwaitresult: IN AL,DX\nAND AL,0C0h\nCMP AL,0C0h\nJNE waitresult\n`;
    const seed=roundTrip?Array.from({length:count},(_,i)=>`MOV BYTE PTR [${address+i}],${bytes[i]^0xa5}`).join('\n')+'\n':'';
    const again=roundTrip?out(0x3f5,[])+`MOV CX,7\ndrain: IN AL,DX\nLOOP drain\n`+
        out(0x0a,[6])+out(0x0c,[0])+out(4,[(address+256)&255,(address+256)>>8])+out(5,[(count-1)&255,(count-1)>>8])+
        out(0x0b,[0x46])+out(0x0a,[2])+out(0x3f5,[0x46,0,0,0,1,2,1,0x2a,0xff])+waitResult.replaceAll('waitresult','waitagain'):'';
    const code=seed+out(0x3f2,[0,12])+out(0x3f5,[3,0xdf,2])+out(0x0a,[6])+out(0x0c,[0])+
        out(4,[address&255,address>>8])+out(5,[(count-1)&255,(count-1)>>8])+out(0x81,[0])+out(0x0b,[mode])+out(0x0a,[2])+
        out(0x3f2,[0x1c])+out(0x3f5,[roundTrip?0x45:0x46,0,0,0,1,2,1,0x2a,0xff])+waitResult+again+'HLT';
    rom.set(assembleRaw(code,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,holdEnabled:true,intrEnabled:true,ioEnabled:true,
        interruptDevice:new Harris8259Adapter({enabled:true}),fdcDevice:fdc,dmaDevice:dma,netBackend,memoryScheduling,memoryWriteJournal,decoderSpecialization,editWires});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();return {cpu,board,dma,fdc,bytes};
}
test('physical DMA writes bytes across both lanes and terminates on N-1 count',()=>{
    const f=fixture();assert.equal(f.cpu.run(10000).status,'halted');
    assert.equal(f.dma.inspect().transferred,4);assert.equal(f.dma.inspect().tcPulses,1);assert.equal(f.fdc.inspect().dmaBytes,4);
    assert.equal(f.dma.inspect().channel2.curCount,65535);assert.equal(f.dma.inspect().channel2.masked,true);
    for(let i=0;i<4;i++){const a=0x501+i;assert.equal(f.board.inspectMemory(a&1?'ram1':'ram0').bytes[a>>1],f.bytes[i]);}
});
test('physical RAM-to-disk DMA can be read back through a second bus transfer',()=>{
    const f=fixture({mode:0x4a,roundTrip:true});assert.equal(f.cpu.run(16000).status,'halted');
    assert.equal(f.dma.inspect().transferred,8);assert.equal(f.dma.inspect().tcPulses,2);assert.equal(f.fdc.inspect().dmaBytes,8);
    for(let i=0;i<4;i++){const a=0x601+i;assert.equal(f.board.inspectMemory(a&1?'ram1':'ram0').bytes[a>>1],f.bytes[i]^0xa5);}
});
test('DMA verify consumes disk bytes and terminal count without writing RAM',()=>{
    const f=fixture({mode:0x42});let observed=0;
    for(let i=0;i<10000&&f.cpu.status==='running';i++){
        f.cpu.stepClock();
        if(['TC1','TC2'].includes(f.dma.inspect().master)){
            observed++;assert.equal(f.board.circuit.require('controller','mrd_n'),1);assert.equal(f.board.circuit.require('controller','mwr_n'),1);
        }
    }
    assert.equal(f.cpu.status,'halted');assert.ok(observed>0);
    assert.equal(f.dma.inspect().transferred,4);assert.equal(f.dma.inspect().tcPulses,1);assert.equal(f.fdc.inspect().dmaBytes,4);
    for(let i=0;i<4;i++){const a=0x501+i;assert.equal(f.board.inspectMemory(a&1?'ram1':'ram0').bytes[a>>1],0);}
});
test('missing physical DMA acknowledge prevents fabricated completion',()=>{
    assert.throws(()=>fixture({editWires:w=>w.filter(x=>!(x.to==='fdc'&&x.toTerminal==='dack2_n'))}),{code:'FLOATING'});
});
test('one full owned sector reaches wired RAM and generates exactly one terminal count',()=>{
    const f=fixture({count:512,address:0x500});assert.equal(f.cpu.run(40000).status,'halted');
    assert.equal(f.dma.inspect().transferred,512);assert.equal(f.fdc.inspect().dmaBytes,512);assert.equal(f.dma.inspect().tcPulses,1);
    const low=f.board.inspectMemory('ram0').bytes,high=f.board.inspectMemory('ram1').bytes;
    for(let i=0;i<512;i++){const a=0x500+i;assert.equal((a&1?high:low)[a>>1],f.bytes[i]);}
});
test('READY stretches a physical DMA byte without early RAM or FDC advancement',()=>{
    const f=fixture();for(let i=0;i<10000&&f.dma.inspect().master!=='TC1';i++)f.cpu.stepClock();
    assert.equal(f.dma.inspect().master,'TC1');const writes=f.board.inspectMemory('ram1').writes;
    for(let i=0;i<12;i++)f.cpu.stepClock(1);
    assert.equal(f.dma.inspect().transferred,0);assert.equal(f.fdc.inspect().dmaBytes,0);assert.equal(f.board.inspectMemory('ram1').writes,writes);
    assert.equal(f.cpu.run(10000).status,'halted');assert.equal(f.dma.inspect().transferred,4);assert.equal(f.dma.inspect().tcPulses,1);
});
test('channel-2 address wraps at 64 KiB without a carry into the page latch',()=>{
    const f=fixture({address:65535});assert.equal(f.cpu.run(10000).status,'halted');
    assert.equal(f.dma.inspect().channel2.curAddr,3);assert.equal(f.dma.inspect().channel2.page,0);
    for(let i=0;i<4;i++){const a=(65535+i)&65535;assert.equal(f.board.inspectMemory(a&1?'ram1':'ram0').bytes[a>>1],f.bytes[i]);}
});
test('RESET during an unaccepted DMA byte releases ownership without inventing terminal count',()=>{
    const f=fixture();for(let i=0;i<10000&&f.dma.inspect().master!=='TC1';i++)f.cpu.stepClock();
    assert.equal(f.dma.inspect().master,'TC1');f.board.clock({reset:1});
    assert.equal(f.dma.inspect().master,'IDLE');assert.equal(f.dma.inspect().transferred,0);assert.equal(f.dma.inspect().tcPulses,0);
    assert.equal(f.fdc.inspect().phase,'command');assert.equal(f.board.circuit.require('cpu','hlda'),0);
});
for(const [memoryScheduling,memoryWriteJournal,decoderSpecialization=false] of [[false,false],[true,false],[true,true],[true,false,true]])test(`compiled connectivity matches reference DMA ownership, data and guest outcome each period (scheduled=${memoryScheduling},journal=${memoryWriteJournal},specialized=${decoderSpecialization})`,()=>{
    for(const options of [{},{mode:0x4a,roundTrip:true},{mode:0x42}]) {
        const ref=fixture(options),fast=fixture({...options,netBackend:'compiled',memoryScheduling,memoryWriteJournal,decoderSpecialization});
        let clocks=0;
        while(ref.cpu.status==='running'&&clocks++<16000) {
            ref.cpu.stepClock();fast.cpu.stepClock();
            assert.deepEqual(fast.board.bus.outputs,ref.board.bus.outputs);
            assert.deepEqual(fast.dma.inspect(),ref.dma.inspect());
            for(const p of ['ale','mrd_n','mwr_n','ior_n','iow_n'])assert.equal(fast.board.circuit.read('controller',p),ref.board.circuit.read('controller',p));
        }
        assert.equal(ref.cpu.status,'halted');assert.deepEqual(fast.cpu.inspect(),ref.cpu.inspect());
        assert.deepEqual(fast.fdc.inspect(),ref.fdc.inspect());
        for(const id of ['ram0','ram1'])assert.deepEqual(fast.board.inspectMemory(id),ref.board.inspectMemory(id));
    }
});
