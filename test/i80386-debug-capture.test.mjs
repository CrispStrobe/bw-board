import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386Adapter} from '../src/i80386-adapter.js';
import {createI80386DebugTarget,captureI80386Registers} from '../src/i80386-debug.js';
import {createI8086DebugTarget} from '../src/i8086-debug.js';
import {I8086Machine} from '../src/i8086-machine.js';
import {I80386Fault} from '../src/experimental/i80386.js';

function fixture(code=[0x90]) {
    const adapter=createI80386Adapter();
    const rom=new Uint8Array(65536);rom.fill(0x90);rom.set(code,0xfff0);
    adapter.machine.loadRom(rom,0xffff0000);
    adapter.machine.reset();
    return {adapter,m:adapter.machine,cpu:adapter.machine.cpu,target:createI80386DebugTarget(adapter)};
}
function one(target) {target.step('insn');target.runFor(1);}

test('real reset NOP retires identically with subscriber and full-width capture',()=>{
    const plain=fixture();one(plain.target);
    const observed=fixture(),events=[];const off=observed.target.onDebugEvent(e=>events.push(e));
    one(observed.target);off();
    assert.equal(observed.cpu.cycles,1);assert.equal(observed.cpu.eip,0xfff1);
    assert.equal(observed.cpu.pc,0xfffffff1);assert.equal(observed.cpu.cycles,plain.cpu.cycles);
    const retire=events.find(e=>e.kind==='instruction'&&e.phase==='retire');
    assert.ok(retire);assert.equal(retire.pcBefore,0xfffffff0);assert.equal(retire.pcAfter,0xfffffff1);
    assert.equal(observed.target.regs().pc,0xfffffff1);
});

test('register snapshot copies full architectural values and cached segments without mutation',()=>{
    const {m,cpu,target}=fixture();cpu.eax=0x89abcdef;cpu.eip=0x12345678;cpu.cs=0x1234;cpu.segmentCaches[1].base=0x80000000;
    cpu.cr0|=1;cpu.segmentCaches[1].default32=true;
    const before=JSON.stringify(cpu.segmentCaches);const r=captureI80386Registers(m);
    assert.equal(r.eax,0x89abcdef);assert.equal(r.eip,0x12345678);assert.equal(r.pc,0x92345678);
    assert.equal(r.cs,0x1234);assert.equal(r.pcSpace,'linear');assert.equal(r.protectedMode,true);
    r.csCacheBase=0;assert.equal(JSON.stringify(cpu.segmentCaches),before);
    assert.equal(target.regs().csCacheDefault32,true);
});

test('high physical read events retain unsigned addresses above 2GiB',()=>{
    const {cpu,target}=fixture([0xa0,0,0]);cpu.segmentCaches[3].base=0x80000000;
    const events=[];target.onDebugEvent(e=>events.push(e));one(target);
    const read=events.find(e=>e.kind==='memory'&&e.memory?.direction==='read');
    assert.ok(read);assert.equal(read.memory.address,0x80000000);
});

test('high physical writes and watchpoint comparison do not alias low memory',()=>{
    const {cpu,target}=fixture([0xa2,1,0]);cpu.segmentCaches[3].base=0x80000000;cpu.eax=0x55;
    const id=target.setBreakpoint({kind:'write',addr:0x80000001,len:1});assert.equal(typeof id,'number');
    const events=[];target.onDebugEvent(e=>events.push(e));one(target);
    const write=events.find(e=>e.kind==='memory'&&e.memory?.direction==='write');
    assert.ok(write);assert.equal(write.memory.address,0x80000001);assert.equal(write.memory.value,0x55);
    assert.equal('before' in write.memory,false);
});

test('linear high reset code breakpoint stops before CPU retirement',()=>{
    const {cpu,target}=fixture();assert.equal(typeof target.setBreakpoint({kind:'code',addr:0xfffffff0}),'number');
    target.run();assert.equal(target.runFor(1),'halted');assert.equal(cpu.cycles,0);
    assert.equal(target.capabilities().runTo[0].addressMax,0xffffffff);
});

test('unsupported legacy operations refuse before mutation in real and protected modes',()=>{
    const {cpu,m,target}=fixture();
    for(const protectedMode of [false,true]){
        cpu.cr0=protectedMode?cpu.cr0|1:cpu.cr0&~1;const before=JSON.stringify(target.regs());const byte=m.mem[0];
        for(const result of [target.step('over'),target.step('out'),target.disasm(0xfffffff0),target.nextCodeAddress(0,1),target.setSymbols(new Map()),target.symbolAt(0),target.writeMem('mem',0,[1]),target.loadFirmware([1]),target.setBreakpoint({kind:'code',seg:0,addr:0})])assert.ok(result.unsupported);
        assert.equal(JSON.stringify(target.regs()),before);assert.equal(m.mem[0],byte);
    }
    assert.deepEqual(target.capabilities().steps,['insn']);assert.equal(target.capabilities().symbols,false);
    assert.equal(target.captureCheckpoint().accepted,false);assert.equal(target.restoreCheckpoint({}).accepted,false);
    assert.equal(target.replayInstruction().accepted,false);assert.equal(target.canApplyReplayInput({}),false);
});

test('physical memory range guard refuses wrap and reads the reset alias',()=>{
    const {target}=fixture();assert.ok(target.readMem('mem',0xffffffff,2).unsupported);
    assert.ok(target.readMem('io',0,1).unsupported);assert.ok(target.readMem('mem',-1,1).unsupported);
    assert.equal(target.readMem('mem',0xfffffff0,1)[0],0x90);
});


test('subscriber capture is scalar and does not report unchanged segment caches as changes',()=>{
    const {target}=fixture(),events=[];target.onDebugEvent(e=>events.push(e));one(target);
    const retire=events.find(e=>e.kind==='instruction');assert.ok(retire.registersAfter);
    assert.equal(retire.registersAfter.csCacheBase,0xffff0000);
    assert.equal(retire.changes.registers.csCacheBase,undefined);
    assert.equal(retire.changes.registers.eip.before,0xfff0);assert.equal(retire.changes.registers.eip.after,0xfff1);
});

test('original operand fault survives event observation with no invented retirement',()=>{
    const {cpu,target}=fixture([0xa0,0,0]),fault=new I80386Fault(14,0,'owned operand fault');
    // Disable guest fault delivery for this direct original-error control only.
    cpu.deliverFaults=false;cpu.read=()=>{throw fault;};const events=[];target.onDebugEvent(e=>events.push(e));
    assert.throws(()=>one(target),e=>e===fault);assert.equal(cpu.eip,0xfff0);assert.equal(cpu.cycles,0);
    assert.equal(events.some(e=>e.kind==='instruction'&&e.phase==='retire'),false);
});

test('ordinary 8086 shared defaults retain code breakpoints, register shape and disassembly',()=>{
    const machine=new I8086Machine();const rom=new Uint8Array(32768);rom.fill(0x90);machine.loadRom(rom);machine.reset();
    const target=createI8086DebugTarget({machine}),before=target.regs(),events=[];
    assert.equal('eax' in before,false);assert.equal(typeof before.ax,'number');assert.ok(target.capabilities().steps.includes('over'));
    assert.equal(target.capabilities().runTo[0].addressMax,0xfffff);
    assert.equal(typeof target.disasm(machine.cpu.pc).length,'number');
    const bp=target.setBreakpoint({kind:'code',addr:machine.cpu.pc});target.run();assert.equal(target.runFor(1),'halted');target.clearBreakpoint(bp);
    target.onDebugEvent(e=>events.push(e));one(target);assert.ok(events.some(e=>e.kind==='instruction'));
});


test('physical VGA observation preserves latches and guest-fault state',()=>{
    const adapter=createI80386Adapter({profile:'freedos-vga'}),target=createI80386DebugTarget(adapter),m=adapter.machine;
    m.vgaMemory.latches.set([1,2,3,4]);const before=[...m.vgaMemory.latches];const cr2=m.cpu.cr2;
    target.readMem('mem',0xa0000,4);assert.deepEqual([...m.vgaMemory.latches],before);assert.equal(m.cpu.cr2,cr2);
});
