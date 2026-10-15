import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const file=new URL('../scripts/i80386-dos32a-input/probe.mjs',import.meta.url);
const source=fs.readFileSync(file,'utf8');
// Execute exact source-owned pure declarations; never import a CPU/device module.
const promptText=source.match(/export const prompt=([^;]+);/)[1];
const prompt=vm.runInNewContext('('+promptText+')');
test('actual prompt predicate and DOS command literal bytes',()=>{
 assert.equal(prompt(['A:\\>']),true);assert.equal(prompt(['BW READY','C:\\>  ']),true);
 for(const row of ['A:>','A:\\>echo ready','old A:\\>',''])assert.equal(prompt([row]),false);
 const literals=[...source.matchAll(/queue=encode\(('[^']*')\)/g)].map(x=>vm.runInNewContext(x[1]));
 assert.ok(literals.includes('c:\\runkey.bat\r'));assert.ok(literals.includes('c:\\verify.bat\r'));
 for(const command of literals)assert.ok(!command.includes('\\\\')&&!command.endsWith('\\r'));
});
const witnessText=source.slice(source.indexOf('export function witness('),source.indexOf('export function regionProof(')).replace('export ','');
const witness=vm.runInNewContext(witnessText+';witness',{Buffer});
test('actual code/mode and preinstruction witness boundaries',()=>{
 const bytes=new Uint8Array(8192);bytes.set([0xe8,0,0,0,0,0x5d],4096);bytes.set([0x0f,0xb6,0xc0],4116);
 const cpu={cr0:1,eip:65536,cs:35,eax:0x861,segmentCaches:[{}, {base:0,default32:true}]};
 const mem=a=>bytes[4096+a-65536]??0;
 const entry=witness(cpu,null,{ready:165,consumed:20},bytes,mem,10);assert.equal(entry.role,'entry');
 cpu.eip+=20;const consumed=witness(cpu,entry,{ready:165,consumed:20},bytes,mem,20);
 assert.equal(consumed.eax&255,0x61);assert.equal(consumed.role,'consumed');
 cpu.cr0=0;assert.equal(witness(cpu,entry,{consumed:20},bytes,mem,30),null);
 cpu.cr0=1;cpu.segmentCaches[1].default32=false;assert.equal(witness(cpu,entry,{consumed:20},bytes,mem,30),null);
 cpu.segmentCaches[1].default32=true;assert.throws(()=>witness(cpu,entry,{ready:165,consumed:20},bytes,()=>0,30),/owned code changed/);
});
const regionText=source.slice(source.indexOf('export function regionProof('),source.indexOf('export async function run(')).replace('export ','');
const regionProof=vm.runInNewContext(regionText+';regionProof',{Buffer,sha:()=> 'authored'});
test('actual selected capture rejects initial foreign clusters before any data copy',()=>{
 const initial=Buffer.alloc(20992),fat=Buffer.alloc(20992),root=Buffer.alloc(16384);
 initial.writeUInt16LE(0xffff,4);fat.writeUInt16LE(0xffff,4);fat.writeUInt16LE(0xffff,80);
 for(const [i,name,c] of [[0,'RESULT  BIN',40],[1,'KEYOK   TXT',2]]){
  root.write(name,i*32,'ascii');root[i*32+11]=32;root.writeUInt16LE(c,i*32+26);root.writeUInt32LE(5,i*32+28);
 }
 let copies=0;
 const raw={length:10653696,subarray(start,end){
  if(start===9216&&end===30208||start===30208&&end===51200)return fat;
  if(start===51200&&end===67584)return root;
  copies++;throw Error('selected bytes copied before all initial allocations admitted');
 }};
 assert.throws(()=>regionProof(raw,initial),/selected cluster initially allocated/);assert.equal(copies,0);
 root.fill(0);assert.equal(Object.keys(regionProof(raw,initial).clusters).length,0);assert.equal(copies,0);
 assert.throws(()=>regionProof(raw,Buffer.alloc(1)),/frozen initial FAT extent/);
});
