// Opt-in, bounded code16 WASM blocks. The ordinary AT machine remains the
// oracle and handles every refused instruction, page walk, fault and event.
import {prevalidateI80386Code16Window as admitCode,
  isI80386Code16WindowValid as validCode} from './i80386-code16-window.js';
import {decodeI80386Code16EA as decodeEA,
  prevalidateI80386Code16EADataWindow as admitEA,
  isI80386Code16EADataWindowValid as validEA} from './i80386-code16-ea.js';
import {createI80386RamBridge} from './i80386-ram-bridge.js';

const OP = {nop: 0, imm: 1, reg: 2, cmp: 3, load8: 4, load16: 5,
  jz: 6, jnz: 7};
const REG = {bx: 3, bp: 5, si: 6, di: 7};
const WORDS = 12;
const MEMORY_PAGES = 258;
let bundledModule;

async function moduleBytes() {
  const url = new URL('../../wasm/i80386-code16-wasm.wasm', import.meta.url);
  if (url.protocol !== 'file:') {
    const response = await fetch(url);
    if (!response.ok) throw new Error('code16 WASM fetch failed');
    return new Uint8Array(await response.arrayBuffer());
  }
  const {readFile} = await import('node:fs/promises');
  return readFile(url);
}

function decodeBlock(machine, maxInstructions) {
  const cpu = machine.cpu, start = cpu.eip >>> 0, cs = cpu.segmentCaches[1];
  if (!cs || start > cs.limit) return null;
  const linear = (cs.base + start) >>> 0;
  const available = Math.min(64, 4096 - (linear & 0xfff), cs.limit - start + 1);
  const capture = admitCode(machine, start, available);
  if (!capture) return null;
  const bytes = capture.bytes, instructions = [];
  let at = 0;
  while (at < bytes.length && instructions.length < maxInstructions) {
    const op = bytes[at];
    let item;
    if (op === 0x90) item = {op: OP.nop, length: 1};
    else if (op >= 0xb8 && op <= 0xbf) {
      if (at + 3 > bytes.length) break;
      item = {op: OP.imm, dst: op & 7, disp: bytes[at + 1] | bytes[at + 2] << 8,
        length: 3};
    } else if ([0x89, 0x8b, 0x39, 0x3b].includes(op)) {
      if (at + 2 > bytes.length) break;
      const modrm = bytes[at + 1], mod = modrm >>> 6;
      if (mod === 3) {
        const reg = (modrm >>> 3) & 7, rm = modrm & 7;
        item = {op: op === 0x89 || op === 0x8b ? OP.reg : OP.cmp,
          dst: (op & 2) ? reg : rm, src: (op & 2) ? rm : reg, length: 2};
      } else if (op === 0x8b) {
        const ea = decodeEA(bytes.slice(at + 1));
        if (!ea) break;
        item = {op: OP.load16, dst: ea.reg, ea, length: 1 + ea.length};
      } else break;
    } else if (op === 0x8a) {
      const ea = decodeEA(bytes.slice(at + 1));
      if (!ea) break;
      item = {op: OP.load8, dst: ea.reg, ea, length: 1 + ea.length};
    } else if (op === 0x74 || op === 0x75) {
      if (at + 2 > bytes.length) break;
      const displacement = (bytes[at + 1] << 24) >> 24;
      item = {op: op === 0x74 ? OP.jz : OP.jnz, length: 2,
        target: (start + at + 2 + displacement) & 0xffff,
        targetLimit: cs.limit};
    } else break;
    if (item.length > 15 || at + item.length > bytes.length) break;
    instructions.push(Object.freeze(item));
    at += item.length;
    if (item.op === OP.jz || item.op === OP.jnz) break;
  }
  if (instructions.length < 2) return null;
  const code = admitCode(machine, start, at);
  return code ? Object.freeze({machine, cpu, start, code,
    instructions: Object.freeze(instructions)}) : null;
}

function prepare(machine, block) {
  if (machine.cpu !== block?.cpu || machine.cpu.eip !== block.start ||
      !validCode(block.code)) return null;
  const ready = [], proofs = [];
  for (const item of block.instructions) {
    const ir = {...item};
    if (item.ea) {
      const proof = admitEA(machine, block.code, item.ea,
        item.op === OP.load8 ? 1 : 2, 'read');
      if (!proof || !validEA(proof)) break;
      proofs.push(proof);
      ir.base = item.ea.terms[0] === undefined ? 8 : REG[item.ea.terms[0]];
      ir.index = item.ea.terms[1] === undefined ? 8 : REG[item.ea.terms[1]];
      ir.disp = item.ea.displacement;
      ir.expectedOffset = proof.ea.off;
      ir.physical0 = proof.dataWindow.physicalAddresses[0];
      ir.physical1 = proof.dataWindow.physicalAddresses[1] ?? 0;
    }
    ready.push(ir);
  }
  return ready.length ? {ready, proofs} : null;
}

function eligible(machine) {
  const cpu = machine.cpu;
  if (cpu.segmentCaches[1]?.default32 || cpu.halted || cpu.shutdown ||
      machine._cycleEst !== null || machine._cpuResetPending ||
      (cpu.eflags & (0x100 | 0x10000)) || cpu._interruptShadow ||
      cpu._nmiShadow || cpu._debugShadow || cpu._repeatContext || cpu.busTrace ||
      cpu._debugRegisters?.some(value => value !== 0) ||
      cpu.cycles > 0xffffffff - 64 || machine._chipDebt >= machine._chipDeadline)
    return false;
  const apicMode = machine._xv6Mp && machine._mpReady && (cpu.cr0 & 1);
  if (machine._nmiPending ||
      (machine._xv6Mp && machine._lapicTimerPending && (cpu.eflags & 0x200)) ||
      (!apicMode && (cpu.eflags & 0x200) && machine._pic?.intActive) ||
      (machine._lapicTimerInterval && machine.cycles >= machine._lapicTimerNext))
    return false;
  if (machine._xv6Mp && machine._apicIrqMask && (cpu.eflags & 0x200)) {
    for (let irq = 0; irq < machine._apicIrq.length; irq++) {
      if (!(machine._apicIrqMask & (1 << irq))) continue;
      if (!((machine._ioapic[0x10 + irq * 2] ?? 0) & 0x10000)) return false;
    }
  }
  return true;
}

/** Separate opt-in dispatcher; never changes the production GUI/CPU path. */
export async function createI80386Code16WasmDispatcher(machine, {
  maxCachedBlocks = 1024, decodeInstructions = 8,
} = {}) {
  if (machine?.variant !== '80386' || !machine.cpu ||
      !Number.isInteger(maxCachedBlocks) || maxCachedBlocks < 1 ||
      !Number.isInteger(decodeInstructions) || decodeInstructions < 2 ||
      decodeInstructions > 64)
    throw new TypeError('invalid code16 WASM dispatcher');
  const bridge = machine._experimentalRamBridge ?? await createI80386RamBridge();
  if (!machine._experimentalRamBridge) {
    bridge.attach(machine);
    machine._experimentalRamBridge = bridge;
  }
  const module = await (bundledModule ??= WebAssembly.compile(await moduleBytes()));
  const {exports: wasm} = await WebAssembly.instantiate(module, {env: {memory: bridge.memory}});
  if (bridge.memory.buffer.byteLength !== MEMORY_PAGES * 65536 ||
      wasm.code16_wasm_version() !== 1 ||
      wasm.code16_wasm_capacity() !== 64 ||
      wasm.code16_wasm_bind_ram(bridge.ram.byteOffset, bridge.ram.length) !== 1)
    throw new Error('code16 WASM ABI or RAM mismatch');
  const words = new Uint32Array(bridge.memory.buffer);
  const stateAt = wasm.code16_wasm_state_ptr() >>> 2;
  const programAt = wasm.code16_wasm_program_ptr() >>> 2;
  const blocks = new Map();
  const stats = {attempts: 0, decoded: 0, blockCalls: 0, instructions: 0,
    fallback: 0, boundary: 0};

  function run(maxInstructions = 64) {
    if (!Number.isInteger(maxInstructions) || maxInstructions < 1 || maxInstructions > 64)
      throw new RangeError('invalid code16 block budget');
    const cpu = machine.cpu;
    if (!eligible(machine)) { stats.fallback++; machine.step(); return 1; }
    stats.attempts++;
    const key = `${cpu.cs}:${cpu.eip >>> 0}`;
    let block = blocks.get(key);
    if (!block || !validCode(block.code)) {
      block = decodeBlock(machine, decodeInstructions);
      if (block) stats.decoded++;
      if (blocks.size >= maxCachedBlocks) blocks.delete(blocks.keys().next().value);
      blocks.set(key, block);
    }
    const prepared = block && prepare(machine, block);
    if (!prepared || prepared.ready.length < 2) {
      stats.fallback++; machine.step(); return 1;
    }
    const charge = machine.functionalInstructionCycles;
    const budget = Math.min(maxInstructions, prepared.ready.length,
      Math.ceil((machine._chipDeadline - machine._chipDebt) / charge),
      machine._lapicTimerInterval
        ? Math.ceil((machine._lapicTimerNext - machine.cycles) / charge) : 64);
    if (budget < 1) { stats.fallback++; machine.step(); return 1; }
    const regs = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
    regs.forEach((name, i) => { words[stateAt + i] = cpu[name] >>> 0; });
    words[stateAt + 8] = cpu.eip >>> 0;
    words[stateAt + 9] = cpu.eflags >>> 0;
    words[stateAt + 10] = cpu.cycles >>> 0;
    prepared.ready.forEach((ir, i) => {
      const fields = [ir.op, ir.dst ?? 0, ir.src ?? 0, ir.length,
        ir.base ?? 8, ir.index ?? 8, ir.disp ?? 0, ir.expectedOffset ?? 0,
        ir.physical0 ?? 0, ir.physical1 ?? 0, ir.target ?? 0,
        ir.targetLimit ?? 0];
      fields.forEach((value, j) => { words[programAt + i * WORDS + j] = value >>> 0; });
    });
    const packed = wasm.code16_wasm_run(prepared.ready.length, budget) >>> 0;
    const completed = packed & 0xffffff, reason = packed >>> 24;
    if (completed > budget || reason > 3) throw new Error('invalid code16 WASM exit');
    if (completed) {
      regs.forEach((name, i) => { cpu[name] = words[stateAt + i]; });
      cpu.eip = words[stateAt + 8];
      cpu.eflags = words[stateAt + 9];
      cpu.cycles = words[stateAt + 10];
      const cycles = completed * charge;
      machine.cycles += cycles;
      machine._chipDebt += cycles;
      stats.blockCalls++;
      stats.instructions += completed;
      if (reason === 3) stats.boundary++;
      return completed;
    }
    stats.fallback++;
    machine.step();
    return 1;
  }
  return {run, stats, ramBridge: bridge};
}
