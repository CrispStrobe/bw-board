/** Fixed factory profile. Provider address guards supplement stricter C owner/kind guards. */
import assert from 'node:assert/strict';
import {protectedStackProfile,stores,bootStores,expectedPages} from './profile.mjs';
export {coldBoardConfig,fixedProtectedStackRom as fixedColdBios} from './profile.mjs';
export const coldBoardProfile=Object.freeze({...protectedStackProfile,maxPortEvents:0,maxDebugBytes:0,maxStatusReads:0});
export const coldOutAllowed=()=>false,coldInAllowed=()=>false;
export const expectedRamPage=()=>expectedPages(bootStores).code;
export function validateProtectedWrite(raw,bytes,index,admitted){assert.ok(Number.isSafeInteger(index)&&index>=0&&index<stores.length);assert.ok(bytes instanceof Uint8Array);assert.equal(admitted,index>=bootStores.length,'boot before fetch, stack only after execute admission');const e=stores[index];assert.equal(raw,e.raw);assert.deepEqual([...bytes],e.bytes);return index+1;}
export function validateProtectedRead(raw,width){assert.ok(Number.isSafeInteger(raw)&&Number.isSafeInteger(width)&&width>0&&width<=16);assert.ok(raw>=0x610&&raw<0x620&&width<=0x620-raw||raw>=0xf0180&&raw<0xf0186&&width<=0xf0186-raw||raw===0x8ffe&&width===2,'only owned GDT/pointer/stack operand');}
