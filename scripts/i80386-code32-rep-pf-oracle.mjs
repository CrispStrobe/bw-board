/** Owned code32 REP/page-fault guest against the ordinary JS AT machine. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL} from '../src/experimental/i80386-at-machine.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const source='test/fixtures/i80386-free-code32-rep-pf.S';
const hash=x=>createHash('sha256').update(x).digest('hex');
const copy=x=>structuredClone(x);
export function assembleCode32RepPfRom(){
 const dir=mkdtempSync(path.join(tmpdir(),'bw-owned-rep32-'));
 try{
  execFileSync('as',['--32','-o',path.join(dir,'rom.o'),path.join(root,source)]);
  execFileSync('ld',['-m','elf_i386','-Ttext','0','-e','setup','-o',path.join(dir,'rom.elf'),path.join(dir,'rom.o')]);
  execFileSync('objcopy',['-O','binary','-j','.text',path.join(dir,'rom.elf'),path.join(dir,'rom.bin')]);
  const rom=readFileSync(path.join(dir,'rom.bin'));assert.equal(rom.length,65536);
  const symbols=Object.fromEntries(execFileSync('nm',['--defined-only',path.join(dir,'rom.o')],{encoding:'utf8'}).trim().split('\n').map(line=>{const [v,,n]=line.trim().split(/\s+/);return [n,parseInt(v,16)];}));
  return {rom,symbols};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
const regs=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cr4','cs','ds','es','ss','fs','gs'];
function cpuState(cpu){return copy({...Object.fromEntries(regs.map(k=>[k,cpu[k]>>>0])),pc:cpu.pc>>>0,gdtr:cpu.gdtr,idtr:cpu.idtr,ldtr:cpu.ldtr,tr:cpu.tr,segmentCaches:cpu.segmentCaches,debugRegisters:[...cpu._debugRegisters],cycles:cpu.cycles,halted:cpu.halted,shutdown:cpu.shutdown,interruptShadow:cpu._interruptShadow,nmiShadow:cpu._nmiShadow,debugShadow:cpu._debugShadow,cpuProfile:cpu.cpuProfile,strict386:cpu._strict386});}
function boardState(m){return copy({cycles:m.cycles,debt:m._chipDebt,deadline:m._chipDeadline,a20Enabled:m._a20Enabled,a20:m._a20Controller.getState(),fastA20Latch:m._fastA20Latch,cpuResetPending:!!m._cpuResetPending,interruptSignals:{nmiPending:!!m._nmiPending,nmiMasked:!!m._nmiMasked,kbdStrobe:!!m._kbdStrobe,pinLevels:{...m._pinLevels}},chipStates:Object.fromEntries(Object.entries(m.chips).map(([name,chip])=>[name,chip.getState()]))});}
const pages=[0,1,2,3,4,5,8,9,10,0xf0];
const selectedPages=m=>Object.fromEntries(pages.map(n=>[n,[...m.mem.subarray(n<<12,(n+1)<<12)]]));
export function runCode32RepPfOracle(){
 const {rom,symbols}=assembleCode32RepPfRom();const events=[],steps=[],deliveries=[];let m,attempt=0,q=0;
 const record=e=>events.push({ordinal:events.length+1,attempt,q,...e});
 m=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL,{onPortAccess:e=>record({kind:'pio',...e})});
 m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();
 const reset={cpu:cpuState(m.cpu),board:boardState(m)};
 for(const method of ['fetch','read','write']){const original=m.cpu[method];m.cpu[method]=(address,value)=>{const before=method==='write'?m._read386(address):undefined;const result=original.call(m.cpu,address,value);record({kind:method,address:address>>>0,value:method==='write'?value&255:result,before,after:method==='write'?m._read386(address):undefined});return result;};}
 const rawWrite=m.cpu._rawWrite;m.cpu._rawWrite=(address,value)=>{const before=m._read386(address);const result=rawWrite(address,value);record({kind:'write',address:address>>>0,value:value&255,before,after:m._read386(address),paging:!!m.cpu._pagingBitWrite});return result;};
 const fault=m.cpu._deliverFault;m.cpu._deliverFault=(...args)=>{const before=cpuState(m.cpu),firstOrdinal=events.length+1;const result=fault.apply(m.cpu,args);deliveries.push({vector:args[0].vector,errorCode:args[0].errorCode,before,after:cpuState(m.cpu),frame:[...m.mem.subarray(m.cpu.esp,m.cpu.esp+16)],firstOrdinal,lastOrdinal:events.length,attempt,q,pages:selectedPages(m),board:boardState(m)});return result;};
 for(attempt=1;attempt<=256&&!m.cpu.halted;attempt++){
  const before=cpuState(m.cpu),boardBefore=boardState(m),firstOrdinal=events.length+1;
  const charged=m.step(),completed=m.cpu.cycles-before.cycles;if(completed)q+=completed;
  steps.push({attempt,q,completed,charged,before,after:cpuState(m.cpu),boardBefore,boardAfter:boardState(m),firstOrdinal,lastOrdinal:events.length});
 }
 const beforeSettle={cpu:cpuState(m.cpu),board:boardState(m)};m._catchUpChips();
 const result={schema:'bw.i80386-code32-rep-pf-js.v1',source:{revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),fixtureSha256:hash(readFileSync(path.join(root,source)))},romSha256:hash(rom),symbols,reset,events,steps,deliveries,beforeSettle,final:{cpu:cpuState(m.cpu),board:boardState(m),pages:selectedPages(m),memorySha256:hash(m.mem)}};
 validateCode32RepPfOracle(result);return result;
}
export function validateCode32RepPfOracle(r){
 const eq=(a,b,what)=>assert.deepEqual(a,b,what),s=r.symbols;
 const {rom}=assembleCode32RepPfRom();assert.equal(r.romSha256,hash(rom));
 const backing=Buffer.alloc(PCAT80386_EXPERIMENTAL.memoryBytes);rom.copy(backing,0xf0000);rom.copy(backing,0xff0000);
 for(const e of r.events.filter(e=>e.kind==='write')){
  const at=e.address>=0xffff0000?0xff0000+(e.address-0xffff0000):e.address;
  assert(at<backing.length,'bounded physical store');eq(e.before,backing[at],`physical write before ${e.ordinal}`);
  eq(e.after,e.value,`physical write after ${e.ordinal}`);backing[at]=e.value;
 }
 eq(hash(backing),r.final.memorySha256,'independent complete backing replay');
 for(const n of pages)eq(r.final.pages[n],[...backing.subarray(n<<12,(n+1)<<12)],`full physical page ${n}`);
 eq(r.deliveries.length,1,'one real #PF');const f=r.deliveries[0];
 eq([f.vector,f.errorCode,f.before.eip,f.before.ecx,f.before.edi,f.before.esi,f.after.cr2],[14,2,s.rep_fill,2,0x5000,0,0x5000],'precise code32 fault state');
 eq([f.after.cs,f.after.eip,f.after.esp],[8,s.pf_handler,0x8ff0],'32-bit handler and frame');
 const frame=Buffer.from(f.frame);eq([0,4,8,12].map(i=>frame.readUInt32LE(i)),[2,s.rep_fill,8,f.before.eflags|0x10000],'real four-dword frame');
 const rep=r.steps.filter(x=>x.before.cs===8&&x.before.eip===s.rep_fill);eq(rep.map(x=>[x.before.ecx,x.before.edi,x.completed]),[[4,0x4ff8,1],[3,0x4ffc,1],[2,0x5000,0],[2,0x5000,1],[1,0x5004,1]],'once-only REP element ledger');
 const dest=r.events.filter(e=>e.kind==='write'&&e.address>=0x4ff8&&e.address<0x5008);
 eq(dest.map(e=>e.address),Array.from({length:16},(_,i)=>0x4ff8+i),'exact destination byte effects');
 assert(!r.events.slice(rep[2].firstOrdinal-1,rep[2].lastOrdinal).some(e=>e.kind==='write'&&e.address>=0x5000&&e.address<0x5004),'faulting element does not commit');
 eq(f.pages[4].slice(0xff8),[0x44,0x33,0x22,0x11,0x44,0x33,0x22,0x11],'prior elements committed at fault');
 eq(f.pages[5].slice(0,8),Array(8).fill(0),'fault destination untouched');
 eq(r.final.pages[4].slice(0xff8),[0x44,0x33,0x22,0x11,0x44,0x33,0x22,0x11],'pre-fault commits');
 eq(r.final.pages[5].slice(0,8),[0x44,0x33,0x22,0x11,0x44,0x33,0x22,0x11],'post-retry commits');
 eq(r.final.pages[0].slice(0x520,0x534),[0,0x50,0,0,2,0,0,0,0,0x50,0,0,0,0,0,0,1,0,0,0],'guest handler witnesses');
 eq(r.events.filter(e=>e.kind==='pio'&&e.port===0xe9).map(e=>String.fromCharCode(e.value)).join(''),'P32OK','actual terminal marker');
 assert(r.final.cpu.halted&&!r.final.cpu.shutdown,'terminal HLT without shutdown');
 eq(r.beforeSettle.cpu,r.final.cpu,'settlement does not execute CPU');eq(r.final.board.debt,0,'terminal device debt settled');
 return {attempts:r.steps.length,completed:r.steps.reduce((n,x)=>n+x.completed,0),faults:r.deliveries.length,rep:rep.length,memorySha256:r.final.memorySha256};
}
