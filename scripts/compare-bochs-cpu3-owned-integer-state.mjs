/** Source-bound, scoped JS/native comparison at the owned final E9 boundary. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixturePath='test/fixtures/i80386-vm-task.S';
const receiptPath='docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-native-checkpoint.json';
const paths=[fixturePath,receiptPath,'src/experimental/i80386.js',
  'scripts/compare-bochs-cpu3-owned-integer-state.mjs'];
const registerNames=['eax','ecx','edx','ebx','esp','ebp','esi','edi'];
const segmentNames=['es','cs','ss','ds','fs','gs'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireCommittedSources=()=>{
  for(const path of paths){
    execFileSync('git',['ls-files','--error-unmatch','--',path],{cwd:repo,stdio:'ignore'});
    const committed=execFileSync('git',['show',`HEAD:${path}`],{cwd:repo});
    if(sha256(committed)!==sha256(readFileSync(resolve(repo,path))))
      throw new Error(`source differs from committed HEAD: ${path}`);
  }
};

export function compareOwnedIntegerState(native,js){
  const mismatches=[];
  const check=(field,reference,actual)=>{
    if(reference!==actual)mismatches.push({field,reference,actual});
  };
  for(const name of registerNames) check(name,native.state[name],js[name]);
  for(const name of ['eip','eflags','cr2','cr3'])check(name,native.state[name],js[name]);
  const definedCr0Mask=0x8000001f;
  check('cr0.defined386',native.state.cr0&definedCr0Mask,js.cr0&definedCr0Mask);
  for(const [prefix,fields] of [['gdtr',['base','limit']],['idtr',['base','limit']]])
    for(const field of fields)
      check(`${prefix}.${field}`,native.tables[`${prefix}${field[0].toUpperCase()}${field.slice(1)}`],js[prefix][field]);
  for(const field of ['selector','base'])check(`tr.${field}`,native.segments.tr[field],js.tr[field]);
  check('tr.limit',native.segments.tr.limitScaled,js.tr.limit);
  check('tr.type',native.segments.tr.type,js.tr.type);
  check('ldtr.selector',native.segments.ldtr.selector,js.ldtr.selector);
  check('ldtr.valid',native.segments.ldtr.valid!==0,js.ldtr.present);
  for(const name of segmentNames){
    const segment=native.segments[name],cache=js.segmentCaches[name];
    check(`${name}.selector`,segment.selector,js[name]);
    check(`${name}.base`,segment.base,cache.base);
    check(`${name}.limit`,segment.limitScaled,cache.limit);
    check(`${name}.present`,segment.present!==0,cache.present);
    check(`${name}.default32`,segment.default32!==0,cache.default32);
  }
  return {
    scope:'owned VM86 fixture integer/system fields at final E9 OUT',
    status:mismatches.length?'scoped-field-mismatch':'scoped-fields-match',
    mismatches,
    cr0:{defined386Mask:definedCr0Mask>>>0,nativeRaw:native.state.cr0,
      jsRaw:js.cr0,rawEqual:native.state.cr0===js.cr0,
      nativeReservedHigh:native.state.cr0&0x7fffffe0,
      jsReservedHigh:js.cr0&0x7fffffe0,
      etNative:(native.state.cr0>>>4)&1,etJs:(js.cr0>>>4)&1},
    debug:{native:native.debug,js:js.debugRegisters,
      comparison:'raw values reported only: 80386 reset leaves debug-register contents unspecified'},
    internalVm86Cache:{nativeCsType:native.segments.cs.type,jsCsCode:js.segmentCaches.cs.code,
      comparison:'different internal encodings; selector/base/limit/presence/default32 compared above'},
    excluded:['TSS RAM and page hashes','FPU/device state','instruction counts and timing',
      'Bochs hook stream versus board byte bus order','undefined reset debug-register values',
      'Bochs-specific CR0 reserved-high-bit readback'],
  };
}

async function main(){
  requireCommittedSources();
  const sourceHashes=Object.fromEntries(paths.map(path=>[path,sha256(readFileSync(resolve(repo,path)))]));
  const nativeReceipt=JSON.parse(readFileSync(resolve(repo,receiptPath),'utf8'));
  if(nativeReceipt.status!=='native-capture-complete' || nativeReceipt.comparison!=='not-run' ||
      nativeReceipt.bochsRevision!=='0e45b736ef9792eb9b752b0a35db49eaf2faea47' ||
      nativeReceipt.sourceHashes[fixturePath]!==sourceHashes[fixturePath])
    throw new Error('native receipt does not bind the owned fixture and pinned CPU3 source');
  const build=mkdtempSync(join(tmpdir(),'bw-bochs-cpu3-js-state-'));
  try {
    const object=join(build,'guest.o'),image=join(build,'guest.bin');
    execFileSync('as',['--32','-o',object,resolve(repo,fixturePath)]);
    execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','--oformat','binary','-o',image,object]);
    const binary=readFileSync(image);
    if(sha256(binary)!==nativeReceipt.imageSha256)
      throw new Error('assembled fixture differs from native image');
    const memory=new Uint8Array(0x10000);
    memory.set(binary,0x7c00);
    let marker='';
    const cpu=new I80386({read:address=>memory[address],fetch:address=>memory[address],
      write:(address,value)=>{memory[address]=value;},
      inPort:()=>0,
      outPort:(port,value)=>{if(port===0xe9)marker+=String.fromCharCode(value&255);}},
    {cpuProfile:'strict386'});
    // The native Bochs build has ET=1. Select an explicit 80387 reset
    // configuration, then begin at the owned post-disk-load setup entry.
    cpu.hardwareReset({coprocessor:'80387'});
    cpu.cs=0;cpu.eip=0x7e00;
    cpu.segmentCaches[1]={base:0,limit:0xffff,default32:false,present:true,
      code:true,readable:true,writable:false};
    let steps=0;
    while(steps<250 && marker.length<7){cpu.step();steps++;}
    if(marker!=='BHVK003') throw new Error(`JS owned marker differs: ${marker}`);
    const js={...Object.fromEntries(registerNames.map(name=>[name,cpu[name]])),
      eip:cpu.eip,eflags:cpu.eflags,cr0:cpu.cr0,cr2:cpu.cr2,cr3:cpu.cr3,
      gdtr:cpu.gdtr,idtr:cpu.idtr,ldtr:cpu.ldtr,tr:cpu.tr,
      segmentCaches:Object.fromEntries(segmentNames.map((name,index)=>[name,cpu.segmentCaches[index]])),
      es:cpu.es,cs:cpu.cs,ss:cpu.ss,ds:cpu.ds,fs:cpu.fs,gs:cpu.gs,
      debugRegisters:Object.fromEntries([0,1,2,3,6,7].map(n=>[`dr${n}`,cpu._debugRegisters[n]]))};
    const comparison=compareOwnedIntegerState(nativeReceipt.checkpoint,js);
    requireCommittedSources();
    if(paths.some(path=>sha256(readFileSync(resolve(repo,path)))!==sourceHashes[path]))
      throw new Error('comparison sources changed during run');
    console.log(JSON.stringify({schema:'bw.bochs-cpu3-owned-integer-compare.v1',
      boardRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
      sourceHashes,nativeReceipt:receiptPath,nativeBochsRevision:nativeReceipt.bochsRevision,
      nativeBinarySha256:nativeReceipt.bochsExecutableSha256,
      imageSha256:sha256(binary),jsSetup:'explicit 80387 reset; direct post-load entry at 0000:7e00',
      jsSteps:steps,marker,comparison},null,2));
    if(comparison.mismatches.length)process.exitCode=1;
  } finally {rmSync(build,{recursive:true,force:true});}
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])await main();
