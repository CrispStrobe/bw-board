import test from 'node:test';
import assert from 'node:assert/strict';
import I80386,{I80386Fault} from '../src/experimental/i80386.js';

function fixture(bytes,{input=0x78563412}={}){
  const memory=new Map(bytes.map((value,index)=>[0x100000+index,value])),reads=[],ports=[];
  const cpu=new I80386({read:a=>{reads.push(a>>>0);return memory.get(a>>>0)??0;},fetch:a=>memory.get(a>>>0)??0,
    write:(a,v)=>memory.set(a>>>0,v&255),inPort:(port,width)=>{ports.push(['in',port,width]);return input;},outPort:(port,value,width)=>ports.push(['out',port,width,value>>>0])});
  cpu.cr0=1;cpu.cs=0x1b;cpu.ss=0x23;cpu.eip=0;cpu.esp=0x800;
  cpu.segmentCaches[1]={base:0x100000,limit:0xffff,default32:true,present:true,code:true,readable:true,writable:false,access:0xfa};
  cpu.segmentCaches[2]={base:0x120000,limit:0xffff,default32:true,present:true,code:false,readable:true,writable:true,access:0xf2};
  cpu.tr={selector:0x28,base:0x600,limit:0x2100,present:true,type:11};
  memory.set(0x666,0x68);memory.set(0x667,0);
  const setBitmap=(port,denied=true)=>{const numbered=port>>>0,address=0x600+0x68+(numbered>>>3),bit=1<<(numbered&7);memory.set(address,denied?(memory.get(address)??0)|bit:(memory.get(address)??0)&~bit);};
  return{cpu,memory,reads,ports,setBitmap};
}

test('CPL above IOPL consults the bitmap for immediate and DX ports at each width',()=>{
  const f=fixture([0xe4,0x20,0x66,0xed,0xee]);f.cpu.dx=7;f.cpu.al=0xaa;
  f.cpu.step();assert.equal(f.cpu.al,0x12);assert.deepEqual(f.ports.shift(),['in',0x20,8]);
  f.setBitmap(8);const before=f.cpu.eax;
  assert.throws(()=>f.cpu.step(),e=>e instanceof I80386Fault&&e.vector===13&&e.errorCode===0);
  assert.equal(f.cpu.eax,before);assert.equal(f.ports.length,0,'a denied crossing port performs no callback');
  f.setBitmap(8,false);f.cpu.step();assert.deepEqual(f.ports.shift(),['in',7,16]);
  f.cpu.step();assert.deepEqual(f.ports.shift(),['out',7,8,f.cpu.al]);
});

test('IOPL admission bypasses an absent bitmap while missing and denied bitmap bytes raise GP',()=>{
  const privileged=fixture([0xe4,0x20]);privileged.cpu.eflags=0x3002;privileged.cpu.tr={selector:0,base:0,limit:0,present:false,type:0};
  privileged.cpu.step();assert.equal(privileged.ports.length,1);
  const short=fixture([0xe4,0x20]);short.cpu.tr.limit=0x66;
  assert.throws(()=>short.cpu.step(),e=>e instanceof I80386Fault&&e.vector===13&&e.errorCode===0);
  const denied=fixture([0xe4,0x20]);denied.setBitmap(0x20);
  assert.throws(()=>denied.cpu.step(),e=>e instanceof I80386Fault&&e.vector===13&&e.errorCode===0);assert.equal(denied.ports.length,0);
  const noTrailingByte=fixture([0xe4,0]);noTrailingByte.cpu.tr.limit=0x68;
  assert.throws(()=>noTrailingByte.cpu.step(),e=>e instanceof I80386Fault&&e.vector===13&&e.errorCode===0);
  assert.equal(noTrailingByte.ports.length,0,'bitmap base equal to the TSS limit means no bitmap');
  const inclusiveLastByte=fixture([0xe4,0xf8]);inclusiveLastByte.cpu.tr.limit=0x87;
  inclusiveLastByte.cpu.step();
  assert.deepEqual(inclusiveLastByte.ports,[['in',0xf8,8]],'the byte at the inclusive TSS limit remains part of the bitmap');
});

test('port FFFF width crossing consults the mandatory trailing deny byte',()=>{
  const f=fixture([0x66,0xed]);f.cpu.dx=0xffff;f.cpu.tr.limit=0x2068;
  f.setBitmap(0xffff,false);f.setBitmap(0x10000,true);
  assert.throws(()=>f.cpu.step(),e=>e instanceof I80386Fault&&e.vector===13&&e.errorCode===0);
  assert.equal(f.ports.length,0);
});

test('TSS bitmap bytes use supervisor paging while the CPL3 instruction remains user mapped',()=>{
  const memory=new Map(),ports=[];
  const put=(at,bytes)=>bytes.forEach((value,index)=>memory.set(at+index,value&255));
  const put32=(at,value)=>put(at,[value,value>>>8,value>>>16,value>>>24]);
  const cpu=new I80386({read:a=>memory.get(a>>>0)??0,fetch:a=>memory.get(a>>>0)??0,
    write:(a,v)=>memory.set(a>>>0,v&255),inPort:(port,width)=>{ports.push([port,width]);return 0x5a;}});
  put32(0x1000,0x2007);put32(0x2000,0x4003);put32(0x2000+0x400,0x3007);
  put(0x3000,[0xe4,0x20]);put(0x4666,[0x68,0]);put(0x466c,[0]);
  cpu.cr0=0x80000001;cpu.cr3=0x1000;cpu.cs=0x1b;cpu.eip=0;cpu.eflags=2;
  cpu.segmentCaches[1]={base:0x100000,limit:0xffff,default32:true,present:true,code:true,readable:true,writable:false,access:0xfa};
  cpu.tr={selector:0x28,base:0x600,limit:0x2100,present:true,type:11};
  cpu.step();assert.equal(cpu.al,0x5a);assert.deepEqual(ports,[[0x20,8]]);
});
