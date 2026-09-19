import test from 'node:test';
import assert from 'node:assert/strict';
import {I8086Machine,PCAT80286} from '../src/i8086-machine.js';
import {AT8042A20} from '../src/at-8042-a20.js';
import {MC146818} from '../src/mc146818.js';

const initPic=(p,base,icw3)=>{p.write(0,0x11);p.write(1,base);p.write(1,icw3);p.write(1,1);};

test('8042 separates responses from keyboard IRQ and checkpoints the typed queue',()=>{
  const irq=[];const k=new AT8042A20({onIRQ:v=>irq.push(v)});
  k.writeCommand(0x60);k.writeData(1);k.writeCommand(0xaa);
  assert.equal(k.injectSet1(0x1e),true);assert.equal(irq.at(-1),false); // response at queue front
  assert.equal(k.readData(),0x55);assert.equal(irq.at(-1),true);
  const s=k.getState();k.readData();k.setState(s);assert.equal(k.readData(),0x1e);
  k.writeCommand(0xad);assert.equal(k.injectSet1(0x30),false);
  k.writeCommand(0xd1);assert.throws(()=>k.writeData(0),/reset/);
});

test('8042 full-queue refusal leaves a pending command intact',()=>{
  const k=new AT8042A20({queueLimit:1});k.writeCommand(0xd1);k.injectSet1(1);
  assert.throws(()=>k.writeCommand(0x20),/full/);assert.equal(k.pendingCommand,0xd1);
});

test('AT cascade acknowledges slave vector and preserves pending requests across EOIs',()=>{
  const m=new I8086Machine(PCAT80286),master=m.chips.pic1,slave=m.chips.pic2;
  initPic(master,0x20,4);initPic(slave,0x28,2);
  const got=[];m.cpu.canTakeInterrupt=()=>true;m.cpu.interrupt=v=>got.push(v);
  slave.setIRQ(0,1);slave.setIRQ(1,1);assert.equal(m._serviceInterrupts(),true);assert.deepEqual(got,[0x28]);
  slave.write(0,0x20);master.write(0,0x20);assert.equal(m._serviceInterrupts(),true);assert.deepEqual(got,[0x28,0x29]);
  slave.write(0,0x20);master.write(0,0x20);master.write(1,4);slave.setIRQ(0,1);assert.equal(m._serviceInterrupts(),false);
});

test('AT cascade refuses PIC ICW3 maps that contradict machine wiring',()=>{
  const m=new I8086Machine(PCAT80286);m.chips.pic1.write(0,0x11);m.chips.pic1.write(1,0x20);
  assert.throws(()=>m.chips.pic1.write(1,0),/master IR2/);
  m.chips.pic2.write(0,0x11);m.chips.pic2.write(1,0x28);
  assert.throws(()=>m.chips.pic2.write(1,3),/identity must be 2/);
});

test('RTC advances deterministically, raises slave IRQ8, and status C clears it',()=>{
  const m=new I8086Machine(PCAT80286),rtc=m.chips.rtc1,master=m.chips.pic1,slave=m.chips.pic2;
  initPic(master,0x20,4);initPic(slave,0x28,2);
  rtc.write(0,0x0b);rtc.write(1,0x42); // PIE, 24-hour BCD
  rtc.advance(Math.ceil(m.clockHz/1024));assert.equal(slave.intActive,true);assert.equal(master.intActive,true);
  rtc.write(0,0x0c);assert.equal(rtc.read(1)&0xc0,0xc0);assert.equal(slave.intActive,false);
  rtc.advance(m.clockHz);rtc.write(0,0);assert.equal(rtc.read(1),1);
  rtc.write(0,0x80);assert.equal(m._nmiMasked,true);m.nmi();m.cpu.canTakeInterrupt=()=>false;assert.equal(m._serviceInterrupts(),false);rtc.write(0,0);m.cpu.interrupt=()=>{};assert.equal(m._serviceInterrupts(),true);
});

test('RTC flags latch while disabled and checkpoint restore is exact and atomic',()=>{
  const r=new MC146818(1024,{initialUnixSeconds:0});r.advance(1);
  assert.equal(r.ram[0x0c]&0x40,0x40);
  r.write(0,0x0b);r.write(1,0x42);assert.equal(r._irq,true);
  const m=new I8086Machine(PCAT80286);m._out(0x64,0x60);m._out(0x60,1);m.keyIn(0x2a);
  const cp=m.captureCheckpoint();assert.equal(cp.refused,undefined);m._in(0x60);m.restoreCheckpoint(cp);
  assert.equal(m._in(0x60),0x2a);
  const bad=structuredClone(cp);bad.state.machine.nmiMasked='no';const before=m.saveState();
  assert.equal(m.restoreCheckpoint(bad).code,'INVALID_CHECKPOINT');assert.deepEqual(m.saveState(),before);
});

test('machine key path polls IBF clear and routes set-1 through the AT controller',()=>{
  const m=new I8086Machine(PCAT80286);initPic(m.chips.pic1,0x20,4);initPic(m.chips.pic2,0x28,2);
  m._out(0x64,0x60);assert.equal(m._in(0x64)&2,0);m._out(0x60,1);
  assert.equal(m.keyIn(0x1c),true);assert.equal(m._in(0x64)&1,1);assert.equal(m._in(0x60),0x1c);
});

test('real guest IRQ8 handler reads status C, EOIs both PICs, IRETs and halts',()=>{
  const m=new I8086Machine(PCAT80286),rtc=m.chips.rtc1;
  initPic(m.chips.pic1,0x20,4);initPic(m.chips.pic2,0x28,2);
  // INT 28h -> 0000:0100. Handler increments [0300], reads status C,
  // EOIs slave then master, and returns to the HLT following the interrupted HLT.
  m.mem.set([0x00,0x01,0x00,0x00],0x28*4);
  m.mem.set([0xfe,0x06,0x00,0x03,0xb0,0x0c,0xe6,0x70,0xe4,0x71,0xb0,0x20,0xe6,0xa0,0xe6,0x20,0xcf],0x100);
  m.mem.set([0xf4,0xf4],0x200);m.cpu.cs=0;m.cpu.ip=0x200;m.cpu.ss=0;m.cpu.sp=0x800;m.cpu.flags|=0x200;
  rtc.write(0,0x0b);rtc.write(1,0x42);rtc.advance(Math.ceil(m.clockHz/1024));
  for(let i=0;i<30&&!m.cpu.halted;i++)m.step();
  assert.equal(m.mem[0x300],1);assert.equal(rtc.ram[0x0c],0);assert.equal(m.chips.pic1.isr,0);assert.equal(m.chips.pic2.isr,0);
  assert.equal(m.cpu.halted,true);
});
