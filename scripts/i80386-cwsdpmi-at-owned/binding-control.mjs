import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {admitBoundImage, bindLoadedText} from './binding.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
const textAddress = 0x1000, textSize = 0x800, coff = 512, rawPointer = 128;
const exe = Buffer.alloc(4096);
exe.write('MZ', 0, 'ascii');
exe.writeUInt16LE(1, 4);
exe.writeUInt16LE(4, 8);
exe.writeUInt16LE(0x14c, coff);
exe.writeUInt16LE(1, coff + 2);
exe.writeUInt16LE(28, coff + 16);
exe.writeUInt16LE(0x102, coff + 18);
exe.writeUInt16LE(0x010b, coff + 20);
const sh = coff + 48;
exe.write('.text', sh, 'ascii');
exe.writeUInt32LE(textAddress, sh + 8);
exe.writeUInt32LE(textAddress, sh + 12);
exe.writeUInt32LE(textSize, sh + 16);
exe.writeUInt32LE(rawPointer, sh + 20);
exe.writeUInt32LE(0x20, sh + 36);
for (let i = 0; i < textSize; i++) exe[coff + rawPointer + i] = i % 251;

const specs = [
  ['allocateMemory', '__dpmi_allocate_memory', 0x1100, 0x40, 'libc.a(d0501.o)', '.text'],
  ['allocateLdt', '__dpmi_allocate_ldt_descriptors', 0x1140, 0x30, 'libc.a(d0000.o)', '.text'],
  ['setBase', '__dpmi_set_segment_base_address', 0x1170, 0x30, 'libc.a(d0007.o)', '.text'],
  ['setLimit', '__dpmi_set_segment_limit', 0x11a0, 0x30, 'libc.a(d0008.o)', '.text'],
  ['simulateInt', '__dpmi_int', 0x11d0, 0x90, 'libc.a(d0300_z.o)', '.text'],
  ['freeLdt', '__dpmi_free_ldt_descriptor', 0x1260, 0x30, 'libc.a(d0001.o)', '.text'],
  ['freeMemory', '__dpmi_free_memory', 0x1290, 0x30, 'libc.a(d0502.o)', '.text'],
  ['main', 'main', 0x1400, 0x100, 'client.o', '.text.startup'],
];
const map = Buffer.from('.text 0x1000 0x800\n' + specs.map(([, symbol, address, bytes, member, section]) =>
  ` ${section} 0x${address.toString(16)} 0x${bytes.toString(16)} /admitted/${member}\n` +
  `  0x${address.toString(16)} ${symbol}\n`).join(''));
const compile = {schema:'bw.cwsdpmi-owned.compile-only.v1',
  status:'COMPILED_NO_GUEST_NO_BINARY_PUBLICATION',
  ownedSource:{path:'scripts/i80386-cwsdpmi-owned/client.c',
    sha256:'c8c654326633b244c64baac144fe9300ce5a1800c330e52615470c62d8c3bb1d'},
  toolchain:{sha256:'8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00'},
  sourceArchives:{
    'djcrx205.zip':{sha256:'22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60'},
    'djdev205.zip':{sha256:'4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda'},
    'djlsr205.zip':{sha256:'80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea'},
  },
  compileArgv:['/admitted/i586-pc-msdosdjgpp-gcc','-std=gnu11','-O2',
    '-march=i386','-mtune=i386','-Wall','-Wextra','-Werror','-fno-lto',
    '-c','client.c','-o','client.o'],
  linkArgv:['/admitted/i586-pc-msdosdjgpp-gcc','-march=i386','-mtune=i386',
    '-Wl,-Map,client.map','-o','client.exe','client.o'],
  resolvedImplicitRoles:Object.fromEntries(['assembler','linker','stubify','crt0.o','libc.a','libgcc.a']
    .map(role=>[role,{admitted:true}])),
  executable:{bytes:exe.length,sha256:hash(exe),uploaded:false},
  map:{bytes:map.length,sha256:hash(map)}};
const layout = admitBoundImage(exe, map, compile);
assert.equal(layout.roles.main.address, 0x1400);
assert.equal(layout.roles.allocateMemory.bytes, 0x40);
const base = 0x200000;
const cpu = {protectedMode:true,eip:0x1400,cs:0x17,
  segmentCaches:[null,{base,default32:true}]};
const read = address => layout.textBytes[address - base - layout.text.address];
const loaded = bindLoadedText(layout, cpu, read);
assert.equal(loaded.base, base);
assert.equal(loaded.textSha256, layout.text.sha256);
// Public diagnostics are mutable aliases; only the private admitted copy has authority.
const originalByte = layout.textBytes[3];
layout.textBytes[3] ^= 1;
layout.roles.main.address = 0x1401;
layout.text.address = 0x1001;
assert.throws(() => bindLoadedText(layout, cpu, read));
layout.textBytes[3] = originalByte;
const genuineRead = address => exe[coff + rawPointer + address - base - textAddress];
assert.equal(bindLoadedText(layout, cpu, genuineRead).main, 0x1400);
assert.throws(() => bindLoadedText({...layout}, cpu, genuineRead));
const borrowedExe = Buffer.from(exe), borrowedMap = Buffer.from(map);
const mutatingReceipt = {...compile};
Object.defineProperty(mutatingReceipt, 'status', {get() {
  borrowedExe[coff + rawPointer + 7] ^= 1;
  borrowedMap[0] ^= 1;
  return compile.status;
}});
assert.equal(admitBoundImage(borrowedExe, borrowedMap, mutatingReceipt).executableSha256,
  hash(exe));
assert.throws(() => admitBoundImage(Buffer.from(exe).fill(1, 900, 901), map, compile));
assert.throws(() => admitBoundImage(Buffer.alloc((2 << 20) + 1), map, compile));
assert.throws(() => admitBoundImage(exe,map,{...compile,ownedSource:{...compile.ownedSource,sha256:'0'.repeat(64)}}));
assert.throws(() => admitBoundImage(exe,map,{...compile,compileArgv:['/admitted/i586-pc-msdosdjgpp-gcc','-march=i486','-mtune=i486']}));
assert.throws(() => admitBoundImage(exe,map,{...compile,
  compileArgv:[...compile.compileArgv,'-march=i486']}));
assert.throws(() => admitBoundImage(exe,map,{...compile,
  linkArgv:[...compile.linkArgv,'-mtune=i486']}));
assert.throws(() => admitBoundImage(exe, Buffer.concat([map, Buffer.from(' ')]), compile));
const badMember = Buffer.from(map.toString().replace('libc.a(d0501.o)', 'libc.a(d0001.o)'));
assert.throws(() => admitBoundImage(exe, badMember, {...compile,
  map:{bytes:badMember.length,sha256:hash(badMember)}}));
const duplicate = Buffer.concat([map, Buffer.from(' .text 0x1100 0x40 /admitted/libc.a(d0501.o)\n  0x1100 __dpmi_allocate_memory\n')]);
assert.throws(() => admitBoundImage(exe, duplicate, {...compile,
  map:{bytes:duplicate.length,sha256:hash(duplicate)}}));
assert.throws(() => bindLoadedText(layout, {...cpu,eip:0x1401}, read));
assert.throws(() => bindLoadedText(layout, {...cpu,protectedMode:false}, read));
assert.throws(() => bindLoadedText(layout, cpu, address =>
  address === base + layout.text.address + 3 ? 0 : read(address)));
console.log('CWSDPMI AT map/loaded-text controls PASS');
