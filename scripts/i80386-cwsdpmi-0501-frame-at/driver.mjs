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
    caches:cpu.segmentCaches,translations:cpu._translations,
    tablePages:cpu._translationTablePages,vga,
    planes:vga?.planes, latches:vga?.latches};
}
function sameReferences(a,b) {
  return Object.keys(a).every(key=>a[key]===b[key]);
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
  const opportunity=()=>{
    // Cheap pre-step selection. This PC does not assert that CPU.step will
    // execute the wrapper next: machine.step can service an IRQ first.
    if(cpu.eip!==range.address) return null;
    const code=cpu.segmentCaches[1];
    if(!(cpu.cr0&1) || (cpu.eflags&0x20000) || cpu.halted || cpu.shutdown ||
       cpu._retainedRealCs || !code?.default32 || !code.present || !code.code)
      throw new Error('unsupported allocation-wrapper CPU opportunity');
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
    if(!same(before,after)||!sameReferences(refs,references(machine)))
      throw new Error('wrapper observation changed guest state');
    if(failed)throw failed;
    const comparison=compareWrapperSnapshot(token,copied);
    return Object.freeze({comparison,cs:cpu.cs});
  };
  const wrapped=createFrameOrchestration(ports,{policy,opportunity});
  return wrapped.finish(runScenario(wrapped.ports));
}
