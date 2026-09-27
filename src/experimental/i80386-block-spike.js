// Bounded execution-contract spike. This is not a board CPU backend.
const REASONS = ['done', 'event', 'unsupported', 'fault-boundary'];
const RAM_BYTES = 1 << 24;
const MEMORY_PAGES = 258;
let bundledModule;

async function moduleBytes() {
  const url = new URL('../../wasm/i80386-block-spike.wasm', import.meta.url);
  if (url.protocol !== 'file:') {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`i80386 block spike fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const {readFile} = await import('node:fs/promises');
  return readFile(url);
}

export async function createI80386BlockSpike({wasmBytes, ramBridge} = {}) {
  const module = wasmBytes
    ? await WebAssembly.compile(wasmBytes)
    : await (bundledModule ??= WebAssembly.compile(await moduleBytes()));
  const memory = ramBridge?.memory ?? new WebAssembly.Memory({initial: MEMORY_PAGES, maximum: MEMORY_PAGES});
  if (!(memory instanceof WebAssembly.Memory) || memory.buffer.byteLength !== MEMORY_PAGES * 65536)
    throw new TypeError('i80386 block spike needs the fixed shared memory layout');
  const {exports: wasm} = await WebAssembly.instantiate(module, {env: {memory}});
  if (wasm.block_spike_version() !== 5) throw new Error('i80386 block spike ABI mismatch');
  const words = new Uint32Array(memory.buffer);
  const stateAt = wasm.block_spike_state_ptr() >>> 2;
  const programAt = wasm.block_spike_program_ptr() >>> 2;
  const capacity = wasm.block_spike_capacity();
  const ram = ramBridge?.ram ?? new Uint8Array(memory.buffer, 1024, RAM_BYTES);
  if (!(ram instanceof Uint8Array) || ram.buffer !== memory.buffer ||
      ram.length !== RAM_BYTES ||
      wasm.block_spike_bind_ram(ram.byteOffset, ram.length) !== 1)
    throw new TypeError('i80386 block spike needs guest RAM below its private state');
  return {
    capacity, memory, ram,
    setState({regs, eip = 0, eflags = 2, cycles = 0}) {
      if (!Array.isArray(regs) || regs.length !== 8)
        throw new TypeError('i80386 block spike needs eight registers');
      for (let i = 0; i < 8; i++) words[stateAt + i] = regs[i] >>> 0;
      words[stateAt + 8] = eip >>> 0;
      words[stateAt + 9] = eflags >>> 0;
      words[stateAt + 10] = cycles >>> 0;
    },
    setCpuState(cpu) {
      words[stateAt] = cpu.eax >>> 0;
      words[stateAt + 1] = cpu.ecx >>> 0;
      words[stateAt + 2] = cpu.edx >>> 0;
      words[stateAt + 3] = cpu.ebx >>> 0;
      words[stateAt + 4] = cpu.esp >>> 0;
      words[stateAt + 5] = cpu.ebp >>> 0;
      words[stateAt + 6] = cpu.esi >>> 0;
      words[stateAt + 7] = cpu.edi >>> 0;
      words[stateAt + 8] = cpu.eip >>> 0;
      words[stateAt + 9] = cpu.eflags >>> 0;
      words[stateAt + 10] = cpu.cycles >>> 0;
    },
    copyStateToCpu(cpu) {
      cpu.eax = words[stateAt];
      cpu.ecx = words[stateAt + 1];
      cpu.edx = words[stateAt + 2];
      cpu.ebx = words[stateAt + 3];
      cpu.esp = words[stateAt + 4];
      cpu.ebp = words[stateAt + 5];
      cpu.esi = words[stateAt + 6];
      cpu.edi = words[stateAt + 7];
      cpu.eip = words[stateAt + 8];
      cpu.eflags = words[stateAt + 9];
      cpu.cycles = words[stateAt + 10];
    },
    state() {
      return {regs: Array.from(words.slice(stateAt, stateAt + 8)),
        eip: words[stateAt + 8], eflags: words[stateAt + 9], cycles: words[stateAt + 10]};
    },
    setProgram(instructions) {
      if (!Array.isArray(instructions) || instructions.length > capacity)
        throw new RangeError('i80386 block spike program exceeds fixed capacity');
      for (let i = 0; i < instructions.length; i++) {
        const {op, dst = 0, src = 0, width = 32, length = 1,
          base = 8, index = 8, scale = 0, disp = 0, lo = 0, hi = 0} = instructions[i];
        const at = programAt + i * 11;
        words[at] = op >>> 0;
        words[at + 1] = dst >>> 0;
        words[at + 2] = src >>> 0;
        words[at + 3] = width >>> 0;
        words[at + 4] = length >>> 0;
        words[at + 5] = base >>> 0;
        words[at + 6] = index >>> 0;
        words[at + 7] = scale >>> 0;
        words[at + 8] = disp >>> 0;
        words[at + 9] = lo >>> 0;
        words[at + 10] = hi >>> 0;
      }
    },
    run(start, end, eventBudget) {
      if (!Number.isInteger(eventBudget) || eventBudget < 0 || eventBudget > 64)
        throw new RangeError('i80386 block spike event budget must be 0 through 64');
      const result = wasm.block_spike_run(start >>> 0, end >>> 0, eventBudget >>> 0);
      return {reason: REASONS[result >>> 24] ?? 'invalid', completed: result & 0xffffff};
    },
  };
}
