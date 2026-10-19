/** Bounded correctness evidence; elapsed CPU/wall are not a speed gate. */
import assert from 'node:assert/strict';
import {writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {wholeNativeWords,boundedCount} from './parity.mjs';
const stringify=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x instanceof Uint8Array?Array.from(x):x)+'\n';
export function serializeMatchedProgress(record){
 assert.deepEqual(Object.keys(record).sort(),['name','n','q','native','javascript','board','ownership','elapsed'].sort());assert.match(record.name,/^(cut-[a-z0-9-]{1,48}|q-[0-9]{6})$/);boundedCount(record.n);boundedCount(record.q);wholeNativeWords(record.native);assert.equal(boundedCount(record.native.nativeTicks),record.n);assert.equal(boundedCount(record.native.successfulQuanta),record.q);assert.equal(record.javascript.q,record.q);assert.ok(record.javascript.cpu&&record.javascript.board&&record.board.board);assert.ok(record.ownership.mask===0||record.ownership.mask===0x800);assert.ok(Array.isArray(record.ownership.events));
 assert.deepEqual(Object.keys(record.elapsed).sort(),['processUserUs','processSystemUs','wallNs'].sort());for(const k of ['processUserUs','processSystemUs'])assert.ok(Number.isSafeInteger(record.elapsed[k])&&record.elapsed[k]>=0);assert.match(record.elapsed.wallNs,/^(0|[1-9][0-9]{0,17})$/);
 const bytes=Buffer.from(stringify({schema:'bw.cold-native.matched-progress.v1',...record,coverage:'Raw full166/JS CPU/board at a matched CPU+scalar-clock boundary. Whole board compared only at named cuts/stage/PIO; no per-element RAM or timing qualification.'}));assert.ok(bytes.length<=1<<20,'bounded progress record');return bytes;
}
export function createMatchedProgressWriter(output){
 assert.equal(realpathSync(output),output);assert.ok(lstatSync(output).isDirectory());const names=new Set(),records=[];
 return Object.freeze({
  append(record){assert.ok(records.length<64,'bounded progress count');assert.ok(!names.has(record.name),'unique progress boundary');const bytes=serializeMatchedProgress(record);writeFileSync(resolve(output,'progress-'+record.name+'.json'),bytes,{flag:'wx'});names.add(record.name);records.push({name:record.name,n:record.n,q:record.q,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});},
  receipt(){return {records:records.map(x=>({...x})),maxRecords:64,maxBytesPerRecord:1<<20,periodQ:16384,scope:'Retained matched progress only; elapsed process CPU/wall informational, not a calibrated throughput measurement'};}
 });
}
