/** Exact represented CPU equality, raw native words and direct RAM-page parity. */
import assert from 'node:assert/strict';
import {compareCpu,wholeNativeWords,validateProgress} from '../bochs-cpu3-native-cold-bios/parity.mjs';
import {namedCuts,ramBootstrapProfile,expectedRamPage,bootStores,patchStore} from './profile.mjs';
export {wholeNativeWords};
export const ramParityPolicy=Object.freeze({cpu:'All documented dynamic JS counterparts via strict compareCpu without undefined-flags ownership; MOV/far JMP/CLI/JNE preserve defined flags and CMP defines arithmetic flags.',nativeOnly:'Cached selector index/TI/RPL, hidden descriptor valid/type/DPL/G/AVL, pending-event/mask and other unrepresented native words retained raw; no all166 cross-engine equality claim.',ram:'Direct copied4096-byte page every boundary; whole raw physical RAM SHA at terminal, no normalization.',scope:'Fixed real-mode one-page program, one ROM-owned off-page patch, AX1→AX2, stop before HLT; no OS or speed qualification.'});
export function compareBoundary(native,board,js,page){
 compareCpu(native,js.cpu);assert.deepEqual(board.board,js.board,'whole actual board');
 assert.ok(page instanceof Uint8Array&&js.ramPage instanceof Uint8Array);assert.equal(page.length,4096);assert.deepEqual(page,js.ramPage,'all4096 actual code-page bytes');
 assert.equal(Number(native.successfulQuanta),js.q);assert.equal(board.successfulQuanta,js.q);assert.equal(board.mappingEpoch,0);assert.equal(js.cpu.cr4,0);
 assert.equal(js.cpu.interruptShadow,0);assert.equal(js.cpu.nmiShadow,0);assert.equal(js.cpu.debugShadow,0);
}
export function ramProgress(previous,n){
 const p=validateProgress(previous,n);assert.ok(p.n<=ramBootstrapProfile.maxNativeTicks&&p.q<=ramBootstrapProfile.maxQuanta);
 assert.equal(n.activityState,0);for(const key of ['repIterations','repPartial','faults','irqDeliveries','portCommits','haltIdleCuts'])assert.equal(Number(n.execution[key]),0,key+' forbidden');return p;
}
export function validateMilestones(cuts){
 assert.deepEqual(cuts.map(c=>c.name),namedCuts.map(c=>c.name),'exact ordered ordinary milestones');
 let previous=-1;for(const [i,c]of cuts.entries()){const e=namedCuts[i];assert.ok(Number.isSafeInteger(c.q)&&c.q>=0&&c.q<=512&&c.q>previous);previous=c.q;assert.equal(c.javascript.cpu.cs,e.cs);assert.equal(c.javascript.cpu.eip,e.eip);if(e.ax!==undefined)assert.equal(c.javascript.cpu.eax&65535,e.ax);}
 for(const c of cuts.filter(c=>['AX1','patched-from-ROM','AX2','before-HLT'].includes(c.name))){const g=c.name==='AX1'?4:5;assert.deepEqual(Uint8Array.from(c.javascript.ramPage),expectedRamPage(g));assert.equal(c.board.ram.bootStores,4);assert.equal(c.board.ram.patches,g-4);assert.ok(c.board.ram.admitted);assert.deepEqual(c.board.generations,[[0x7000,g]]);assert.deepEqual(c.board.ram.writes.map(w=>[w.raw,...w.bytes,w.generation]),[...bootStores,...(g===5?[patchStore]:[])].map((w,i)=>[...w,i+1]),'exact ordered boot and off-page patch effects');}
 return {milestones:cuts.length,codeGenerations:[4,5],rawPageBytes:4096};
}
