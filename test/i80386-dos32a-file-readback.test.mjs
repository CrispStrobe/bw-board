import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=fs.readFileSync(new URL('../scripts/i80386-dos32a-file-readback/probe.mjs',import.meta.url),'utf8');
// Evaluate only exact source-owned pure functions, never the emulator imports.
const witnessText=source.slice(source.indexOf('export function witness('),source.indexOf('export function regionProof(')).replace('export ','');
const witness=vm.runInNewContext(witnessText+';witness',{Buffer});
const regionText=source.slice(source.indexOf('export function regionProof('),source.indexOf('export async function run(')).replace('export ','');
const regionProof=vm.runInNewContext(regionText+';regionProof',{Buffer,sha:()=> 'authored'});
const prompt=vm.runInNewContext('('+source.match(/export const prompt=([^;]+);/)[1]+')');
function authored(){
 const client=Buffer.alloc(8192),base=65536;client.set([0xe8,0,0,0,0,0x5d],4096);
 client.set([0xcd,0x21,0x0f,0x82,0,0],4196);client.set([0x0f,0x82,0,0,0,0],4198);
 client.set([0x8d,0x95,1,2,3,4],4296);client.set([0x8b,0x9d,1,2,3,4],4396);
 client.fill(0xcc,4608,4672);const guard=Buffer.from('a55aa55a3cc33cc3','hex');guard.copy(client,4600);guard.copy(client,4672);
 const memory=Buffer.from(client),read=a=>memory[4096+a-base]??0;
 const meta={labels:{entry:0,full_call:100,full_return:102,proof_ready:200,write_fail:300,full_buffer:512,proof:700,saved_counts:900},witnessRoles:['entry','full_call','full_return','proof_ready']};
 const cpu={cr0:1,eip:base,cs:35,ds:43,segmentCaches:[{}, {base:0,limit:0xffffffff,default32:true},{},{base:0,limit:0xffffffff,default32:false}]};
 for(const reg of ['eax','ebx','ecx','edx','esi','edi','ebp','esp','eflags'])cpu[reg]=0;
 cpu.ebp=base+5;
 return {client,memory,read,meta,cpu,base,guard};
}
test('current prompt and exact DOS launch/VERIFY literals',()=>{
 assert.equal(prompt(['A:\\>']),true);assert.equal(prompt(['old','C:\\>  ']),true);
 for(const row of ['A:>','A:\\>echo ready','old A:\\>',''])assert.equal(prompt([row]),false);
 const commands=[...source.matchAll(/queue=encode\(('[^']*')\)/g)].map(x=>vm.runInNewContext(x[1]));
 assert.ok(commands.includes('c:\\runfile.bat\r'));assert.ok(commands.includes('c:\\verify.bat\r'));
 for(const command of commands)assert.ok(!command.includes('\\\\')&&!command.endsWith('\\r'));
});
test('actual source witness preserves original full registers and DS.D false',()=>{
 const a=authored(),entry=witness(a.cpu,null,a.meta,a.client,a.read,10);assert.equal(entry.payloadHex,a.client.subarray(4096).toString('hex'));
 a.cpu.eip+=100;Object.assign(a.cpu,{eax:0x3f00,ebx:5,ecx:17,edx:a.base+512,eflags:0x203});
 const call=witness(a.cpu,entry,a.meta,a.client,a.read,20);assert.equal(call.eax,0x3f00);assert.equal(call.eflags,0x203);assert.equal(call.dsDefault32,false);assert.equal(call.buffer.dataHex,'cc'.repeat(64));
 assert.equal(call.dsSelector,43);assert.equal('selector' in a.cpu.segmentCaches[3],false);
 a.cpu.eip+=2;Object.assign(a.cpu,{eax:17,edx:0xdeadbeef,eflags:0x202});a.memory[4608]=0x11;
 const ret=witness(a.cpu,entry,a.meta,a.client,a.read,30);assert.equal(ret.buffer.linear,call.buffer.linear);assert.equal(ret.buffer.dataHex,'11'+'cc'.repeat(63));assert.equal(ret.edx,0xdeadbeef);
});
test('original DS pointer and code ownership are checked before buffer capture',()=>{
 for(const mutate of [a=>{a.cpu.edx++},a=>{a.cpu.segmentCaches[3].base=1},a=>{a.cpu.segmentCaches[3].limit=10},a=>{a.cpu.ds=0}]){
  const a=authored(),entry=witness(a.cpu,null,a.meta,a.client,a.read,10);a.cpu.eip+=100;a.cpu.edx=a.base+512;mutate(a);
  assert.throws(()=>witness(a.cpu,entry,a.meta,a.client,a.read,20),/DS buffer address|DS descriptor identity/);
 }
 const a=authored(),entry=witness(a.cpu,null,a.meta,a.client,a.read,10);a.cpu.eip+=100;a.cpu.edx=a.base+512;a.memory[4196]=0x90;
 assert.throws(()=>witness(a.cpu,entry,a.meta,a.client,a.read,20),/owned code changed/);
});
test('blocked foreign CS/mode is not fabricated into an owned witness',()=>{
 const a=authored(),entry=witness(a.cpu,null,a.meta,a.client,a.read,10);a.cpu.eip+=100;a.cpu.cs=36;
 assert.equal(witness(a.cpu,entry,a.meta,a.client,a.read,20),null);a.cpu.cs=35;a.cpu.cr0=0;assert.equal(witness(a.cpu,entry,a.meta,a.client,a.read,30),null);
 a.cpu.cr0=0x80000001;assert.equal(witness(a.cpu,entry,a.meta,a.client,a.read,40),null);
});
test('actual proof/full-count snapshots and authenticated guest-failure PC',()=>{
 const a=authored(),entry=witness(a.cpu,null,a.meta,a.client,a.read,10);a.cpu.eip=a.base+200;a.memory[4996]=17;
 const proof=witness(a.cpu,entry,a.meta,a.client,a.read,20);assert.equal(proof.savedCountsLinear,a.base+900);assert.equal(proof.savedCountsHex,'11'+'00'.repeat(11));assert.equal(proof.proofHex.length,310);
 a.cpu.eip=a.base+300;assert.equal(witness(a.cpu,entry,a.meta,a.client,a.read,30).role,'write_fail');a.memory[4396]=0x90;assert.throws(()=>witness(a.cpu,entry,a.meta,a.client,a.read,40),/owned code changed/);
});
test('all selected initial allocations are admitted before even the first data copy',()=>{
 const initial=Buffer.alloc(20992),fat=Buffer.alloc(20992),root=Buffer.alloc(16384);initial.writeUInt16LE(0xffff,4);fat.writeUInt16LE(0xffff,4);fat.writeUInt16LE(0xffff,80);
 for(const [i,name,c] of [[0,'DATA    BIN',40],[1,'RESULT  BIN',2]]){root.write(name,i*32,'ascii');root[i*32+11]=32;root.writeUInt16LE(c,i*32+26);root.writeUInt32LE(5,i*32+28);}
 let copies=0;const raw={length:10653696,subarray(a,z){if(a===9216&&z===30208||a===30208&&z===51200)return fat;if(a===51200&&z===67584)return root;copies++;throw Error('data copied before complete admission');}};
 assert.throws(()=>regionProof(raw,initial),/selected cluster initially allocated/);assert.equal(copies,0);root.fill(0);assert.equal(Object.keys(regionProof(raw,initial).clusters).length,0);assert.equal(copies,0);
 assert.throws(()=>regionProof(raw,Buffer.alloc(1)),/initial FAT extent/);
});
