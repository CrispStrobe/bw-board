/** Source-bound scoped JS/native comparison for one guest-recovered #PF. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import I80386 from '../src/experimental/i80386.js';
import {compareOwnedPagingState} from './compare-bochs-cpu3-owned-paging-v2.mjs';
import {assertRecoverablePageFault} from './bochs-cpu3-owned-oracle-v2-pagefault-retry/contract.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixturePath='test/fixtures/i80386-bochs-cpu3-pagefault-retry.S';
const receiptPath='docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-pagefault-retry.json';
const comparatorPath='scripts/compare-bochs-cpu3-owned-pagefault-retry.mjs';
const importedComparatorPath='scripts/compare-bochs-cpu3-owned-paging-v2.mjs';
const nativeContractPath='scripts/bochs-cpu3-owned-oracle-v2-pagefault-retry/contract.mjs';
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

function fixtureSymbols(object){
  const symbols=execFileSync('nm',['--defined-only',object],{encoding:'utf8'});
  const start=symbols.match(/^([0-9a-f]+) [tT] _start$/m);
  if(!start || Number.parseInt(start[1],16)!==0)
    throw new Error('owned fixture is missing _start at zero');
  return Object.fromEntries(['setup','faulting_store','pf_handler','cr3_reload','iret_retry'].map(name=>{
    const symbol=symbols.match(new RegExp(`^([0-9a-f]+) [tT] ${name}$`,'m'));
    if(!symbol)throw new Error(`owned fixture is missing ${name}`);
    const address=0x7c00+Number.parseInt(symbol[1],16);
    if(address<0x7c00 || address>0xffff)
      throw new Error(`owned ${name} is outside the direct-entry segment`);
    return [name,address];
  }));
}

const dword=(memory,address)=>
  (memory[address]|(memory[address+1]<<8)|(memory[address+2]<<16)|
    (memory[address+3]*0x1000000))>>>0;
const hex4=(memory,address)=>Buffer.from(memory.subarray(address,address+4)).toString('hex');

/** Compare bounded fault/retry facts; native callback ordinals remain native-only. */
export function compareOwnedPageFault(nativeProof,js,symbols){
  const mismatches=[];
  const check=(field,reference,actual)=>{
    if(reference!==actual)mismatches.push({field,reference,actual});
  };
  check('fault.vector',nativeProof.vector,js.vector);
  check('fault.errorCode',nativeProof.errorCode,js.frame.errorCode);
  check('fault.cr2',nativeProof.cr2,js.cr2);
  check('fault.faultingCs',8,js.faultingCs);
  check('fault.attemptedStoreEip',symbols.faulting_store,js.attemptedStoreEip);
  check('fault.handlerEip',symbols.pf_handler,js.handlerEip);
  check('fault.zeroReturnCount',1,js.zeroReturnCount);
  check('fault.storeAttemptCount',2,js.storeAttemptCount);
  check('fault.handlerEntryCount',1,js.handlerEntryCount);
  check('fault.cr3ReloadCount',1,js.cr3ReloadCount);
  check('fault.iretRetryCount',1,js.iretRetryCount);
  check('fault.savedEip',nativeProof.frame.eip.value,js.frame.eip);
  check('fault.savedCsSelector',nativeProof.frame.cs.value&0xffff,js.frame.cs&0xffff);
  check('fault.savedEflagsDefined386',
    nativeProof.frame.eflags.value&0x00037fd7,js.frame.eflags&0x00037fd7);
  check('fault.savedEflagsExpected386',0x00010046,js.frame.eflags&0x00037fd7);
  check('fault.stackPointer',0x6ff0,js.stackPointer);
  check('fault.pte5BeforeRepair','02500000',js.pte5BeforeRepair);
  check('fault.failedStoreWriteCount',0,js.failedStoreWriteCount);
  check('fault.scratchCr2','00500000',js.scratchCr2);
  return {status:mismatches.length?'scoped-fault-mismatch':'scoped-fault-match',
    mismatches,frameDefinedEflagsMask:0x00037fd7,
    native:{vector:nativeProof.vector,errorCode:nativeProof.errorCode,cr2:nativeProof.cr2,
      attemptedStoreEip:nativeProof.attemptedStoreEip,handlerEip:nativeProof.handlerEip,
      frame:Object.fromEntries(Object.entries(nativeProof.frame).map(([name,value])=>
        [name,{address:value.address,raw:value.value,bytes:value.bytes}])),
      failedStoreLinearCallbackCount:nativeProof.failedStoreLinearCallbackCount},
    js,
    excluded:['native callback ordinals versus JavaScript bus order',
      'upper 16 bits of saved CS dword','undefined/reserved saved EFLAGS bits',
      'complete physical bus cycles and timing']};
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
    'src/experimental/i80386.js',importedComparatorPath,nativeContractPath,comparatorPath])];
  requireCommittedSources(paths);
  const sourceHashes=Object.fromEntries(paths.map(path=>[path,sha256(readFileSync(resolve(repo,path)))]));
  if(nativeReceipt.schema!=='bw.bochs-cpu3-owned-pagefault-retry-capture.v1' ||
      nativeReceipt.status!=='native-capture-complete' || nativeReceipt.comparison!=='not-run' ||
      nativeReceipt.fixtureVariant!=='recoverable-pte5-page-fault-386-gate' ||
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
    throw new Error('native receipt does not bind the committed CPU3 page-fault fixture');
  const derivedNativeProof=assertRecoverablePageFault(
    nativeReceipt.checkpoint,nativeReceipt.fixtureSymbols);
  if(JSON.stringify(derivedNativeProof)!==JSON.stringify(nativeReceipt.faultEvidence))
    throw new Error('native fault evidence differs from direct checkpoint hooks');
  const build=mkdtempSync(join(tmpdir(),'bw-bochs-cpu3-js-pagefault-'));
  try{
    const object=join(build,'guest.o'),image=join(build,'guest.bin');
    execFileSync('as',['--32','-o',object,resolve(repo,fixturePath)]);
    const symbols=fixtureSymbols(object),entry=symbols.setup;
    if(JSON.stringify(symbols)!==JSON.stringify(nativeReceipt.fixtureSymbols))
      throw new Error('assembled fault/handler symbols differ from native receipt');
    execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','--oformat','binary','-o',image,object]);
    const binary=readFileSync(image);
    if(sha256(binary)!==nativeReceipt.imageSha256)
      throw new Error('assembled page-fault fixture differs from native image');
    if(entry<0x7c00 || entry>=0x7c00+binary.length)
      throw new Error('owned setup symbol is outside the assembled image');
    const memory=new Uint8Array(0x100000);
    memory.set(binary,0x7c00);
    let marker='';
    const writes=[];
    const cpu=new I80386({read:address=>memory[address],fetch:address=>memory[address],
      write:(address,value)=>{writes.push(address>>>0);memory[address]=value&255;},inPort:()=>0,
      outPort:(port,value)=>{if(port===0xe9)marker+=String.fromCharCode(value&255);}},
    {cpuProfile:'strict386',deliverFaults:true});
    cpu.hardwareReset({coprocessor:'80387'});
    cpu.cs=0;cpu.eip=entry;
    cpu.segmentCaches[1]={base:0,limit:0xffff,default32:false,present:true,
      code:true,readable:true,writable:false};
    let steps=0,zeroReturnCount=0,storeAttemptCount=0,handlerEntryCount=0;
    let cr3ReloadCount=0,iretRetryCount=0;
    let faultProof=null;
    while(steps<2200 && marker.length<7){
      const beforeCs=cpu.cs,beforeEip=cpu.eip;
      if(cpu.cs===8 && cpu.eip===symbols.faulting_store)storeAttemptCount++;
      if(cpu.cs===8 && cpu.eip===symbols.pf_handler)handlerEntryCount++;
      if(cpu.cs===8 && cpu.eip===symbols.cr3_reload)cr3ReloadCount++;
      if(cpu.cs===8 && cpu.eip===symbols.iret_retry)iretRetryCount++;
      const completed=cpu.step();steps++;
      if(completed===0){
        zeroReturnCount++;
        if(faultProof)throw new Error('multiple JavaScript fault-delivery steps');
        faultProof={vector:14,vectorProvenance:'configured #PF gate reached on zero-return step',
          cr2:cpu.cr2>>>0,faultingCs:beforeCs,attemptedStoreEip:beforeEip,
          handlerEip:cpu.eip>>>0,stackPointer:cpu.sp,
          frame:{errorCode:dword(memory,0x6ff0),eip:dword(memory,0x6ff4),
            cs:dword(memory,0x6ff8),eflags:dword(memory,0x6ffc)},
          pte5BeforeRepair:hex4(memory,0xa014),
          failedStoreWriteCount:writes.filter(address=>address>=0x5000&&address<0x5004).length};
      }
    }
    if(marker!=='BHPG004')throw new Error(`JS owned paging marker differs: ${marker}`);
    if(!faultProof)throw new Error('JavaScript fixture had no delivered fault');
    faultProof.zeroReturnCount=zeroReturnCount;
    faultProof.storeAttemptCount=storeAttemptCount;
    faultProof.handlerEntryCount=handlerEntryCount;
    faultProof.cr3ReloadCount=cr3ReloadCount;
    faultProof.iretRetryCount=iretRetryCount;
    faultProof.scratchCr2=hex4(memory,0x0520);
    const faultComparison=compareOwnedPageFault(derivedNativeProof,faultProof,symbols);
    const stateComparison=compareOwnedPagingState(nativeReceipt.checkpoint,snapshotJs(cpu,memory));
    requireCommittedSources(paths);
    if(paths.some(path=>sha256(readFileSync(resolve(repo,path)))!==sourceHashes[path]))
      throw new Error('comparison sources changed during run');
    console.log(JSON.stringify({schema:'bw.bochs-cpu3-owned-pagefault-retry-compare.v1',
      boardRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
      sourceHashes,nativeReceipt:receiptPath,nativeBochsRevision:nativeReceipt.bochsRevision,
      nativeBinarySha256:nativeReceipt.bochsExecutableSha256,imageSha256:sha256(binary),
      jsSetup:'strict386; deliverFaults true; explicit 80387 reset; direct owned setup symbol at CS 0000; guest handler/IRETD',
      fixtureSymbols:symbols,jsEntry:entry,jsSteps:steps,marker,
      faultComparison,stateComparison},null,2));
    if(faultComparison.mismatches.length || stateComparison.mismatches.length)process.exitCode=1;
  }finally{rmSync(build,{recursive:true,force:true});}
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])await main();
