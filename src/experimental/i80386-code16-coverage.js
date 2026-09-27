import {prevalidateI80386Code16Window,
  isI80386Code16WindowValid} from './i80386-code16-window.js';
import {decodeI80386Code16Block} from './i80386-code16-block-decode.js';

/** Read-only census sampled immediately before ordinary machine.step(). */
export function createI80386Code16Coverage() {
  const counts = {code16Steps: 0, admittedSteps: 0, decodedSteps: 0,
    instructionsInCandidateBlocks: 0, candidateLengthHistogram: {}, stopReasons: {},
    observedBlockLengthHistogram: {}, retiredInObservedBlocks: 0,
    retiredInMultiInstructionBlocks: 0,
    ambiguousRetirements: {},
    byMode: {real: {steps: 0, admitted: 0, decoded: 0},
      protected16: {steps: 0, admitted: 0, decoded: 0},
      vm86: {steps: 0, admitted: 0, decoded: 0}}};
  let active = null, pending = null, interruptSerial = 0;
  const finish = () => {
    if (!active?.retired) { active = null; return; }
    const n = active.retired;
    counts.observedBlockLengthHistogram[n] =
      (counts.observedBlockLengthHistogram[n] ?? 0) + 1;
    counts.retiredInObservedBlocks += n;
    if (n > 1) counts.retiredInMultiInstructionBlocks += n;
    active = null;
  };
  return {
    attach(machine) {
      const original = machine._serviceInterrupts;
      if (typeof original !== 'function') throw new TypeError('machine needs interrupt service');
      const wrapped = function (...args) {
        const delivered = original.apply(this, args);
        if (delivered) interruptSerial++;
        return delivered;
      };
      machine._serviceInterrupts = wrapped;
      return () => {
        if (machine._serviceInterrupts === wrapped) machine._serviceInterrupts = original;
      };
    },
    observe(machine) {
      pending = null;
      const cpu = machine.cpu, cs = cpu.segmentCaches?.[1];
      if (!cs?.code || !cs.present || cs.default32) { finish(); return; }
      counts.code16Steps++;
      const mode = cpu.virtual8086 ? 'vm86' : cpu.protectedMode ? 'protected16' : 'real';
      counts.byMode[mode].steps++;
      const offset = cpu.eip >>> 0;
      const pageLeft = 4096 - (((cs.base + offset) >>> 0) & 4095);
      const segmentLeft = cs.limit - offset + 1;
      const length = Math.min(64, pageLeft, segmentLeft);
      const window = length >= 1 ? prevalidateI80386Code16Window(machine, offset, length) : null;
      if (!window) {
        counts.stopReasons['window-refused'] = (counts.stopReasons['window-refused'] ?? 0) + 1;
        finish();
        return;
      }
      counts.admittedSteps++;
      counts.byMode[mode].admitted++;
      const block = decodeI80386Code16Block(window);
      const size = block.instructions.length;
      if (size) counts.decodedSteps++;
      if (size) counts.byMode[mode].decoded++;
      counts.instructionsInCandidateBlocks += size;
      counts.candidateLengthHistogram[size] = (counts.candidateLengthHistogram[size] ?? 0) + 1;
      counts.stopReasons[block.reason] = (counts.stopReasons[block.reason] ?? 0) + 1;
      if (active && (active.cs !== cpu.cs ||
          active.instructions[active.next]?.offset !== offset ||
          !isI80386Code16WindowValid(active.window))) finish();
      if (!active && size) active = {cs: cpu.cs, window,
        instructions: block.instructions, next: 0, retired: 0};
      if (active) pending = {cycles: cpu.cycles, cs: cpu.cs, eip: offset,
        interruptSerial, halted: cpu.halted, trace: !!(cpu.eflags & 0x100),
        instruction: active.instructions[active.next]};
    },
    retired(machine) {
      if (!pending || !active) return;
      const before = pending, cpu = machine.cpu, instruction = before.instruction;
      pending = null;
      let ambiguity = null;
      if (before.halted) ambiguity = 'halted';
      else if (interruptSerial !== before.interruptSerial) ambiguity = 'pre-step-interrupt';
      else if (cpu.cycles !== before.cycles + 1) ambiguity = 'no-completed-instruction';
      else if (before.trace) ambiguity = 'single-step-trap';
      else if (cpu.cs !== before.cs) ambiguity = 'cs-changed';
      else if (instruction.kind === 'ret16') ambiguity = 'dynamic-return-target';
      else if (instruction.terminal) {
        if (cpu.eip !== instruction.target &&
            !(instruction.kind.startsWith('jz-') || instruction.kind.startsWith('jnz-')))
          ambiguity = 'target-mismatch';
        else if ((instruction.kind.startsWith('jz-') || instruction.kind.startsWith('jnz-')) &&
                 cpu.eip !== instruction.target && cpu.eip !== instruction.fallthrough)
          ambiguity = 'target-mismatch';
      } else if (cpu.eip !== instruction.offset + instruction.length)
        ambiguity = 'fallthrough-mismatch';
      if (ambiguity) {
        counts.ambiguousRetirements[ambiguity] =
          (counts.ambiguousRetirements[ambiguity] ?? 0) + 1;
        finish();
        return;
      }
      active.retired++;
      active.next++;
      if (instruction.terminal || active.next === active.instructions.length) finish();
    },
    report() {
      finish();
      return {...counts,
        stepCoveragePercent: counts.code16Steps ?
          100 * counts.decodedSteps / counts.code16Steps : 0};
    },
  };
}
