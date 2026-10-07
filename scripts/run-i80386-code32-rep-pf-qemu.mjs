#!/usr/bin/env node
/** External QEMU cross-check for the freely authored code32 ROM. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assembleCode32RepPfRom} from './i80386-code32-rep-pf-oracle.mjs';

const output=process.argv[2],qemu=process.argv[3]??'/usr/bin/qemu-system-i386';
assert(output&&process.argv.length<=4,'usage: node scripts/run-i80386-code32-rep-pf-qemu.mjs /new/receipt.json [/pinned/qemu-system-i386]');
const sha=x=>createHash('sha256').update(x).digest('hex');
const dir=mkdtempSync(path.join(tmpdir(),'bw-owned-qemu-rep32-'));
try{
 const {rom,symbols}=assembleCode32RepPfRom();const bios=path.join(dir,'rom.bin'),trace=path.join(dir,'trace.log');writeFileSync(bios,rom);
 const argv=['-accel','tcg','-cpu','486','-m','16M','-bios',bios,'-display','none','-serial','none','-monitor','none','-debugcon','stdio','-global','isa-debugcon.iobase=0xe9','-device','isa-debug-exit,iobase=0xf4,iosize=0x04','-no-reboot','-no-shutdown','-d','int','-D',trace];
 const p=spawnSync(qemu,argv,{encoding:'utf8',timeout:10000,maxBuffer:1<<20});
 const log=readFileSync(trace,'utf8');const fault=[...log.matchAll(/^\s*\d+: v=0e .*$/gm)];
 assert.equal(p.error,undefined,String(p.error));assert.equal(p.status,1,'QEMU debug-exit status');assert.equal(p.stdout,'P32OK','real terminal output');assert.equal(fault.length,1,'one independent #PF');
 assert(!/Triple fault|v=08|v=0d/.test(log),'no nested exception or shutdown');
 const record=log.slice(log.indexOf(fault[0][0]),log.indexOf(fault[0][0])+1300);
 assert(record.includes(`IP=0008:${symbols.rep_fill.toString(16).padStart(8,'0')}`),'faulting REP site');
 assert(record.includes('e=0002')&&record.includes('CR2=00005000'),'fault code and address');
 assert(record.includes('ECX=00000002')&&record.includes('EDI=00005000')&&record.includes('ESI=00000000'),'partial REP state');
 const qemuVersion=execFileSync(qemu,['--version'],{encoding:'utf8'}).split('\n')[0];
 const receipt={schema:'bw.i80386-code32-rep-pf-qemu.v1',result:'PASS',emulator:{version:qemuVersion,sha256:sha(readFileSync(qemu)),cpu:'486',accelerator:'tcg',memoryMiB:16},fixture:{romSha256:sha(rom),symbols},execution:{exitStatus:p.status,stdout:p.stdout,stderr:p.stderr,command:argv.map(x=>x===bios?'<owned-rom>':x===trace?'<owned-trace>':x),faultCount:fault.length,rawFaultRecord:record.trimEnd(),traceSha256:sha(log)}};
 writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({result:receipt.result,emulator:receipt.emulator,fixture:receipt.fixture,faultCount:fault.length,stdout:p.stdout}));
}finally{rmSync(dir,{recursive:true,force:true});}
