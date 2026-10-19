// Narrow, opt-in execution of unprefixed MOV r8/r16, r/m memory loads.
// All refusal paths leave the CPU untouched so its ordinary step can fault.
import {prevalidateI80386Code16Window,
  isI80386Code16WindowValid} from './i80386-code16-window.js';
import {decodeI80386Code16EA, prevalidateI80386Code16EADataWindow,
  isI80386Code16EADataWindowValid} from './i80386-code16-ea.js';

export function enableI80386Code16LoadExecution(machine) {
  if (machine?.variant !== '80386' || !machine.cpu ||
      machine.code16LoadExecutions !== undefined)
    throw new TypeError('code16 load execution requires a fresh 386 AT machine');
  const cpu = machine.cpu;
  const ordinaryStepInstruction = cpu._stepInstruction.bind(cpu);
  machine.code16LoadExecutions = 0;
  cpu._stepInstruction = () =>
    tryI80386Code16Load(machine) ?? ordinaryStepInstruction();
  return machine;
}

export function tryI80386Code16Load(machine) {
  const cpu = machine.cpu;
  if (cpu.halted || cpu.shutdown || (cpu.eflags & (0x100 | 0x10000)) ||
      cpu._debugShadow || cpu._interruptShadow || cpu._nmiShadow ||
      cpu.busTrace || machine._cycleEst ||
      cpu._debugRegisters?.some(value => value !== 0)) return null;
  const start = cpu.eip >>> 0;
  const head = prevalidateI80386Code16Window(machine, start, 2);
  if (!head) return null;
  const opcode = head.bytes[0], modrm = head.bytes[1];
  if ((opcode !== 0x8a && opcode !== 0x8b) || (modrm & 0xc0) === 0xc0)
    return null;
  const mod = modrm >>> 6, rm = modrm & 7;
  const length = 1 + (mod === 0 && rm !== 6 ? 1 : mod === 1 ? 2 : 3);
  const code = length === 2 ? head : prevalidateI80386Code16Window(machine, start, length);
  if (!code) return null;
  const descriptor = decodeI80386Code16EA(code.bytes.slice(1));
  if (!descriptor || descriptor.length + 1 !== length) return null;
  const width = opcode === 0x8a ? 1 : 2;
  const operand = prevalidateI80386Code16EADataWindow(
    machine, code, descriptor, width, 'read');
  if (!operand || cpu.eip !== start ||
      !isI80386Code16WindowValid(code) ||
      !isI80386Code16EADataWindowValid(operand)) return null;

  // The proof names actual physical bytes, including a possible page crossing.
  // Read now: data is deliberately not captured by admission.
  const physical = operand.dataWindow.physicalAddresses;
  const value = machine.mem[physical[0]] |
    (width === 2 ? machine.mem[physical[1]] << 8 : 0);
  cpu._instructionBytes = length;
  cpu.eip = start + length;
  if (width === 1) cpu._setReg8(descriptor.reg, value);
  else cpu._setReg(descriptor.reg, 16, value);
  cpu.cycles++;
  machine.code16LoadExecutions++;
  return 1;
}
