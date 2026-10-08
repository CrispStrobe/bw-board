// CPU-free orchestration policy. All inputs are supplied by a future owned
// synchronous driver; this module does not authenticate a guest or a pause.
const word = n => Number.isInteger(n) && n >= 0 && n <= 0xffff;
const dword = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const cpl = n => Number.isInteger(n) && n >= 0 && n <= 3;
const addressFromWords = (hi,lo) => (((hi & 0xffff) * 0x10000) + (lo & 0xffff)) >>> 0;
const field = (object,key) => {
  const descriptor = object && Object.getOwnPropertyDescriptor(object,key);
  return descriptor && Object.hasOwn(descriptor,'value') ? descriptor.value : undefined;
};

export function create0501Policy(cpu) {
  if (!cpu || typeof cpu.armOwned0501FrameJournal !== 'function' ||
      typeof cpu.owned0501FrameStatus !== 'function' ||
      typeof cpu.takeOwned0501FrameObservation !== 'function')
    throw new Error('journal API required');
  let phase='waiting', token=null, terminal=null, firstFailure=null;
  let wrapperStart=null, wrapperEnd=null, armedCs=null, armedCap=null;
  let busy=false, reentered=false;
  function fail(reason) {
    firstFailure ??= reason;
    phase='invalid';
    return Object.freeze({phase, firstFailure});
  }
  function exclusive(operation) {
    if (busy) {
      reentered=true;
      return fail('policy-reentry');
    }
    busy=true;
    try {
      const result=operation();
      return reentered ? fail('policy-reentry') : result;
    } finally {busy=false;}
  }
  return Object.freeze({
    status:()=>exclusive(()=>Object.freeze({phase, firstFailure, observation:terminal})),
    // Call only at the source-owned pre-step wrapper opportunity, after the
    // main cut and a passive exact wrapper comparison in this same machine.
    arm(options) {return exclusive(()=>{
      if (phase!=='waiting') return fail('second-arm-or-finished');
      const mainCut=field(options,'mainCut'),comparison=field(options,'comparison'),
        cs=field(options,'cs');
      const suppliedCap=field(options,'maxActiveSteps');
      const maxActiveSteps=suppliedCap===undefined?1000000:suppliedCap;
      if (mainCut!==true || field(comparison,'schema')!==
          'bw.cwsdpmi-0501.wrapper-comparison.v1' ||
          !dword(field(comparison,'address')) ||
          !Number.isInteger(field(comparison,'bytes')) ||
          field(comparison,'bytes')<3 || field(comparison,'bytes')>4096 ||
          !word(cs) || !Number.isInteger(maxActiveSteps) ||
          maxActiveSteps<1 || maxActiveSteps>1000000)
        return fail('wrapper-opportunity-not-admitted');
      const startEip=field(comparison,'address');
      const endEip=startEip+field(comparison,'bytes');
      if (endEip>0xffffffff) return fail('wrapper-range-overflow');
      try {
        token=cpu.armOwned0501FrameJournal({cs,startEip,endEip,maxActiveSteps});
        if (!token || !['object','function'].includes(typeof token))
          return fail('cpu-arm-token-missing');
        wrapperStart=startEip; wrapperEnd=endEip;
        armedCs=cs; armedCap=maxActiveSteps;
        phase='armed';
      } catch { return fail('cpu-arm-refused'); }
      return Object.freeze({phase, startEip, endEip});
    });},
    // Called after, never during, the original ordinary machine.step().
    afterStep() {return exclusive(()=>{
      if (phase!=='armed') return Object.freeze({phase, firstFailure});
      let state;
      try { state=cpu.owned0501FrameStatus(token); }
      catch { return fail('cpu-status-refused'); }
      if (state?.phase==='armed' || state?.phase==='open')
        return Object.freeze({phase, cpuPhase:state.phase});
      if (state?.phase!=='complete' && state?.phase!=='invalid')
        return fail('cpu-status-malformed');
      try { terminal=cpu.takeOwned0501FrameObservation(token); }
      catch { return fail('cpu-drain-refused'); }
      if (!terminal || terminal.phase!==state.phase ||
          terminal.failure!==state.failure ||
          !Number.isInteger(terminal.activeSteps) ||
          terminal.activeSteps<1 || terminal.activeSteps>armedCap)
        return fail('cpu-drain-mismatch');
      if (terminal.phase==='invalid') return fail(terminal.failure || 'cpu-invalid');
      phase='complete';
      return Object.freeze({phase});
    });},
    // The actual driver must supply a same-session strict output projection
    // and its independently graded finite client/shell result.
    finish(options) {return exclusive(()=>{
      const clientPassed=field(options,'clientPassed'),diagnostic=field(options,'diagnostic');
      if (phase!=='complete' || clientPassed!==true || !terminal ||
          terminal.failure!==null)
        return fail('client-or-pair-incomplete');
      const entry=terminal.entry, returned=terminal.returned;
      const address=field(diagnostic,'address');
      if (!dword(address) || address<=0x100000 ||
          !entry || !returned ||
          entry.source!=='decoded-software-int31' || entry.vector!==0x31 ||
          entry.width!==32 || entry.entryAx!==0x0501 ||
          !dword(entry.instructionStart) || !dword(entry.returnEip) ||
          entry.instructionStart<wrapperStart ||
          entry.instructionStart>=wrapperEnd ||
          entry.returnEip<=entry.instructionStart ||
          entry.returnEip>wrapperEnd ||
          !word(entry.returnCs) || entry.returnCs!==armedCs ||
          !word(entry.returnSs) || !dword(entry.returnEsp) ||
          !dword(entry.savedFlags) || !cpl(entry.oldCpl) ||
          !cpl(entry.newCpl) || entry.newCpl>entry.oldCpl ||
          ![14,15].includes(entry.gateType) ||
          !word(entry.handlerCs) || !dword(entry.handlerEip) ||
          !word(entry.handlerSs) || !dword(entry.handlerEsp) ||
          !dword(entry.frameLinear) ||
          entry.frameBytes!==(entry.newCpl<entry.oldCpl?20:12) ||
          !word(entry.entryBx) || !word(entry.entryCx) ||
          addressFromWords(entry.entryBx,entry.entryCx)!==4096 ||
          returned.source!=='decoded-protected-iret' || returned.width!==32 ||
          !word(returned.handlerCs) || !word(returned.handlerSs) ||
          !dword(returned.handlerEsp) || !dword(returned.instructionStart) ||
          returned.handlerCs!==entry.handlerCs ||
          returned.handlerSs!==entry.handlerSs ||
          returned.handlerEsp!==entry.handlerEsp ||
          !word(returned.consumedCs) || !dword(returned.consumedEip) ||
          !dword(returned.consumedFlags) ||
          returned.consumedCs!==entry.returnCs ||
          returned.consumedEip!==entry.returnEip ||
          !cpl(returned.returnedCpl) || returned.returnedCpl!==entry.oldCpl ||
          !word(returned.returnedBx) || !word(returned.returnedCx) ||
          addressFromWords(returned.returnedBx,returned.returnedCx)!==address ||
          !dword(returned.returnedFlags) || (returned.returnedFlags&1)!==0 ||
          returned.returnedCs!==entry.returnCs ||
          returned.returnedEip!==entry.returnEip ||
          returned.returnedSs!==entry.returnSs ||
          returned.returnedEsp!==entry.returnEsp ||
          returned.consumedFrameLinear!==entry.frameLinear)
        return fail('owned-0501-pair-or-output-mismatch');
      phase='passed';
      return Object.freeze({phase, address, entrySavedFlags:entry.savedFlags,
        returnConsumedFlags:returned.consumedFlags,
        actualReturnedFlags:returned.returnedFlags});
    });},
  });
}
