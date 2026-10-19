import test from 'node:test';
import assert from 'node:assert/strict';
import {I8086Machine} from '../src/i8086-machine.js';

const put=(m,at,bytes)=>m.mem.set(bytes,at);
const descriptor=(m,at,base,access)=>put(m,at,[0xff,0xff,base&255,base>>8&255,base>>16&255,access,0,0]);

function machine(program) {
  const m=new I8086Machine({clockHz:8_000_000,variant:'80286',cpuBackend:'protected286-experimental',
    memoryBytes:0x200000,a20:{controller:'8042',enabled:true},regions:[{kind:'ram',start:0,end:0x1fffff}],
    chips:[{kind:'pic',name:'pic1',at:0x20}]});
  put(m,0,[0x0f,1,0x16,0,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);
  put(m,0x100,[0x1f,0,0,2,0]);
  descriptor(m,0x208,0x100000,0x9a);descriptor(m,0x210,0x120000,0x92);descriptor(m,0x218,0x130000,0x92);
  put(m,0x100000,[0xb8,0x10,0,0x8e,0xd8,0xb8,0x18,0,0x8e,0xd0,0x8e,0xc0,0xbc,0,2,...program]);
  m.cpu.cs=0;m.cpu.ip=0;
  for(let i=0;i<20&&(!(m.cpu.msw&1)||m.cpu.ip!==15);i++)m.step();
  assert.equal(m.cpu.ip,15,'protected guest reached owned program');
  const p=m.chips.pic1;p.write(0,0x13);p.write(1,0x20);p.write(1,1);
  return m;
}

test('machine service path honors STI through one REP iteration then interrupts at prefix',()=>{
  const m=machine([0xfb,0xf3,0xa4,0xf4]);
  Object.assign(m.cpu,{cx:2,si:0x10,di:0x20});m.mem[0x120010]=0x41;m.mem[0x120011]=0x42;
  m.step();assert.equal(m.cpu._pmStiShadow,1);
  m.chips.pic1.setIRQ(1,1);const prefix=m.cpu.ip;m.step();
  assert.deepEqual([m.cpu.ip,m.cpu.cx,m.mem[0x130020]],[prefix,1,0x41]);
  const delivered=[];m.cpu.interrupt=v=>{delivered.push(v);m.cpu.halted=true;};
  m.step();assert.deepEqual(delivered,[0x21]);assert.equal(m.cpu.ip,prefix,'second REP iteration has not executed');
});

for(const [name,bytes] of [['MOV SS',[0x8e,0xd0,0x90]],['POP SS',[0x50,0x17,0x90]]]) {
  test(`machine NMI waits through protected ${name} shadow`,()=>{
    const m=machine(bytes);if(name==='POP SS')m.step();
    m.step();assert.equal(m.cpu.intShadow,1);const afterLoad=m.cpu.ip;m.nmi();
    m.step();assert.equal(m.cpu.ip,afterLoad+1);assert.equal(m._nmiPending,true);
    const delivered=[];m.cpu.interrupt=v=>delivered.push(v);m.step();
    assert.deepEqual(delivered,[2]);assert.equal(m._nmiPending,false);
  });
}
