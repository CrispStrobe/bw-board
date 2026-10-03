/** Every represented CPU field, all166 retained and both copied host pages. */
import assert from 'node:assert/strict';
import {wholeNativeWords,validateProgress} from '../bochs-cpu3-native-cold-bios/parity.mjs';
import {compareProtectedCpu} from './cpu-comparison.mjs';
import {namedCuts,protectedRamProfile,expectedRamPage,expectedGdtPage,stores,validateMilestone} from './profile.mjs';
export {wholeNativeWords};
export const protectedDescriptorSources=Object.freeze([{path:'bochs/cpu/descriptor.h',sha256:'2cea747965fcb0523db6826929fbe9cfc2b59893102c789e01ece67c10e00b10',lines:'56',contract:'SegValidCache=1'},{path:'bochs/cpu/ctrl_xfer_pro.cc',sha256:'a70b7ee89237e5058e44e07095ea7d52d621dcff6fd727e75bfd1be544577d62',lines:'80–112',contract:'load_cs copies source descriptor/selector and sets valid=SegValidCache before invalidating prefetch'}].map(Object.freeze));
export const protectedParityPolicy=Object.freeze({cpu:'Strict raw equality of every documented JS counterpart via exact fixed-CR0 phase derivative; no flags masks or post-step normalization.',nativeOnly:'All166 words retained; cached selector index/TI/RPL, hidden descriptor valid/type/DPL/G/AVL and pending event/mask lack JS counterparts. Fixed protected CS descriptor row is separately validated against source GDT at protected cuts.',pages:'Actual host-provider copied4096 GDT and4096 code-page bytes every boundary; entire raw physical RAM hash at final catchup. No independent native-cache dump claim.',scope:'Fixed LGDT/PE/farjump/code16 MOV milestone; stop before HLT. No paging/IRQ/fault/OS or speed claim.'});
export function compareBoundary(n,board,js,pages){
 compareProtectedCpu(n,js.cpu);assert.deepEqual(board.board,js.board,'full actual board');
 for(const [key,jkey]of [['code','ramPage'],['gdt','gdtPage']]){assert.ok(pages[key] instanceof Uint8Array&&js[jkey] instanceof Uint8Array);assert.equal(pages[key].length,4096);assert.deepEqual(pages[key],js[jkey],'whole copied '+key+' page');}
 assert.equal(Number(n.successfulQuanta),js.q);assert.equal(board.successfulQuanta,js.q);assert.equal(board.mappingEpoch,0);assert.equal(js.cpu.cr4,0);for(const k of ['interruptShadow','nmiShadow','debugShadow'])assert.equal(js.cpu[k],0);
 assert.deepEqual(board.ram.writes.map(w=>({raw:w.raw,bytes:w.bytes})),js.stores.map(w=>({raw:w.raw,bytes:w.bytes})),'exact effects/order');
}
export function protectedProgress(previous,n){const p=validateProgress(previous,n);assert.ok(p.n<=protectedRamProfile.maxNativeTicks&&p.q<=protectedRamProfile.maxQuanta);assert.equal(n.activityState,0);for(const k of ['repIterations','repPartial','faults','irqDeliveries','portCommits','haltIdleCuts'])assert.equal(Number(n.execution[k]),0,k+' forbidden');return p;}
export function validateMilestones(cuts){
 assert.deepEqual(cuts.map(c=>c.name),namedCuts.map(c=>c.name));let last=-1;
 for(const c of cuts){assert.ok(Number.isSafeInteger(c.q)&&c.q>=0&&c.q<=512&&c.q>last);last=c.q;assert.equal(c.q,c.javascript.q);validateMilestone(c.name,{cpu:c.javascript.cpu,gdtPage:Uint8Array.from(c.javascript.gdtPage),ramPage:Uint8Array.from(c.javascript.ramPage)});
  if(c.name!=='reset'){assert.equal(c.board.ram.bootStores,4);assert.deepEqual(c.board.generations,[[0,2],[0x7000,2]]);assert.deepEqual(c.board.ram.writes.map(w=>[w.raw,w.bytes,w.generation]),stores.map((w,i)=>[w.raw,[...w.bytes],i%2+1]));assert.deepEqual(c.pages.gdt,expectedGdtPage());assert.deepEqual(c.pages.code,expectedRamPage());}
  if(c.javascript.cpu.cs===0x18){assert.ok(c.board.ram.admitted);assert.deepEqual(c.native.segments.slice(15,30),[1,24,3,0,0,1,1,0,1,11,0,65535,0,0,0],'independent fixed protected CS descriptor words');}
 }
 return {milestones:cuts.length,pageBytes:8192,gdtGeneration:2,codeGeneration:2};
}
