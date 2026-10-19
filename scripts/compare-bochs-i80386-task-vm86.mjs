/** Independent 386-level Bochs check of the owned VM86 task-switch fixture. */
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir,cpus,platform,arch} from 'node:os';
import {fileURLToPath} from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source='test/fixtures/i80386-vm-task.S';
const core='src/experimental/i80386.js';
const self='scripts/compare-bochs-i80386-task-vm86.mjs';
const paths=[source,core,self];
const hash=data=>createHash('sha256').update(data).digest('hex');
const sourceHashes=Object.fromEntries(paths.map(p=>[p,hash(readFileSync(resolve(repo,p)))]));
execFileSync('git',['diff','--quiet','HEAD','--',...paths],{cwd:repo});
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const bochsRoot=process.env.BOCHS_386_ROOT;
if(!bochsRoot)throw new Error('Set BOCHS_386_ROOT to a clean Bochs REL_2_7_FINAL source checkout built with --enable-cpu-level=3 --with-nogui');
const bochsRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:bochsRoot,encoding:'utf8'}).trim();
if(bochsRevision!=='0e45b736ef9792eb9b752b0a35db49eaf2faea47')throw new Error('unexpected Bochs source revision');
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:bochsRoot,encoding:'utf8'}).trim())
  throw new Error('Bochs tracked source must be clean');
const configHeader=readFileSync(resolve(bochsRoot,'bochs/config.h'),'utf8');
if(!configHeader.includes('#define BX_CPU_LEVEL 3'))throw new Error('Bochs must be built at CPU level 3');
const bochs=resolve(bochsRoot,'bochs/bochs');
const bochsSha256=hash(readFileSync(bochs));
const bios=resolve(repo,'roms/free-at-bios/BIOS-bochs-legacy');
const vgaBios=resolve(repo,'roms/free-at-bios/vgabios-lgpl.bin');
const build=mkdtempSync(join(tmpdir(),'bw-bochs-vmtask-'));
try {
  const object=join(build,'guest.o'),image=join(build,'guest.bin');
  execFileSync('as',['--32','-o',object,resolve(repo,source)]);
  execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','--oformat','binary','-o',image,object]);
  const binary=readFileSync(image);
  if(binary.length>1474560)throw new Error('fixture exceeds floppy capacity');
  const floppy=Buffer.alloc(1474560);binary.copy(floppy);writeFileSync(join(build,'floppy.img'),floppy);
  const log=join(build,'bochs.log');
  const rc=join(build,'bochsrc');
  writeFileSync(rc,[
    'display_library: nogui',
    'memory: guest=16, host=16',
    `romimage: file=${bios}`,
    `vgaromimage: file=${vgaBios}`,
    'cpu: count=1, ips=10000000',
    `floppya: 1_44=${join(build,'floppy.img')}, status=inserted`,
    'boot: floppy',
    'port_e9_hack: enabled=1',
    `log: ${log}`,
    'panic: action=fatal',
    'error: action=report',
    'info: action=report',
    'debug: action=ignore',
    'mouse: enabled=0',
  ].join('\n')+'\n');
  // stdbuf makes the E9 checkpoint observable before the fixture's
  // QEMU-specific exit port falls through to Bochs' otherwise idle guest loop.
  const run=await new Promise((resolveRun,reject)=>{
    const child=spawn('stdbuf',['-o0','-e0',bochs,'-q','-f',rc],{stdio:['ignore','pipe','pipe']});
    let output='',error='',sawCheckpoint=false;
    const timer=setTimeout(()=>child.kill('SIGTERM'),5000);
    child.stdout.on('data',chunk=>{
      output+=chunk.toString('latin1');
      const start=output.indexOf('BHV');
      if(!sawCheckpoint&&start>=0&&output.length>=start+7){sawCheckpoint=true;child.kill('SIGTERM');}
    });
    child.stderr.on('data',chunk=>{error+=chunk.toString('latin1');});
    child.once('error',err=>{clearTimeout(timer);reject(err);});
    child.once('close',(code,signal)=>{clearTimeout(timer);resolveRun({output,error,code,signal,sawCheckpoint});});
  });
  const checkpointStart=run.output.indexOf('BHV');
  const reference=run.sawCheckpoint?run.output.slice(checkpointStart,checkpointStart+7):null;
  const memory=new Uint8Array(0x10000);memory.set(binary,0x7c00);
  let actual='';
  const cpu=new I80386({read:a=>memory[a],fetch:a=>memory[a],write:(a,v)=>memory[a]=v,
    inPort:()=>0,outPort:(port,value)=>{if(port===0xe9)actual+=String.fromCharCode(value&255);}});
  cpu.cs=0;cpu.eip=0x7e00;
  cpu.segmentCaches[1]={base:0,limit:0xffff,default32:false,present:true,code:true,readable:true,writable:false};
  for(let step=0;step<250&&actual.length<7;step++)cpu.step();
  const mutation=process.env.I386_BOCHS_VM_TASK_MUTATION??null;
  if(![null,'result','checkpoint','memory'].includes(mutation))throw new Error('unknown mutation');
  if(mutation==='result')actual=actual.slice(0,-1)+'X';
  if(mutation==='checkpoint')actual=actual.slice(0,3)+'X'+actual.slice(4);
  if(mutation==='memory')memory[0x500]^=1;
  const actualCheckpoint={handlerMemory:memory[0x500],cs:cpu.cs,
    eip:cpu.eip,eflags:cpu.eflags,tr:cpu.tr.selector};
  const referenceCheckpoint=reference?{
    handlerMemory:reference.charCodeAt(3),cs:parseInt(reference.slice(4,6),10),
    iopl:parseInt(reference[6],10)}:null;
  const bochsLog=readFileSync(log,'utf8');
  const differences=[];
  if(reference!=='BHVK003')differences.push({field:'reference.output',expected:'BHVK003',actual:reference});
  if(actual!=='BHVK003')differences.push({field:'actual.output',expected:'BHVK003',actual});
  if(actualCheckpoint.handlerMemory!==0x4b)differences.push({field:'actual.handlerMemory',expected:0x4b,actual:actualCheckpoint.handlerMemory});
  if(actualCheckpoint.cs!==0)differences.push({field:'actual.cs',expected:0,actual:actualCheckpoint.cs});
  if(!(actualCheckpoint.eflags&0x20000))differences.push({field:'actual.eflags.VM',expected:1,actual:0});
  if(((actualCheckpoint.eflags>>>12)&3)!==3)differences.push({field:'actual.eflags.IOPL',expected:3,actual:(actualCheckpoint.eflags>>>12)&3});
  if(actualCheckpoint.tr!==0x20)differences.push({field:'actual.tr',expected:0x20,actual:actualCheckpoint.tr});
  if(referenceCheckpoint&&referenceCheckpoint.handlerMemory!==actualCheckpoint.handlerMemory)
    differences.push({field:'handlerMemory',reference:referenceCheckpoint.handlerMemory,actual:actualCheckpoint.handlerMemory});
  if(referenceCheckpoint&&referenceCheckpoint.cs!==actualCheckpoint.cs)
    differences.push({field:'cs',reference:referenceCheckpoint.cs,actual:actualCheckpoint.cs});
  if(referenceCheckpoint&&referenceCheckpoint.iopl!==((actualCheckpoint.eflags>>>12)&3))
    differences.push({field:'iopl',reference:referenceCheckpoint.iopl,actual:(actualCheckpoint.eflags>>>12)&3});
  if(!bochsLog.includes('Booting from 0000:7c00'))
    differences.push({field:'reference.boot',expected:'Booting from 0000:7c00',actual:null});
  if(bochsLog.includes('>>PANIC<<'))differences.push({field:'reference.panic',actual:true});
  execFileSync('git',['diff','--quiet','HEAD','--',...paths],{cwd:repo});
  if(paths.some(p=>hash(readFileSync(resolve(repo,p)))!==sourceHashes[p]))throw new Error('execution source changed');
  const report={oracle:'Bochs CPU-level-3 software emulator',revision,sourceHashes,
    host:{platform:platform(),arch:arch(),cpuModels:[...new Set(cpus().map(cpu=>cpu.model))],node:process.version},
    bochsRevision,bochsSha256,bochsConfigSha256:hash(configHeader),
    biosSha256:hash(readFileSync(bios)),vgaBiosSha256:hash(readFileSync(vgaBios)),
    imageSha256:hash(binary),floppySha256:hash(floppy),
    execution:{reference:'Bochs BIOS boots owned floppy; compare E9 BHV plus handler-memory, resumed CS and IOPL checkpoint',
      actual:'same image at 0x7c00; starts owned setup at 0x7e00 after disk load',
      checkpoint:{boundary:'after IDT task gate handler IRET restores the VM86 task, before its F4 exit port',
        encoding:'B=setup; H=protected handler; V=VM86 resume; K=handler RAM byte at physical 0x0500; 00=CS; 3=IOPL'},
      postCheckpoint:'The fixture exits via QEMU port F4; Bochs can later reset from its VM86 idle loop. Stop at the complete seven-byte checkpoint.'},
    mutation,status:differences.length?'fail':'pass',expected:'BHVK003',reference,actual,
    referenceCheckpoint,actualCheckpoint,differences,
    bochsExit:{code:run.code,signal:run.signal},
    bochsLogTail:bochsLog.split('\n').filter(line=>line.includes('BIOS')||line.includes('CPU')).slice(-12)};
  console.log(JSON.stringify(report,null,2));
  if(differences.length)process.exitCode=1;
} finally {rmSync(build,{recursive:true,force:true});}
