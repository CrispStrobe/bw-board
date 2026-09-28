/** Owned protected-16 branch-to-I/O acceptance oracle; no private media. */
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {cpus,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source='test/fixtures/i80386-win16-io-boundary.S';
const core='src/experimental/i80386.js';
const self='scripts/compare-qemu-i80386-win16-io-boundary.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
const sourceHashes=Object.fromEntries([source,core,self]
  .map(path=>[path,sha(readFileSync(resolve(repo,path)))]));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const mutation=process.env.I386_WIN16_IO_MUTATION??null;
if(![null,'io-value'].includes(mutation))throw new Error('unknown mutation');
const qemu=process.env.QEMU_I386_PATH??'/usr/bin/qemu-system-i386';
const bios=process.env.QEMU_BIOS_PATH??'/usr/share/seabios/bios.bin';
const qemuVersion=execFileSync(qemu,['--version'],{encoding:'utf8'}).split('\n')[0];
const qemuHash=sha(readFileSync(qemu));
const biosHash=sha(readFileSync(bios));
if(qemuVersion!=='QEMU emulator version 8.2.2 (Debian 1:8.2.2+ds-0ubuntu1.18)'||
   qemuHash!=='28fa14f1c45fca7422e3ec5737768b33b705de2f31014a76e658d4263464a6a5'||
   biosHash!=='4d597f68e06a0e28498e12e96e1f2ce64aee88a519685c61da92eb775c95a445')
  throw new Error('unexpected QEMU or BIOS build');

const dir=mkdtempSync(join(tmpdir(),'bw-win16-io-oracle-'));
try{
  const object=join(dir,'guest.o'),elf=join(dir,'guest.elf');
  const image=join(dir,'guest.bin'),debug=join(dir,'debug.bin'),log=join(dir,'qemu.log');
  execFileSync('as',['--32','-o',object,resolve(repo,source)]);
  execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','-o',elf,object]);
  execFileSync('objcopy',['-O','binary',elf,image]);
  const binary=readFileSync(image);
  if(binary.length!==512||binary[510]!==0x55||binary[511]!==0xaa)
    throw new Error('fixture is not an exact boot sector');
  const symbols=Object.fromEntries(execFileSync('nm',['-n',elf],{encoding:'utf8'})
    .split('\n').map(line=>line.match(/^([0-9a-f]+) [A-Za-z] (\w+)$/))
    .filter(Boolean).map(([,address,name])=>[name,parseInt(address,16)]));
  const expectedSymbols={trace_start:0x7c2e,io_boundary:0x7c3c,after_io:0x7c3d,gdt:0x7c50};
  for(const [name,address] of Object.entries(expectedSymbols))
    if(symbols[name]!==address)throw new Error(`unexpected ${name} address`);

  const run=spawnSync(qemu,['-bios',bios,'-machine','pc,accel=tcg','-cpu','486',
    '-m','16M','-nic','none','-vga','none','-display','none','-monitor','none',
    '-serial','none','-device','isa-debug-exit,iobase=0xf4,iosize=0x04',
    '-drive',`file=${image},format=raw,if=floppy`,'-debugcon',`file:${debug}`,
    '-d','cpu','-D',log,'-no-reboot'],{timeout:5000,encoding:'utf8'});
  if(run.error)throw run.error;
  const referenceOutput=readFileSync(debug);
  const lines=readFileSync(log,'utf8').split('\n');
  const stateAt=address=>{
    const eipText=`EIP=${address.toString(16).padStart(8,'0')}`;
    const indexes=lines.flatMap((line,index)=>line.includes(eipText)?[index]:[]);
    if(indexes.length!==1)throw new Error(`expected one QEMU checkpoint at ${eipText}`);
    const index=indexes[0],regs=lines.slice(index-2,index+1).join(' ');
    const hex=(text,key)=>{
      const value=text.match(new RegExp(`\\b${key}=([0-9a-fA-F]{4,8})`));
      if(!value)throw new Error(`missing QEMU ${key}`);
      return parseInt(value[1],16);
    };
    const segment=key=>{
      const line=lines.slice(index+1,index+8).find(line=>line.startsWith(`${key} =`));
      if(!line)throw new Error(`missing QEMU ${key}`);
      return parseInt(line.match(/^\w+ =([0-9a-fA-F]{4})/)[1],16);
    };
    return {cs:segment('CS'),ds:segment('DS'),ss:segment('SS'),
      es:segment('ES'),fs:segment('FS'),gs:segment('GS'),
      eip:hex(regs,'EIP'),eflags:hex(regs,'EFL'),
      bx:hex(regs,'EBX')&0xffff,dx:hex(regs,'EDX')&0xffff,
      al:hex(regs,'EAX')&0xff};
  };
  const referenceBefore=stateAt(symbols.io_boundary);
  const referenceAfter=stateAt(symbols.after_io);
  let bochsReference=null;
  if(process.env.BOCHS_386_ROOT){
    const root=process.env.BOCHS_386_ROOT;
    const bochs=resolve(root,'bochs/bochs');
    const configHeader=readFileSync(resolve(root,'bochs/config.h'));
    const bochsRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    if(bochsRevision!=='0e45b736ef9792eb9b752b0a35db49eaf2faea47'||
       !configHeader.includes(Buffer.from('#define BX_CPU_LEVEL 3'))||
       sha(readFileSync(bochs))!=='2282de6986025228b177e648f3ca41957aad4bf276438fa2501afda0af802ff9')
      throw new Error('unexpected Bochs CPU-level-3 build');
    const bochsBios=resolve(repo,'roms/free-at-bios/BIOS-bochs-legacy');
    const bochsVgaBios=resolve(repo,'roms/free-at-bios/vgabios-lgpl.bin');
    const floppy=Buffer.alloc(1474560);binary.copy(floppy);
    const floppyPath=join(dir,'floppy.img');writeFileSync(floppyPath,floppy);
    const bochsLog=join(dir,'bochs.log'),bochsRc=join(dir,'bochsrc');
    writeFileSync(bochsRc,[
      'display_library: nogui','memory: guest=16, host=16',
      `romimage: file=${bochsBios}`,`vgaromimage: file=${bochsVgaBios}`,
      'cpu: count=1, ips=10000000',
      `floppya: 1_44=${floppyPath}, status=inserted`,
      'boot: floppy','port_e9_hack: enabled=1',`log: ${bochsLog}`,
      'panic: action=fatal','error: action=report','info: action=report',
      'debug: action=ignore','mouse: enabled=0',
    ].join('\n')+'\n');
    const marker=Buffer.from([0xa5,0x4b]);
    const bochsRun=await new Promise((resolveRun,reject)=>{
      const child=spawn('stdbuf',['-o0','-e0',bochs,'-q','-f',bochsRc],
        {stdio:['ignore','pipe','pipe']});
      let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),sawMarker=false;
      const timer=setTimeout(()=>child.kill('SIGTERM'),5000);
      child.stdout.on('data',chunk=>{
        stdout=Buffer.concat([stdout,chunk]);
        if(!sawMarker&&stdout.indexOf(marker)>=0){sawMarker=true;child.kill('SIGTERM');}
      });
      child.stderr.on('data',chunk=>{stderr=Buffer.concat([stderr,chunk]);});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',(code,signal)=>{
        clearTimeout(timer);resolveRun({stdout,stderr,code,signal,sawMarker});
      });
    });
    const bochsLogText=readFileSync(bochsLog,'utf8');
    bochsReference={name:'Bochs REL_2_7_FINAL CPU level 3 output witness',
      bochsRevision,bochsSha256:sha(readFileSync(bochs)),
      configHeaderSha256:sha(configHeader),
      biosSha256:sha(readFileSync(bochsBios)),
      vgaBiosSha256:sha(readFileSync(bochsVgaBios)),
      floppySha256:sha(floppy),
      outputHex:bochsRun.sawMarker?'a54b':null,
      booted:bochsLogText.includes('Booting from 0000:7c00'),
      panic:bochsLogText.includes('>>PANIC<<'),
      stop:'process terminated immediately after owned A5K marker; later guest behavior is outside this oracle'};
  }
  const memory=new Uint8Array(0x10000);memory.set(binary,0x7c00);
  let reads=0;
  const cpu=new I80386({read:a=>memory[a]??0,fetch:a=>memory[a]??0,
    write:(a,v)=>memory[a]=v&255,
    inPort:(port,width)=>{
      if(port!==0x21||width!==8)throw new Error('unexpected device read');
      reads++;
      return mutation==='io-value'?0xa4:0xa5;
    },outPort:()=>{throw new Error('trace advanced beyond post-I/O checkpoint');}});
  cpu.cr0=0x11;cpu.gdtr={base:symbols.gdt,limit:23};
  cpu.cs=8;cpu.ds=cpu.ss=0x10;cpu.eip=symbols.trace_start;
  cpu.esp=0x7000;cpu.eax=0xa5;cpu.edx=0x21;cpu.eflags=6;
  cpu.segmentCaches[1]=cpu._descriptor(8);
  cpu.segmentCaches[2]=cpu._descriptor(0x10);
  cpu.segmentCaches[3]=cpu._descriptor(0x10);
  const local=()=>({cs:cpu.cs,ds:cpu.ds,ss:cpu.ss,
    es:cpu.es,fs:cpu.fs,gs:cpu.gs,eip:cpu.eip,
    eflags:cpu.eflags,bx:cpu.ebx&0xffff,dx:cpu.edx&0xffff,
    al:cpu.eax&0xff});
  const trail=[];
  for(let step=0;step<3;step++){trail.push(cpu.eip);cpu.step();}
  const before=local(),readsBefore=reads;
  cpu.step();
  const after=local(),readsAfter=reads;
  const expectedBefore={cs:8,ds:0x10,ss:0x10,es:0,fs:0,gs:0,eip:0x7c3c,
    eflags:0x46,bx:1,dx:0x21,al:0xa5};
  const expectedAfter={...expectedBefore,eip:0x7c3d};
  const differences=[];
  const check=(field,actual,expected)=>{
    if(JSON.stringify(actual)!==JSON.stringify(expected))
      differences.push({field,expected,actual});
  };
  check('reference.before',referenceBefore,expectedBefore);
  check('local.before',before,expectedBefore);
  check('reference.after',referenceAfter,expectedAfter);
  check('local.after',after,expectedAfter);
  check('local.trace',trail,[0x7c2e,0x7c31,0x7c34]);
  check('local.readCounts',[readsBefore,readsAfter],[0,1]);
  check('reference.output',[...referenceOutput],[0xa5,0x4b]);
  check('reference.exitStatus',run.status,3);
  if(bochsReference){
    check('bochs.output',bochsReference.outputHex,'a54b');
    check('bochs.booted',bochsReference.booted,true);
    check('bochs.panic',bochsReference.panic,false);
  }
  const report={schema:'bw.i80386-win16-io-boundary-oracle.v1',revision,
    sourceHashes,imageSha256:sha(binary),
    reference:{name:'QEMU TCG 8.2.2, 486 CPU',qemuVersion,qemuSha256:qemuHash,
      biosSha256:biosHash,exitStatus:run.status,outputHex:referenceOutput.toString('hex'),
      before:referenceBefore,after:referenceAfter},
    ...(bochsReference?{bochs:bochsReference}:{}),
    local:{core:'ExperimentalI80386 protected16',trail,before,after,
      readsBefore,readsAfter},
    contract:{entry:'CS=0008, DS=SS=0010, ES=FS=GS=0000, EIP=7c2e; PIC1 IMR preloaded A5',
      stopEvent:'io-read-required at CS:7c3c before IN DX; no device read yet',
      resume:'ordinary IN reads port 0021 exactly once and reaches CS:7c3d with AL=A5',
      referenceReadCountLimit:'QEMU CPU log proves the pre/post instruction boundary and output A5K; it does not instrument device read count. The owned code contains exactly one IN between checkpoints.'},
    host:{cpuModel:cpus()[0]?.model,node:process.version},
    mutation,status:differences.length?'fail':'pass',differences};
  console.log(JSON.stringify(report,null,2));
  if(differences.length)process.exitCode=1;
}finally{rmSync(dir,{recursive:true,force:true});}
