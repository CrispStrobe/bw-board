/** Source-bound, scoped JavaScript/native comparison for the owned paging fixture. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixturePath='test/fixtures/i80386-bochs-cpu3-paging-v2.S';
const receiptPath='docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-v2.json';
const thisPath='scripts/compare-bochs-cpu3-owned-paging-v2.mjs';
const registers=['eax','ecx','edx','ebx','esp','ebp','esi','edi'];
const segments=['es','cs','ss','ds','fs','gs'];
const ramAddresses={pde0:0x9000,pte5:0xa014,data5:0x5000};
const definedCr0Mask=0x8000001f;
// Original 80386 EFLAGS: status/control bits, fixed bit 1, IOPL, NT, RF, VM.
// Reserved bits and later 486 AC are outside this comparison.
const definedEflagsMask=0x00037fd7;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=bytes=>Buffer.from(bytes).toString('hex');

function requireCommittedSources(paths){
  for(const path of paths){
    execFileSync('git',['ls-files','--error-unmatch','--',path],{cwd:repo,stdio:'ignore'});
    const committed=execFileSync('git',['show',`HEAD:${path}`],{cwd:repo});
    if(sha256(committed)!==sha256(readFileSync(resolve(repo,path))))
      throw new Error(`source differs from committed HEAD: ${path}`);
  }
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
      [name,{physicalAddress:address,bytes:hex(memory.subarray(address,address+4))}])),
  };
}

export function compareOwnedPagingState(native,js){
  const mismatches=[];
  const check=(field,reference,actual)=>{
    if(reference!==actual)mismatches.push({field,reference,actual});
  };
  for(const name of registers)check(name,native.state[name],js[name]);
  for(const name of ['eip','cr2','cr3'])check(name,native.state[name],js[name]);
  check('eflags.defined386',(native.state.eflags&definedEflagsMask)>>>0,
    (js.eflags&definedEflagsMask)>>>0);
  check('cr0.defined386',(native.state.cr0&definedCr0Mask)>>>0,
    (js.cr0&definedCr0Mask)>>>0);
  for(const prefix of ['gdtr','idtr'])for(const field of ['base','limit'])
    check(`${prefix}.${field}`,
      native.tables[`${prefix}${field[0].toUpperCase()}${field.slice(1)}`],js[prefix][field]);
  for(const kind of ['tr','ldtr']){
    const source=native.segments[kind],target=js[kind];
    check(`${kind}.selector`,source.selector,target.selector);
    // A null system selector has no loaded architectural hidden cache. The
    // Bochs raw cache remains in the receipt but is not asserted as state.
    if(source.selector!==0 && target.selector!==0){
      check(`${kind}.base`,source.base,target.base);
      check(`${kind}.limit`,source.limitScaled,target.limit);
      check(`${kind}.present`,source.present!==0,target.present);
      if(kind==='tr')check('tr.type',source.type,target.type);
    }
  }
  for(const name of segments){
    const source=native.segments[name],cache=js.segmentCaches[name];
    check(`${name}.selector`,source.selector,js[name]);
    check(`${name}.base`,source.base,cache.base);
    check(`${name}.limit`,source.limitScaled,cache.limit);
    check(`${name}.present`,source.present!==0,cache.present);
    check(`${name}.default32`,source.default32!==0,cache.default32);
    check(`${name}.code`,!!(source.type&8),cache.code);
  }
  for(const [name,address] of Object.entries(ramAddresses)){
    check(`ram.${name}.physicalAddress`,address,native.ramSnapshots[name].physicalAddress);
    check(`ram.${name}.jsPhysicalAddress`,address,js.ramSnapshots[name].physicalAddress);
    check(`ram.${name}.bytes`,native.ramSnapshots[name].bytes,js.ramSnapshots[name].bytes);
  }
  return {
    scope:'owned 4 KiB paging fixture after final E9 OUT: selected integer/system fields and three physical RAM words',
    status:mismatches.length?'scoped-field-mismatch':'scoped-fields-match',
    mismatches,
    compared:{registers,eflagsDefined386Mask:definedEflagsMask>>>0,
      cr0Defined386Mask:definedCr0Mask>>>0,ramAddresses},
    raw:{eflags:{native:native.state.eflags,js:js.eflags},
      cr0:{native:native.state.cr0,js:js.cr0},
      debug:{native:native.debug,js:js.debugRegisters},
      nullSystemCaches:{nativeTr:native.segments.tr,nativeLdtr:native.segments.ldtr,
        jsTr:js.tr,jsLdtr:js.ldtr}},
    excluded:['undefined/reserved CR0 and EFLAGS bits','undefined debug-register reset values',
      'unloaded TR/LDTR hidden caches','Bochs internal segment-valid encodings',
      'Bochs callback event order versus JavaScript bus order',
      'all RAM outside the three selected plain-owned words','FPU/device state',
      'instruction counts, timing, and full physical bus cycles'],
  };
}

async function main(){
  const nativeReceipt=JSON.parse(readFileSync(resolve(repo,receiptPath),'utf8'));
  const paths=[...new Set([...Object.keys(nativeReceipt.sourceHashes),
    fixturePath,receiptPath,'src/experimental/i80386.js',thisPath])];
  requireCommittedSources(paths);
  const sourceHashes=Object.fromEntries(paths.map(path=>[path,sha256(readFileSync(resolve(repo,path)))]));
  if(nativeReceipt.schema!=='bw.bochs-cpu3-owned-memory-capture.v2' ||
      nativeReceipt.status!=='native-capture-complete' || nativeReceipt.comparison!=='not-run' ||
      nativeReceipt.bochsRevision!=='0e45b736ef9792eb9b752b0a35db49eaf2faea47' ||
      nativeReceipt.cpuLevel!==3 || nativeReceipt.marker!=='BHPG004' ||
      Object.entries(nativeReceipt.sourceHashes).some(([path,hash])=>sourceHashes[path]!==hash))
    throw new Error('native receipt does not bind the committed owned paging fixture and CPU3 source');
  const build=mkdtempSync(join(tmpdir(),'bw-bochs-cpu3-js-paging-'));
  try{
    const object=join(build,'guest.o'),image=join(build,'guest.bin');
    execFileSync('as',['--32','-o',object,resolve(repo,fixturePath)]);
    execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','--oformat','binary','-o',image,object]);
    const binary=readFileSync(image);
    if(sha256(binary)!==nativeReceipt.imageSha256)
      throw new Error('assembled paging fixture differs from native image');
    const memory=new Uint8Array(0x100000);
    memory.set(binary,0x7c00);
    let marker='';
    const cpu=new I80386({read:address=>memory[address],fetch:address=>memory[address],
      write:(address,value)=>{memory[address]=value&255;},inPort:()=>0,
      outPort:(port,value)=>{if(port===0xe9)marker+=String.fromCharCode(value&255);}},
    {cpuProfile:'strict386'});
    cpu.hardwareReset({coprocessor:'80387'});
    cpu.cs=0;cpu.eip=0x7e00;
    cpu.segmentCaches[1]={base:0,limit:0xffff,default32:false,present:true,
      code:true,readable:true,writable:false};
    let steps=0;
    while(steps<2000 && marker.length<7){cpu.step();steps++;}
    if(marker!=='BHPG004')throw new Error(`JS owned paging marker differs: ${marker}`);
    const comparison=compareOwnedPagingState(nativeReceipt.checkpoint,snapshotJs(cpu,memory));
    requireCommittedSources(paths);
    if(paths.some(path=>sha256(readFileSync(resolve(repo,path)))!==sourceHashes[path]))
      throw new Error('comparison sources changed during run');
    console.log(JSON.stringify({schema:'bw.bochs-cpu3-owned-paging-compare.v1',
      boardRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
      sourceHashes,nativeReceipt:receiptPath,nativeBochsRevision:nativeReceipt.bochsRevision,
      nativeBinarySha256:nativeReceipt.bochsExecutableSha256,imageSha256:sha256(binary),
      jsSetup:'strict386, explicit 80387 reset, direct owned post-load entry at 0000:7e00',
      jsSteps:steps,marker,comparison},null,2));
    if(comparison.mismatches.length)process.exitCode=1;
  }finally{rmSync(build,{recursive:true,force:true});}
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])await main();
