import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assembleCombinedHotRom,hotWorkload} from '../scripts/i80386-free-combined-hot.mjs';
const actual=assembleCombinedHotRom();
test('hot guest retains the correctness source prefix and genuine cold reset vector',()=>{
 const old=readFileSync(new URL('./fixtures/i80386-free-combined-paging-ram.S',import.meta.url),'utf8');
 const next=readFileSync(new URL('./fixtures/i80386-free-combined-hot.S',import.meta.url),'utf8');
 const prefix=old.slice(0,old.indexOf(" movb $'R',%al"));assert.ok(next.includes(prefix));
 assert.deepEqual([...actual.rom.subarray(0xfff0,0xfff5)],[0xea,0,1,0,0xf0]);assert.equal(actual.rom.length,65536);
});
test('linked hot boundaries contain bounded loops and guest PIC mask',()=>{
 const {rom,symbols:s}=actual;
 assert.deepEqual([...rom.subarray(s.hot_profile_start,s.hot_profile_start+5)],[0xfa,0xb0,0xff,0xe6,0x21]);
 assert.ok(s.hot_profile_start<s.hot_register_loop&&s.hot_register_loop<s.hot_register_end&&s.hot_register_end<s.hot_memory_loop&&s.hot_memory_loop<s.hot_memory_end&&s.hot_memory_end<s.terminal_hlt);
 assert.deepEqual([...rom.subarray(s.hot_register_loop,s.hot_register_end)],[0x66,0x01,0xd8,0x66,0x43,0x66,0x49,0x75,0xf7]);
 assert.match(actual.disassembly,/add\s+%ebx,%eax/);assert.match(actual.disassembly,/mov\s+0x588,%eax/);
});
test('independent closed-form witnesses and footprint bound',()=>{
 assert.equal(hotWorkload.registerChecksum,hotWorkload.registerIterations*(hotWorkload.registerIterations+1)/2);
 assert.equal(hotWorkload.registerNext,hotWorkload.registerIterations+1);assert.equal(hotWorkload.memoryChecksum,hotWorkload.memoryIterations);
 assert.ok(4*hotWorkload.registerIterations+5*hotWorkload.memoryIterations+1000<hotWorkload.proposedTotalQuantaCap);
 assert.equal(hotWorkload.marker,'RPGH001');assert.ok(actual.symbols.gdt_end<0x1000,'guest code and descriptors fit existing ROM code page');
});
