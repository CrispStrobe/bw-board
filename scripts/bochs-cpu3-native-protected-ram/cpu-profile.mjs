/** One attested MOV CR0 model seam; ordinary global CPU and snapshots are untouched. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export const cpuSourceSha256='6fba681208e1443cc9eff00ae6aba444903d23e5feafe62527b25428e72d60ed';
export const nativeCr0Source=Object.freeze({compiledRevision:'81694d0d19a86ded0449ab56b3554020ffc344ca',buildRun:37136096190,path:'bochs/cpu/crregs.cc',sha256:'f39cb6b7b1f7b030690104dcd31e839651a6d343784d8a072e5b337d17fcd374',lines:'1082–1084',expression:'val_32 = val_32 | 0x7ffffff0',scope:'Bochs CPU3 model semantics, not an Intel hardware correction'});
export function bochsCr0Write(value){assert.ok(Number.isInteger(value)&&value>=0&&value<=0xffffffff);return (value|0x7ffffff0)>>>0;}
export function deriveProtectedCpu(bytes){
 assert.equal(sha(bytes),cpuSourceSha256,'exact ordinary CPU source');const source=bytes.toString();
 const old='? (value & 0x8000001f) >>> 0',next='? ((value & 0x8000001f) | 0x7ffffff0) >>> 0';
 assert.equal(source.split(old).length-1,1,'one MOV CR0 assignment seam');const derived=source.replace(old,next);
 assert.equal(derived.split(next).length-1,1);const inverse=derived.replace(next,old);assert.equal(sha(inverse),cpuSourceSha256,'exact inverse');
 return {bytes:Buffer.from(derived),baseSha256:cpuSourceSha256,sha256:sha(derived),edits:[{old,next,count:1}],nativeCr0Source};
}
export async function protectedCpuClass(...args){
 assert.equal(args.length,0,'no caller core');const d=deriveProtectedCpu(readFileSync(new URL('../../src/experimental/i80386.js',import.meta.url)));
 // This standalone CPU source has no imports; fail if that source contract changes.
 assert.ok(!/^(?:import|export .* from)\s/m.test(d.bytes.toString()),'standalone attested core');
 const m=await import('data:text/javascript;base64,'+d.bytes.toString('base64'));return m.ExperimentalI80386;
}
