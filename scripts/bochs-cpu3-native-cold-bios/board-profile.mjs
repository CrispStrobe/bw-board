/** Source-only board scope before F000:E16, not native BIOS admission. */
import assert from 'node:assert/strict';import {readFileSync}from 'node:fs';import {createHash}from 'node:crypto';
import {selfTestBoardConfig}from '../bochs-cpu3-native-owned-8042/profile.mjs';
import {biosSha256}from './rep-policy.mjs';
export const coldBoardConfig=selfTestBoardConfig; // Exact successful census12/32/noBAT/ACK/mouse profile.
export const coldBoardProfile=Object.freeze({kind:'free-cold-BIOS-board-source-v1',romSha256:biosSha256,totalNativeTicks:400000,totalQuanta:400000,maxPortEvents:20000,maxDebugBytes:256,maxStatusReads:10000,checkpoint:Object.freeze({cs:0xf000,eip:0xe16}),status:'SOURCE_ONLY_NOT_NATIVE_ADMISSION'});
export function fixedColdBios(...args){assert.equal(args.length,0,'no caller ROM');const b=readFileSync(new URL('../../roms/free-at-bios/BIOS-bochs-legacy',import.meta.url));assert.equal(b.length,65536);assert.equal(createHash('sha256').update(b).digest('hex'),biosSha256);return Uint8Array.from(b);}
export function coldOutAllowed(port,width,value){if(!Number.isInteger(port)||width!==1||!Number.isInteger(value)||value<0||value>255)return false;return port===0xd6?value===0xc0:[0x0d,0xda,0xd4,0x71,0x40,0x80].includes(port)?value===0:port===0x70?value===0x0f:port===0x43?value===0x34:port===0x64?value===0xaa||value===0xab:port===0x402;}
export function coldInAllowed(port,width){return width===1&&[0x71,0x64,0x60].includes(port);}
