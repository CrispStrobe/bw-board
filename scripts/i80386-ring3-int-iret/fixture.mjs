// MIT. Authored 80386 instruction bytes; no assembler, compiler or guest execution.
import {createHash} from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const REGISTERS = Object.freeze(['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi']);
export const SEGMENTS = Object.freeze(['es', 'cs', 'ss', 'ds', 'fs', 'gs']);
export const INITIAL = Object.freeze({eax: 0x11223344, ecx: 0x99aabbcc, edx: 0xddeeff00,
  ebx: 0x55667788, esp: 0x9000, ebp: 0x0badc0de, esi: 0x12345678, edi: 0x87654321});
export const RESPONSE = 0xa1b2c3d4;
export const ADDRESSES = Object.freeze({gdt: 0x1000, idt: 0x1800, tss: 0x2000,
  kernel: 0x4000, user: 0x5000, handler: 0x6000, reporter: 0x6200,
  pre: 0x7000, entry: 0x7040, returned: 0x7080, frame: 0x70c0,
  handlerMarker: 0x70d4, returnMarker: 0x70d8, kernelEsp: 0x8000,
  userEsp: 0x9000, reporterEsp: 0xa000, startupEsp: 0xb000});
export const WIRE_MAGIC = Buffer.from('BW-RING3-V1\n', 'ascii');
export const WIRE_END = Buffer.from('\nBW-RING3-END\n', 'ascii');
export const RANGES = Object.freeze([
  {name: 'records', address: 0x7000, bytes: 0xe0},
  {name: 'gdt', address: 0x1000, bytes: 48},
  {name: 'idt', address: 0x1800, bytes: 0x410},
  {name: 'tss', address: 0x2000, bytes: 0x68},
  {name: 'kernelStack', address: 0x7fc0, bytes: 0x60},
  {name: 'userStack', address: 0x8fc0, bytes: 0x60},
  {name: 'reporterStack', address: 0x9fc0, bytes: 0x60}
].map(Object.freeze));

class Bytes {
  constructor(base) { this.base = base; this.data = []; this.symbols = {}; }
  emit(...values) {
    for (const value of values) {
      if (!Number.isInteger(value) || value < 0 || value > 255) throw Error('authored byte extent');
      this.data.push(value);
    }
  }
  word(value) { this.emit(value & 255, (value >>> 8) & 255); }
  dword(value) { this.word(value & 65535); this.word(value >>> 16); }
  mark(name) { if (Object.hasOwn(this.symbols, name)) throw Error('duplicate symbol'); this.symbols[name] = this.base + this.data.length; }
  mov(reg, value) { this.emit(0xb8 + reg); this.dword(value); }
  store(address, reg) { this.emit(0x89, (reg << 3) | 5); this.dword(address); }
  immediate(address, value) { this.emit(0xc7, 5); this.dword(address); this.dword(value); }
  record(address) {
    REGISTERS.forEach((_, reg) => this.store(address + 4 * reg, reg));
    SEGMENTS.forEach((_, reg) => { this.emit(0x8c, (reg << 3) | 5); this.dword(address + 32 + 2 * reg); });
    this.emit(0x9c, 0x8f, 5); this.dword(address + 44); // PUSHFD; POP dword [record.flags].
  }
  output(address, bytes) {
    this.mov(6, address); this.mov(1, bytes);
    this.emit(0xac, 0xee, 0xe2, 0xfc); // LODSB; OUT DX,AL; LOOP back four bytes.
  }
}

export function buildFixture() {
  const a = ADDRESSES, rom = Buffer.alloc(65536, 0), used = new Uint8Array(65536), blocks = [];
  const put = (offset, body, name, destination = null) => {
    const bytes = Buffer.from(body);
    if (offset < 0 || offset + bytes.length > rom.length || used.subarray(offset, offset + bytes.length).some(Boolean)) throw Error('authored ROM overlap');
    rom.set(bytes, offset); used.fill(1, offset, offset + bytes.length);
    if (destination !== null) blocks.push({name, offset, address: destination, bytes: bytes.length});
  };
  const gdt = Buffer.from('0000000000000000ffff0000009acf00ffff00000092cf00ffff000000facf00ffff000000f2cf006700002000890000', 'hex');
  put(a.gdt, gdt, 'gdt', a.gdt);
  const gates = Buffer.alloc(16);
  for (const [offset, target] of [[0, a.handler], [8, a.reporter]]) {
    gates.writeUInt16LE(target & 65535, offset); gates.writeUInt16LE(8, offset + 2);
    gates[offset + 5] = 0xee; gates.writeUInt16LE(target >>> 16, offset + 6);
  }
  put(a.idt + 0x400, gates, 'gates', a.idt + 0x400);
  const tss = Buffer.alloc(0x68); tss.writeUInt32LE(a.kernelEsp, 4); tss.writeUInt16LE(0x10, 8); tss.writeUInt16LE(0x68, 0x66);
  put(a.tss, tss, 'tss', a.tss);
  for (const [name, address] of [['kernelStack', 0x7fc0], ['userStack', 0x8fc0], ['reporterStack', 0x9fc0]]) put(address, Buffer.alloc(0x60, 0xcc), name, address);

  const kernel = new Bytes(a.kernel);
  kernel.emit(0x66, 0xb8, 0x10, 0, 0x8e, 0xd8, 0x8e, 0xc0, 0x8e, 0xd0);
  kernel.mov(4, a.startupEsp);
  kernel.emit(0x66, 0xb8, 0x28, 0, 0x0f, 0, 0xd8); // MOV AX,28; LTR AX.
  kernel.emit(0x66, 0xb8, 0x23, 0, 0x8e, 0xd8, 0x8e, 0xc0, 0x8e, 0xe0, 0x8e, 0xe8);
  REGISTERS.forEach((name, reg) => { if (reg !== 4) kernel.mov(reg, INITIAL[name]); });
  for (const value of [0x23, a.userEsp, 0x202, 0x1b, a.user]) { kernel.emit(0x68); kernel.dword(value); }
  kernel.mark('initialIretd'); kernel.emit(0xcf);
  put(a.kernel, kernel.data, 'kernel', a.kernel);

  const user = new Bytes(a.user);
  user.record(a.pre); user.mark('int80'); user.emit(0xcd, 0x80);
  user.mark('returned'); user.record(a.returned);
  user.immediate(a.returnMarker, 0x5245544e); user.mark('int81'); user.emit(0xcd, 0x81);
  user.emit(0xeb, 0xfe); // No successful return from the one-way reporter.
  put(a.user, user.data, 'user', a.user);

  const handler = new Bytes(a.handler);
  // Save all GPRs and segment selectors without touching ESP/flags first.
  REGISTERS.forEach((_, reg) => handler.store(a.entry + reg * 4, reg));
  SEGMENTS.forEach((_, reg) => { handler.emit(0x8c, (reg << 3) | 5); handler.dword(a.entry + 32 + reg * 2); });
  for (let offset = 0; offset < 20; offset += 4) {
    handler.emit(0x8b, 0x44, 0x24, offset); // MOV EAX,[ESP+offset].
    handler.store(a.frame + offset, 0);
  }
  handler.emit(0x9c, 0x8f, 5); handler.dword(a.entry + 44);
  handler.immediate(a.tss + 4, a.reporterEsp); // Only after the original frame copy.
  handler.immediate(a.handlerMarker, 0x48414e44);
  handler.mov(0, RESPONSE); handler.mark('iretd'); handler.emit(0xcf);
  put(a.handler, handler.data, 'handler', a.handler);

  put(0x100, WIRE_MAGIC, 'wireMagic'); put(0x140, WIRE_END, 'wireEnd');
  const reporter = new Bytes(a.reporter);
  reporter.emit(0xfa, 0xfc); reporter.mov(2, 0xe9);
  reporter.output(0xf0100, WIRE_MAGIC.length);
  for (const range of RANGES) reporter.output(range.address, range.bytes);
  reporter.output(0xf0140, WIRE_END.length);
  reporter.mov(2, 0xf4); reporter.emit(0x31, 0xc0); reporter.mark('exit'); reporter.emit(0xee, 0xfa, 0xf4, 0xeb, 0xfc);
  put(a.reporter, reporter.data, 'reporter', a.reporter);

  const boot = new Bytes(0xf0000);
  boot.emit(0xfa, 0xfc, 0xb8, 0, 0xf0, 0x8e, 0xd8, 0x31, 0xc0, 0x8e, 0xc0, 0x8e, 0xd0, 0xbc, 0, 0xb0);
  boot.emit(0xb0, 0xff, 0xe6, 0x21, 0xe6, 0xa1); // Mask both PICs; no hardware IRQ is graded.
  for (const block of blocks) {
    boot.emit(0xbe); boot.word(block.offset); boot.emit(0xbf); boot.word(block.address);
    boot.emit(0xb9); boot.word(block.bytes); boot.emit(0xf3, 0xa4);
  }
  boot.emit(0x66, 0x0f, 1, 0x16, 0, 2, 0x66, 0x0f, 1, 0x1e, 6, 2);
  boot.emit(0x66, 0xb8, 1, 0, 0, 0, 0x0f, 0x22, 0xc0, 0x66, 0xea); boot.dword(a.kernel); boot.word(8);
  put(0, boot.data, 'boot');
  const tables = Buffer.alloc(12); tables.writeUInt16LE(47); tables.writeUInt32LE(a.gdt, 2);
  tables.writeUInt16LE(0x40f, 6); tables.writeUInt32LE(a.idt, 8); put(0x200, tables, 'tablePointers');
  put(0xfff0, [0xea, 0, 0, 0, 0xf0], 'reset');
  const symbols = {...kernel.symbols, ...user.symbols, ...handler.symbols, ...reporter.symbols};
  const manifest = {schema: 'bw.ring3.fixture.v1', license: 'MIT', romBytes: 65536, romSha256: sha256(rom),
    ramBytes: 1048576, addresses: {...a}, initial: {...INITIAL}, response: RESPONSE, symbols,
    blocks, ranges: RANGES.map(range => ({...range})), selectorPaddingOffsets: [6, 7, 18, 19],
    wireBytes: WIRE_MAGIC.length + RANGES.reduce((sum, range) => sum + range.bytes, 0) + WIRE_END.length,
    cpuProfile: 'strict386', deliverFaults: false, ordinaryStepLimit: 2000000};
  return {rom: Uint8Array.from(rom), manifest};
}
