/** Pure closed budgets, progress and final proof; no addon or machine. */
import assert from 'node:assert/strict';
import {wholeNativeWords,compareCpu,comparePorts,boundedCount} from '../bochs-cpu3-native-cold-bios/parity.mjs';
export const modes=Object.freeze(['oneQ','batched']);
export const noArtificialNativeDeadline=0xffffffffffffffffn;
export function nextBudget(mode,q,targetQ){
 assert.ok(modes.includes(mode));assert.ok(Number.isSafeInteger(targetQ)&&targetQ>0&&targetQ<=400000);assert.ok(Number.isSafeInteger(q)&&q>=0&&q<targetQ);
 return {maxN:mode==='oneQ'?1:600,maxQ:Math.min(mode==='oneQ'?1:300,targetQ-q)};
}
/** Cheap safety guards are real worker costs. No intermediate word hashing,
 * snapshot cloning, board inspection or oracle comparison is performed here. */
export function validateReturn(previous,n,budget,targetQ){
 const ticks=boundedCount(n.nativeTicks),q=boundedCount(n.successfulQuanta),dn=ticks-previous.n,dq=q-previous.q;
 assert.ok(dn>=0&&dn<=budget.maxN&&dq>=0&&dq<=budget.maxQ&&q<=targetQ,'independent bounded N/Q');assert.equal(n.chargedNativeTicks,dn);assert.equal(n.chargedQuanta,dq);assert.ok([1,3,7].includes(n.reason),'budget/PIO/event only');assert.ok(dn||dq||n.reason===7,'zero clocks require actual event');assert.equal(n.mappingEpoch,0);assert.equal(n.boardA20,1);
 return {n:ticks,q,dn,dq};
}
export function validateTerminalMetadata(n){
 wholeNativeWords(n);assert.equal(n.state[13],0xf000);assert.equal(n.state[8],0xe16);assert.equal(n.state[10],0x7ffffff0);assert.equal(n.state[9]&0x200,0);assert.equal(n.activityState,0);assert.equal(n.mappingEpoch,0);assert.equal(n.boardA20,1);
 assert.deepEqual(Object.keys(n.fallback).sort(),['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'].sort());for(const v of Object.values(n.fallback))assert.equal(boundedCount(v),0);
 assert.deepEqual(Object.keys(n.execution).sort(),['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'].sort());for(const v of Object.values(n.execution))boundedCount(v,Number.MAX_SAFE_INTEGER);for(const k of ['faults','irqDeliveries','haltIdleCuts'])assert.equal(boundedCount(n.execution[k]),0);
 return n;
}
export function captureBoundaries(c){
 assert.ok(Array.isArray(c.cuts)&&c.cuts.length===15);assert.equal(c.cuts[0].name,'reset');assert.equal(c.cuts.at(-1).name,'before-F000-E16');const reset=c.cuts[0],final=c.cuts.at(-1);wholeNativeWords(reset.native);validateTerminalMetadata(final.native);assert.equal(boundedCount(reset.native.nativeTicks),0);assert.equal(boundedCount(reset.native.successfulQuanta),0);assert.equal(boundedCount(final.native.nativeTicks),c.progress.n);assert.equal(boundedCount(final.native.successfulQuanta),c.progress.q);return {reset,final};
}
export function compareReset(native,board,capture){
 const {reset}=captureBoundaries(capture);assert.deepEqual(wholeNativeWords(native),wholeNativeWords(reset.native),'entire native raw reset166');compareCpu(native,reset.javascript.cpu);assert.deepEqual(board.board,reset.javascript.board,'whole actual reset board');
}
export function compareFinalEvidence(native,settled,ports,capture){
 validateTerminalMetadata(native);const {final}=captureBoundaries(capture);assert.deepEqual(wholeNativeWords(native),wholeNativeWords(final.native),'entire raw final166; no batch normalization');compareCpu(native,final.javascript.cpu);assert.equal(boundedCount(native.nativeTicks),capture.progress.n,'exact final N independently of Q');assert.equal(boundedCount(native.successfulQuanta),capture.progress.q);
 assert.deepEqual(settled.state.board,capture.javascriptFinal.board,'full settled board including actual PIC');assert.equal(settled.ramSha256,capture.javascriptFinal.ramSha256,'whole raw RAM, no witness normalization');assert.equal(settled.state.nativeTicks,capture.progress.n);assert.equal(settled.state.successfulQuanta,capture.progress.q);assert.equal(settled.state.mappingEpoch,0);assert.equal(settled.state.cold.phase,'complete');assert.equal(settled.state.cold.portEventCount,ports.length);const pio=comparePorts(ports,capture.javascriptPorts);
 return {status:'NATIVE_ARM_RAW_FINAL166_BOARD_RAM_AND_COMPLETE_PIO_MATCH',q:capture.progress.q,ports:pio.ports,coverage:'Reset/final full166, final dynamic JS counterparts/full board/whole raw RAM hash and complete PIO; intermediate words not independently retained'};
}
