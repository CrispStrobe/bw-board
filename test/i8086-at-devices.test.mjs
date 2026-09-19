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

test('RTC SET, UIP, alarm and enable gating are deterministic',()=>{
  const noon=Date.UTC(1970,0,1,13,2,3)/1000,r=new MC146818(1_000_000,{initialUnixSeconds:noon});
  r.write(0,4);assert.equal(r.read(1),0x13); // BCD 24-hour
  r.write(0,1);r.write(1,0xc0);r.write(0,3);r.write(1,0xc0);r.write(0,5);r.write(1,0xc0);
  r.write(0,0x0b);r.write(1,0x22);r.advance(1_000_000);assert.equal(r.ram[0x0c]&0x20,0x20);assert.equal(r._irq,true);
  r.write(0,0x0b);r.write(1,0x82);const held=r.seconds;r.advance(2_000_000);assert.equal(r.seconds,held);
  r.write(0,0x0a);r.cyclePhase=999_800;assert.equal(r.read(1)&0x80,0); // SET suppresses UIP
  r.write(0,0x0b);r.write(1,0x02);r.write(0,0x0a);assert.equal(r.read(1)&0x80,0x80);
});

test('RTC SET stages calendar writes, preserves independent weekday and commits atomically',()=>{
  const r=new MC146818(100,{initialUnixSeconds:0});
  const write=(register,value)=>{r.write(0,register);r.write(1,value);};
  write(0x0b,0x86); // SET, binary, 24-hour
  for(const [register,value] of [[9,24],[8,2],[7,29],[6,5],[4,23],[2,59],[0,59]])write(register,value);
  r.advance(1_000);assert.equal(r.seconds,0,'SET freezes update cycles');
  r.write(0,7);assert.equal(r.read(1),29,'staged values are visible before commit');
  const state=r.getState(),restored=new MC146818(100);restored.setState(state);
  assert.deepEqual(restored.getState(),state,'checkpoint retains an incomplete SET transaction');
  write(0x0b,0x06);
  assert.equal(r.seconds,Date.UTC(2024,1,29,23,59,59)/1000);
  r.write(0,6);assert.equal(r.read(1),5,'written weekday is independent of Gregorian date');
  r.advance(100);r.write(0,6);assert.equal(r.read(1),6,'midnight advances the independent weekday');

  write(0x0b,0x80);write(4,0x81); // BCD, 12-hour, 1 PM
  r.write(0,4);assert.equal(r.read(1),0x81);
  write(8,0x02);write(7,0x31);
  assert.throws(()=>write(0x0b,0x00),/invalid staged calendar date/);
  assert.equal(r.ram[0x0b]&0x80,0x80,'failed commit leaves SET transaction intact');

  const live=new MC146818(100,{initialUnixSeconds:Date.UTC(2024,2,31,0,0,0)/1000});
  const liveWrite=(register,value)=>{live.write(0,register);live.write(1,value);};
  liveWrite(0,0x28);live.write(0,0);assert.equal(live.read(1),0x28,
    'firmware may write a calendar field without SET');
  liveWrite(8,0x02); // February 31 is retained as an intermediate raw state.
  assert(live.pendingCalendar);const pending=live.getState(),pendingCopy=new MC146818(100);
  pendingCopy.setState(pending);assert.deepEqual(pendingCopy.getState(),pending);
  liveWrite(7,0x29);assert.equal(live.pendingCalendar,null,'a later field completes the valid leap date');
  liveWrite(6,0);live.write(0,6);assert.equal(live.read(1),0,
    'the hardware calendar register retains a firmware-written weekday zero');
  const weekdayZero=new MC146818(1,{initialUnixSeconds:Date.UTC(2024,0,1,23,59,59)/1000});
  weekdayZero.write(0,6);weekdayZero.write(1,0);weekdayZero.advance(1);weekdayZero.write(0,6);
  assert.equal(weekdayZero.read(1),1,
    'the next midnight advances a literal weekday zero into the documented range');

  const format=new MC146818(100,{initialUnixSeconds:0});
  const fw=(register,value)=>{format.write(0,register);format.write(1,value);};
  fw(0x0b,0x90);assert.equal(format.ram[0x0b]&0x10,0,'SET clears update-ended interrupts');
  for(const [register,value] of [[9,24],[8,2],[7,29],[6,5],[4,13],[2,40],[0,39]])fw(register,value);
  fw(0x0b,0x06);format.write(0,2);assert.equal(format.read(1),40,
    'SET bytes are interpreted using the final binary mode, not the old BCD mode');
  assert.throws(()=>fw(0x0b,0x02),/requires SET reinitialization/,
    'live representation changes refuse instead of silently converting registers');

  const rollover=new MC146818(1,{initialUnixSeconds:Date.UTC(2099,11,31,23,59,59)/1000});
  rollover.advance(2);rollover.write(0,9);assert.equal(rollover.read(1),0);
  rollover.write(0,8);assert.equal(rollover.read(1),1);
  rollover.write(0,0);assert.equal(rollover.read(1),1,'bulk advance crosses the century and retains elapsed time');
  rollover.write(0,0x0b);rollover.write(1,0x82);rollover.write(0,6);rollover.write(1,0);
  rollover.write(0,0x0b);rollover.write(1,0x02);rollover.write(0,6);assert.equal(rollover.read(1),0,
    'SET round trip preserves the bounded weekday-zero policy');
  const legacy=rollover.getState();legacy.v=1;delete legacy.dayOfWeek;
  delete legacy.setCalendar;delete legacy.pendingCalendar;
  const migrated=new MC146818(1);migrated.setState(legacy);assert.equal(migrated.getState().v,2);
  assert.throws(()=>new MC146818(1,{initialUnixSeconds:Date.UTC(2100,0,1)/1000}),/precede 2100/);
});

test('checkpoint rejects invalid RTC before CPU/RAM mutation and preserves acknowledged IRQ state',()=>{
  const m=new I8086Machine(PCAT80286);initPic(m.chips.pic1,0x20,4);initPic(m.chips.pic2,0x28,2);
  m._out(0x64,0x60);m._out(0x60,1);m.keyIn(0x1e);m.cpu.canTakeInterrupt=()=>true;m.cpu.interrupt=()=>{};m._serviceInterrupts();
  const acknowledged=m.captureCheckpoint(),exact=structuredClone(acknowledged.state);
  m._in(0x60);m.chips.pic1.write(0,0x20);assert.equal(m.restoreCheckpoint(acknowledged),undefined);
  assert.deepEqual(m.saveState(),exact,'restore preserves IRR cleared with IRQ1 still queued and ISR active');
  const bad=structuredClone(acknowledged);bad.state.chips.rtc1.seconds=-1;bad.state.mem[0]=99;bad.state.cpu.ax=77;
  const before=m.saveState();assert.equal(m.restoreCheckpoint(bad).code,'INVALID_CHECKPOINT');assert.deepEqual(m.saveState(),before);
  const inconsistent=structuredClone(acknowledged);inconsistent.state.chips.rtc1.nmiMasked=!inconsistent.state.machine.nmiMasked;
  assert.equal(m.restoreCheckpoint(inconsistent).code,'INVALID_CHECKPOINT');assert.deepEqual(m.saveState(),before);

  const r=new I8086Machine(PCAT80286);initPic(r.chips.pic1,0x20,4);initPic(r.chips.pic2,0x28,2);
  r.cpu.canTakeInterrupt=()=>true;r.cpu.interrupt=()=>{};r.chips.rtc1.write(0,0x0b);r.chips.rtc1.write(1,0x42);
  r.chips.rtc1.advance(Math.ceil(r.clockHz/1024));r._serviceInterrupts();
  const rtcAck=r.captureCheckpoint(),rtcExact=structuredClone(rtcAck.state);
  r.chips.rtc1.write(0,0x0c);r.chips.rtc1.read(1);r.chips.pic2.write(0,0x20);r.chips.pic1.write(0,0x20);
  assert.equal(r.restoreCheckpoint(rtcAck),undefined);
  assert.deepEqual(r.saveState(),rtcExact,'restore preserves acknowledged IRQ8 with status C still latched');
});

test('machine key path polls IBF clear and routes set-1 through the AT controller',()=>{
  const m=new I8086Machine(PCAT80286);initPic(m.chips.pic1,0x20,4);initPic(m.chips.pic2,0x28,2);
  m._out(0x64,0x60);assert.equal(m._in(0x64)&2,0);m._out(0x60,1);
  assert.equal(m.keyIn(0x1c),true);assert.equal(m._in(0x64)&1,1);assert.equal(m._in(0x60),0x1c);
});

test('acknowledged keyboard IRQ is not reasserted by A20 and queued keys form distinct IRQs',()=>{
  const m=new I8086Machine(PCAT80286),pic=m.chips.pic1;initPic(pic,0x20,4);initPic(m.chips.pic2,0x28,2);
  m._out(0x64,0x60);m._out(0x60,1);m.cpu.canTakeInterrupt=()=>true;m.cpu.interrupt=()=>{};
  m.keyIn(0x1e);m._serviceInterrupts();assert.equal(pic.irr&2,0);
  m._out(0x64,0xd1);m._out(0x60,3);assert.equal(pic.irr&2,0,'unrelated A20 change cannot duplicate IRQ1');
  assert.equal(m._in(0x60),0x1e);pic.write(0,0x20);
  m.keyIn(0x20);m.keyIn(0x21);m._serviceInterrupts();assert.equal(m._in(0x60),0x20);
  pic.write(0,0x20);assert.equal(m._serviceInterrupts(),true);assert.equal(m._in(0x60),0x21);
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
