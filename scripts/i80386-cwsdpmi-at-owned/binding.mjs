import {createHash} from 'node:crypto';

// DJGPP's published MZ and COFF file/section layouts define these offsets.
// A map symbol alone never establishes which bytes the AT guest executed.
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const admittedLayouts = new WeakMap();
const CLIENT_PATH = 'scripts/i80386-cwsdpmi-owned/client.c';
const CLIENT_SHA = 'c8c654326633b244c64baac144fe9300ce5a1800c330e52615470c62d8c3bb1d';
const TOOL_SHA = '8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00';
const SOURCE_HASHES = Object.freeze({
  'djcrx205.zip':'22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60',
  'djdev205.zip':'4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda',
  'djlsr205.zip':'80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea',
});
const REQUIRED = Object.freeze({
  main: ['client.o', '.text.startup'],
  allocateMemory: ['libc.a(d0501.o)', '.text'],
  allocateLdt: ['libc.a(d0000.o)', '.text'],
  setBase: ['libc.a(d0007.o)', '.text'],
  setLimit: ['libc.a(d0008.o)', '.text'],
  simulateInt: ['libc.a(d0300_z.o)', '.text'],
  freeLdt: ['libc.a(d0001.o)', '.text'],
  freeMemory: ['libc.a(d0502.o)', '.text'],
});
const SYMBOLS = Object.freeze({
  main: 'main', allocateMemory: '__dpmi_allocate_memory',
  allocateLdt: '__dpmi_allocate_ldt_descriptors',
  setBase: '__dpmi_set_segment_base_address',
  setLimit: '__dpmi_set_segment_limit', simulateInt: '__dpmi_int',
  freeLdt: '__dpmi_free_ldt_descriptor', freeMemory: '__dpmi_free_memory',
});
const number = raw => {
  const n = Number.parseInt(raw, 16);
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) throw new Error('map number');
  return n;
};

export function admitBoundImage(executable, mapBytes, compile) {
  if (!Buffer.isBuffer(executable) || !Buffer.isBuffer(mapBytes))
    throw new Error('executable/map buffers');
  // Borrowed input buffers cannot change the bytes being admitted during a
  // caller-controlled receipt property read.
  executable = Buffer.from(executable);
  mapBytes = Buffer.from(mapBytes);
  const profile = argv => Array.isArray(argv) &&
    argv.includes('-march=i386') && argv.includes('-mtune=i386') &&
    argv[0]?.endsWith('/i586-pc-msdosdjgpp-gcc');
  if (!Buffer.isBuffer(executable) || executable.length < 4096 || executable.length > 2 << 20 ||
      !Buffer.isBuffer(mapBytes) || mapBytes.length > 1 << 20 ||
      compile?.schema !== 'bw.cwsdpmi-owned.compile-only.v1' ||
      compile.status !== 'COMPILED_NO_GUEST_NO_BINARY_PUBLICATION' ||
      compile.executable?.bytes !== executable.length ||
      compile.executable.sha256 !== sha256(executable) ||
      compile.map?.bytes !== mapBytes.length || compile.map.sha256 !== sha256(mapBytes) ||
      compile.executable.uploaded !== false ||
      compile.ownedSource?.path !== CLIENT_PATH || compile.ownedSource.sha256 !== CLIENT_SHA ||
      compile.toolchain?.sha256 !== TOOL_SHA ||
      Object.keys(compile.sourceArchives ?? {}).sort().join() !== Object.keys(SOURCE_HASHES).sort().join() ||
      Object.entries(SOURCE_HASHES).some(([name,digest]) => compile.sourceArchives[name]?.sha256 !== digest) ||
      !profile(compile.compileArgv) || !profile(compile.linkArgv) ||
      !['assembler','linker','stubify','crt0.o','libc.a','libgcc.a'].every(role =>
        compile.resolvedImplicitRoles?.[role]?.admitted === true))
    throw new Error('fresh executable/map/compile receipt');
  if (executable.toString('ascii', 0, 2) !== 'MZ') throw new Error('MZ prefix');
  const last = executable.readUInt16LE(2), blocks = executable.readUInt16LE(4),
    paragraphs = executable.readUInt16LE(8);
  const coff = blocks * 512 - (last ? 512 - last : 0);
  if (last > 511 || !blocks || !paragraphs || paragraphs * 16 > coff ||
      coff + 20 > executable.length) throw new Error('MZ/COFF extent');
  const magic = executable.readUInt16LE(coff), count = executable.readUInt16LE(coff + 2),
    optional = executable.readUInt16LE(coff + 16), flags = executable.readUInt16LE(coff + 18);
  if (magic !== 0x14c || count < 1 || count > 96 || optional < 28 || optional > 256 ||
      !(flags & 2) || executable.readUInt16LE(coff + 20) !== 0x010b ||
      coff + 20 + optional + count * 40 > executable.length) throw new Error('i386 COFF header');
  let text = null;
  for (let i = 0; i < count; i++) {
    const at = coff + 20 + optional + i * 40;
    const name = executable.toString('ascii', at, at + 8).replace(/\0.*$/, '');
    if (name !== '.text') continue;
    if (text) throw new Error('duplicate text section');
    const physical = executable.readUInt32LE(at + 8),
      address = executable.readUInt32LE(at + 12),
      bytes = executable.readUInt32LE(at + 16),
      offset = executable.readUInt32LE(at + 20),
      relocations = executable.readUInt16LE(at + 32),
      properties = executable.readUInt32LE(at + 36);
    if (address !== physical || !bytes || bytes > 1 << 20 ||
        coff + offset + bytes > executable.length || !(properties & 0x20) || relocations)
      throw new Error('linked text section extent');
    text = {address, bytes, offset: coff + offset,
      sha256: sha256(executable.subarray(coff + offset, coff + offset + bytes))};
  }
  if (!text) throw new Error('missing COFF text section');
  const map = mapBytes.toString('utf8');
  if (Buffer.from(map, 'utf8').length !== mapBytes.length || map.includes('\0'))
    throw new Error('map text encoding');
  const lines = map.split(/\r?\n/);
  const top = lines.filter(line => /^\.text\s+0x[0-9a-fA-F]+\s+0x[0-9a-fA-F]+\s*$/.test(line));
  if (top.length !== 1) throw new Error('map text span uniqueness');
  const [, topAt, topBytes] = /^\.text\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)/.exec(top[0]);
  if (number(topAt) !== text.address || number(topBytes) !== text.bytes)
    throw new Error('map/COFF text span differs');
  const roles = {};
  for (let i = 0; i < lines.length - 1; i++) {
    const section = /^\s+(\.text(?:\.startup)?)\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)\s+(\S+)\s*$/.exec(lines[i]);
    const symbol = /^\s+0x([0-9a-fA-F]+)\s+([A-Za-z_][A-Za-z_0-9]*)\s*$/.exec(lines[i + 1]);
    if (!section || !symbol) continue;
    for (const [role, [member, sectionName]] of Object.entries(REQUIRED)) {
      if (symbol[2] !== SYMBOLS[role]) continue;
      if (roles[role] || section[1] !== sectionName ||
          !section[4].endsWith(member) || number(symbol[1]) !== number(section[2]))
        throw new Error('map role mismatch: ' + role);
      const address = number(section[2]), bytes = number(section[3]);
      if (!bytes || bytes > 4096 || address < text.address ||
          address + bytes > text.address + text.bytes)
        throw new Error('map role outside text: ' + role);
      roles[role] = {address, bytes, member};
    }
  }
  if (Object.keys(roles).length !== Object.keys(REQUIRED).length)
    throw new Error('incomplete client/wrapper map roles');
  const ranges = Object.values(roles).sort((a, b) => a.address - b.address);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i - 1].address + ranges[i - 1].bytes > ranges[i].address)
      throw new Error('overlapping source roles');
  const result = Object.freeze({schema: 'bw.cwsdpmi-owned.at-bound-image.v1',
    executableSha256: sha256(executable), mapSha256: sha256(mapBytes), text,
    textBytes: Buffer.from(executable.subarray(text.offset, text.offset + text.bytes)), roles});
  admittedLayouts.set(result, Object.freeze({
    executableSha256: result.executableSha256, mapSha256: result.mapSha256,
    text: Object.freeze({...text}),
    textBytes: Buffer.from(result.textBytes),
    roles: Object.freeze(Object.fromEntries(Object.entries(roles)
      .map(([key, role]) => [key, Object.freeze({...role})]))),
  }));
  return result;
}

export function bindLoadedText(layout, cpu, readLinear) {
  const admitted = admittedLayouts.get(layout);
  if (!admitted || layout?.schema !== 'bw.cwsdpmi-owned.at-bound-image.v1' ||
      !cpu?.protectedMode || !cpu.segmentCaches?.[1]?.default32 ||
      cpu.eip !== admitted.roles.main.address || typeof readLinear !== 'function')
    throw new Error('not at admitted 32-bit client main entry');
  const base = cpu.segmentCaches[1].base >>> 0;
  if (base + admitted.text.address + admitted.text.bytes > 0x100000000)
    throw new Error('loaded text linear extent');
  for (let i = 0; i < admitted.text.bytes; i++)
    if (readLinear(base + admitted.text.address + i) !== admitted.textBytes[i])
      throw new Error('loaded text differs at byte ' + i);
  return Object.freeze({base, cs: cpu.cs, textSha256: admitted.text.sha256,
    executableSha256: admitted.executableSha256, main: admitted.roles.main.address});
}
