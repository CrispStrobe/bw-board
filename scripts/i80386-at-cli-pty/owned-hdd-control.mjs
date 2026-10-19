import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386AtFat16Image} from '../lib/i80386-at-hdd-image.mjs';
import {makeOwnedHdd,readyText,doneText,geometry,sha256} from './owned-hdd.mjs';

test('owned CLI boot program is one finite signed FAT16 sector on the 306x4x17 HDD',()=>{
  const {image,bootCodeBytes,imageSha256,bootSectorSha256}=makeOwnedHdd();
  const base=createI80386AtFat16Image();
  assert.deepEqual(geometry,{cylinders:306,heads:4,sectors:17});
  assert.equal(image.length,10653696);
  assert.equal(bootCodeBytes,82);
  assert.equal(image[510],0x55);assert.equal(image[511],0xaa);
  assert.ok(Buffer.from(image.subarray(62,510)).includes(Buffer.from(readyText+'\0')));
  assert.ok(Buffer.from(image.subarray(62,510)).includes(Buffer.from(doneText+'\0')));
  assert.deepEqual(image.subarray(0,62),base.subarray(0,62),'FAT16 BPB remains intact');
  assert.deepEqual(image.subarray(512),base.subarray(512),'all nonboot disk bytes remain intact');
  assert.equal(bootSectorSha256,'ffc2a036857bae7e955160b8b34c69b16baf8ef6fbd83a1a3e8cf8365d00c521');
  assert.equal(imageSha256,'a5245b3f5cb74761e87c372fd38f49cd0e21bf3e870708d1f427e994ba81cd9b');
  assert.equal(sha256(image),imageSha256);
});
