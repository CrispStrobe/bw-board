/** Two authenticated timing providers, differing only at the empty generation Map copy. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha=b=>createHash('sha256').update(b).digest('hex');
export const qualifiedSha256='e529866863d1d7644ee866565b32ceef39cf882ba67bc6f56f9e62ed8ccc6dc6';
export const baselineNormalizedSha256='2a46628a13eb023d41762a807325535e285d68657f1345090108cd54977e0ac5';
const imports={
 '../bochs-cpu3-native-cold-bios/board-provider.mjs':'19bb6335c40feeacf12be2dc19d5bd7abbc90ffcb26580785f1ffda98332e107',
 '../bochs-cpu3-native-cold-bios/board-profile.mjs':'6ea848b7a97eea178926fc2c966e3ad4e8b76a60da6ba8cefe07f47e4d5922e3'
};
const edits=[
 ['const journalRecords=[];','let journalEntries=0;'],
 ['journalRecords.length+entries.length<=400000','journalEntries+entries.length<=400000'],
 ['for(const e of entries)journalRecords.push({sessionIdentity:String(sessionIdentity),sequence:e.sequence,effect:e.effect,n:e.n,q:e.q,epoch:e.epoch,address:e.address,generation:e.generation,before:Array.from(e.before),after:Array.from(e.after)});','journalEntries+=entries.length;'],
 ["journal(){assert.ok(!lease&&!active&&!closed);return journalRecords.map(e=>({...e,before:[...e.before],after:[...e.after]}));},",
  "journal(){throw Error('raw diagnostic journal disabled in paired timing');},"],
 ['ownerStatus(){return {acknowledged,sessionIdentity:sessionIdentity===null?null:String(sessionIdentity),journalEntries:journalRecords.length};}',
  'ownerStatus(){return {acknowledged,sessionIdentity:sessionIdentity===null?null:String(sessionIdentity),journalEntries};}']
];
const mapBefore='  const stagedGenerations=new Map(board.generations);';
const mapAfter='  const stagedGenerations=entries.length===0?board.generations:new Map(board.generations);';
function exact(s,before,after){assert.equal(s.split(before).length,2,'exact derivative seam');return s.replace(before,after);}

export function derive(sourceRoot,mode){
 assert.ok(mode==='baseline'||mode==='candidate','exact arm');
 const file=resolve(sourceRoot,'scripts/bochs-cpu3-native-cold-direct-ram/provider.mjs');
 const original=readFileSync(file);assert.equal(sha(original),qualifiedSha256,'qualified provider bytes');
 let normalized=original.toString();for(const [before,after] of edits)normalized=exact(normalized,before,after);
 assert.equal(sha(Buffer.from(normalized)),baselineNormalizedSha256,'held timing derivative bytes');
 const baseline=normalized;
 if(mode==='candidate')normalized=exact(normalized,mapBefore,mapAfter);
 let inverse=normalized;
 if(mode==='candidate')inverse=exact(inverse,mapAfter,mapBefore);
 assert.equal(inverse,baseline,'candidate is only empty Map expression');
 for(const [before,after] of [...edits].reverse())inverse=exact(inverse,after,before);
 assert.equal(sha(Buffer.from(inverse)),qualifiedSha256,'inverse to qualified provider');
 let loaded=normalized;
 for(const [relative,expected] of Object.entries(imports)){
  assert.equal(sha(readFileSync(resolve(dirname(file),relative))),expected,'qualified dependency bytes');
  loaded=exact(loaded,`'${relative}'`,`'${pathToFileURL(resolve(dirname(file),relative)).href}'`);
 }
 let restored=loaded;
 for(const relative of Object.keys(imports))restored=exact(restored,
  `'${pathToFileURL(resolve(dirname(file),relative)).href}'`,`'${relative}'`);
 assert.equal(restored,normalized,'loaded import inverse');
 return Object.freeze({mode,qualifiedSha256,baselineNormalizedSha256,
  normalizedSha256:sha(Buffer.from(normalized)),loadedSha256:sha(Buffer.from(loaded)),
  dependencySha256:imports,moduleUrl:'data:text/javascript;base64,'+Buffer.from(loaded).toString('base64')});
}

export async function load(sourceRoot,mode){
 const identity=derive(sourceRoot,mode),module=await import(identity.moduleUrl);
 assert.equal(typeof module.createDirectRamColdBiosProvider,'function');
 return {create:module.createDirectRamColdBiosProvider,identity};
}
