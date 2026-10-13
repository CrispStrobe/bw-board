import test from 'node:test';
import assert from 'node:assert/strict';
import I80386, { I80386Fault } from '../src/experimental/i80386.js';

function fixture(bytes) {
  const effects = [];
  const cpu = new I80386({
    fetch(address) {
      effects.push(['fetch', address]);
      return bytes[address] ?? 0;
    },
    read(address) { effects.push(['read', address]); return 0; },
    write(address, value) { effects.push(['write', address, value]); },
  });
  cpu.bx = 0xfff0;
  cpu.bp = 0x8000;
  cpu.si = 0x0030;
  cpu.di = 0xfffd;
  return { cpu, effects };
}

// Authored arithmetic values, not computed with the decoder under test.
const offsets = [
  [32, 65517, 32816, 32765, 48, 65533, 4660, 65520],
  [65440, 65389, 32688, 32637, 65456, 65405, 32640, 65392],
  [31, 65516, 32815, 32764, 47, 65532, 32767, 65519],
];
for (let mod = 0; mod < 3; mod++) {
  test(`all eight 16-bit memory forms with mod ${mod}`, () => {
    for (let rm = 0; rm < 8; rm++) {
      const displacement = mod === 1 ? [0x80] : mod === 2 ? [0xff, 0xff] : rm === 6 ? [0x34, 0x12] : [];
      const { cpu, effects } = fixture([(mod << 6) | (5 << 3) | rm, ...displacement]);
      const ea = cpu._decodeEA(false, null);
      const seg = rm === 2 || rm === 3 || (rm === 6 && mod !== 0) ? 2 : 3;
      assert.deepEqual(ea, { reg: 5, rm, isReg: false, off: offsets[mod][rm], seg, usesEsp: false });
      assert.equal(cpu.eip, 1 + displacement.length);
      assert.deepEqual(effects, Array.from({ length: cpu.eip }, (_, i) => ['fetch', i]));
    }
  });
}

test('signed byte displacements and register extremes wrap once to sixteen bits', () => {
  for (const [bx, byte, expected] of [[0, 0xff, 65535], [65535, 1, 0], [65535, 0x7f, 126], [0, 0, 0]]) {
    const { cpu } = fixture([0x47, byte]);
    cpu.bx = bx;
    assert.equal(cpu._decodeEA(false, null).off, expected);
  }
  for (const [word, expected] of [[0, 65535], [0x8000, 32767]]) {
    const { cpu } = fixture([0x87, word & 255, word >>> 8]);
    cpu.bx = 65535;
    assert.equal(cpu._decodeEA(false, null).off, expected);
  }
});

test('returned operands remain independently owned across subsequent decodes', () => {
  const { cpu } = fixture([0x00, 0x46, 1]);
  const first = cpu._decodeEA(false, null);
  const second = cpu._decodeEA(false, null);
  assert.notEqual(first, second);
  second.off = 7;
  second.seg = 0;
  assert.deepEqual(first, { reg: 0, rm: 0, isReg: false, off: 32, seg: 3, usesEsp: false });
});

test('all six instruction segment overrides select the operand base and last override wins', () => {
  for (const [prefix, seg] of [[0x26, 0], [0x2e, 1], [0x36, 2], [0x3e, 3], [0x64, 4], [0x65, 5]]) {
    // MOV AX,[BP+1]; CS stays at zero so the instruction stream is independent.
    const { cpu, effects } = fixture([prefix, 0x8b, 0x46, 1]);
    for (const i of [0, 2, 3, 4, 5]) cpu.segmentCaches[i] = { ...cpu.segmentCaches[i], base: (i + 1) * 0x10000 };
    cpu.step();
    const expected = (seg === 1 ? 0 : (seg + 1) * 0x10000) + 0x8001;
    assert.deepEqual(effects.filter(e => e[0] === 'read'), [['read', expected], ['read', expected + 1]]);
  }
  const { cpu, effects } = fixture([0x26, 0x65, 0x8b, 0x07]);
  cpu.segmentCaches[5] = { ...cpu.segmentCaches[5], base: 0x50000 };
  cpu.step();
  assert.deepEqual(effects.filter(e => e[0] === 'read'), [['read', 0x5fff0], ['read', 0x5fff1]]);
});

test('register and 32-bit SIB forms keep their original shape and fetch extent', () => {
  const reg = fixture([0xed, 0xff]);
  assert.deepEqual(reg.cpu._decodeEA(false, 0), { reg: 5, rm: 5, isReg: true });
  assert.equal(reg.cpu.eip, 1);
  const sib = fixture([0x44, 0xb4, 0xfc]); // ESI*4 + ESP -4, SS default.
  sib.cpu.esi = 7;
  sib.cpu.esp = 100;
  assert.deepEqual(sib.cpu._decodeEA(true, null), { reg: 0, rm: 4, isReg: false, off: 124, seg: 2, usesEsp: true });
  assert.deepEqual(sib.effects, [['fetch', 0], ['fetch', 1], ['fetch', 2]]);
});

test('address-size override uses SIB while operand-size override leaves sixteen-bit addressing', () => {
  const a = fixture([0x67, 0x8b, 0x44, 0xb4, 0xfc]);
  a.cpu.esi = 7;
  a.cpu.esp = 100;
  a.cpu.step();
  assert.deepEqual(a.effects.filter(e => e[0] === 'read'), [['read', 124], ['read', 125]]);
  const b = fixture([0x66, 0x8b, 0x07]);
  b.cpu.step();
  assert.deepEqual(b.effects.filter(e => e[0] === 'read'), [0xfff0, 0xfff1, 0xfff2, 0xfff3].map(a => ['read', a]));
});

test('second displacement byte CS-limit refusal preserves fetch prefix and step rollback', () => {
  for (const instruction of [[0x8b, 0x06, 0x34], [0x8b, 0x86, 0x34]]) {
    const { cpu, effects } = fixture(instruction);
    cpu.segmentCaches[1] = { ...cpu.segmentCaches[1], limit: 2 };
    cpu.ax = 0x1234;
    assert.throws(() => cpu.step(), e => e instanceof I80386Fault && e.vector === 13 && e.errorCode === 0);
    assert.equal(cpu.eip, 0);
    assert.equal(cpu.ax, 0x1234);
    assert.deepEqual(effects, [['fetch', 0], ['fetch', 1], ['fetch', 2]]);
  }
});

test('page refusal in disp16 preserves CR2, byte order and architectural restart', () => {
  const { cpu, effects } = fixture([]);
  cpu.eip = 0xffd;
  cpu.ax = 0x5678;
  cpu.fetch = address => {
    effects.push(['fetch', address]);
    return new Map([[0xffd, 0x8b], [0xffe, 0x06], [0xfff, 0x34]]).get(address) ?? 0;
  };
  cpu._translate = address => {
    if (address === 0x1000) { cpu.cr2 = address; throw new I80386Fault(14, 0, 'authored absent code page'); }
    return address;
  };
  assert.throws(() => cpu.step(), e => e instanceof I80386Fault && e.vector === 14 && e.errorCode === 0);
  assert.equal(cpu.eip, 0xffd);
  assert.equal(cpu.cr2, 0x1000);
  assert.equal(cpu.ax, 0x5678);
  assert.deepEqual(effects, [['fetch', 0xffd], ['fetch', 0xffe], ['fetch', 0xfff]]);
});

test('protected BP addressing faults through SS while direct disp16 faults through DS', () => {
  for (const [instruction, segment, vector] of [[[0x8b, 0x46, 1], 2, 12], [[0x8b, 0x06, 0, 0x80], 3, 13]]) {
    const { cpu, effects } = fixture(instruction);
    cpu.cr0 = 1;
    cpu.ax = 0xabcd;
    cpu.segmentCaches[segment] = { ...cpu.segmentCaches[segment], base: segment * 0x10000, limit: 0x7fff };
    assert.throws(() => cpu.step(), e => e instanceof I80386Fault && e.vector === vector && e.errorCode === 0);
    assert.equal(cpu.eip, 0);
    assert.equal(cpu.ax, 0xabcd);
    assert.equal(effects.filter(e => e[0] !== 'fetch').length, 0);
  }
});

test('VM86 wrapped BP+SI retains SS operand addressing', () => {
  const { cpu, effects } = fixture([0x8b, 0x02]);
  cpu.cr0 = 1;
  cpu.eflags |= 0x20000;
  cpu.bp = 0xfff0;
  cpu.si = 0x30;
  cpu.segmentCaches[2] = { ...cpu.segmentCaches[2], base: 0x23000 };
  cpu.segmentCaches[3] = { ...cpu.segmentCaches[3], base: 0x45000 };
  cpu.step();
  assert.deepEqual(effects.filter(e => e[0] === 'read'), [['read', 0x23020], ['read', 0x23021]]);
});
