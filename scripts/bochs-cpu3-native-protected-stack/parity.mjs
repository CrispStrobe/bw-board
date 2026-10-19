/** Strict represented-state comparison plus separate source-backed descriptor rows. */
import assert from 'node:assert/strict';
import {wholeNativeWords,validateProgress} from '../bochs-cpu3-native-cold-bios/parity.mjs';
import {compareStackCpu} from './cpu-comparison.mjs';
import {namedCuts,protectedStackProfile,bootStores,stackStores,expectedPages,validateMilestone,codeSelector,dataSelector} from './profile.mjs';
export {wholeNativeWords};
export const stackNativeSources=Object.freeze([
 {path:'bochs/cpu/descriptor.h',sha256:'2cea747965fcb0523db6826929fbe9cfc2b59893102c789e01ece67c10e00b10',lines:'56–60',contract:'SegValidCache=1, SegAccessROK=2, SegAccessWOK=4; selector index is a distinct field'},
 {path:'bochs/cpu/ctrl_xfer_pro.cc',sha256:'a70b7ee89237e5058e44e07095ea7d52d621dcff6fd727e75bfd1be544577d62',lines:'80–112',contract:'load_cs installs the accessed code descriptor, valid=1'},
 {path:'bochs/cpu/segment_ctrl_pro.cc',sha256:'737fea13e5e6dc97d7b24d17b3cfe249dbbfba7aae37304abdf3e783b54af714',lines:'87–94,149–153',contract:'protected DS/SS loads copy accessed writable descriptor and set valid=1'},
 {path:'bochs/cpu/access.cc',sha256:'1ac261289fd31feded2b4e123f6aedf795277298e5adea946edabb94089bd526',lines:'82–102',contract:'first writable non-expand-down segment access sets valid |=2|4'},
 {path:'bochs/cpu/access.h',sha256:'c9f74122f4039120d26e21bf301f0ee03da6c4c80544627e6887557cdb537a65',lines:'190–193',contract:'write_virtual_word uses agen_write before linear callback'},
 {path:'bochs/cpu/stack.cc',sha256:'8d6ba5771a0f676034764773e15ffecab39b63cbc1b204e067a726b4afa925fd',lines:'155–191',contract:'without a direct host pointer, stack_write_word invokes write_virtual_word'},
 {path:'bochs/cpu/data_xfer16.cc',sha256:'3f589baa88393b8a70138e7b664a8f21d603aa20d7109826e4d37d2e4456ed79',lines:'124–129',contract:'MOV SS installs interrupt/debug inhibition for the next instruction'},
 {path:'bochs/cpu/event.cc',sha256:'3f1603ed7e9b668cda9264821af0e03439577a617ba63cea69e95122b6cd2b12',lines:'387–400',contract:'native instruction admission checks actual one-instruction inhibit lifetime'},
].map(Object.freeze));
export const stackParityPolicy=Object.freeze({
 cpu:'Strict raw equality for every represented JS counterpart; exact fixed CR0 phase derivative, no flag mask or normalization. Every166 native words retained at reset/return/final inspect.',
 nativeOnly:'Selector index/TI/RPL, cache valid/type/DPL/G/AVL and native pending-event/mask are not JS counterparts. CS/DS/SS15-word rows are independently checked against the fixed GDT and source-backed access-cache phases; other hidden words are retained without a cross-engine parity claim.',
 shadow:'JS returned MOVSS shadow is1/1/0 at CS18:EIP7007 and0/0/0 elsewhere. ABI4 exposes no native inhibit counter: compiled runtime separately tests actual Bochs interrupt/debug inhibition before the following MOVSP. This is source-attested policy, not a shadow-word equality claim.',
 pages:'Three actual copied host-provider pages (GDT/code/stack) compared byte-for-byte every boundary and at final catchup. Entire raw physical RAM hash compared after settlement; no independent native-cache memory dump claim.',
 scope:'Fixed same-ring code16 DS/SS/PUSH/POP/CALL/RET program, ordinary stop before HLT; no paging/IRQ/fault/OS/performance claim.',
});
const row=(index,selector,valid,type)=>[index,selector,selector>>>3,0,0,valid,1,0,1,type,0,0xffff,0,0,0];
export function validateDescriptorRows(n,js){
 const c=js.cpu;wholeNativeWords(n);
 if(c.cs===codeSelector)assert.deepEqual(n.segments.slice(15,30),row(1,codeSelector,1,11),'strict protected CS descriptor row');
 if(c.ds===dataSelector)assert.deepEqual(n.segments.slice(45,60),row(3,dataSelector,1,3),'strict loaded DS descriptor row');
 if(c.ss===dataSelector){
  // The fixed adapter supplies no direct RAM pointer; PUSH therefore performs
  // write_virtual_checks once. Its read/write cache bits remain set thereafter.
  const accessed=js.stores.length>bootStores.length;
  assert.deepEqual(n.segments.slice(30,45),row(2,dataSelector,accessed?7:1,3),'strict SS descriptor/access-cache phase');
 }
}
export function compareBoundary(n,board,js,pages){
 compareStackCpu(n,js.cpu);validateDescriptorRows(n,js);assert.deepEqual(board.board,js.board,'full actual board');
 for(const key of ['gdt','code','stack']){assert.ok(pages[key] instanceof Uint8Array&&js.pages[key] instanceof Uint8Array);assert.equal(pages[key].length,4096);assert.deepEqual(pages[key],js.pages[key],'whole copied '+key+' page');}
 assert.equal(Number(n.successfulQuanta),js.q);assert.equal(board.successfulQuanta,js.q);assert.equal(board.mappingEpoch,0);assert.equal(js.cpu.cr4,0);
 const shadow=js.cpu.cs===codeSelector&&js.cpu.eip===0x7007?[1,1,0]:[0,0,0];assert.deepEqual([js.cpu.interruptShadow,js.cpu.nmiShadow,js.cpu.debugShadow],shadow,'exact JS returned shadow phase');
 assert.deepEqual(board.ram.writes.map(w=>({raw:w.raw,bytes:w.bytes})),js.stores.map(w=>({raw:w.raw,bytes:w.bytes})),'all exact effects/order');
 assert.equal(board.ram.storeCount,js.stores.length);assert.equal(board.ram.bootStores,Math.min(bootStores.length,js.stores.length));
 const admitted=js.cpu.cs===codeSelector&&js.cpu.eip!==0x7000;assert.equal(board.ram.admitted,admitted,'admission only after actual RAM fetch');
}
export function stackProgress(previous,n){const p=validateProgress(previous,n);assert.ok(p.n<=protectedStackProfile.maxNativeTicks&&p.q<=protectedStackProfile.maxQuanta);assert.equal(n.activityState,0);for(const k of ['repIterations','repPartial','faults','irqDeliveries','portCommits','haltIdleCuts'])assert.equal(Number(n.execution[k]),0,k+' forbidden');return p;}
const stackCount=name=>['after-PUSH','after-POP'].includes(name)?1:['entered-CALL','callee-MOV','returned-CALL','before-HLT'].includes(name)?2:0;
export function validateMilestones(cuts){
 assert.deepEqual(cuts.map(c=>c.name),namedCuts.map(c=>c.name));let last=-1;
 for(const c of cuts){assert.ok(Number.isSafeInteger(c.q)&&c.q>=0&&c.q<=512&&c.q>last);last=c.q;assert.equal(c.q,c.javascript.q);validateMilestone(c.name,c.javascript);validateDescriptorRows(c.native,c.javascript);
  const count=c.name==='reset'?0:bootStores.length+stackCount(c.name),effects=[...bootStores,...stackStores].slice(0,count),expected=expectedPages(effects);
  for(const key of ['gdt','code','stack'])assert.deepEqual(c.pages[key],expected[key],'independent exact milestone '+key+' bytes');
  const generations=count===0?[]:[[0,4],[0x7000,7],...(count>bootStores.length?[[0x8000,count-bootStores.length]]:[])];
  assert.deepEqual(c.board.generations,generations);assert.equal(c.board.ram.bootStores,Math.min(count,bootStores.length));assert.equal(c.board.ram.storeCount,count);
  assert.deepEqual(c.board.ram.writes.map(w=>[w.raw,w.bytes,w.generation]),effects.map((w,i)=>[w.raw,[...w.bytes],i<4?i+1:i<11?i-3:i-10]));
  assert.equal(c.board.ram.admitted,c.javascript.cpu.cs===codeSelector&&c.javascript.cpu.eip!==0x7000,'cut fetch admission');
 }
 return {milestones:cuts.length,pageBytes:12288,gdtGeneration:4,codeGeneration:7,stackGeneration:2,shadowCoverage:stackParityPolicy.shadow};
}
