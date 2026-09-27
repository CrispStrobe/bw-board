// Experimental shared backing for the board and a future WASM CPU. This
// changes no execution path by itself; the JavaScript CPU remains authoritative.
let bundledModule;

async function moduleBytes() {
  const url = new URL('../../wasm/i80386-ram-bridge.wasm', import.meta.url);
  if (url.protocol !== 'file:') {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`i80386 RAM bridge fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const {readFile} = await import('node:fs/promises');
  return readFile(url);
}

export async function createI80386RamBridge({wasmBytes} = {}) {
  const module = wasmBytes
    ? await WebAssembly.compile(wasmBytes)
    : await (bundledModule ??= WebAssembly.compile(await moduleBytes()));
  const {exports: wasm} = await WebAssembly.instantiate(module);
  if (wasm.ram_bridge_version?.() !== 1)
    throw new Error('i80386 RAM bridge ABI mismatch');
  const pointer = wasm.ram_bridge_ptr() >>> 0;
  const capacity = wasm.ram_bridge_capacity() >>> 0;
  if (!(wasm.memory instanceof WebAssembly.Memory) || capacity !== 1 << 24 ||
      pointer + capacity > wasm.memory.buffer.byteLength)
    throw new Error('i80386 RAM bridge has an invalid memory export');
  const ram = new Uint8Array(wasm.memory.buffer, pointer, capacity);
  let attached = null;
  return {
    memory: wasm.memory,
    ram,
    attach(machine) {
      if (attached || machine?.variant !== '80386' ||
          !(machine.mem instanceof Uint8Array) ||
          !Number.isInteger(machine.memoryBytes) ||
          machine.memoryBytes < 1 << 20 || machine.memoryBytes > capacity ||
          machine.mem.length !== machine.memoryBytes)
        throw new TypeError('i80386 RAM bridge needs one unattached 386 AT machine');
      const boardRam = new Uint8Array(wasm.memory.buffer, pointer, machine.memoryBytes);
      boardRam.set(machine.mem);
      machine.mem = boardRam;
      attached = machine;
      return boardRam;
    },
  };
}
