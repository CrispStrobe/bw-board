/** Compare an owned VM86 task boot image with QEMU TCG and ExperimentalI80386. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source='test/fixtures/i80386-vm-task.S',core='src/experimental/i80386.js',self='scripts/compare-qemu-i80386-task-vm86.mjs';
const paths=[source,core,self];
execFileSync('git',['diff','--quiet','HEAD','--',...paths],{cwd:repo});
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const hash=data=>createHash('sha256').update(data).digest('hex');
const sourceHashes=Object.fromEntries(paths.map(path=>[path,hash(readFileSync(resolve(repo,path)))]));
const mutation=process.env.I386_QEMU_VM_TASK_MUTATION??null;
if(![null,'result','budget'].includes(mutation))throw new Error(`unknown mutation ${mutation}`);
const qemuRoot=process.env.QEMU_ROOT;
if(!qemuRoot)throw new Error('Set QEMU_ROOT to the extracted QEMU 8.2.2 package root');
const qemu=resolve(qemuRoot,'usr/bin/qemu-system-i386'),lib=resolve(qemuRoot,'usr/lib/x86_64-linux-gnu');
const env={...process.env,LD_LIBRARY_PATH:lib,QEMU_MODULE_DIR:resolve(lib,'qemu')};
const qemuVersion=execFileSync(qemu,['--version'],{env,encoding:'utf8'}).split('\n')[0];
if(qemuVersion!=='QEMU emulator version 8.2.2 (Debian 1:8.2.2+ds-0ubuntu1.18)')throw new Error(`unexpected QEMU version: ${qemuVersion}`);
const object='/tmp/astra-vmtask-oracle.o',image='/tmp/astra-vmtask-oracle.bin',debug='/tmp/astra-vmtask-oracle.out';
execFileSync('as',['--32','-o',object,resolve(repo,source)]);
execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','--oformat','binary','-o',image,object]);
writeFileSync(debug,'');
const run=spawnSync(qemu,['-L',resolve(qemuRoot,'usr/share/seabios'),'-bios','bios.bin','-machine','pc,accel=tcg','-cpu','486','-m','16M','-nic','none','-vga','none','-drive',`file=${image},format=raw,if=floppy`,'-display','none','-monitor','none','-serial','none','-debugcon',`file:${debug}`,'-no-reboot','-no-shutdown'],{env,timeout:1000});
if(run.error&&run.error.code!=='ETIMEDOUT')throw run.error;
const reference=readFileSync(debug,'utf8');
const binary=readFileSync(image),memory=new Uint8Array(0x10000);memory.set(binary,0x7c00);
let actual='';const cpu=new I80386({read:a=>memory[a],fetch:a=>memory[a],write:(a,v)=>memory[a]=v,inPort:()=>0,outPort:(port,value)=>{if(port===0xe9)actual+=String.fromCharCode(value&255);}});
cpu.cs=0;cpu.eip=0x7e00;cpu.segmentCaches[1]={base:0,limit:0xffff,default32:false,present:true,code:true,readable:true,writable:false};
const budget=mutation==='budget'?10:200;
const actualTrail=[];
for(let step=0;step<budget&&actual!=='BHV';step++){actualTrail.push(`${cpu.cs.toString(16)}:${cpu.eip.toString(16)}`);cpu.step();}
if(mutation==='result')actual=actual.slice(0,-1)+'X';
const expected='BHV',differences=[];
if(reference!==expected)differences.push({field:'reference.output',expected,actual:reference});
if(actual!==expected)differences.push({field:'actual.output',expected,actual});
execFileSync('git',['diff','--quiet','HEAD','--',...paths],{cwd:repo});
if(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()!==revision||paths.some(path=>hash(readFileSync(resolve(repo,path)))!==sourceHashes[path]))throw new Error('execution sources changed');
const packages={
 'qemu-system-x86_1:8.2.2+ds-0ubuntu1.18_amd64.deb':'14602e262627adac030329d2cecfee5f6c0938b34566ff2ea2d4c9a9eb02430d',
 'qemu-system-common_1:8.2.2+ds-0ubuntu1.18_amd64.deb':'0a0b744f31e87d72dd0465436b8dfbb1ef9f574ecd0d5a2e9dd8c5cb7d0fef1f',
 'qemu-system-data_1:8.2.2+ds-0ubuntu1.18_all.deb':'a14b88d864859bd61c8a3274971da4ecb7da6cec15be6c265d0d411f783d5f2e',
 'seabios_1.16.3-2_all.deb':'cac4e59a66c834d19cae751c22ab3a0391c22f78010fd11aa2e3fe630e6bc0e0'};
const actualState={cs:cpu.cs,eip:cpu.eip,tr:cpu.tr.selector,cr0:cpu.cr0,eflags:cpu.eflags,halted:cpu.halted,shutdown:cpu.shutdown,trail:actualTrail.slice(0,50)};
console.log(JSON.stringify({oracle:'QEMU TCG later-model software CPU',revision,qemuVersion,qemuExecutableHash:hash(readFileSync(qemu)),packages,sourceHashes,imageHash:hash(binary),mutation,status:differences.length?'fail':'pass',expected,reference,actual,actualState,differences},null,2));process.exitCode=differences.length?1:0;
