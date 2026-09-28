// Opt-in bounded 386 dynamic-memory contract. The regular AT/native dispatcher
// does not call this. No page walk, fault, MMIO, or code write happens in WASM.
import {prevalidateI80386ReadWindow, isI80386ReadWindowValid} from
  './i80386-read-window.js';

const RAM_BYTES = 1 << 24;
const MEMORY_PAGES = 258;
const FLAG_USER = 1, FLAG_WRITABLE = 2, FLAG_DIRTY = 4, FLAG_STORE_OK = 8;
const REASONS = ['done', 'event', 'slow-exit', 'unsupported'];
const REG = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
let bundledModule;

async function moduleBytes() {
  const url = new URL('../../wasm/i80386-dynamic-memory-spike.wasm', import.meta.url);
  if (url.protocol !== 'file:') {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`dynamic-memory WASM fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const {readFile} = await import('node:fs/promises');
  return readFile(url);
}

export async function createI80386DynamicMemorySpike(machine, ramBridge) {
  const cpu = machine?.cpu;
  if (machine?.variant !== '80386' || !cpu ||
      machine.mem?.buffer !== ramBridge?.memory?.buffer ||
      machine.mem.byteOffset !== ramBridge.ram?.byteOffset ||
      machine.mem.length !== machine.memoryBytes ||
      ramBridge.memory.buffer.byteLength !== MEMORY_PAGES * 65536)
    throw new TypeError('dynamic-memory spike needs a shared-RAM 386 AT machine');
  const module = bundledModule ??= WebAssembly.compile(await moduleBytes());
  const {exports: wasm} = await WebAssembly.instantiate(await module,
    {env: {memory:ramBridge.memory}});
  if (wasm.dynamic_memory_version() !== 1 ||
      wasm.dynamic_memory_capacity() !== 16 ||
      wasm.dynamic_memory_bind_ram(ramBridge.ram.byteOffset, RAM_BYTES) !== 1)
    throw new Error('dynamic-memory spike ABI mismatch');
  const words = new Uint32Array(ramBridge.memory.buffer);
  const stateAt = wasm.dynamic_memory_state_ptr() >>> 2;
  const programAt = wasm.dynamic_memory_program_ptr() >>> 2;
  const mirrored = new Map();
  const cachedCodePages = new Set();
  const stats = {mirrors:0, validityChecks:0, invalidations:0,
    blockCalls:0, retired:0, slowExits:0};

  function remove(page) {
    if (!mirrored.delete(page)) return;
    wasm.dynamic_memory_invalidate(page);
    stats.invalidations++;
  }
  function mapping(page) {
    const entry = cpu._translations?.[page & 511];
    if (!entry || entry.generation !== cpu._translationGeneration ||
        entry.page !== page || entry.cr3 !== cpu.cr3 || entry.cr4 !== cpu.cr4 ||
        !cpu._translationCacheEnabled || !cpu.protectedMode || cpu.virtual8086 ||
        !(cpu.cr0 & 0x80000000) ||
        (machine._a20Configured && !machine._a20Enabled)) return null;
    const physical = entry.physicalBase >>> 0;
    if ((physical & 4095) || physical < 0x100000 ||
        physical + 4096 > machine.memoryBytes ||
        machine._page?.[physical >>> 12] !== 1) return null;
    const flags = (entry.userPage ? FLAG_USER : 0) |
      (entry.writable ? FLAG_WRITABLE : 0) |
      (entry.dirty ? FLAG_DIRTY : 0) |
      (entry.writable && entry.dirty &&
       !cpu._translationTablePages?.has(physical >>> 12) &&
       !cachedCodePages.has(physical) ? FLAG_STORE_OK : 0);
    return {entry, physical, flags};
  }
  function mirrorCachedPage(linearAddress) {
    if (!Number.isInteger(linearAddress) || linearAddress < 0 ||
        linearAddress > 0xffffffff) return false;
    const page = linearAddress >>> 12;
    const next = mapping(page);
    if (!next) {remove(page); return false;}
    const collision = page & 63;
    for (const oldPage of mirrored.keys())
      if ((oldPage & 63) === collision && oldPage !== page) remove(oldPage);
    wasm.dynamic_memory_mirror(page, next.physical,
      cpu._translationGeneration, cpu.cr3, cpu.cr4, next.flags);
    mirrored.set(page, next);
    stats.mirrors++;
    return true;
  }
  function validateMirrors() {
    // Bounded O(mirrored entries), never a full 512-entry JS TLB copy.
    for (const [page, previous] of mirrored) {
      stats.validityChecks++;
      const next = mapping(page);
      if (!next || next.entry !== previous.entry ||
          next.physical !== previous.physical) remove(page);
      else if (next.flags !== previous.flags) mirrorCachedPage(page * 4096);
    }
  }
  function registerCachedCodePage(physicalPage) {
    if (!Number.isInteger(physicalPage) || (physicalPage & 4095) ||
        physicalPage < 0x100000 || physicalPage + 4096 > machine.memoryBytes ||
        machine._page?.[physicalPage >>> 12] !== 1)
      throw new RangeError('cached code page must be aligned ordinary RAM');
    cachedCodePages.add(physicalPage);
    validateMirrors();
  }
  function decode(maxInstructions = 16) {
    if (!Number.isInteger(maxInstructions) || maxInstructions < 1 ||
        maxInstructions > 16 || !cpu.protectedMode || cpu.virtual8086 ||
        !cpu.segmentCaches[1]?.default32) return null;
    const startEip = cpu.eip >>> 0;
    const codeWindow = prevalidateI80386ReadWindow(machine, startEip, 1);
    if (!codeWindow) return null;
    const startPhysical = codeWindow.physicalPage +
      (startEip - codeWindow.linearPage);
    const endPhysical = codeWindow.physicalPage + 4096;
    const instructions = [];
    let at = startPhysical;
    while (instructions.length < maxInstructions && at + 1 < endPhysical) {
      const opcode = machine.mem[at], modrm = machine.mem[at + 1];
      const mod = modrm >>> 6, base = modrm & 7;
      if ((opcode !== 0x8b && opcode !== 0x89) || mod !== 0 ||
          base === 4 || base === 5) break;
      instructions.push({op:opcode === 0x8b ? 1 : 2,
        reg:(modrm >>> 3) & 7,base,disp:0,length:2});
      at += 2;
    }
    if (!instructions.length) return null;
    cachedCodePages.add(codeWindow.physicalPage);
    validateMirrors();
    return {machine,cpu,cs:cpu.cs,startEip,codeWindow,startPhysical,
      bytes:machine.mem.slice(startPhysical,at),instructions};
  }
  function validBlock(block) {
    if (!block || block.machine !== machine || block.cpu !== cpu ||
        block.cs !== cpu.cs || block.startEip !== cpu.eip ||
        !isI80386ReadWindowValid(block.codeWindow)) return false;
    for (let i=0;i<block.bytes.length;i++)
      if (machine.mem[block.startPhysical+i] !== block.bytes[i]) return false;
    return true;
  }
  function run(block, maxInstructions = 16) {
    if (!Number.isInteger(maxInstructions) || maxInstructions < 1 ||
        maxInstructions > 16) throw new RangeError('dynamic-memory budget must be 1 through 16');
    const ds = cpu.segmentCaches[3];
    if (!validBlock(block) || !cachedCodePages.has(block.codeWindow.physicalPage) ||
        !ds || ds.null || !ds.present || ds.code || !ds.readable ||
        (block?.instructions?.some(ins => ins.op === 2) && !ds.writable) ||
        ds.base !== 0 || ds.expandDown || ds.limit !== 0xffffffff ||
        !cpu.protectedMode || cpu.virtual8086 || !cpu.segmentCaches[1]?.default32 ||
        cpu.halted || cpu.shutdown || machine._cycleEst !== null ||
        (cpu.eflags & (0x100 | 0x10000)) || cpu._interruptShadow ||
        cpu._nmiShadow || cpu._debugShadow || cpu._repeatContext ||
        cpu.busTrace || machine._cpuResetPending || cpu.cycles > 0xffffffff-16)
      return {instructions:0,reason:'fallback'};
    if (machine._chipDebt >= machine._chipDeadline)
      return {instructions:0,reason:'event'};
    const apicMode = machine._xv6Mp && machine._mpReady && (cpu.cr0 & 1);
    let apicIrqReady = false;
    if (machine._xv6Mp && machine._apicIrqMask && (cpu.eflags & 0x200)) {
      for (let irq=0;irq<machine._apicIrq.length;irq++) {
        if (!(machine._apicIrqMask & (1 << irq))) continue;
        const low = machine._ioapic[0x10 + irq * 2] ?? 0;
        if (!(low & 0x10000)) {apicIrqReady=true;break;}
      }
    }
    if (machine._nmiPending ||
        (machine._xv6Mp && machine._lapicTimerPending && (cpu.eflags & 0x200)) ||
        apicIrqReady ||
        (!apicMode && (cpu.eflags & 0x200) && machine._pic?.intActive) ||
        (machine._lapicTimerInterval && machine.cycles >= machine._lapicTimerNext))
      return {instructions:0,reason:'fallback'};
    const charge = machine.functionalInstructionCycles;
    const budget = Math.min(maxInstructions, block.instructions.length,
      Math.ceil((machine._chipDeadline-machine._chipDebt)/charge),
      machine._lapicTimerInterval
        ? Math.ceil((machine._lapicTimerNext-machine.cycles)/charge) : 16);
    if (budget < 1) return {instructions:0,reason:'event'};
    validateMirrors();
    for (let i=0;i<8;i++) words[stateAt+i] = cpu[REG[i]] >>> 0;
    words[stateAt+8] = cpu.eip >>> 0;
    words[stateAt+9] = cpu.eflags >>> 0;
    words[stateAt+10] = cpu.cycles >>> 0;
    for (let i=0;i<block.instructions.length;i++) {
      const ins=block.instructions[i], at=programAt+i*5;
      words[at]=ins.op;words[at+1]=ins.reg;words[at+2]=ins.base;
      words[at+3]=ins.disp;words[at+4]=ins.length;
    }
    const packed = wasm.dynamic_memory_run(block.instructions.length,budget,
      cpu._translationGeneration,cpu.cr3,cpu.cr4,
      cpu.currentPrivilegeLevel === 3 ? 1 : 0);
    const completed = packed & 0xffffff;
    const reason = REASONS[packed >>> 24] ?? 'invalid';
    if (completed) {
      for (let i=0;i<8;i++) cpu[REG[i]] = words[stateAt+i];
      cpu.eip=words[stateAt+8];cpu.eflags=words[stateAt+9];
      cpu.cycles=words[stateAt+10];
      const cycles=completed*charge;
      machine.cycles+=cycles;machine._chipDebt+=cycles;
      stats.blockCalls++;stats.retired+=completed;
    }
    if (reason === 'slow-exit') stats.slowExits++;
    return {instructions:completed,reason};
  }
  return {mirrorCachedPage,registerCachedCodePage,decode,run,stats};
}
