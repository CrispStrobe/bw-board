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
 assert.equal(n.activityState,0,'resume explicitly represents active state');
 const ticks=boundedCount(n.nativeTicks),q=boundedCount(n.successfulQuanta),dn=ticks-previous.n,dq=q-previous.q;
 assert.ok(dn>=0&&dn<=budget.maxN&&dq>=0&&dq<=budget.maxQ&&q<=targetQ,'independent bounded N/Q');assert.equal(n.chargedNativeTicks,dn);assert.equal(n.chargedQuanta,dq);assert.ok([1,3,7].includes(n.reason),'budget/PIO/event only');assert.ok(dn||dq||n.reason===7,'zero clocks require actual event');assert.equal(n.mappingEpoch,0);assert.equal(n.boardA20,1);
 return {n:ticks,q,dn,dq};
}
const inspectKeys=['state','extra','segments','system','debug','nativeTicks','successfulQuanta','mappingEpoch','boardA20','clockTransfers','callbacks','fallback','execution'].sort();
export function validateInspectMetadata(n){
 assert.deepEqual(Object.keys(n).sort(),inspectKeys,'actual ABI4 inspect schema; no invented activity');wholeNativeWords(n);boundedCount(n.nativeTicks);boundedCount(n.successfulQuanta);assert.equal(n.mappingEpoch,0);assert.equal(n.boardA20,1);
 for(const [name,keys] of [['clockTransfers',['transfers','commits','words']],['callbacks',['physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks']],['fallback',['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer']],['execution',['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts']]]){assert.deepEqual(Object.keys(n[name]).sort(),keys.sort());for(const value of Object.values(n[name]))boundedCount(value,Number.MAX_SAFE_INTEGER);}
 for(const value of Object.values(n.fallback))assert.equal(boundedCount(value),0);for(const k of ['faults','irqDeliveries','haltIdleCuts'])assert.equal(boundedCount(n.execution[k]),0);return n;
}
export function validateTerminalMetadata(n){
 validateInspectMetadata(n);assert.equal(n.state[13],0xf000);assert.equal(n.state[8],0xe16);assert.equal(n.state[10],0x7ffffff0);assert.equal(n.state[9]&0x200,0);return n;
}
export function validateFinalReturn(last,final){
 assert.deepEqual(Object.keys(last).sort(),[...inspectKeys,'activityState','reason','chargedNativeTicks','chargedQuanta','sliceBytes'].sort(),'actual resume schema');assert.equal(last.activityState,0,'actual last resume active; not inferred from inspect');assert.ok([1,3,7].includes(last.reason));
 assert.ok(Number.isSafeInteger(last.chargedNativeTicks)&&last.chargedNativeTicks>=0&&last.chargedNativeTicks<=600);assert.ok(Number.isSafeInteger(last.chargedQuanta)&&last.chargedQuanta>=0&&last.chargedQuanta<=300);assert.ok(Array.isArray(last.sliceBytes)&&last.sliceBytes.length===160);for(const byte of last.sliceBytes)assert.ok(Number.isInteger(byte)&&byte>=0&&byte<=255);
 assert.equal(boundedCount(last.nativeTicks),boundedCount(final.nativeTicks));assert.equal(boundedCount(last.successfulQuanta),boundedCount(final.successfulQuanta));assert.deepEqual(wholeNativeWords(last),wholeNativeWords(final),'last returned raw166 equals final inspect');
 return last;
}
export function captureBoundaries(c){
 assert.ok(Array.isArray(c.cuts)&&c.cuts.length===15);assert.equal(c.cuts[0].name,'reset');assert.equal(c.cuts.at(-1).name,'before-F000-E16');const reset=c.cuts[0],final=c.cuts.at(-1);validateInspectMetadata(reset.native);validateTerminalMetadata(final.native);assert.equal(boundedCount(reset.native.nativeTicks),0);assert.equal(boundedCount(reset.native.successfulQuanta),0);assert.equal(boundedCount(final.native.nativeTicks),c.progress.n);assert.equal(boundedCount(final.native.successfulQuanta),c.progress.q);return {reset,final};
}
export function compareReset(native,board,capture){
 validateInspectMetadata(native);const {reset}=captureBoundaries(capture);assert.deepEqual(wholeNativeWords(native),wholeNativeWords(reset.native),'entire native raw reset166');compareCpu(native,reset.javascript.cpu);assert.deepEqual(board.board,reset.javascript.board,'whole actual reset board');
}
export function compareFinalEvidence(native,settled,ports,capture,lastReturnedNative){
 validateTerminalMetadata(native);validateFinalReturn(lastReturnedNative,native);const {final}=captureBoundaries(capture);assert.deepEqual(wholeNativeWords(native),wholeNativeWords(final.native),'entire raw final166; no batch normalization');compareCpu(native,final.javascript.cpu);assert.equal(boundedCount(native.nativeTicks),capture.progress.n,'exact final N independently of Q');assert.equal(boundedCount(native.successfulQuanta),capture.progress.q);
 assert.deepEqual(settled.state.board,capture.javascriptFinal.board,'full settled board including actual PIC');assert.equal(settled.ramSha256,capture.javascriptFinal.ramSha256,'whole raw RAM, no witness normalization');assert.equal(settled.state.nativeTicks,capture.progress.n);assert.equal(settled.state.successfulQuanta,capture.progress.q);assert.equal(settled.state.mappingEpoch,0);assert.equal(settled.state.cold.phase,'complete');assert.equal(settled.state.cold.portEventCount,ports.length);const pio=comparePorts(ports,capture.javascriptPorts);
 return {status:'NATIVE_ARM_RAW_FINAL166_BOARD_RAM_AND_COMPLETE_PIO_MATCH',q:capture.progress.q,ports:pio.ports,coverage:'Reset/final full166, final dynamic JS counterparts/full board/whole raw RAM hash and complete PIO; intermediate words not independently retained'};
}
