import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compareOwnedPageFault} from '../scripts/compare-bochs-cpu3-owned-pagefault-retry.mjs';

const symbols={setup:0x7e00,faulting_store:0x7ebe,pf_handler:0x7ef3,
  cr3_reload:0x7f46,iret_retry:0x7f4c};
const native={vector:14,errorCode:2,cr2:0x5000,
  attemptedStoreEip:symbols.faulting_store,handlerEip:symbols.pf_handler,
  failedStoreLinearCallbackCount:0,
  frame:{errorCode:{address:0x6ff0,value:2,bytes:'02000000'},
    eip:{address:0x6ff4,value:symbols.faulting_store,bytes:'be7e0000'},
    cs:{address:0x6ff8,value:8,bytes:'08000000'},
    eflags:{address:0x6ffc,value:0x10046,bytes:'46000100'}}};
function jsProof(){
  return {vector:14,deliveredErrorCode:2,
    deliveredReturnEip:symbols.faulting_store,deliveryCallCount:1,
    cr2:0x5000,faultingCs:8,
    attemptedStoreEip:symbols.faulting_store,handlerEip:symbols.pf_handler,
    zeroReturnCount:1,storeAttemptCount:2,handlerEntryCount:1,
    cr3ReloadCount:1,iretRetryCount:1,stackPointer:0x6ff0,
    frame:{errorCode:2,eip:symbols.faulting_store,cs:8,eflags:0x10046},
    pte5BeforeRepair:'02500000',failedStoreWriteCount:0,
    scratchCr2:'00500000',
    executionPoints:{firstStore:800,delivery:800,handler:801,
      cr3Reload:829,iret:831,retryStore:832}};
}

test('bounded delivered page fault matches native frame, CR2, and guest retry',()=>{
  const result=compareOwnedPageFault(native,jsProof(),symbols);
  assert.equal(result.status,'scoped-fault-match');
  assert.deepEqual(result.mismatches,[]);
  assert.equal(result.frameDefinedEflagsMask,0x00037fd7);
  assert.equal(result.native.frame.eip.raw,symbols.faulting_store);
});

test('fault proof rejects changed error, restart, RF, retry, and repair evidence',()=>{
  const mutations=[
    [js=>{js.frame.errorCode=0;},'fault.errorCode'],
    [js=>{js.deliveredErrorCode=0;},'fault.deliveredErrorCode'],
    [js=>{js.deliveredReturnEip++;},'fault.deliveredReturnEip'],
    [js=>{js.deliveryCallCount=2;},'fault.deliveryCallCount'],
    [js=>{js.cr2=0x4000;},'fault.cr2'],
    [js=>{js.faultingCs=0;},'fault.faultingCs'],
    [js=>{js.frame.eip++;},'fault.savedEip'],
    [js=>{js.frame.cs=0x10;},'fault.savedCsSelector'],
    [js=>{js.frame.eflags&=~0x10000;},'fault.savedEflagsDefined386'],
    [js=>{js.storeAttemptCount=1;},'fault.storeAttemptCount'],
    [js=>{js.handlerEntryCount=0;},'fault.handlerEntryCount'],
    [js=>{js.cr3ReloadCount=0;},'fault.cr3ReloadCount'],
    [js=>{js.iretRetryCount=0;},'fault.iretRetryCount'],
    [js=>{js.pte5BeforeRepair='03500000';},'fault.pte5BeforeRepair'],
    [js=>{js.failedStoreWriteCount=1;},'fault.failedStoreWriteCount'],
    [js=>{js.scratchCr2='00000000';},'fault.scratchCr2'],
    [js=>{js.executionPoints.iret=js.executionPoints.cr3Reload-1;},'fault.iretAfterReload'],
  ];
  for(const [mutate,field] of mutations){
    const js=jsProof();mutate(js);
    assert.ok(compareOwnedPageFault(native,js,symbols).mismatches.some(x=>x.field===field),field);
  }
});

test('source-bound CLI runs one real guest #PF, handler, IRETD, and store retry',()=>{
  const repo=fileURLToPath(new URL('../',import.meta.url));
  const raw=execFileSync(process.execPath,
    ['scripts/compare-bochs-cpu3-owned-pagefault-retry.mjs'],{cwd:repo,encoding:'utf8'});
  const report=JSON.parse(raw);
  assert.equal(report.marker,'BHPG004');
  assert.equal(report.fixtureSymbols.faulting_store,0x7ebe);
  assert.equal(report.faultComparison.status,'scoped-fault-match');
  assert.deepEqual(report.faultComparison.mismatches,[]);
  assert.equal(report.faultComparison.js.zeroReturnCount,1);
  assert.equal(report.faultComparison.js.deliveryCallCount,1);
  assert.equal(report.faultComparison.js.vector,14);
  assert.equal(report.faultComparison.js.deliveredErrorCode,2);
  assert.equal(report.faultComparison.js.storeAttemptCount,2);
  assert.equal(report.faultComparison.js.iretRetryCount,1);
  assert.equal(report.stateComparison.status,'scoped-fields-match');
  assert.deepEqual(report.stateComparison.mismatches,[]);
  for(const name of ['pde0','pte5','data5'])
    assert.equal(report.stateComparison.ramSnapshots.native[name].bytes,
      report.stateComparison.ramSnapshots.js[name].bytes);
});
