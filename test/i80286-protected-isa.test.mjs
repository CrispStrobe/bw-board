import test from 'node:test';
import assert from 'node:assert/strict';
import ProtectedI80286, {ProtectedModeFault,SEG_CS,SEG_DS,SEG_SS} from '../src/experimental/i80286-protected.js';

function fixture(){
  const mem=new Map(),reads=[],writes=[];
  const cpu=new ProtectedI80286({read:a=>{reads.push(a);return mem.get(a)??0;},fetch:a=>{reads.push(a);return mem.get(a)??0;},
    write:(a,v)=>{writes.push([a,v&255]);mem.set(a,v&255);}});
  const put=(a,b)=>b.forEach((v,i)=>mem.set(a+i,v));
  const desc=(a,base,limit,access)=>put(a,[limit&255,limit>>8,base&255,base>>8&255,base>>16&255,access,0,0]);
  const word=a=>(mem.get(a)??0)|((mem.get(a+1)??0)<<8);
  return{cpu,mem,reads,writes,put,desc,word};
}

function boot(f,program){
  f.put(0,[0x0f,1,0x16,0,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);
  f.put(0x100,[0x1f,0,0,2,0]);
  f.desc(0x208,0x100000,0xffff,0x9a);f.desc(0x210,0x120000,0xffff,0x92);f.desc(0x218,0x130000,0xffff,0x92);
  f.put(0x100000,[0xb8,0x10,0,0x8e,0xd8,0xb8,0x18,0,0x8e,0xd0,0xbc,0,2,...program]);
  f.cpu.cs=0;f.cpu.ip=0;for(let i=0;i<9;i++)f.cpu.step();
  assert.equal(f.cpu.ip,13);assert.equal(f.cpu.segmentCaches[SEG_DS].base,0x120000);assert.equal(f.cpu.segmentCaches[SEG_SS].base,0x130000);
}

test('owned protected guest runs arithmetic loop, stack call, and high-memory RMW',()=>{
  const f=fixture();boot(f,[
    0xbb,0x20,0, 0xbe,4,0,                    // BX=20, SI=4
    0xc7,0x40,2,1,0,                          // MOV word [BX+SI+2],1
    0xb9,5,0,                                 // CX=5
    0x01,0x48,2, 0xe2,0xfb,                   // ADD [BX+SI+2],CX / LOOP
    0xe8,1,0, 0xf4,                           // CALL sub / HLT
    0xff,0x40,2, 0xc3,                        // sub: INC word [...] / RET
  ]);
  for(let budget=40;budget--&&!f.cpu.halted;)f.cpu.step();
  assert.equal(f.cpu.halted,true);assert.equal(f.cpu.cx,0);
  assert.equal(f.word(0x120026),17);assert.equal(f.cpu.sp,0x200,'near CALL/RET balanced protected stack');
  assert.equal(f.cpu.pc,0x100024);
});

test('all 16-bit ModR/M bases choose DS or SS and honor an override',()=>{
  const f=fixture();boot(f,[]);Object.assign(f.cpu,{bx:0x10,si:2,di:4,bp:0x20});
  const probes=[
    [[0x8b,0x00],SEG_DS,0x12], [[0x8b,0x01],SEG_DS,0x14],
    [[0x8b,0x02],SEG_SS,0x22], [[0x8b,0x03],SEG_SS,0x24],
    [[0x8b,0x04],SEG_DS,0x02], [[0x8b,0x05],SEG_DS,0x04],
    [[0x8b,0x06,0x30,0],SEG_DS,0x30], [[0x8b,0x07],SEG_DS,0x10],
    [[0x3e,0x8b,0x02],SEG_DS,0x22],
  ];
  for(let i=0;i<probes.length;i++){
    const [bytes,id,off]=probes[i],base=f.cpu.segmentCaches[id].base,value=0x4100+i;
    f.mem.set(base+off,value&255);f.mem.set(base+off+1,value>>8);
    const at=f.cpu.ip;f.put(0x100000+at,bytes);f.cpu.step();assert.equal(f.cpu.ax,value,`probe ${i}`);
  }
});

test('ALU forms produce core flags and compare without committing a destination',()=>{
  const f=fixture();boot(f,[
    0xb8,0xff,0x7f, 0x05,1,0,                 // AX=7FFF; ADD AX,1 (OF,SF)
    0x3d,0,0x80,                              // CMP AX,8000 (ZF)
    0x25,0xff,0,                              // AND AX,00FF
    0x0d,0,1,                                 // OR AX,0100
    0x35,0x00,1,                              // XOR AX,0100 => 0
    0x40,0x48,0xf4,                           // INC/DEC AX; HLT
  ]);
  f.cpu.step();f.cpu.step();assert.equal(f.cpu.ax,0x8000);assert.ok(f.cpu.flags&0x800);
  f.cpu.step();assert.equal(f.cpu.ax,0x8000);assert.ok(f.cpu.flags&0x40);
  while(!f.cpu.halted)f.cpu.step();assert.equal(f.cpu.ax,0);assert.ok(f.cpu.flags&0x40);
});

test('memory RMW preflights write permission before reading the operand',()=>{
  const f=fixture();boot(f,[0x2e,0x01,0x06,0x00,0x02]);f.cpu.ax=1;
  f.mem.set(0x100200,7);f.mem.set(0x100201,0);
  const reads=f.reads.length,writes=f.writes.length,state=f.cpu.getProtectedState();
  assert.throws(()=>f.cpu.step(),e=>e instanceof ProtectedModeFault&&e.vector===13);
  assert.deepEqual(f.cpu.getProtectedState(),state);assert.equal(f.writes.length,writes);
  assert.ok(!f.reads.slice(reads).includes(0x100200),'forbidden RMW did not read its data operand');
});

test('near control-transfer limit faults restart register and stack state',()=>{
  const f=fixture();boot(f,[0xe8,0x00,0x01]);f.cpu.segmentCaches[SEG_CS].limit=0xff;
  const state=f.cpu.getProtectedState(),writes=f.writes.length;
  assert.throws(()=>f.cpu.step(),e=>e instanceof ProtectedModeFault&&e.vector===13);
  assert.deepEqual(f.cpu.getProtectedState(),state);assert.equal(f.writes.length,writes);
});
