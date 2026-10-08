import {runScenario} from '../i80386-cwsdpmi-highmem-at/driver.mjs';
import {admittedTextExtent} from '../i80386-cwsdpmi-highmem-at/binding.mjs';
import {observationFingerprint} from '../i80386-cwsdpmi-highmem-at/strict-cut.mjs';
import {readOrdinaryLinear} from '../i80386-cwsdpmi-at-loaded/passive-ram.mjs';
import {admittedWrapperRange,compareWrapperSnapshot} from './admit.mjs';
import {create0501Policy} from './policy.mjs';
import {createFrameOrchestration} from './orchestration.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function references(machine) {
  const cpu=machine.cpu,vga=machine.vgaMemory;
  return {cpu,mem:machine.mem,memBuffer:machine.mem.buffer,
    page:machine._page,pageBuffer:machine._page.buffer,
    config:machine.config,chips:machine.chips,
    caches:cpu.segmentCaches,
    cacheValues:[...cpu.segmentCaches],
    translations:cpu._translations,
    translationValues:[...cpu._translations],
    tablePages:cpu._translationTablePages,vga,
    planes:vga?.planes,planeValues:vga?.planes?[...vga.planes]:null,
    planeBuffers:vga?.planes?vga.planes.map(plane=>plane.buffer):null,
    latches:vga?.latches,latchBuffer:vga?.latches?.buffer,
    debug:cpu._debugRegisters,debugBuffer:cpu._debugRegisters?.buffer};
}
function sameReferences(a,b) {
  const arrays=new Set(['cacheValues','translationValues','planeValues','planeBuffers']);
  return Object.keys(a).every(key=>arrays.has(key)
    ? (a[key]===null&&b[key]===null ||
       Array.isArray(a[key])&&Array.isArray(b[key])&&
       a[key].length===b[key].length&&a[key].every((value,index)=>value===b[key][index]))
    : a[key]===b[key]);
}

// The caller's ports must be the same source-owned machine/media ports as the
// unchanged high-memory AT driver. A separate input adapter will construct
// those ports from authenticated files; this export does not authenticate an
// arbitrary caller-provided ports object by itself.
export function runFrameScenario(ports,{machine,layout,token}) {
  if (!machine || ports?.machine!==machine || machine.cpu!==ports.machine.cpu)
    throw new Error('frame machine owner');
  const range=admittedWrapperRange(token),extent=admittedTextExtent(layout);
  if(range.textAddress!==extent.address || range.textBytes!==extent.bytes ||
     range.address<extent.address || range.address+range.bytes>extent.address+extent.bytes)
    throw new Error('private wrapper/text mismatch');
  const cpu=machine.cpu,policy=create0501Policy(cpu);
  let mainCs=null,mainBase=null,observerBusy=false,observerFailed=false;
  let machineStepCount=0,opportunityCount=0;
  const bind=()=>{
    const loaded=ports.bind();
    if(machine.cpu!==cpu)throw new Error('main-cut CPU owner changed');
    mainCs=cpu.cs;mainBase=cpu.segmentCaches[1].base;
    return loaded;
  };
  const opportunity=()=>{
    if(observerBusy||observerFailed){observerFailed=true;
      throw new Error('reentered/failed wrapper observer');}
    observerBusy=true;
    try {
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
    const before=observationFingerprint(machine),refs=references(machine);
    let copied=null,failed=null;
    try {
      copied=readOrdinaryLinear(machine,{sourcePaused:true,
        linear:base+extent.address,length:extent.bytes});
    } catch(error){failed=error;}
    const after=observationFingerprint(machine);
    const referenceEqual=sameReferences(refs,references(machine));
    if(!same(before,after)||!referenceEqual)
      throw new Error('wrapper observation changed guest state');
    if(failed)throw failed;
    const comparison=compareWrapperSnapshot(token,copied);
    return Object.freeze({comparison,cs:cpu.cs,
      receipt:Object.freeze({machineStepCount,opportunityCount,
        sourceCs:cpu.cs,sourceCodeBase:base,sourceEip:cpu.eip,
        cpuCycles:cpu.cycles,machineCycles:machine.cycles,
        comparison,before,after,referenceEqual})});
    } catch(error){observerFailed=true;throw error;}
    finally{observerBusy=false;}
  };
  const wrapped=createFrameOrchestration({...ports,bind,
    step:()=>{if(machine.cpu!==cpu)throw new Error('frame CPU owner changed');
      ports.step();machineStepCount++; }}, {policy,opportunity});
  return wrapped.finish(runScenario(wrapped.ports));
}
