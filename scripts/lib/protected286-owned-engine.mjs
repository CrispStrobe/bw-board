import ProtectedI80286 from "../../src/experimental/i80286-protected.js";

const FLAGS_MASK = 0x7fd7;

export function createOwnedExternal286Engine() {
  const memory = new Uint8Array(1 << 24);
  let input = () => 0xff;
  const cpu = new ProtectedI80286(
    {
      read: (address) => memory[address] ?? 0xff,
      fetch: (address) => memory[address] ?? 0xff,
      write: (address, value) => (memory[address] = value),
      in: (port) => input(port),
    },
    { deliverProtectedFaults: true },
  );
  return {
    memorySize: memory.length,
    clear: () => memory.fill(0),
    read: (address) => memory[address] ?? 0xff,
    write: (address, value) => (memory[address] = value),
    range: (address, length) => memory.subarray(address, address + length),
    video: () => memory.subarray(0xb8000, 0xb8000 + 4000),
    textRow: (row) =>
      String.fromCharCode(
        ...Array.from(
          { length: 80 },
          (_, column) => memory[0xb8000 + (row * 80 + column) * 2],
        ),
      ),
    setRetraceInput: (handler) =>
      (input = (port) => (port === 0x3da ? handler() : 0xff)),
    boot: () => {
      cpu.reset();
      Object.assign(cpu, {
        cs: 0,
        ip: 0x7c00,
        ds: 0,
        es: 0,
        ss: 0,
        sp: 0x8000,
        flags: 2,
      });
    },
    step: () => cpu.step(),
    pc: () => cpu.pc,
    tr: () => cpu.tr.selector,
    snapshot: () => ({
      ax: cpu.ax,
      bx: cpu.bx,
      cx: cpu.cx,
      dx: cpu.dx,
      sp: cpu.sp,
      bp: cpu.bp,
      si: cpu.si,
      di: cpu.di,
      cs: cpu.cs,
      ds: cpu.ds,
      es: cpu.es,
      ss: cpu.ss,
      ip: cpu.ip,
      flags: cpu.flags & FLAGS_MASK,
      cpl: cpu.cpl,
      tr: cpu.tr.selector,
      ldtr: cpu.ldtr.selector,
      msw: cpu.msw & 0xf,
    }),
  };
}
