import test from 'node:test';
import assert from 'node:assert/strict';
import CPU,{I80386Fault} from '../src/experimental/i80386.js';

function fixture(code=[]){
  const memory=new Map(code.map((v,i)=>[i,v])),events=[];
  const cpu=new CPU({fetch:a=>{events.push(['fetch',a]);return memory.get(a)??0;},read:a=>{events.push(['read',a]);return memory.get(a)??0;},write:(a,v)=>{events.push(['write',a,v]);memory.set(a,v);}});
  return {cpu,memory,events};
}

test('independent unsigned carry/borrow vectors cover all architectural widths',()=>{
  for(const [width,max] of [[8,255],[16,65535],[32,4294967295]]){
    for(const [operation,a,b,carry,wanted,flags] of [
      [0x00,max,1,0,0,0x57], [0x10,max,0,1,0,0x57],
      [0x28,0,1,0,max,0x97], [0x18,0,0,1,max,0x97],
    ]){
      const {cpu}=fixture();cpu.eflags=2|carry;
      assert.equal(cpu._alu(operation,a,b,width),wanted,`width${width} op${operation}`);
      assert.equal(cpu.eflags,flags);
    }
  }
});

test('signed overflow, sign, auxiliary and parity flags use authored values',()=>{
  for(const [width,max,sign,flags] of [[8,127,128,0x892],[16,32767,32768,0x896],[32,2147483647,2147483648,0x896]]){
    const {cpu}=fixture();cpu.eflags=2;
    assert.equal(cpu._add(max,1,width),sign);assert.equal(cpu.eflags,flags);
    cpu.eflags=0x8d7;assert.equal(cpu._setLogic(sign,width),sign);assert.equal(cpu.eflags,width===8?0x82:0x86);
    cpu.eflags=0x8d7;assert.equal(cpu._setLogic(0,width),0);assert.equal(cpu.eflags,0x46);
  }
});

test('narrow operands mask high bits while nonarchitectural fallback widths remain unchanged',()=>{
  for(const [width,max] of [[1,1],[4,15],[8,255],[12,4095],[16,65535],[32,4294967295]]){
    const {cpu}=fixture();cpu.eflags=2;
    assert.equal(cpu._setLogic(-1,width),max);
    assert.equal(cpu._add(max,1,width),0);
  }
  const {cpu}=fixture();assert.equal(cpu._add(0x123400ff,1,8),0);assert.equal(cpu._add(0x1234ffff,1,16),0);
});

test('ordinary instruction widths retain upper halves and override semantics',()=>{
  for(const [code,initial,wanted] of [
    [[0x04,1],0x1234fffe,0x1234ffff],
    [[0x05,1,0],0x1234fffe,0x1234ffff],
    [[0x66,0x05,1,0,0,0],0xffffffff,0],
  ]){
    const {cpu}=fixture(code);cpu.eax=initial;assert.equal(cpu.step(),1);assert.equal(cpu.eax,wanted);assert.equal(cpu.eip,code.length);
  }
});

test('CMP updates flags without storing either register or memory',()=>{
  const {cpu,memory,events}=fixture([0x81,0x3e,0,0x20,1,0]);memory.set(0x2000,1);memory.set(0x2001,0);cpu.eax=0x12345678;
  assert.equal(cpu.step(),1);assert.equal(cpu.eflags,0x46);assert.equal(cpu.eax,0x12345678);
  assert.deepEqual(events.filter(e=>e[0]!=='fetch'),[['read',0x2000],['read',0x2001]]);
  assert.equal(memory.get(0x2000),1);
});

test('shift count zero and masked32 preserve flags while one-bit shift/rotate consume width masks',()=>{
  for(const [width,sign] of [[8,128],[16,32768],[32,2147483648]]){
    const {cpu}=fixture();cpu.eflags=0x8d7;
    assert.equal(cpu._shift(sign|1,width,4,0),sign|1);assert.equal(cpu.eflags,0x8d7);
    assert.equal(cpu._shift(sign|1,width,4,32),sign|1);assert.equal(cpu.eflags,0x8d7);
    cpu.eflags=2;assert.equal(cpu._shift(sign,width,4,1),0);assert.equal(cpu.eflags&0x8d5,0x845);
    cpu.eflags=2;assert.equal(cpu._shift(sign,width,0,1),1);assert.equal(cpu.eflags&0x801,0x801);
  }
});

test('memory RMW preserves independently expected byte-callback order',()=>{
  const code=[0x81,0x06,0,0x20,1,0],{cpu,memory,events}=fixture(code);memory.set(0x2000,0xff);memory.set(0x2001,0);
  assert.equal(cpu.step(),1);
  assert.deepEqual(events,[...code.map((_,i)=>['fetch',i]),['read',0x2000],['read',0x2001],['write',0x2000,0],['write',0x2001,1]]);
  assert.equal(cpu.eflags,0x16);
});

test('operand first/second-byte faults preserve identity and architectural restart before writes',()=>{
  for(const address of [0x2000,0x2001]){
    const {cpu,memory,events}=fixture([0x81,0x06,0,0x20,1,0]);memory.set(0x2000,255);memory.set(0x2001,0);
    const original=cpu.read,fault=new I80386Fault(14,0,'authored operand failure');cpu.read=a=>{if(a===address)throw fault;return original(a);};
    cpu.eflags=0x202;cpu.eax=0x12345678;
    assert.throws(()=>cpu.step(),e=>e===fault);assert.equal(cpu.eip,0);assert.equal(cpu.eflags,0x202);assert.equal(cpu.eax,0x12345678);assert.equal(cpu.cycles,0);
    assert.equal(events.some(e=>e[0]==='write'),false);assert.equal(memory.get(0x2000),255);
  }
});

test('write faults retain prior committed bytes rather than inventing memory rollback',()=>{
  for(const address of [0x2000,0x2001]){
    const {cpu,memory}=fixture([0x81,0x06,0,0x20,1,0]);memory.set(0x2000,255);memory.set(0x2001,0);
    const original=cpu.write,fault=new I80386Fault(14,2,'authored write failure');cpu.write=(a,v)=>{if(a===address)throw fault;original(a,v);};
    cpu.eflags=0x202;assert.throws(()=>cpu.step(),e=>e===fault);assert.equal(cpu.eip,0);assert.equal(cpu.eflags,0x202);assert.equal(cpu.cycles,0);
    assert.equal(memory.get(0x2000),address===0x2000?255:0);assert.equal(memory.get(0x2001),0);
    assert.equal(cpu._instructionBytes,6);
  }
});
