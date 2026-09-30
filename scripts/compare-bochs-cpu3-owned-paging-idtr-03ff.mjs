/** Source-bound scoped JS/native comparison for the owned LIDT-aligned paging fixture. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import I80386 from '../src/experimental/i80386.js';
import {compareOwnedPagingState} from './compare-bochs-cpu3-owned-paging-v2.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixturePath='test/fixtures/i80386-bochs-cpu3-paging-idtr-03ff.S';
const receiptPath='docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-idtr-03ff.json';
const comparatorPath='scripts/compare-bochs-cpu3-owned-paging-idtr-03ff.mjs';
const importedComparatorPath='scripts/compare-bochs-cpu3-owned-paging-v2.mjs';
const registers=['eax','ecx','edx','ebx','esp','ebp','esi','edi'];
const segments=['es','cs','ss','ds','fs','gs'];
const ramAddresses={pde0:0x9000,pte5:0xa014,data5:0x5000};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

function requireCommittedSources(paths){
  for(const path of paths){
    execFileSync('git',['ls-files','--error-unmatch','--',path],{cwd:repo,stdio:'ignore'});
    const committed=execFileSync('git',['show',`HEAD:${path}`],{cwd:repo});
    if(sha256(committed)!==sha256(readFileSync(resolve(repo,path))))
      throw new Error(`source differs from committed HEAD: ${path}`);
  }
}

function setupAddress(object){
  const symbols=execFileSync('nm',['--defined-only',object],{encoding:'utf8'});
  const start=symbols.match(/^([0-9a-f]+) [tT] _start$/m);
  const setup=symbols.match(/^([0-9a-f]+) [tT] setup$/m);
  if(!start || !setup || Number.parseInt(start[1],16)!==0)
    throw new Error('owned fixture is missing expected _start/setup symbols');
  const address=0x7c00+Number.parseInt(setup[1],16);
  if(address>0xffff)throw new Error('owned setup is outside the direct-entry real-mode segment');
  return address;
}

function snapshotJs(cpu,memory){
  return {
    ...Object.fromEntries(registers.map(name=>[name,cpu[name]>>>0])),
    eip:cpu.eip>>>0,eflags:cpu.eflags>>>0,cr0:cpu.cr0>>>0,
    cr2:cpu.cr2>>>0,cr3:cpu.cr3>>>0,gdtr:cpu.gdtr,idtr:cpu.idtr,
    tr:cpu.tr,ldtr:cpu.ldtr,
    ...Object.fromEntries(segments.map(name=>[name,cpu[name]])),
    segmentCaches:Object.fromEntries(segments.map((name,index)=>[name,cpu.segmentCaches[index]])),
    debugRegisters:Object.fromEntries([0,1,2,3,6,7].map(n=>[`dr${n}`,cpu._debugRegisters[n]])),
    ramSnapshots:Object.fromEntries(Object.entries(ramAddresses).map(([name,address])=>
      [name,{physicalAddress:address,bytes:Buffer.from(memory.subarray(address,address+4)).toString('hex')}])),
  };
}

async function main(){
  const nativeReceipt=JSON.parse(readFileSync(resolve(repo,receiptPath),'utf8'));
  const paths=[...new Set([...Object.keys(nativeReceipt.sourceHashes),fixturePath,receiptPath,
    'src/experimental/i80386.js',importedComparatorPath,comparatorPath])];
  requireCommittedSources(paths);
  const sourceHashes=Object.fromEntries(paths.map(path=>[path,sha256(readFileSync(resolve(repo,path)))]));
  if(nativeReceipt.schema!=='bw.bochs-cpu3-owned-memory-idtr-aligned-capture.v1' ||
      nativeReceipt.status!=='native-capture-complete' || nativeReceipt.comparison!=='not-run' ||
      nativeReceipt.fixtureVariant!=='paging-4k-idtr-0-03ff' ||
      nativeReceipt.fixtureSourcePath!==fixturePath ||
      nativeReceipt.fixtureSourceSha256!==sourceHashes[fixturePath] ||
      nativeReceipt.bochsRevision!=='0e45b736ef9792eb9b752b0a35db49eaf2faea47' ||
      nativeReceipt.cpuLevel!==3 || nativeReceipt.cpu3NoCr4Pse!==true ||
      nativeReceipt.marker!=='BHPG004' || nativeReceipt.retainedMarker!=='BHPG004' ||
      nativeReceipt.retainedHookSchema!=='bw.bochs-cpu3-owned-memory-checkpoint.v2' ||
      nativeReceipt.checkpoint?.schema!=='bw.bochs-cpu3-owned-memory-checkpoint.v2' ||
      nativeReceipt.checkpoint.tables.idtrBase!==0 ||
      nativeReceipt.checkpoint.tables.idtrLimit!==0x03ff ||
      Object.entries(nativeReceipt.sourceHashes).some(([path,hash])=>sourceHashes[path]!==hash))
    throw new Error('native receipt does not bind the committed IDTR-aligned CPU3 fixture');
  const build=mkdtempSync(join(tmpdir(),'bw-bochs-cpu3-js-paging-idtr-'));
  try{
    const object=join(build,'guest.o'),image=join(build,'guest.bin');
    execFileSync('as',['--32','-o',object,resolve(repo,fixturePath)]);
    const entry=setupAddress(object);
    execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','--oformat','binary','-o',image,object]);
    const binary=readFileSync(image);
    if(sha256(binary)!==nativeReceipt.imageSha256)
      throw new Error('assembled aligned fixture differs from native image');
    if(entry<0x7c00 || entry>=0x7c00+binary.length)
      throw new Error('owned setup symbol is outside the assembled image');
    const memory=new Uint8Array(0x100000);
    memory.set(binary,0x7c00);
    let marker='';
    const cpu=new I80386({read:address=>memory[address],fetch:address=>memory[address],
      write:(address,value)=>{memory[address]=value&255;},inPort:()=>0,
      outPort:(port,value)=>{if(port===0xe9)marker+=String.fromCharCode(value&255);}},
    {cpuProfile:'strict386'});
    cpu.hardwareReset({coprocessor:'80387'});
    cpu.cs=0;cpu.eip=entry;
    cpu.segmentCaches[1]={base:0,limit:0xffff,default32:false,present:true,
      code:true,readable:true,writable:false};
    let steps=0;
    while(steps<2000 && marker.length<7){cpu.step();steps++;}
    if(marker!=='BHPG004')throw new Error(`JS owned paging marker differs: ${marker}`);
    const comparison=compareOwnedPagingState(nativeReceipt.checkpoint,snapshotJs(cpu,memory));
    requireCommittedSources(paths);
    if(paths.some(path=>sha256(readFileSync(resolve(repo,path)))!==sourceHashes[path]))
      throw new Error('comparison sources changed during run');
    console.log(JSON.stringify({schema:'bw.bochs-cpu3-owned-paging-idtr-aligned-compare.v1',
      boardRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
      sourceHashes,nativeReceipt:receiptPath,nativeBochsRevision:nativeReceipt.bochsRevision,
      nativeBinarySha256:nativeReceipt.bochsExecutableSha256,imageSha256:sha256(binary),
      jsSetup:'strict386; explicit 80387 reset; direct owned post-load setup symbol at CS 0000',
      jsEntry:entry,jsSteps:steps,marker,comparison},null,2));
    if(comparison.mismatches.length)process.exitCode=1;
  }finally{rmSync(build,{recursive:true,force:true});}
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])await main();
