// CPU-free port policy. The actual driver supplies machine-owned ports and a
// synchronous passive wrapper observer. Synthetic controls prove ordering only.
export function createFrameOrchestration(ports,{policy,opportunity}) {
  if (!ports || typeof ports.bind!=='function' || typeof ports.step!=='function' ||
      !policy || typeof policy.arm!=='function' ||
      typeof policy.afterStep!=='function' || typeof policy.finish!=='function' ||
      typeof opportunity!=='function')
    throw new Error('frame port contract');
  let bound=false,armed=false,firstFailure=null;
  const fail=reason=>{
    firstFailure??=reason;
    throw new Error(reason);
  };
  const wrapped={...ports,
    bind(){
      if(bound) return fail('duplicate owned-main cut');
      const result=ports.bind();
      if(result?.ownedCodeAtEntry!=='PASS') return fail('owned-main cut refused');
      bound=true;
      return result;
    },
    step(){
      if(bound&&!armed){
        const candidate=opportunity();
        if(candidate!==null){
          // A pre-step PC is only an opportunity. machine.step may deliver an
          // interrupt before CPU.step. The CPU journal selects actual CD31.
          armed=true;
          const state=policy.arm({mainCut:true,comparison:candidate.comparison,
            cs:candidate.cs,maxActiveSteps:1000000});
          if(state.phase!=='armed') return fail(state.firstFailure||'journal arm refused');
        }
      }
      ports.step();
      if(armed){
        const state=policy.afterStep();
        if(state.phase==='invalid')
          return fail(state.firstFailure||'journal invalid');
      }
    },
  };
  return Object.freeze({
    ports:Object.freeze(wrapped),
    finish(report){
      if(!report || typeof report!=='object') throw new Error('completion report');
      const result={...report};
      if(firstFailure){
        result.passed=false;
        result.firstFailure??=firstFailure;
        result.frame0501={phase:'invalid',firstFailure};
        return result;
      }
      if(result.passed!==true){
        result.frame0501=policy.status();
        return result;
      }
      const graded=policy.finish({clientPassed:true,diagnostic:result.returnDiagnostic});
      result.frame0501=graded;
      if(graded.phase!=='passed'){
        result.passed=false;
        result.firstFailure??=graded.firstFailure||'owned 0501 pair absent';
      }
      return result;
    },
  });
}
