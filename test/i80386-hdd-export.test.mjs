// Detached-copy prerequisite only, not a paused user-facing snapshot API.
import test from 'node:test';
import assert from 'node:assert/strict';
import ATA from '../src/experimental/ata16.js';
import {createI80386Adapter,captureI80386AtaMaster} from '../src/i80386-adapter.js';
const geometry={cylinders:1,heads:1,sectors:2};
const kinds=['uint8','buffer','offset-uint8','offset-buffer'];
function input(kind,length=1024){
 const offset=kind.startsWith('offset-')?13:0;
 const backing=kind.includes('buffer')?Buffer.alloc(length+offset+17,0xcc):new Uint8Array(length+offset+17).fill(0xcc);
 const view=backing.subarray(offset,offset+length);for(let i=0;i<length;i++)view[i]=i&255;
 return {view,backing,offset,neighbours:()=>[...backing.subarray(0,offset),...backing.subarray(offset+length)]};
}
function command(ata,operation,slave=false){
 ata.writeRegister(6,slave?0xb0:0xa0);ata.writeRegister(2,1);ata.writeRegister(3,1);ata.writeRegister(4,0);ata.writeRegister(5,0);ata.writeRegister(7,operation);
}
for(const kind of kinds)test(`ATA ${kind} master/slave inputs and media copies are detached`,()=>{
 const master=input(kind),slave=input(kind),ms=master.neighbours(),ss=slave.neighbours();slave.view[0]=0x34;slave.view[1]=0x12;
 const ata=new ATA(master.view,geometry,{slaveImage:slave.view});ata.slaveEnabled=true;
 assert.equal(ata.image.constructor,Uint8Array);assert.equal(ata.slaveImage.constructor,Uint8Array);
 master.view[0]=0x99;slave.view[0]=0x88;assert.equal(ata.image[0],0);assert.equal(ata.slaveImage[0],0x34);
 const callerMaster=Uint8Array.from(master.backing),callerSlave=Uint8Array.from(slave.backing);
 command(ata,0x20,true);assert.equal(ata.readData16(),0x1234);for(let i=1;i<256;i++)ata.readData16();
 command(ata,0x30,true);for(let i=0;i<256;i++)ata.writeData16(0xa000|i);
 assert.equal(ata.slaveImage[0],0);assert.equal(ata.slaveImage[1],0xa0);assert.equal(ata.image[1],1);
 command(ata,0x30);for(let i=0;i<256;i++)ata.writeData16(0xb000|i);
 assert.deepEqual([...master.backing],[...callerMaster]);assert.deepEqual([...slave.backing],[...callerSlave]);assert.deepEqual(master.neighbours(),ms);assert.deepEqual(slave.neighbours(),ss);
 const a=ata.mediaBytes(),b=ata.mediaBytes();assert.equal(a.constructor,Uint8Array);assert.equal(a.length,1024);assert.notEqual(a.buffer,b.buffer);assert.notEqual(a.buffer,ata.image.buffer);
 a[0]=0x55;assert.equal(ata.image[0],0);assert.equal(b[0],0);ata.image[1]=0x77;assert.equal(b[1],0xb0);
});
test('media copy during PIO read does not mutate FIFO, task file or IRQ state',()=>{
 const ata=new ATA(input('buffer').view,geometry);command(ata,0x20);
 const state=()=>({status:ata.status,sector:ata.sectorNumber,count:ata.sectorCount,index:ata.wordIndex,direction:ata.direction,irq:ata._irqPending,irqOutput:ata._irqOutput,buffer:[...ata.buffer]});
 const before=state(),copy=ata.mediaBytes();copy.fill(0xff);assert.deepEqual(state(),before);
 ata.image[0]=0xee;assert.equal(ata.readData16(),0x0100);for(let i=1;i<256;i++)ata.readData16();assert.equal(ata.readRegister(7),0x50);
});
for(const kind of kinds)test(`adapter ${kind} initial and replacement media are detached`,()=>{
 const a=createI80386Adapter(),first=input(kind,4*17*512);a.attachAtaImage(first.view);const ata=a.machine.ata;
 assert.equal(ata.image.constructor,Uint8Array);first.view[0]=0xee;assert.equal(ata.image[0],0);
 command(ata,0x20);assert.equal(ata.readData16(),0x0100);
 const next=input(kind,4*17*512);next.view[0]=0x42;a.attachAtaImage(next.view);assert.equal(a.machine.ata,ata);assert.equal(ata.image[0],0x42);
 next.view[0]=0x99;assert.equal(ata.image[0],0x42);assert.equal(ata.readRegister(7)&0x88,0);
 const copy=ata.mediaBytes();copy[0]=0x55;assert.equal(ata.image[0],0x42);ata.image[0]=0x66;assert.equal(next.view[0],0x99);
 assert.deepEqual(next.neighbours(),new Array(next.offset+17).fill(0xcc));
});
test('null slave and existing type, CHS and length refusals remain',()=>{
 const ata=new ATA(new Uint8Array(1024),geometry);assert.equal(ata.slaveImage,null);
 assert.throws(()=>new ATA([],geometry));assert.throws(()=>new ATA(new Uint8Array(512),geometry));
 assert.throws(()=>new ATA(new Uint8Array(1024),{cylinders:1,heads:0,sectors:2}));
 assert.throws(()=>new ATA(new Uint8Array(1024),geometry,{slaveImage:new Uint8Array(512)}));
 const a=createI80386Adapter();assert.throws(()=>a.attachAtaImage(new Uint8Array(1024)));a.attachAtaImage(new Uint8Array(4*17*512));const original=a.machine.ata.image;
 assert.throws(()=>a.attachAtaImage(new Uint8Array(512)));assert.equal(a.machine.ata.image,original);
});


test('synchronous master capture copies exact CHS and boundary without IO or state mutation',()=>{
 const ata=new ATA(input('buffer').view,geometry);const machine={ata,cpu:{cycles:7},cycles:42};
 // Completed PIO operations retain historical counters and an unacknowledged IRQ.
 command(ata,0x30);for(let i=0;i<256;i++)ata.writeData16(0x6100|i);
 ata.wordIndex=256;ata.sectorCount=1;
 let calls=0;ata.readRegister=ata.readData16=ata.advance=()=>{calls++;throw Error('capture performed IO');};
 const state=JSON.stringify(ata),original=ata.image.slice();
 const r=captureI80386AtaMaster(machine);assert.equal(r.schema,'bw.i80386-master-hdd-copy.v1');assert.equal(r.drive,'master');
 assert.deepEqual(r.geometry,geometry);assert.equal(r.byteLength,1024);assert.deepEqual(r.boundary,{cpuCycles:7,machineCycles:42});assert.deepEqual(r.bytes,original);
 assert.equal(JSON.stringify(ata),state);assert.equal(calls,0);r.bytes[0]=0xff;r.geometry.heads=7;assert.equal(ata.image[0],0);assert.equal(ata.geometry.heads,1);
 ata.image[1]=0xff;assert.equal(r.bytes[1],0x61);
});
test('master capture refuses every active ATA state without IO or media changes',()=>{
 const ata=new ATA(new Uint8Array(1024),geometry),machine={ata,cpu:{cycles:0},cycles:0};
 for(const [key,value] of [['status',0x80],['status',0x08],['control',4],['buffer',new Uint8Array(512)],['direction','read'],['_intersector','read'],['_intersectorRemaining',1],['status',NaN],['control',true]]){
  ata.reset();ata[key]=value;const before=ata.image.slice();const result=captureI80386AtaMaster(machine);
  assert.equal(result.refused.code,'snapshot-ata-busy',key);assert.deepEqual(ata.image,before);
 }
});
test('master capture validates CHS, extent and cap before allocating returned bytes',()=>{
 assert.equal(captureI80386AtaMaster({}).refused.code,'snapshot-no-master');
 const ata=new ATA(new Uint8Array(1024),geometry),machine={ata,cpu:{cycles:0},cycles:0};
 for(const g of [{cylinders:true,heads:1,sectors:2},{cylinders:1,heads:17,sectors:2},{cylinders:1,heads:1,sectors:256},{cylinders:1.5,heads:1,sectors:2}]){
  ata.geometry=g;assert.equal(captureI80386AtaMaster(machine).refused.code,'snapshot-invalid-media');
 }
 ata.geometry=geometry;ata.image=new Uint8Array(512);assert.equal(captureI80386AtaMaster(machine).refused.code,'snapshot-invalid-media');
 // A shadowed public length cannot manufacture an admitted extent.
 ata.image=new Uint8Array(512);Object.defineProperty(ata.image,'length',{value:1024});
 Object.defineProperty(ata.image,'byteLength',{value:1024});ata.geometry=geometry;
 assert.equal(captureI80386AtaMaster(machine).refused.code,'snapshot-invalid-media');
 ata.image=[];assert.equal(captureI80386AtaMaster(machine).refused.code,'snapshot-invalid-media');
});
test('adapter capture delegates its own machine and remains master-only with slave selected',()=>{
 const a=createI80386Adapter(),view=input('offset-buffer',4*17*512).view;a.attachAtaImage(view);const ata=a.machine.ata;
 ata.slaveImage=new Uint8Array(view.length).fill(0xaa);ata.slaveEnabled=true;ata.driveHead=0xb0;
 const r=a.captureAtaMaster();assert.equal(r.drive,'master');assert.equal(r.bytes[0],0);assert.equal(r.bytes[1],1);
 view[0]=0xee;assert.equal(r.bytes[0],0);assert.equal(ata.slaveImage[0],0xaa);
});


test('intrinsic media extent ignores shadowed public properties and rejects proxies',()=>{
 const image=new Uint8Array(1024).fill(0x5a);
 Object.defineProperty(image,'length',{value:1});Object.defineProperty(image,'byteLength',{value:999});
 const ata=new ATA(new Uint8Array(1024),geometry);ata.image=image;
 const machine={ata,cpu:{cycles:7},cycles:42};const r=captureI80386AtaMaster(machine);
 assert.equal(r.byteLength,1024);assert.equal(r.bytes.length,1024);assert.equal(r.bytes.byteLength,1024);assert.ok(r.bytes.every(x=>x===0x5a));
 const before=JSON.stringify(ata);
 for(const counter of [NaN,-1,0.5,true,Infinity]){
  machine.cpu.cycles=counter;assert.equal(captureI80386AtaMaster(machine).refused.code,'snapshot-invalid-media');
 }
 machine.cpu.cycles=7;machine.cycles=true;assert.equal(captureI80386AtaMaster(machine).refused.code,'snapshot-invalid-media');
 assert.equal(JSON.stringify(ata),before);
 machine.cycles=42;ata.image=new Proxy(image,{});assert.equal(captureI80386AtaMaster(machine).refused.code,'snapshot-invalid-media');
 ata.image=new Uint16Array(512);assert.equal(captureI80386AtaMaster(machine).refused.code,'snapshot-invalid-media');
 const detached=new Uint8Array(1024);structuredClone(detached.buffer,{transfer:[detached.buffer]});ata.image=detached;
 assert.equal(captureI80386AtaMaster(machine).refused.code,'snapshot-invalid-media');
});


test('over-cap actual extent refuses before allocating a returned copy',()=>{
 const ata=new ATA(new Uint8Array(1024),geometry);
 // One unfilled owned 64MiB+512 allocation; CHS has exactly131073 sectors.
 ata.image=new Uint8Array(64*1024*1024+512);ata.geometry={cylinders:43691,heads:3,sectors:1};
 const result=captureI80386AtaMaster({ata,cpu:{cycles:0},cycles:0});
 assert.equal(result.refused.code,'snapshot-too-large');assert.equal(result.bytes,undefined);
 ata.image=null;
});
test('public extent getters are never invoked for admitted typed-array storage',()=>{
 const image=new Uint8Array(1024).fill(0x7b);let calls=0;
 for(const key of ['length','byteLength'])Object.defineProperty(image,key,{get(){calls++;throw Error('public extent getter invoked');}});
 const ata=new ATA(new Uint8Array(1024),geometry);ata.image=image;
 const result=captureI80386AtaMaster({ata,cpu:{cycles:0},cycles:0});
 assert.equal(result.byteLength,1024);assert.equal(result.bytes.length,1024);assert.equal(result.bytes[1023],0x7b);assert.equal(calls,0);
});
