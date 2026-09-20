import test from 'node:test';
import assert from 'node:assert/strict';
import {createDoomFat16Hdd,readDoomFat16File,DOOM_PARTITION} from '../scripts/lib/i80386-doom-fat16-image.mjs';
const word=(b,o)=>b[o]|b[o+1]<<8;
const dword=(b,o)=>(word(b,o)|word(b,o+2)<<16)>>>0;

test('owned Doom HDD is a partitioned type-1 FAT16 disk with exact file chains',()=>{
  const exe=Uint8Array.from({length:1500},(_,i)=>i&255);
  const wad=Uint8Array.from({length:2500},(_,i)=>(i*3)&255);
  const {image,manifest}=createDoomFat16Hdd({doomExe:exe,doomWad:wad});
  assert.equal(image.length,306*4*17*512);
  assert.deepEqual(Array.from(image.slice(510,512)),[0x55,0xaa]);
  assert.equal(image[450],0x04);
  assert.equal(dword(image,454),DOOM_PARTITION.startLba);
  assert.equal(dword(image,458),DOOM_PARTITION.sectors);
  const volume=DOOM_PARTITION.startLba*512;
  assert.equal(word(image,volume+11),512);
  assert.equal(word(image,volume+22),41);
  assert.equal(dword(image,volume+28),17);
  assert.deepEqual(Array.from(image.slice(volume+510,volume+512)),[0x55,0xaa]);
  const fat=(DOOM_PARTITION.startLba+1)*512;
  assert.deepEqual([word(image,fat+4),word(image,fat+6)],[3,0xffff]);
  const root=(DOOM_PARTITION.startLba+1+82)*512;
  assert.equal(Buffer.from(image.slice(root,root+11)).toString(),'DOOM    EXE');
  assert.equal(dword(image,root+28),exe.length);
  assert.equal(Buffer.from(image.slice(root+32,root+43)).toString(),'DOOM1   WAD');
  assert.equal(dword(image,root+60),wad.length);
  assert.deepEqual(manifest.files.map(file=>file.bytes),[1500,2500]);
  assert.deepEqual(readDoomFat16File(image,'DOOM    EXE'),exe);
  assert.deepEqual(readDoomFat16File(image,'DOOM1   WAD'),wad);
  const fat1=(DOOM_PARTITION.startLba+1)*512;
  const fat2=(DOOM_PARTITION.startLba+1+DOOM_PARTITION.fatSectors)*512;
  assert.deepEqual(image.slice(fat1,fat1+DOOM_PARTITION.fatSectors*512),
    image.slice(fat2,fat2+DOOM_PARTITION.fatSectors*512),'both FAT copies match');
});

test('owned Doom HDD rejects files larger than the fixed partition',()=>{
  assert.throws(()=>createDoomFat16Hdd({doomExe:new Uint8Array(),doomWad:new Uint8Array(1)}),/nonempty/);
  assert.throws(()=>createDoomFat16Hdd({doomExe:new Uint8Array(11_000_000),doomWad:new Uint8Array(1)}),
    /exceed/);
});

test('owned Doom HDD carries an exact ordinary short demo file when requested',()=>{
  const exe=Uint8Array.of(1),wad=Uint8Array.of(2),demo=Uint8Array.of(109,2,1,1,0,0,0,0,0,1,0,0,0,0x80);
  const {image,manifest}=createDoomFat16Hdd({doomExe:exe,doomWad:wad,
    extraFiles:[{name:'ASTRA   LMP',bytes:demo}]});
  assert.deepEqual(readDoomFat16File(image,'ASTRA   LMP'),demo);
  assert.deepEqual(manifest.files.map(file=>file.name),['DOOM    EXE','DOOM1   WAD','ASTRA   LMP']);
  assert.throws(()=>createDoomFat16Hdd({doomExe:exe,doomWad:wad,
    extraFiles:[{name:'astra.lmp',bytes:demo}]}),/canonical uppercase/);
  for(const name of ['           ',' A      LMP','AS TRA  LMP'])
    assert.throws(()=>createDoomFat16Hdd({doomExe:exe,doomWad:wad,
      extraFiles:[{name,bytes:demo}]}),/canonical uppercase/);
  assert.throws(()=>createDoomFat16Hdd({doomExe:exe,doomWad:wad,
    extraFiles:[{name:'DOOM    EXE',bytes:demo}]}),/duplicate|short name/);
  const tooMany=Array.from({length:511},(_,index)=>({
    name:`X${index.toString(36).toUpperCase()}`.padEnd(8)+'BIN',bytes:Uint8Array.of(index&255)}));
  assert.throws(()=>createDoomFat16Hdd({doomExe:exe,doomWad:wad,extraFiles:tooMany}),/root directory/);
});
