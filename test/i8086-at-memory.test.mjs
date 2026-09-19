import test from 'node:test';
import assert from 'node:assert/strict';
import {I8086Machine} from '../src/i8086-machine.js';

const config = (extra={}) => ({clockHz:8_000_000,variant:'80286',memoryBytes:0x400000,
    a20:{controller:'8042',enabled:false},chips:[],regions:[{kind:'ram',start:0,end:0x3fffff}],...extra});
const put=(m,at,bytes)=>m.mem.set(bytes,at);

test('real 286 guest changes A20 through exact 8042 D1/data ports',()=>{
    const m=new I8086Machine(config());
    // MOV DS,ffff; write 11 through ffff:0010 while gated; D1 + output-port
    // bit 1; write 22 through the same logical address; HLT.
    put(m,0,[0xb8,0xff,0xff,0x8e,0xd8, 0xc6,0x06,0x10,0x00,0x11,
        0xb0,0xd1,0xe6,0x64,0xe4,0x64,0xa8,0x02,0x75,0xfa,
        0xb0,0x03,0xe6,0x60,
        0xc6,0x06,0x10,0x00,0x22,0xf4]);
    m.cpu.cs=0; m.cpu.ip=0;
    for(let i=0;i<20&&!m.cpu.halted;i++) m.step();
    assert.equal(m.cpu.halted,true);
    assert.equal(m.mem[0x000000],0x11);
    assert.equal(m.mem[0x100000],0x22);
    assert.equal(m.a20Enabled,true);
    m._out(0x64,0xd0);
    assert.equal(m._in(0x64)&1,1);
    assert.equal(m._in(0x60)&3,3);
});

test('A20 clears only bit 20 across byte, word, ROM and MMIO paths',()=>{
    for(const fastWords of [true,false]) {
        const m=new I8086Machine(config({fastWords}));
        m.cpu._wr16(0xffff,0x10,0x1234);
        assert.equal(m.mem[0]|m.mem[1]<<8,0x1234,`gated word fastWords=${fastWords}`);
        m.setA20Enabled(true); m.cpu._wr16(0xffff,0x10,0x5678);
        assert.equal(m.mem[0x100000]|m.mem[0x100001]<<8,0x5678,`HMA word fastWords=${fastWords}`);
        m.mem[0xfffff]=0xaa;m.mem[0]=0xbb;m.mem[0x100000]=0xcc;
        m.setA20Enabled(false);
        assert.equal(m.cpu._rd16(0xffff,0x000f),0xbbaa,`boundary gates each byte fastWords=${fastWords}`);
        m.setA20Enabled(true);
        assert.equal(m.cpu._rd16(0xffff,0x000f),0xccaa,`enabled boundary reaches HMA fastWords=${fastWords}`);
    }
    const high=new I8086Machine(config());
    high.cpu.write(0x300010,0x5a);
    assert.equal(high.mem[0x200010],0x5a,'bit 21 survives while bit 20 is cleared');
    const video=new I8086Machine(config());
    const revision=video.displayRevision; video.cpu.write(0x1b8000,0x41);
    assert.equal(video.mem[0xb8000],0x41);
    assert.equal(video.displayRevision,revision+1,'gated video alias invalidates the frame');

    const mmio=new I8086Machine(config({chips:[{kind:'ppi',name:'p',at:0x100,bus:'mem'}]}));
    mmio.cpu.write(0x100103,0x80);
    assert.equal(mmio.chips.p.control,0x80,'gated HMA address reaches low MMIO alias');

    const rom=new I8086Machine(config({regions:[{kind:'ram',start:0,end:0x0efff},
        {kind:'rom',start:0x0f000,end:0x0ffff},{kind:'ram',start:0x10000,end:0x3fffff}]}));
    rom.mem[0xf000]=0x33; rom.cpu.write(0x10f000,0x44);
    assert.equal(rom.mem[0xf000],0x33,'gated write aliases ROM and is swallowed');
    rom.setA20Enabled(true); rom.cpu.write(0x10f000,0x44);
    assert.equal(rom.mem[0x10f000],0x44);
});

test('host loads are raw physical and bounded controller refuses false keyboard support',()=>{
    const m=new I8086Machine(config());
    m.loadRom(Uint8Array.of(0xaa),0x100000);
    assert.equal(m.mem[0x100000],0xaa);
    assert.equal(m.mem[0],0);
    assert.throws(()=>m.loadRom(Uint8Array.of(1),0x400000),/exceeds configured physical memory/);
    assert.throws(()=>m._out(0x64,0xfe),/outside the bounded A20 subset/);
    assert.throws(()=>m._out(0x60,2),/no D1 output-port command/);
    m._out(0x64,0xd1);
    assert.throws(()=>m._out(0x60,2),/unsupported CPU reset/);
    assert.equal(m.a20Enabled,false,'refused reset command cannot mutate A20');
    m._out(0x64,0xd0);
    assert.throws(()=>m._out(0x64,0xd0),/output buffer is full/);
    assert.throws(()=>new I8086Machine(config({chips:[{kind:'ppi',name:'kbd',at:0x60}]})),/conflicts.*60h or 64h/);
    const odd=new I8086Machine({clockHz:1,variant:'80286',memoryBytes:0x100001,chips:[],regions:[{kind:'ram',start:0,end:0x100000}]});
    odd.cpu.write(0x100000,0x5a); assert.equal(odd.mem[0x100000],0x5a,'partial final page uses slow decode');
    assert.throws(()=>new I8086Machine({...config(),memoryBytes:0x1000001}),/1 MiB through 16 MiB/);
});

test('memory geometry and complete 8042 gate state participate in checkpoints',()=>{
    const m=new I8086Machine(config());
    m._out(0x64,0xd1);
    const checkpoint=m.captureCheckpoint();
    assert.equal(checkpoint.state.machine.a20Controller.pendingCommand,0xd1);
    m._out(0x60,3); assert.equal(m.a20Enabled,true);
    assert.equal(m.restoreCheckpoint(checkpoint),undefined);
    assert.equal(m.a20Enabled,false);
    m._out(0x60,3); assert.equal(m.a20Enabled,true,'restored D1 accepts its pending data byte');

    m._out(0x64,0xd0);
    const queued=m.captureCheckpoint();
    assert.equal(m._in(0x60),3);
    assert.equal(m.restoreCheckpoint(queued),undefined);
    assert.equal(m._in(0x60),3,'queued D0 output byte survives checkpoint');

    const bad=structuredClone(checkpoint); bad.state.machine.a20Controller.outputBuffer=999;
    const before=m.saveState();
    assert.match(m.restoreCheckpoint(bad).refused,/8042 state is invalid/);
    assert.deepEqual(m.saveState(),before,'invalid controller state refuses before mutation');
    const badType=structuredClone(checkpoint); badType.state.machine.a20Enabled=1;
    assert.match(m.restoreCheckpoint(badType).refused,/must be boolean/);
    assert.deepEqual(m.saveState(),before,'malformed A20 type refuses before mutation');
    const other=new I8086Machine(config({memoryBytes:0x500000,regions:[{kind:'ram',start:0,end:0x4fffff}]}));
    assert.match(other.restoreCheckpoint(checkpoint).refused,/topology/);
});

test('experimental protected backend executes from HMA and reaches bit-21 RAM',()=>{
    const m=new I8086Machine(config({cpuBackend:'protected286-experimental',fastWords:true}));
    // Enable A20 via the original-AT 8042 subset, then enter PE and jump to
    // code at physical 100000h. Protected code writes through a data segment
    // based at 200000h, proving bit 21 is retained by the address policy.
    put(m,0,[0xb0,0xd1,0xe6,0x64,0xb0,0x03,0xe6,0x60,
        0x0f,0x01,0x16,0x00,0x01,0xb8,0x01,0x00,0x0f,0x01,0xf0,0xea,0,0,8,0]);
    put(m,0x100,[0x17,0,0,2,0]);
    const descriptor=(at,base,access)=>put(m,at,[0xff,0xff,base&255,base>>8&255,base>>16&255,access,0,0]);
    descriptor(0x208,0x100000,0x9a); descriptor(0x210,0x200000,0x92);
    put(m,0x100000,[0xb8,0x10,0,0x8e,0xd8,0xb8,0x34,0x12,0x89,0x06,0x20,0,0xf4]);
    m.cpu.cs=0;m.cpu.ip=0;
    for(let i=0;i<16&&!m.cpu.halted;i++) m.step();
    assert.equal(m.cpu.halted,true);
    assert.equal(m.mem[0x200020]|m.mem[0x200021]<<8,0x1234);
    assert.equal(Object.hasOwn(m.cpu,'_rd16'),false,'protected backend cannot use raw RAM word shortcut');
    m.cpu.segmentCaches[3].limit=0x20;m.mem[0x200020]=0xaa;m.mem[0x200021]=0xbb;
    assert.throws(()=>m.cpu._wr16(3,0x20,0x5678),/segment limit/);
    assert.deepEqual([...m.mem.slice(0x200020,0x200022)],[0xaa,0xbb],'protected word limit preflights both bytes');
    const refusal=m.captureCheckpoint();
    assert.ok(refusal.refused);
    assert.match(JSON.stringify(refusal),/hidden descriptor caches/);
    assert.throws(()=>m.saveState(),/protected 286 hidden state/);
    assert.throws(()=>m.loadState({}),/protected 286 hidden state/);
});

test('reset preserves RAM and restores configured A20/controller state',()=>{
    const m=new I8086Machine(config());
    m.mem[0x100000]=0x77;m.setA20Enabled(true);m._out(0x64,0xd0);
    m.reset();
    assert.equal(m.mem[0x100000],0x77);
    assert.equal(m.a20Enabled,false);
    assert.equal(m._in(0x64)&1,0,'reset clears queued controller output');
});
