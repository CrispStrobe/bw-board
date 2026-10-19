import assert from 'node:assert/strict';
import {validateReturn as heldReturn,modes,nextBudget,noArtificialNativeDeadline,compareReset as heldReset,compareFinalEvidence as heldFinal} from './held-protocol.mjs';
import {plainSnapshot,validateBridgeAttempts} from './snapshot.mjs';
export {modes,nextBudget,noArtificialNativeDeadline};
export const progressExportProfile='bw.cold-native.compact-progress.v1';
export function validateProgressProfile(api){assert.equal(api.progressExportProfile,progressExportProfile);assert.equal(typeof api.resumeProgress,'function');assert.equal(typeof api.inspect,'function');}
export function validateProgressReturn(previous,n,budget,targetQ){
 assert.deepEqual(Object.keys(n).sort(),['sliceBytes','reason','activityState','chargedNativeTicks','chargedQuanta','nativeTicks','successfulQuanta','mappingEpoch','boardA20'].sort(),'compact schema; no full snapshot substitution');
 assert.ok(n.sliceBytes instanceof Uint8Array&&n.sliceBytes.length===160&&n.sliceBytes.byteOffset===0&&n.sliceBytes.buffer instanceof ArrayBuffer&&n.sliceBytes.buffer.byteLength===160&&!n.sliceBytes.buffer.resizable,'fixed copied slice160');
 return heldReturn(previous,n,budget,targetQ);
}
export function compareReset(native,board,capture){return heldReset(plainSnapshot(native),board,capture);}
export function compareProgressFinalEvidence(native,board,ports,capture,last,cut){
 validateBridgeAttempts(native);validateBridgeAttempts(cut);assert.deepEqual(cut.bridgeClockEntryAttempts,native.bridgeClockEntryAttempts);assert.deepEqual(cut.bridgeMemoryEntryAttempts,native.bridgeMemoryEntryAttempts);
 for(const k of ['nativeTicks','successfulQuanta','mappingEpoch','boardA20'])assert.equal(last[k],cut[k],'last progress matches actual requested cut '+k);
 // Internal held-validator view: actual full inspect plus actual last progress.
 // It is never persisted or labelled an actual full resume return.
 const view={...plainSnapshot(cut),reason:last.reason,activityState:last.activityState,chargedNativeTicks:last.chargedNativeTicks,chargedQuanta:last.chargedQuanta,sliceBytes:last.sliceBytes};
 const result=heldFinal(plainSnapshot(native),board,ports,capture,view);return {...result,coverage:'Actual reset/last-resume/final inspect166, compact last progress, full board/whole RAM hash/ordered PIO; no per-resume full-state materialization'};
}
