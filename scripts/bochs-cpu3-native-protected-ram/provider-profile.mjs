/** Fixed native provider configuration; no caller options or I/O domain. */
export {coldBoardConfig, fixedProtectedRamRom as fixedColdBios} from './profile.mjs';
import {protectedRamProfile,stores,expectedRamPage} from './profile.mjs';
import assert from 'node:assert/strict';
export {expectedRamPage};
export const coldBoardProfile=Object.freeze({...protectedRamProfile,maxPortEvents:0,maxDebugBytes:0,maxStatusReads:0});
export const coldOutAllowed=()=>false,coldInAllowed=()=>false;
export function validateProtectedWrite(raw,bytes,index,admitted){
 assert.ok(Number.isSafeInteger(index)&&index>=0&&index<4,'four ordered stores');assert.equal(admitted,false,'no code writes after execute admission');
 assert.ok(bytes instanceof Uint8Array);const e=stores[index];assert.equal(raw,e.raw);assert.deepEqual(Array.from(bytes),e.bytes);return index+1;
}
export function validateProtectedRead(raw,width){
 assert.ok(Number.isSafeInteger(raw)&&Number.isSafeInteger(width)&&width>0&&width<=16);
 assert.ok(raw>=0x618&&raw<0x620&&width<=0x620-raw||raw>=0xf0180&&raw<0xf0186&&width<=0xf0186-raw,'only descriptor or GDTR pointer');
}
