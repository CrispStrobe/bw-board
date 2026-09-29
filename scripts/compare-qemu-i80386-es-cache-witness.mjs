/** Owned protected16 ES-cache witness. QEMU 486 checks output, not bus order. */
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source='test/fixtures/i80386-es-cache-witness.S';
const self='scripts/compare-qemu-i80386-es-cache-witness.mjs';
const core='src/experimental/i80386.js';
const sha=data=>createHash('sha256').update(data).digest('hex');
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const sourceHashes=Object.fromEntries([source,self,core].map(path=>
  [path,sha(readFileSync(resolve(repo,path)))]));
const mutation=process.env.I386_ES_CACHE_MUTATION??null;
if(![null,'stale-after-reload'].includes(mutation))throw new Error('unknown mutation');
const qemu=process.env.QEMU_I386_PATH??'/usr/bin/qemu-system-i386';
const bios=process.env.QEMU_BIOS_PATH??'/usr/share/seabios/bios.bin';
const qemuVersion=execFileSync(qemu,['--version'],{encoding:'utf8'}).split('\n')[0];
const qemuSha256=sha(readFileSync(qemu));
const biosSha256=sha(readFileSync(bios));
if(qemuVersion!=='QEMU emulator version 8.2.2 (Debian 1:8.2.2+ds-0ubuntu1.18)'||
   qemuSha256!=='28fa14f1c45fca7422e3ec5737768b33b705de2f31014a76e658d4263464a6a5'||
   biosSha256!=='4d597f68e06a0e28498e12e96e1f2ce64aee88a519685c61da92eb775c95a445')
  throw new Error('unexpected QEMU or BIOS build');

const dir=mkdtempSync(join(tmpdir(),'bw-es-cache-oracle-'));
try{
  const object=join(dir,'guest.o'),elf=join(dir,'guest.elf');
  const image=join(dir,'guest.bin'),debug=join(dir,'debug.bin');
  execFileSync('as',['--32','-o',object,resolve(repo,source)]);
  execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','-o',elf,object]);
  execFileSync('objcopy',['-O','binary',elf,image]);
  const binary=readFileSync(image);
  if(binary.length!==512||binary[510]!==0x55||binary[511]!==0xaa)
    throw new Error('fixture is not an exact boot sector');
  const symbols=Object.fromEntries(execFileSync('nm',['-n',elf],{encoding:'utf8'})
    .split('\n').map(line=>line.match(/^([0-9a-f]+) [A-Za-z] (\w+)$/))
    .filter(Boolean).map(([,address,name])=>[name,parseInt(address,16)]));
  const expectedSymbols={witness_start:0x7c32,after_second_load:0x7c4c,
    gdt:0x7c60,selector_slot:0x7c86};
  for(const [name,address] of Object.entries(expectedSymbols))
    if(symbols[name]!==address)throw new Error(`unexpected ${name} address`);

  const run=spawnSync(qemu,['-bios',bios,'-machine','pc,accel=tcg','-cpu','486',
    '-m','16M','-nic','none','-vga','none','-display','none','-monitor','none',
    '-serial','none','-device','isa-debug-exit,iobase=0xf4,iosize=0x04',
    '-drive',`file=${image},format=raw,if=floppy`,'-debugcon',`file:${debug}`,
    '-no-reboot'],{timeout:30000,encoding:'utf8'});
  if(run.error)throw run.error;
  const referenceOutput=readFileSync(debug);

  const memory=new Uint8Array(0x10000);
  memory.set(binary,0x7c00);
  memory[0x9000]=0xa1;
  memory[0xa000]=0xb2;
  const localOutput=[];
  let exitValue=null;
  const cpu=new I80386({
    read:a=>memory[a]??0,fetch:a=>memory[a]??0,
    write:(a,v)=>{memory[a]=v&255;},
    outPort:(port,value,width)=>{
      if(width!==8)throw new Error('unexpected output width');
      if(port===0xe9)localOutput.push(value&255);
      else if(port===0xf4)exitValue=value&255;
      else throw new Error(`unexpected output port ${port}`);
    },
  });
  cpu.cr0=1;
  cpu.gdtr={base:symbols.gdt,limit:31};
  cpu.cs=8;cpu.ds=cpu.ss=0x10;
  cpu.eip=symbols.witness_start;
  cpu.esp=0x7000;
  cpu.eflags=2;
  cpu.segmentCaches[1]=cpu._descriptor(8);
  cpu.segmentCaches[2]=cpu._descriptor(0x10);
  cpu.segmentCaches[3]=cpu._descriptor(0x10);
  const trail=[];
  for(let step=0;step<20&&exitValue===null;step++){
    trail.push(cpu.eip);
    if(mutation==='stale-after-reload'&&cpu.eip===symbols.after_second_load)
      cpu.segmentCaches[0]={...cpu.segmentCaches[0],base:0x9000};
    cpu.step();
  }
  const expected=[0x93,0xa1,0xb2,0x4b];
  const differences=[];
  const check=(field,actual,want)=>{
    if(JSON.stringify(actual)!==JSON.stringify(want))
      differences.push({field,expected:want,actual});
  };
  check('reference.output',[...referenceOutput],expected);
  check('reference.exitStatus',run.status,3);
  check('local.output',localOutput,expected);
  check('local.exitValue',exitValue,1);
  check('local.accessedByte',memory[symbols.gdt+29],0x93);
  check('local.modifiedBaseByte',memory[symbols.gdt+27],0xa0);
  const report={schema:'bw.i80386-es-cache-witness.v1',revision,
    sourceHashes,imageSha256:sha(binary),
    reference:{name:'QEMU TCG 8.2.2, 486 CPU output witness',qemuVersion,
      qemuSha256,biosSha256,exitStatus:run.status,
      outputHex:referenceOutput.toString('hex')},
    local:{core:'ExperimentalI80386 protected16',outputHex:Buffer.from(localOutput).toString('hex'),
      exitValue,accessedByte:memory[symbols.gdt+29],
      modifiedBaseByte:memory[symbols.gdt+27],trail},
    contract:{output:'93 = Accessed, a1 = retained ES base after GDT edit, b2 = new base after ES reload, 4b = completion',
      scope:'QEMU 486 observes output behavior; neither external bus ordering nor exact 80386 timing is claimed'},
    mutation,status:differences.length?'fail':'pass',differences};
  console.log(JSON.stringify(report,null,2));
  if(differences.length)process.exitCode=1;
}finally{rmSync(dir,{recursive:true,force:true});}
