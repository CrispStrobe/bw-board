// Detached-copy prerequisite only, not a paused user-facing snapshot API.
import test from 'node:test';
import assert from 'node:assert/strict';
import ATA from '../src/experimental/ata16.js';
import {createI80386Adapter} from '../src/i80386-adapter.js';
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
