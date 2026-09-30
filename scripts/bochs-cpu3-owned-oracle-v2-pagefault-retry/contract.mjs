/** Additional owned #PF evidence over the unchanged v2 hook checkpoint. */
const word=bytes=>Buffer.from(bytes,'hex').readUInt32LE(0);
const fail=message=>{throw new Error(`owned page-fault proof: ${message}`);};

export function assertRecoverablePageFault(record,symbols){
  for(const name of ['setup','faulting_store','pf_handler','cr3_reload','iret_retry'])
    if(!Number.isInteger(symbols?.[name]) || symbols[name]<0x7c00 || symbols[name]>=0x8600)
      fail(`missing or out-of-range ${name} symbol`);
  if(symbols.setup!==0x7e00) fail('post-load setup entry changed');
  const events=record?.events;
  if(!Array.isArray(events)) fail('missing parsed v2 events');
  const faults=events.filter(e=>e.kind==='exception');
  if(faults.length!==1 || faults[0].a!==14 || faults[0].b!==2)
    fail('expected exactly one supervisor not-present write #PF, vector 14/error 2');
  const fault=faults[0];
  const attempts=events.filter(e=>e.kind==='instruction' && e.a===8 &&
    e.b===symbols.faulting_store);
  if(attempts.length!==2 || attempts[0].ordinal>=fault.ordinal ||
      attempts[1].ordinal<=fault.ordinal || fault.instruction!==attempts[0].instruction)
    fail('faulting store must execute once before and once after handler');
  const deliveries=events.filter(e=>e.kind==='interrupt' || e.kind==='hardware-interrupt');
  if(deliveries.length!==1 || deliveries[0].kind!=='interrupt' ||
      deliveries[0].a!==14 || deliveries[0].ordinal<=fault.ordinal ||
      deliveries[0].instruction!==attempts[0].instruction)
    fail('missing or extra instrumented exception delivery callback');
  const interrupt=deliveries[0];
  const handlers=events.filter(e=>e.kind==='instruction' && e.a===8 &&
    e.b===symbols.pf_handler);
  if(handlers.length!==1 || handlers[0].ordinal<=interrupt.ordinal ||
      handlers[0].ordinal>=attempts[1].ordinal)
    fail('real guest handler must enter exactly once before retry');
  const handler=handlers[0];
  const between=(e,lo,hi)=>e.ordinal>lo && e.ordinal<hi;
  const absent=events.find(e=>e.kind==='physical-access' && e.a===0xa014 &&
    e.why===5 && e.phase==='postread' && e.bytes==='02500000' &&
    e.instruction===attempts[0].instruction &&
    between(e,attempts[0].ordinal,fault.ordinal));
  if(!absent) fail('missing direct not-present PTE5 read before #PF');
  const frameSpecs=[
    {name:'eflags',address:0x6ffc},
    {name:'cs',address:0x6ff8},
    {name:'eip',address:0x6ff4,expected:symbols.faulting_store},
    {name:'errorCode',address:0x6ff0,expected:2},
  ];
  const frame={};
  let preceding=interrupt.ordinal;
  for(const spec of frameSpecs){
    const hook=events.find(e=>e.kind==='linear-access' && e.a===spec.address &&
      e.b===spec.address && e.c===4 && e.phase==='prewrite' &&
      e.instruction===attempts[0].instruction &&
      between(e,preceding,handler.ordinal));
    if(!hook) fail(`missing ${spec.name} stack-frame write`);
    const value=word(hook.bytes);
    if(spec.expected!==undefined && value!==spec.expected)
      fail(`incorrect saved ${spec.name}`);
    frame[spec.name]={address:spec.address,value,ordinal:hook.ordinal,bytes:hook.bytes};
    preceding=hook.ordinal;
  }
  if((frame.eflags.value&0x00037fd7)!==0x00010046)
    fail('saved frame lacks expected defined arithmetic flags and RF');
  if((frame.cs.value&0xffff)!==8)
    fail('saved CS selector differs from owned ring-zero code segment');
  const repair=events.find(e=>e.kind==='linear-access' && e.a===0xa014 &&
    e.c===4 && e.phase==='prewrite' && e.bytes==='03500000' &&
    between(e,handler.ordinal,attempts[1].ordinal));
  if(!repair) fail('guest handler did not install present PTE5 before retry');
  const control=(name,lo,hi)=>events.find(e=>e.kind==='instruction' && e.a===8 &&
    e.b===symbols[name] && between(e,lo,hi));
  const reload=control('cr3_reload',repair.ordinal,attempts[1].ordinal);
  const iret=control('iret_retry',reload?.ordinal??repair.ordinal,attempts[1].ordinal);
  if(!reload || !iret) fail('guest did not execute CR3 reload and IRETD before retry');
  const scratch=(phase)=>events.find(e=>e.kind==='linear-access' && e.a===0x0520 &&
    e.b===0x0520 && e.c===4 && e.phase===phase && e.bytes==='00500000' &&
    between(e,handler.ordinal,repair.ordinal));
  const cr2Write=scratch('prewrite'),cr2Read=scratch('postread');
  if(!cr2Write || !cr2Read || cr2Write.ordinal>=cr2Read.ordinal)
    fail('handler did not write and read back CR2 via mapped scratch');
  if(record.state?.cr2!==0x5000 || record.tables?.idtrBase!==0 ||
      record.tables.idtrLimit!==0x03ff)
    fail('final CR2 or IDTR differs from owned fault contract');
  const afterRepair=events.find(e=>e.kind==='physical-access' && e.a===0xa014 &&
    e.why===5 && e.phase==='postread' && e.bytes==='03500000' &&
    e.instruction===attempts[1].instruction && e.ordinal>attempts[1].ordinal);
  if(!afterRepair) fail('retry did not walk the repaired PTE5');
  const successfulStore=events.find(e=>e.kind==='linear-access' && e.a===0x5000 &&
    e.b===0x5000 && e.c===4 && e.phase==='prewrite' &&
    e.bytes==='44332211' && e.instruction===attempts[1].instruction &&
    e.ordinal>afterRepair.ordinal);
  if(!successfulStore) fail('repaired retry did not reach the expected data write');
  const failedStoreCallbacks=events.filter(e=>e.kind==='linear-access' && e.a===0x5000 &&
    between(e,attempts[0].ordinal,fault.ordinal));
  if(failedStoreCallbacks.length) fail('faulted write unexpectedly reached linear write callback');
  return {schema:'bw.bochs-cpu3-owned-pagefault-proof.v1',
    vector:14,errorCode:2,cr2:0x5000,
    attemptedStoreEip:symbols.faulting_store,handlerEip:symbols.pf_handler,
    faultEventOrdinal:fault.ordinal,interruptEventOrdinal:interrupt.ordinal,
    firstAttemptOrdinal:attempts[0].ordinal,handlerEntryOrdinal:handler.ordinal,
    retryOrdinal:attempts[1].ordinal,
    nonpresentPteReadOrdinal:absent.ordinal,repairWriteOrdinal:repair.ordinal,
    cr3ReloadOrdinal:reload.ordinal,iretOrdinal:iret.ordinal,
    repairedPteReadOrdinal:afterRepair.ordinal,successfulStoreOrdinal:successfulStore.ordinal,
    scratchCr2WriteOrdinal:cr2Write.ordinal,scratchCr2ReadOrdinal:cr2Read.ordinal,
    failedStoreLinearCallbackCount:0,frame};
}
