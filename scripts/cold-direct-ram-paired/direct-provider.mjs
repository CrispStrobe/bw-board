/** Derive the qualified ABI5 board adapter with only raw journal serialization removed.
 * Native owner journal, validation, ACK, board generations and clocks are unchanged.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const QUALIFIED_PROVIDER_SHA='e529866863d1d7644ee866565b32ceef39cf882ba67bc6f56f9e62ed8ccc6dc6';
const dependencySha256={
 '../bochs-cpu3-native-cold-bios/board-provider.mjs':'19bb6335c40feeacf12be2dc19d5bd7abbc90ffcb26580785f1ffda98332e107',
 '../bochs-cpu3-native-cold-bios/board-profile.mjs':'6ea848b7a97eea178926fc2c966e3ad4e8b76a60da6ba8cefe07f47e4d5922e3'
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const edits=[
 ['const journalRecords=[];','let journalEntries=0;'],
 ['journalRecords.length+entries.length<=400000','journalEntries+entries.length<=400000'],
 ['for(const e of entries)journalRecords.push({sessionIdentity:String(sessionIdentity),sequence:e.sequence,effect:e.effect,n:e.n,q:e.q,epoch:e.epoch,address:e.address,generation:e.generation,before:Array.from(e.before),after:Array.from(e.after)});','journalEntries+=entries.length;'],
 ["journal(){assert.ok(!lease&&!active&&!closed);return journalRecords.map(e=>({...e,before:[...e.before],after:[...e.after]}));},",
  "journal(){throw Error('raw diagnostic journal disabled in paired timing');},"],
 ['ownerStatus(){return {acknowledged,sessionIdentity:sessionIdentity===null?null:String(sessionIdentity),journalEntries:journalRecords.length};}',
  'ownerStatus(){return {acknowledged,sessionIdentity:sessionIdentity===null?null:String(sessionIdentity),journalEntries};}']
];
function exact(text,old,next){assert.equal(text.split(old).length,2,'exact provider derivation seam');return text.replace(old,next);}
export function deriveDirectTimingProvider(sourceRoot){
 const file=resolve(sourceRoot,'scripts/bochs-cpu3-native-cold-direct-ram/provider.mjs');
 const original=readFileSync(file);assert.equal(sha(original),QUALIFIED_PROVIDER_SHA,'guest-qualified provider bytes');
 let modified=original.toString();for(const [old,next] of edits)modified=exact(modified,old,next);
 let restored=modified;for(const [old,next] of [...edits].reverse())restored=exact(restored,next,old);
 assert.equal(sha(Buffer.from(restored)),QUALIFIED_PROVIDER_SHA,'exact inverse provider derivation');
 const derivedSha256=sha(Buffer.from(modified));
 for(const [relative,expected] of Object.entries(dependencySha256)){
  assert.equal(sha(readFileSync(resolve(dirname(file),relative))),expected,'qualified provider dependency');
  modified=exact(modified,`'${relative}'`,`'${pathToFileURL(resolve(dirname(file),relative)).href}'`);
 }
 return {moduleUrl:'data:text/javascript;base64,'+Buffer.from(modified).toString('base64'),
         qualifiedSha256:QUALIFIED_PROVIDER_SHA,derivedSha256,
         loadedModuleSha256:sha(Buffer.from(modified)),dependencySha256,
         removed:'Only per-entry JSON diagnostic journal objects; scalar count and all native/board effects retained'};
}
export async function loadDirectTimingProvider(sourceRoot){
 const derived=deriveDirectTimingProvider(sourceRoot),module=await import(derived.moduleUrl);
 assert.equal(typeof module.createDirectRamColdBiosProvider,'function');
 return {create:module.createDirectRamColdBiosProvider,derivation:{qualifiedSha256:derived.qualifiedSha256,
  derivedSha256:derived.derivedSha256,loadedModuleSha256:derived.loadedModuleSha256,
  dependencySha256:derived.dependencySha256,removed:derived.removed}};
}
