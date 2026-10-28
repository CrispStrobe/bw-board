import test from 'node:test';
import assert from 'node:assert/strict';
import I80386, {I80386Fault} from '../src/experimental/i80386.js';

function fixture(bytes, mode = 'real') {
  const fetches = [], reads = [], writes = [];
  const cpu = new I80386({
    fetch(address) { fetches.push([address, cpu.eip, cpu._instructionBytes]); return bytes[address] ?? 0; },
    read(address) { reads.push(address); return 0x5a; },
    write(address, value) { writes.push([address, value]); },
  });
  cpu.bx = 0x1111; cpu.bp = 0x2222; cpu.si = 0x3333; cpu.di = 0x4444;
  if (mode !== 'real') cpu.cr0 = 1;
  if (mode === 'vm86') cpu.eflags |= 0x20000;
  return {cpu, fetches, reads, writes};
}
const fault13 = error => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0;

test('direct disp16 has independent unsigned address, reg, DS and all override expectations', () => {
  for (const mode of ['real', 'protected16', 'vm86'])
    for (const reg of [0,1,2,3,4,5,6,7])
      for (const off of [0,0x7fff,0x8000,0xffff])
        for (const override of [null,0,1,2,3,4,5]) {
          const {cpu, fetches, reads} = fixture([(reg << 3) | 6, off & 255, off >>> 8], mode);
          const actual = cpu._decodeEA(false, override);
          assert.deepEqual(actual, {reg,rm:6,isReg:false,off,seg:override ?? 3,usesEsp:false});
          assert.deepEqual(fetches, [[0,0,undefined],[1,1,1],[2,2,2]]);
          assert.equal(cpu.eip,3); assert.equal(cpu._instructionBytes,3); assert.deepEqual(reads,[]);
        }
});

test('neighboring BP forms, register and 32-bit forms keep independent expectations', () => {
  for (const [bytes,address32,expected] of [
    [[0x46,0xff],false,{reg:0,rm:6,isReg:false,off:0x2221,seg:2,usesEsp:false}],
    [[0x86,0xfe,0xff],false,{reg:0,rm:6,isReg:false,off:0x2220,seg:2,usesEsp:false}],
    [[0xc6],false,{reg:0,rm:6,isReg:true}],
    [[0x06],true,{reg:0,rm:6,isReg:false,off:0x3333,seg:3,usesEsp:false}],
    [[0x05,0x78,0x56,0x34,0x12],true,{reg:0,rm:5,isReg:false,off:0x12345678,seg:3,usesEsp:false}],
    [[0x04,0x24],true,{reg:0,rm:4,isReg:false,off:0,seg:2,usesEsp:true}],
  ]) {
    const {cpu} = fixture(bytes); assert.deepEqual(cpu._decodeEA(address32,null),expected);
    assert.equal(cpu.eip,bytes.length);
  }
});

test('instruction address-size override selects disp16 inside 32-bit code', () => {
  for (const default32 of [false,true]) {
    const bytes = [...(default32 ? [0x67] : []),0x8d,0x06,0x34,0x92];
    const {cpu,reads} = fixture(bytes,'protected16');
    cpu.segmentCaches[1].default32 = default32;
    cpu.eax=0xaaaa0000; cpu.step();
    assert.equal(cpu.eax,default32 ? 0x9234 : 0xaaaa9234);
    assert.equal(cpu.eip,bytes.length); assert.deepEqual(reads,[]);
  }
});

test('actual MOV uses DS or selected segment, never the BP default', () => {
  for (const [prefix,segment] of [[[],3],[[0x26],0],[[0x36],2],[[0x64],4],[[0x65],5]]) {
    const {cpu,reads} = fixture([...prefix,0x8a,0x06,0x34,0x12],'protected16');
    for (let i=0;i<6;i++) if(i!==1) cpu.segmentCaches[i].base=(i+1)*0x10000;
    cpu.step(); assert.equal(cpu.al,0x5a);
    assert.deepEqual(reads,[(segment+1)*0x10000+0x1234]);
  }
});

test('first and second displacement callback faults preserve original exception and partial cursor', () => {
  for (const failing of [1,2]) {
    const {cpu,fetches,reads,writes} = fixture([0x06,0x34,0x12]);
    const original = cpu.fetch, error = new Error('authored displacement callback fault');
    cpu.fetch = address => { if(address===failing) {fetches.push([address,cpu.eip,cpu._instructionBytes]);throw error;} return original(address); };
    assert.throws(()=>cpu._decodeEA(false,null),caught=>caught===error);
    assert.equal(cpu.eip,failing); assert.equal(cpu._instructionBytes,failing);
    assert.deepEqual(fetches.map(row=>row[0]),Array.from({length:failing+1},(_,i)=>i));
    assert.deepEqual(reads,[]); assert.deepEqual(writes,[]);
  }
});

test('CS and instruction-length boundaries refuse the second displacement byte before bus access', () => {
  for (const boundary of ['segment','length']) {
    const {cpu,fetches,reads} = fixture([0x06,0x34,0x12],'protected16');
    if(boundary==='segment') cpu.segmentCaches[1].limit=1;
    else cpu._instructionBytes=13;
    assert.throws(()=>cpu._decodeEA(false,null),fault13);
    assert.equal(cpu.eip,2); assert.equal(cpu._instructionBytes,boundary==='length'?15:2);
    assert.deepEqual(fetches.map(row=>row[0]),[0,1]); assert.deepEqual(reads,[]);
  }
});

test('page-crossing displacement fault has exact translation order, partial cursor and CR2', () => {
  const {cpu,fetches,reads} = fixture([]); const translated=[];
  cpu.eip=0xffe;
  cpu.fetch=address=>{fetches.push([address,cpu.eip,cpu._instructionBytes]);return address===0xffe?6:0x34;};
  const fault=new I80386Fault(14,4,'authored missing displacement page');
  cpu._translate=linear=>{translated.push(linear);if(linear===0x1000){cpu.cr2=linear;throw fault;}return linear;};
  assert.throws(()=>cpu._decodeEA(false,null),error=>error===fault);
  assert.deepEqual(translated,[0xffe,0xfff,0x1000]);
  assert.deepEqual(fetches.map(row=>row[0]),[0xffe,0xfff]);
  assert.equal(cpu.eip,0x1000);assert.equal(cpu._instructionBytes,2);assert.equal(cpu.cr2,0x1000);assert.deepEqual(reads,[]);
});

test('whole MOV displacement page fault restores architectural state without operand effects', () => {
  const {cpu,fetches,reads,writes}=fixture([0x8a,0x06,0x34,0x12]);
  cpu.eax=0x12345678; cpu.eflags=0x202; const before=cpu._snapshotInstruction();
  const original=cpu.fetch,fault=new I80386Fault(14,0,'authored displacement page fault');
  cpu.fetch=address=>{if(address===3){cpu.cr2=0x1000;throw fault;}return original(address);};
  assert.throws(()=>cpu.step(),error=>error===fault);
  assert.deepEqual(cpu._snapshotInstruction(),before);assert.equal(cpu.cycles,0);assert.equal(cpu._instructionBytes,3);
  assert.equal(cpu.cr2,0x1000);assert.deepEqual(fetches.map(row=>row[0]),[0,1,2]);assert.deepEqual(reads,[]);assert.deepEqual(writes,[]);
});
