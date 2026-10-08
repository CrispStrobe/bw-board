// CPU-free port policy. The actual driver supplies machine-owned ports and a
// synchronous passive wrapper observer. Synthetic controls prove ordering only.
export function guardObservation(operation) {
  let busy=false,failed=false;
  return (...args)=>{
    if(busy||failed){failed=true;throw new Error('reentered/failed wrapper observer');}
    busy=true;
    try {
      const result=operation(...args);
      if(failed)throw new Error('swallowed wrapper observer reentry');
      return result;
    } catch(error){failed=true;throw error;}
    finally{busy=false;}
  };
}

export function createFrameOrchestration(ports,{policy,opportunity}) {
  if (!ports || typeof ports.bind!=='function' || typeof ports.step!=='function' ||
      typeof ports.progress!=='function' ||
      !policy || typeof policy.arm!=='function' ||
      typeof policy.afterStep!=='function' || typeof policy.finish!=='function' ||
      typeof opportunity!=='function')
    throw new Error('frame port contract');
  let bound=false,armed=false,terminalEmitted=false,
    firstFailure=null,wrapperReceipt=null;
  let lastProgress=null,lastFrameProgress=null,stepCalls=0;
  let journalInvalidReason=null;
  let busy=false,reentered=false;
  const fail=reason=>{
    firstFailure??=reason;
    throw new Error(reason);
  };
  const exclusive=operation=>{
    if(busy){reentered=true;return fail('frame port reentry');}
    busy=true;
    try{
      const result=operation();
      if(reentered)return fail('frame port reentry');
      return result;
    }finally{busy=false;}
  };
  const emitFrameMilestone=event=>{
    if(!lastProgress) return fail('frame milestone lacks finite-client progress');
    const status=policy.status();
    const frameProgress=Object.freeze({event,stepCalls,
      wrapper:wrapperReceipt,cpuJournal:status});
    lastFrameProgress=frameProgress;
    // The adapter wraps this in a top-level pending/false report. Keep the
    // inherited partial result and its first failure alongside the frame.
    ports.progress({...lastProgress,frameProgress});
  };
  const wrapped={...ports,
    progress(value){
      lastProgress=value;
      ports.progress(lastFrameProgress?{...value,frameProgress:lastFrameProgress}:value);
    },
    bind(){return exclusive(()=>{
      if(firstFailure) return fail(firstFailure);
      if(bound) return fail('duplicate owned-main cut');
      let result;
      try {result=ports.bind();}
      catch(error){firstFailure??='owned-main cut exception';throw error;}
      if(firstFailure)return fail(firstFailure);
      if(result?.ownedCodeAtEntry!=='PASS') return fail('owned-main cut refused');
      bound=true;
      return result;
    });},
    step(){return exclusive(()=>{
      if(firstFailure) return fail(firstFailure);
      if(bound&&!armed){
        let candidate;
        try {candidate=opportunity();}
        catch(error){firstFailure??='wrapper opportunity exception';throw error;}
        if(firstFailure)return fail(firstFailure);
        if(candidate!==null){
          // A pre-step PC is only an opportunity. machine.step may deliver an
          // interrupt before CPU.step. The CPU journal selects actual CD31.
          armed=true;
          wrapperReceipt=candidate.receipt??null;
          let state;
          try {state=policy.arm({mainCut:true,comparison:candidate.comparison,
            cs:candidate.cs,maxActiveSteps:1000000});}
          catch(error){firstFailure??='journal arm exception';throw error;}
          if(firstFailure)return fail(firstFailure);
          if(state.phase!=='armed') return fail(state.firstFailure||'journal arm refused');
          try {emitFrameMilestone('armed');}
          catch(error){firstFailure??='frame arm progress exception';throw error;}
        }
      }
      try {ports.step();}
      catch(error){firstFailure??='machine step exception';throw error;}
      if(firstFailure)return fail(firstFailure);
      stepCalls++;
      if(armed){
        let state;
        try {state=policy.afterStep();}
        catch(error){firstFailure??='journal poll exception';throw error;}
        if(firstFailure)return fail(firstFailure);
        if(state.phase==='invalid'){
          journalInvalidReason=state.firstFailure||'journal invalid';
          firstFailure??=journalInvalidReason;
        }
        if(!terminalEmitted&&(state.phase==='complete'||state.phase==='invalid')){
          try {emitFrameMilestone(state.phase);}
          catch(error){firstFailure??='frame terminal progress exception';throw error;}
          terminalEmitted=true;
        }
        if(state.phase==='invalid')
          return fail(state.firstFailure||'journal invalid');
      }
    });},
  };
  return Object.freeze({
    ports:Object.freeze(wrapped),
    finish(report){return exclusive(()=>{
      if(!report || typeof report!=='object') throw new Error('completion report');
      const result={...report};
      result.finiteClientPassed=report.passed===true;
      result.finiteClientFirstFailure=report.firstFailure??null;
      if(firstFailure){
        result.passed=false;
        if(journalInvalidReason && result.firstFailure &&
           result.firstFailure!==journalInvalidReason)
          result.secondaryFailures=[...(result.secondaryFailures??[]),result.firstFailure];
        result.firstFailure=journalInvalidReason??result.firstFailure??firstFailure;
        result.frame0501={phase:'invalid',firstFailure,wrapper:wrapperReceipt,
          cpuJournal:policy.status()};
        return result;
      }
      if(result.passed!==true){
        result.frame0501={phase:'incomplete',wrapper:wrapperReceipt,
          cpuJournal:policy.status()};
        return result;
      }
      const graded=policy.finish({clientPassed:true,diagnostic:result.returnDiagnostic});
      result.frame0501={...graded,wrapper:wrapperReceipt,
        cpuJournal:policy.status()};
      if(graded.phase!=='passed'){
        result.passed=false;
        result.firstFailure??=graded.firstFailure||'owned 0501 pair absent';
      }
      return result;
    });},
  });
}
