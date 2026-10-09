import {runScenario} from '../i80386-cwsdpmi-highmem-at/driver.mjs';
import {admittedTextExtent} from '../i80386-cwsdpmi-highmem-at/binding.mjs';
import {observationFingerprint} from '../i80386-cwsdpmi-highmem-at/strict-cut.mjs';
import {readOrdinaryLinear} from '../i80386-cwsdpmi-at-loaded/passive-ram.mjs';
import {admittedWrapperRange,compareWrapperSnapshot} from '../i80386-cwsdpmi-0501-frame-at/admit.mjs';
import {guardObservation} from '../i80386-cwsdpmi-0501-frame-at/orchestration.mjs';
import {captureReferences,sameReferences} from '../i80386-cwsdpmi-0501-frame-at/references.mjs';
import {createPfConnectedOrchestration,sourceBoundPfStepMonitor} from './orchestration.mjs';
import {gradePfOutcome} from './grade.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// The caller's ports must be the same source-owned machine/media ports as the
// unchanged high-memory AT driver. A separate input adapter will construct
// those ports from authenticated files; this export does not authenticate an
// arbitrary caller-provided ports object by itself.
export function runPfConnectedScenario(ports,{machine,layout,token}) {
  if (!machine || ports?.machine!==machine || machine.cpu!==ports.machine.cpu)
    throw new Error('frame machine owner');
  const range=admittedWrapperRange(token),extent=admittedTextExtent(layout);
  if(range.textAddress!==extent.address || range.textBytes!==extent.bytes ||
     range.address<extent.address || range.address+range.bytes>extent.address+extent.bytes)
    throw new Error('private wrapper/text mismatch');
  const cpu=machine.cpu;
  let mainCs=null,mainBase=null;
  let machineStepCount=0,opportunityCount=0;
  const bind=()=>{
    const loaded=ports.bind();
    if(machine.cpu!==cpu)throw new Error('main-cut CPU owner changed');
    mainCs=cpu.cs;mainBase=cpu.segmentCaches[1].base;
    return loaded;
  };
  const opportunity=guardObservation(()=>{
    opportunityCount++;
    // Cheap pre-step selection. This PC does not assert that CPU.step will
    // execute the wrapper next: machine.step can service an IRQ first.
    if(machine.cpu!==cpu)throw new Error('wrapper CPU owner changed');
    if(cpu.eip!==range.address) return null;
    const code=cpu.segmentCaches[1];
    if(!(cpu.cr0&1) || (cpu.eflags&0x20000) || cpu.halted || cpu.shutdown ||
       cpu._retainedRealCs || !code?.default32 || !code.present || !code.code)
      throw new Error('unsupported allocation-wrapper CPU opportunity');
    if(cpu.cs!==mainCs || code.base!==mainBase)
      throw new Error('allocation-wrapper code context changed since main cut');
    const base=code.base;
    if(!Number.isInteger(base)||base<0||base+extent.address+extent.bytes>0x100000000)
      throw new Error('wrapper text linear extent');
    const before=observationFingerprint(machine),refs=captureReferences(machine);
    let copied=null,failed=null;
    try {
      copied=readOrdinaryLinear(machine,{sourcePaused:true,
        linear:base+extent.address,length:extent.bytes});
    } catch(error){failed=error;}
    const after=observationFingerprint(machine);
    const referenceEqual=sameReferences(refs,captureReferences(machine));
    if(!same(before,after)||!referenceEqual)
      throw new Error('wrapper observation changed guest state');
    if(failed)throw failed;
    const comparison=compareWrapperSnapshot(token,copied);
    return Object.freeze({comparison,cs:cpu.cs,
      receipt:Object.freeze({machineStepCount,opportunityCount,
        sourceCs:cpu.cs,sourceCodeBase:base,sourceEip:cpu.eip,
        cpuCycles:cpu.cycles,machineCycles:machine.cycles,
        comparison,before,after,referenceEqual})});
  });
  const wrapped=createPfConnectedOrchestration({...ports,bind,
    step:()=>{if(machine.cpu!==cpu)throw new Error('frame CPU owner changed');
      ports.step();machineStepCount++; }}, {cpu,opportunity,
      progress:ports.taskProgress});
  const finiteClient=runScenario(wrapped.ports);
  const strict=wrapped.terminal();
  let taskMode=null,continuationFailure=null,pfArm=null,pfStatus=null,
    pfObservation=null,pfFailure=null,continuationCalls=0;
  let stepMonitor=null;
  // The old task-mode driver continues synchronously before returning. This
  // derivative owns the pause after runScenario's strict refusal instead.
  if(strict.modeArmed&&strict.strict?.phase==='invalid') {
    try {
      if(machine.cpu!==cpu||ports.machine!==machine)
        throw new Error('PF arm owner changed');
      const before=observationFingerprint(machine),refs=captureReferences(machine);
      pfArm=wrapped.armFaultAtStrictTerminal({maxActiveSteps:100_000});
      if(machine.cpu!==cpu||ports.machine!==machine)
        throw new Error('PF arm owner changed');
      if(!same(before,observationFingerprint(machine))||
         !sameReferences(refs,captureReferences(machine)))
        throw new Error('PF arm changed guest source state');
      ports.taskProgress({event:'pf-outcome-armed',steps:pfArm.preContinuationMachineSteps,
        modeAtArm:pfArm.modeAtArm,pfRecorderAttemptedSteps:0});
      if(machine.cpu!==cpu||!same(before,observationFingerprint(machine))||
         !sameReferences(refs,captureReferences(machine)))
        throw new Error('PF arm progress changed guest source state');
    } catch {
      pfFailure='PF arm or progress refused';
      const retained=wrapped.faultTerminal();
      if(retained.token&&retained.arm)
        pfArm={token:retained.token,...retained.arm};
    }
    if(pfArm&&!pfFailure){
      try {
        const monitored=sourceBoundPfStepMonitor(machine,cpu,pfArm.token);
        stepMonitor=monitored.receipt;
        continuationCalls++;
        taskMode=wrapped.continue(monitored.machine,{now:ports.now});
      }
      catch {continuationFailure='task mode continuation observer exception';
        taskMode=wrapped.terminal().modeResult;}
    }
  }
  // No guest step occurs after the inherited terminal stop. A failed progress
  // write or mode drain cannot silently discard an already-armed PF token.
  if(pfArm){
    try {
      if(machine.cpu!==cpu||ports.machine!==machine)
        throw new Error('PF drain owner changed');
      pfStatus=cpu.owned0501FaultOutcomeStatus(pfArm.token);
      if(pfStatus?.phase==='complete'||pfStatus?.phase==='invalid')
        pfObservation=cpu.takeOwned0501FaultOutcome(pfArm.token);
      else pfFailure??='PF outcome incomplete at terminal stop';
      if(!pfObservation&&pfStatus?.phase!=='armed'&&
         pfStatus?.phase!=='capturing')pfFailure??='PF outcome drain absent';
    }catch{pfFailure??='PF outcome status or take refused';}
  }
  const pfOutcome={arm:pfArm?{
      modeAtArm:pfArm.modeAtArm,
      preContinuationMachineSteps:pfArm.preContinuationMachineSteps,
      maxActiveSteps:pfArm.maxActiveSteps}:null,
    continuationCalls,continuationAttemptedMachineSteps:taskMode?.steps??null,
    stepMonitor,
    status:pfStatus,observation:pfObservation,firstFailure:pfFailure,
    frameReturnQualified:false};
  const pfGrade=gradePfOutcome({finiteClient,strict,taskMode,pfOutcome});
  return {finiteClient,strict,taskMode,continuationFailure,pfOutcome,pfGrade};
}
