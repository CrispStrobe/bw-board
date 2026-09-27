// Opt-in, bounded code16 WASM blocks. The ordinary AT machine remains the
// oracle and handles every refused instruction, page walk, fault and event.
import {prevalidateI80386Code16Window as admitCode,
  isI80386Code16WindowValid as validCode} from './i80386-code16-window.js';
import {decodeI80386Code16EA as decodeEA,
  prevalidateI80386Code16EADataWindow as admitEA,
  isI80386Code16EADataWindowValid as validEA} from './i80386-code16-ea.js';
import {createI80386RamBridge} from './i80386-ram-bridge.js';
import {decodeI80386Code16ObservedForm} from './i80386-code16-form-census.js';

const OP = {nop: 0, imm: 1, reg: 2, cmp: 3, load8: 4, load16: 5,
  jz: 6, jnz: 7, cmpMem8: 8, xorReg16: 9, store16: 10};
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

function decodeBlock(machine, maxInstructions, refused = null) {
  const cpu = machine.cpu, start = cpu.eip >>> 0, cs = cpu.segmentCaches[1];
  if (!cs || start > cs.limit) { refused?.('codeAddressLimit'); return null; }
  const linear = (cs.base + start) >>> 0;
  const available = Math.min(64, 4096 - (linear & 0xfff), cs.limit - start + 1);
  const capture = admitCode(machine, start, available);
  if (!capture) { refused?.('codeWindowRefusal'); return null; }
  const bytes = capture.bytes, instructions = [];
  let at = 0, stop = 'codePageEnd';
  while (at < bytes.length && instructions.length < maxInstructions) {
    const op = bytes[at];
    let item;
    if (op === 0x90) item = {op: OP.nop, length: 1};
    else if (op === 0x26) {
      if (at + 3 > bytes.length) { stop = 'truncatedInstruction'; break; }
      const following = bytes[at + 1];
      if (following !== 0x8a && following !== 0x8b && following !== 0x3a) {
        stop = 'unsupportedOpcode'; break;
      }
      const ea = decodeEA(bytes.slice(at + 2), {segmentOverride: 0});
      if (!ea) { stop = 'unsupportedMemoryForm'; break; }
      item = {op: following === 0x8a ? OP.load8 :
        following === 0x8b ? OP.load16 : OP.cmpMem8,
      dst: ea.reg, ea, length: 2 + ea.length};
    }
    else if (op >= 0xb8 && op <= 0xbf) {
      if (at + 3 > bytes.length) { stop = 'truncatedInstruction'; break; }
      item = {op: OP.imm, dst: op & 7, disp: bytes[at + 1] | bytes[at + 2] << 8,
        length: 3};
    } else if ([0x89, 0x8b, 0x39, 0x3b, 0x31, 0x33].includes(op)) {
      if (at + 2 > bytes.length) { stop = 'truncatedInstruction'; break; }
      const modrm = bytes[at + 1], mod = modrm >>> 6;
      if (mod === 3) {
        const reg = (modrm >>> 3) & 7, rm = modrm & 7;
        item = {op: op === 0x89 || op === 0x8b ? OP.reg :
          op === 0x31 || op === 0x33 ? OP.xorReg16 : OP.cmp,
          dst: (op & 2) ? reg : rm, src: (op & 2) ? rm : reg, length: 2};
      } else if (op === 0x89 && (modrm & 0xc7) === 0x06) {
        const ea = decodeEA(bytes.slice(at + 1));
        if (!ea) { stop = 'unsupportedMemoryForm'; break; }
        item = {op: OP.store16, src: ea.reg, ea, length: 1 + ea.length};
      } else if (op === 0x8b) {
        const ea = decodeEA(bytes.slice(at + 1));
        if (!ea) { stop = 'unsupportedMemoryForm'; break; }
        item = {op: OP.load16, dst: ea.reg, ea, length: 1 + ea.length};
      } else { stop = 'unsupportedMemoryForm'; break; }
    } else if (op === 0x8a) {
      const ea = decodeEA(bytes.slice(at + 1));
      if (!ea) { stop = 'unsupportedMemoryForm'; break; }
      item = {op: OP.load8, dst: ea.reg, ea, length: 1 + ea.length};
    } else if (op === 0x74 || op === 0x75) {
      if (at + 2 > bytes.length) { stop = 'truncatedInstruction'; break; }
      const displacement = (bytes[at + 1] << 24) >> 24;
      item = {op: op === 0x74 ? OP.jz : OP.jnz, length: 2,
        target: (start + at + 2 + displacement) & 0xffff,
        targetLimit: cs.limit};
    } else { stop = 'unsupportedOpcode'; break; }
    if (item.length > 15 || at + item.length > bytes.length) {
      stop = 'truncatedInstruction'; break;
    }
    instructions.push(Object.freeze(item));
    at += item.length;
    if (item.op === OP.jz || item.op === OP.jnz || item.op === OP.store16) {
      stop = item.op === OP.store16 ? 'terminalStore' : 'terminalBranch'; break;
    }
  }
  if (instructions.length < 2) {
    const reason = instructions.length ? 'shortBlock' :
      stop === 'unsupportedOpcode' ? 'unsupportedFirstOpcode' : stop;
    refused?.(reason, reason === 'unsupportedFirstOpcode' ? bytes[0] : stop,
      {bytes, at});
    return null;
  }
  const code = admitCode(machine, start, at);
  if (!code) refused?.('codeReproofRefusal');
  return code ? Object.freeze({machine, cpu, start, code,
    instructions: Object.freeze(instructions)}) : null;
}

function prepare(machine, block) {
  if (machine.cpu !== block?.cpu || machine.cpu.eip !== block.start ||
      !validCode(block.code)) return null;
  const ready = [], proofs = [];
  let refusal = null;
  for (const item of block.instructions) {
    const ir = {...item};
    if (item.ea) {
      const write = item.op === OP.store16;
      const proof = admitEA(machine, block.code, item.ea,
        item.op === OP.load16 || write ? 2 : 1, write ? 'write' : 'read');
      // This first store slice is a plain, physically contiguous RAM word.
      // Refuse a crossing before WASM can store either byte.
      if (!proof || !validEA(proof) ||
          (write && (proof.dataWindow.pages.length !== 1 ||
            proof.dataWindow.physicalAddresses[1] !==
              proof.dataWindow.physicalAddresses[0] + 1))) {
        refusal = proof ? 'dataProofInvalidation' : 'dataProofRefusal'; break;
      }
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
  return {ready, proofs, refusal};
}

// Called only after an ordinary eligibility refusal, and only with diagnostics
// enabled. Priority is the same as the admission guard; simultaneous blockers
// are reported by the first matching predicate.
function ineligibleReason(machine) {
  const cpu = machine.cpu;
  if (cpu.segmentCaches[1]?.default32) return 'mode32';
  if (cpu.halted || cpu.shutdown) return 'haltedOrShutdown';
  if (machine._cycleEst !== null || machine._cpuResetPending) return 'cycleOrReset';
  if (cpu.eflags & (0x100 | 0x10000) || cpu.busTrace ||
      cpu._debugRegisters?.some(value => value !== 0)) return 'debugState';
  if (cpu._interruptShadow || cpu._nmiShadow || cpu._debugShadow)
    return 'interruptShadow';
  if (cpu._repeatContext) return 'repeatContext';
  if (cpu.cycles > 0xffffffff - 64) return 'cycleCounterLimit';
  if (machine._chipDebt >= machine._chipDeadline ||
      (machine._lapicTimerInterval && machine.cycles >= machine._lapicTimerNext))
    return 'eventHorizon';
  const apicMode = machine._xv6Mp && machine._mpReady && (cpu.cr0 & 1);
  if (machine._nmiPending ||
      (machine._xv6Mp && machine._lapicTimerPending && (cpu.eflags & 0x200)) ||
      (!apicMode && (cpu.eflags & 0x200) && machine._pic?.intActive))
    return 'pendingInterrupt';
  if (machine._xv6Mp && machine._apicIrqMask && (cpu.eflags & 0x200)) {
    for (let irq = 0; irq < machine._apicIrq.length; irq++) {
      if (!(machine._apicIrqMask & (1 << irq))) continue;
      if (!((machine._ioapic[0x10 + irq * 2] ?? 0) & 0x10000))
        return 'pendingApicIrq';
    }
  }
  return 'unclassifiedEligibility';
}

const bump = (counts, reason) => { counts[reason] = (counts[reason] ?? 0) + 1; };

function boundaryReason(ready, completed, words, stateAt) {
  const item = ready[completed];
  if (!item) return 'wasmGuard';
  if (item.ea) {
    const base = item.base < 8 ? words[stateAt + item.base] & 0xffff : 0;
    const index = item.index < 8 ? words[stateAt + item.index] & 0xffff : 0;
    return ((base + index + item.disp) & 0xffff) !== item.expectedOffset ?
      'dynamicEA' : 'wasmGuard';
  }
  if ((item.op === OP.jz || item.op === OP.jnz) &&
      item.target > item.targetLimit) return 'branchTargetLimit';
  return 'wasmGuard';
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
  maxCachedBlocks = 1024, decodeInstructions = 8, diagnosticReasons = false,
  diagnosticForms = false, diagnosticBranchLinks = false,
} = {}) {
  if (machine?.variant !== '80386' || !machine.cpu ||
      !Number.isInteger(maxCachedBlocks) || maxCachedBlocks < 1 ||
      !Number.isInteger(decodeInstructions) || decodeInstructions < 2 ||
      decodeInstructions > 64 || typeof diagnosticReasons !== 'boolean' ||
      typeof diagnosticForms !== 'boolean' ||
      typeof diagnosticBranchLinks !== 'boolean' ||
      ((diagnosticForms || diagnosticBranchLinks) && !diagnosticReasons))
    throw new TypeError('invalid code16 WASM dispatcher');
  const bridge = machine._experimentalRamBridge ?? await createI80386RamBridge();
  if (!machine._experimentalRamBridge) {
    bridge.attach(machine);
    machine._experimentalRamBridge = bridge;
  }
  const module = await (bundledModule ??= WebAssembly.compile(await moduleBytes()));
  const {exports: wasm} = await WebAssembly.instantiate(module, {env: {memory: bridge.memory}});
  if (bridge.memory.buffer.byteLength !== MEMORY_PAGES * 65536 ||
      wasm.code16_wasm_version() !== 3 ||
      wasm.code16_wasm_capacity() !== 64 ||
      wasm.code16_wasm_bind_ram(bridge.ram.byteOffset, bridge.ram.length) !== 1)
    throw new Error('code16 WASM ABI or RAM mismatch');
  const words = new Uint32Array(bridge.memory.buffer);
  const stateAt = wasm.code16_wasm_state_ptr() >>> 2;
  const programAt = wasm.code16_wasm_program_ptr() >>> 2;
  const blocks = new Map();
  const stats = {attempts: 0, decoded: 0, blockCalls: 0, instructions: 0,
    fallback: 0, boundary: 0};
  const diagnostics = diagnosticReasons ? {fallbacks: {}, exits: {},
    shortBlockStops: {}, unsupportedFirstOpcodes: {},
    preparationTruncations: {}, cacheInvalidations: 0} : null;
  if (diagnosticForms) diagnostics.formCensus = {
    excludedTerminalBranches: 0,
    first26: {forms: {}, lengths: {}, outcomes: {}, calls: 0},
    first66: {forms: {}, lengths: {}, outcomes: {}, calls: 0},
    first8e: {forms: {}, lengths: {}, outcomes: {}, calls: 0},
    shortBlockSequential: {forms: {}, lengths: {}, outcomes: {}, calls: 0},
  };
  if (diagnosticBranchLinks) diagnostics.branchLinks = {
    terminalSingleJcc: 0, firstFetchMismatch: 0, fetchedBytesMismatch: 0,
    didNotRetire: 0, unexpectedSuccessor: 0, modeOrSegmentChange: 0,
    directions: {taken: 0, fallthrough: 0},
    landing: {samePage: 0, otherPage: 0},
    samePage: {candidate: 0, postStepIneligible: 0, codeRefusal: 0,
      shortOrUnsupported: 0, dataRefusal: 0, otherRefusal: 0},
    candidateRefusals: {}, candidateLengths: {},
    candidateKinds: {registerOnly: 0, memoryRead: 0},
  };

  // A diagnostic probe wraps only this ordinary fallback step. It observes
  // the actual fetch bytes without adding a second bus read or retiring code.
  function stepTerminalBranch(branch) {
    const cpu = machine.cpu, census = diagnostics.branchLinks;
    const ownFetch = Object.getOwnPropertyDescriptor(cpu, 'fetch');
    const oldFetch = cpu.fetch, beforeCycles = cpu.cycles;
    const fetched = [];
    let firstFetch = null;
    cpu.fetch = function(physical) {
      if (!firstFetch) firstFetch = {cs: cpu.cs, eip: cpu.eip >>> 0};
      const value = oldFetch.call(this, physical);
      if (fetched.length < 2) fetched.push(value & 255);
      return value;
    };
    try { machine.step(); } finally {
      if (ownFetch) Object.defineProperty(cpu, 'fetch', ownFetch);
      else delete cpu.fetch;
    }
    census.terminalSingleJcc++;
    if (!firstFetch || firstFetch.cs !== branch.cs ||
        firstFetch.eip !== branch.start) { census.firstFetchMismatch++; return; }
    if (fetched[0] !== branch.op || fetched[1] !== branch.dispByte) {
      census.fetchedBytesMismatch++; return;
    }
    if (cpu.cycles !== beforeCycles + 1) { census.didNotRetire++; return; }
    const taken = branch.op === 0x74 ? !!(branch.eflags & 0x40) :
      !(branch.eflags & 0x40);
    const expected = taken ? branch.target : branch.fallthrough;
    if (cpu.cs !== branch.cs || (cpu.eip >>> 0) !== expected) {
      census.unexpectedSuccessor++; return;
    }
    if (cpu.cr0 !== branch.cr0 || cpu.cr3 !== branch.cr3 ||
        cpu.cr4 !== branch.cr4 ||
        cpu._translationGeneration !== branch.translationGeneration ||
        machine._a20Configured !== branch.a20Configured ||
        machine._a20Enabled !== branch.a20Enabled ||
        (cpu.eflags & 0x20000) !== branch.vm ||
        cpu.segmentCaches[1] !== branch.csCache ||
        branch.csCache.base !== branch.csBase ||
        branch.csCache.limit !== branch.csLimit ||
        branch.csCache.default32 !== branch.csDefault32) {
      census.modeOrSegmentChange++; return;
    }
    bump(census.directions, taken ? 'taken' : 'fallthrough');
    const linear = (branch.csBase + expected) >>> 0;
    if ((linear >>> 12) !== branch.linearPage) {
      census.landing.otherPage++; return;
    }
    census.landing.samePage++;
    if (!eligible(machine)) { census.samePage.postStepIneligible++; return; }
    let reason = null;
    const successor = decodeBlock(machine, decodeInstructions,
      value => { reason = value; });
    if (!successor) {
      bump(census.candidateRefusals, reason ?? 'unknown');
      bump(census.samePage, reason === 'codeWindowRefusal' ||
        reason === 'codeAddressLimit' ? 'codeRefusal' :
        reason === 'shortBlock' || reason === 'unsupportedFirstOpcode' ||
        reason === 'unsupportedMemoryForm' ? 'shortOrUnsupported' : 'otherRefusal');
      return;
    }
    const prepared = prepare(machine, successor);
    if (!prepared || prepared.ready.length < 2) {
      census.samePage.dataRefusal++; return;
    }
    census.samePage.candidate++;
    bump(census.candidateLengths, prepared.ready.length);
    census.candidateKinds[prepared.ready.some(item => item.ea) ?
      'memoryRead' : 'registerOnly']++;
  }

  function observeForm(bucket, bytes, at) {
    const form = decodeI80386Code16ObservedForm(bytes, at);
    bucket.calls++;
    bump(bucket.forms, form.key);
    bump(bucket.lengths, form.length ?? 'unknown');
    bump(bucket.outcomes, form.reason);
  }

  function run(maxInstructions = 64) {
    if (!Number.isInteger(maxInstructions) || maxInstructions < 1 || maxInstructions > 64)
      throw new RangeError('invalid code16 block budget');
    const cpu = machine.cpu;
    if (!eligible(machine)) {
      stats.fallback++;
      if (diagnostics) bump(diagnostics.fallbacks, ineligibleReason(machine));
      machine.step(); return 1;
    }
    stats.attempts++;
    const key = `${cpu.cs}:${cpu.eip >>> 0}`;
    let block = blocks.get(key);
    let refusal = null;
    let terminalBranch = null;
    const refused = diagnostics ? (reason, detail, capture) => {
      refusal = reason;
      if (reason === 'shortBlock') bump(diagnostics.shortBlockStops, detail);
      if (reason === 'unsupportedFirstOpcode')
        bump(diagnostics.unsupportedFirstOpcodes, detail);
      if (diagnosticBranchLinks && reason === 'shortBlock' &&
          detail === 'terminalBranch' && capture?.at === 2) {
        const displacement = (capture.bytes[1] << 24) >> 24;
        const start = cpu.eip >>> 0, csCache = cpu.segmentCaches[1];
        terminalBranch = {cs: cpu.cs, start, op: capture.bytes[0],
          dispByte: capture.bytes[1], eflags: cpu.eflags, cr0: cpu.cr0,
          cr3: cpu.cr3, cr4: cpu.cr4,
          translationGeneration: cpu._translationGeneration,
          a20Configured: machine._a20Configured,
          a20Enabled: machine._a20Enabled,
          vm: cpu.eflags & 0x20000, csCache, csBase: csCache.base,
          csLimit: csCache.limit, csDefault32: csCache.default32,
          linearPage: ((csCache.base + start) >>> 0) >>> 12,
          fallthrough: (start + 2) >>> 0,
          target: (start + 2 + displacement) & 0xffff};
      }
      if (diagnosticForms && capture) {
        if (reason === 'shortBlock') {
          if (detail === 'terminalBranch')
            diagnostics.formCensus.excludedTerminalBranches++;
          else observeForm(diagnostics.formCensus.shortBlockSequential,
            capture.bytes, capture.at);
        }
        else if (reason === 'unsupportedFirstOpcode') {
          const bucket = detail === 0x26 ? diagnostics.formCensus.first26 :
            detail === 0x66 ? diagnostics.formCensus.first66 :
            detail === 0x8e ? diagnostics.formCensus.first8e : null;
          if (bucket) observeForm(bucket, capture.bytes, capture.at);
        }
      }
    } : null;
    if (!block || !validCode(block.code)) {
      if (block && diagnostics) diagnostics.cacheInvalidations++;
      block = decodeBlock(machine, decodeInstructions, refused);
      if (block) stats.decoded++;
      if (blocks.size >= maxCachedBlocks) blocks.delete(blocks.keys().next().value);
      blocks.set(key, block);
    }
    const prepared = block && prepare(machine, block);
    if (block && !prepared) refusal = 'codeRevalidationRefusal';
    if (!prepared || prepared.ready.length < 2) {
      stats.fallback++;
      if (diagnostics) bump(diagnostics.fallbacks,
        prepared?.refusal ?? refusal ?? 'shortPreparedBlock');
      if (terminalBranch) stepTerminalBranch(terminalBranch);
      else machine.step();
      return 1;
    }
    if (diagnostics && prepared.refusal)
      bump(diagnostics.preparationTruncations, prepared.refusal);
    const charge = machine.functionalInstructionCycles;
    const budget = Math.min(maxInstructions, prepared.ready.length,
      Math.ceil((machine._chipDeadline - machine._chipDebt) / charge),
      machine._lapicTimerInterval
        ? Math.ceil((machine._lapicTimerNext - machine.cycles) / charge) : 64);
    if (budget < 1) {
      stats.fallback++;
      if (diagnostics) bump(diagnostics.fallbacks, 'eventBudget');
      machine.step(); return 1;
    }
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
    const exit = diagnostics ? reason === 3 ?
      boundaryReason(prepared.ready, completed, words, stateAt) :
      reason === 1 ? 'eventBudget' : reason === 2 ? 'wasmGuard' : 'completed' : null;
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
      if (diagnostics) bump(diagnostics.exits, exit);
      return completed;
    }
    stats.fallback++;
    if (diagnostics) bump(diagnostics.fallbacks, exit);
    machine.step();
    return 1;
  }
  return {run, stats, diagnostics, ramBridge: bridge};
}
