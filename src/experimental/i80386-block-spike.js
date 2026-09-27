// Bounded execution-contract spike. This is not a board CPU backend.
const REASONS = ['done', 'event', 'unsupported', 'fault-boundary'];
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

export async function createI80386BlockSpike({wasmBytes} = {}) {
  const module = wasmBytes
    ? await WebAssembly.compile(wasmBytes)
    : await (bundledModule ??= WebAssembly.compile(await moduleBytes()));
  const {exports: wasm} = await WebAssembly.instantiate(module);
  if (wasm.block_spike_version() !== 1) throw new Error('i80386 block spike ABI mismatch');
  const words = new Uint32Array(wasm.memory.buffer);
  const stateAt = wasm.block_spike_state_ptr() >>> 2;
  const programAt = wasm.block_spike_program_ptr() >>> 2;
  const capacity = wasm.block_spike_capacity();
  return {
    capacity,
    setState({regs, eip = 0, eflags = 2, cycles = 0}) {
      if (!Array.isArray(regs) || regs.length !== 8)
        throw new TypeError('i80386 block spike needs eight registers');
      for (let i = 0; i < 8; i++) words[stateAt + i] = regs[i] >>> 0;
      words[stateAt + 8] = eip >>> 0;
      words[stateAt + 9] = eflags >>> 0;
      words[stateAt + 10] = cycles >>> 0;
    },
    state() {
      return {regs: Array.from(words.slice(stateAt, stateAt + 8)),
        eip: words[stateAt + 8], eflags: words[stateAt + 9], cycles: words[stateAt + 10]};
    },
    setProgram(instructions) {
      if (!Array.isArray(instructions) || instructions.length > capacity)
        throw new RangeError('i80386 block spike program exceeds fixed capacity');
      for (let i = 0; i < instructions.length; i++) {
        const {op, dst = 0, src = 0, width = 32, length = 1} = instructions[i];
        const at = programAt + i * 5;
        words[at] = op >>> 0;
        words[at + 1] = dst >>> 0;
        words[at + 2] = src >>> 0;
        words[at + 3] = width >>> 0;
        words[at + 4] = length >>> 0;
      }
    },
    run(start, end, eventBudget) {
      const result = wasm.block_spike_run(start >>> 0, end >>> 0, eventBudget >>> 0);
      return {reason: REASONS[result >>> 24] ?? 'invalid', completed: result & 0xffffff};
    },
  };
}
