import assert from 'node:assert/strict';
import test from 'node:test';
import {ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP,
  PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from '../src/experimental/i80386-at-machine.js';

const geometry = {cylinders: 1, heads: 1, sectors: 1};
const profile = PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP;
const make = (enabled, config = profile) => new ExperimentalI80386ATMachine(
  {...config, experimentalPlainRamReadShortcut: enabled},
  {ataImage: new Uint8Array(512), ataGeometry: geometry});

test('plain RAM read shortcut is strictly opt-in and validates its board flag', () => {
  assert.equal(new ExperimentalI80386ATMachine(profile)._plainRamReadShortcut, false);
  assert.equal(make(false)._plainRamReadShortcut, false);
  assert.equal(make(true)._plainRamReadShortcut, true);
  assert.throws(() => make('1'), /experimentalPlainRamReadShortcut must be boolean/);
});

test('byte and page-edge reads preserve A20, reset alias, MP, APIC, ROM and open-bus values', () => {
  const ordinary = make(false), shortcut = make(true);
  const machines = [ordinary, shortcut];
  for (const machine of machines) {
    for (const [address, value] of [[0, 0x11], [0xfff, 0x12], [0x1000, 0x13],
      [0x9fbff, 0x14], [0x9fc00, 0x15], [0x9fd00, 0x16], [0x9ffff, 0x17],
      [0x100000, 0x21], [0x100fff, 0x22], [0x101000, 0x23],
      [0x45ffff, 0x24], [0xff0000, 0x31]]) machine.mem[address] = value;
    machine._mpReady = true;
    machine._lapic[0x300 / 4] = 0x1234;
    machine._ioapicSelect = 1;
    machine._ioapic[1] = 0x12345678;
  }
  const addresses = [0, 0xfff, 0x1000, 0x9fbff, 0x9fc00, 0x9fc0f,
    0x9fd00, 0x9fd4f, 0x9ffff, 0xa0000, 0xbffff, 0xc0000,
    0x100000, 0x100fff, 0x101000, 0x45ffff, 0x460000,
    0xfec00010, 0xfee00300, 0xfffffff0, 0x10fffff0];
  const readAll = machine => addresses.map(address => machine.cpu.read(address));
  assert.deepEqual(readAll(shortcut), readAll(ordinary));
  assert.equal(shortcut.cpu.read(0x9fc00), shortcut._xv6Mp.float[0]);
  assert.notEqual(shortcut.cpu.read(0x9fc00), shortcut.mem[0x9fc00]);
  assert.equal(shortcut.cpu.read(0xfffffff0), ordinary.cpu.read(0xfffffff0));
  for (const machine of machines) machine.setA20Enabled(false);
  assert.deepEqual(readAll(shortcut), readAll(ordinary));
  assert.equal(shortcut.cpu.read(0x100000), 0x11);
  for (const machine of machines) machine.setA20Enabled(true);
  assert.deepEqual(readAll(shortcut), readAll(ordinary));
});

test('VGA latch reads and a slow MMIO page retain their ordered callbacks', () => {
  const config = PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA;
  const ordinary = make(false, config), shortcut = make(true, config);
  const effects = [[], []];
  for (const [index, machine] of [ordinary, shortcut].entries()) {
    const originalVideoRead = machine.vgaMemory.read.bind(machine.vgaMemory);
    machine.vgaMemory.read = address => {
      effects[index].push(['video', address]);
      return originalVideoRead(address);
    };
    const out = (port, value) => machine.cpu.outPort(port, value, 8);
    out(0x3c2, 2); out(0x3c4, 2); out(0x3c5, 15);
    out(0x3c4, 4); out(0x3c5, 14);
    out(0x3ce, 5); out(0x3cf, 0); out(0x3ce, 6); out(0x3cf, 5);
    out(0x3ce, 8); out(0x3cf, 255);
    machine.cpu.write(0xa0010, 0x61);
    // A device covers only one byte in an otherwise RAM page. The page must
    // go through the slow decoder, including callback side effects.
    const chip = {read: offset => {effects[index].push(['mmio', offset]); return 0x5a;}};
    machine._mmio.unshift({start: 0x30001, end: 0x30001, chip, stride: 1, regs: 1});
    machine._buildPageTable();
  }
  assert.equal(shortcut._page[0x30000 >>> 12], 3);
  const addresses = [0xa0010, 0xa0011, 0x30000, 0x30001, 0x30002, 0x100000];
  assert.deepEqual(addresses.map(address => shortcut.cpu.read(address)),
    addresses.map(address => ordinary.cpu.read(address)));
  // The only omitted callback is the VGA aperture check on proved plain RAM.
  assert.deepEqual(effects[1], effects[0].filter(([, address]) => address !== 0x100000));
  assert.ok(effects[1].some(([type]) => type === 'mmio'));
  assert.deepEqual(shortcut.vgaMemory.latches, ordinary.vgaMemory.latches);
});

test('a wrapped board _read remains visible before and after a plain-RAM read', () => {
  const machine = make(true), effects = [];
  const original = machine._read.bind(machine);
  machine._read = address => {effects.push(address); return original(address);};
  machine.mem[0x100000] = 0x74;
  assert.equal(machine.cpu.read(0x100000), 0x74);
  assert.equal(machine.cpu.read(0x100001), 0);
  assert.deepEqual(effects, [0x100000, 0x100001]);
});

for (const mode of ['real', 'protected16', 'vm86', 'protected32']) {
  test(`${mode} ordinary instruction reads preserve CPU and board state`, () => {
    const ordinary = make(false), shortcut = make(true);
    for (const machine of [ordinary, shortcut]) {
      const cpu = machine.cpu, wide = mode === 'protected32';
      cpu.cr0 = mode === 'real' ? 0 : 1;
      cpu.cr3 = 0; cpu.cr4 = 0;
      cpu.cs = 0x1000; cpu.ds = 0x2000; cpu.eip = 0x100;
      cpu.eflags = mode === 'vm86' ? 0x23002 : 2;
      cpu.segmentCaches[1] = {base: 0x10000, limit: 0xffff, default32: wide,
        present: true, code: true, readable: true, writable: false};
      cpu.segmentCaches[3] = {base: 0x20000, limit: 0xffff, default32: wide,
        present: true, code: false, readable: true, writable: true};
      // MOV AL,[moffs16/32]; CMP AL,imm8; HLT.
      machine.mem.set(wide ? [0xa0, 0x30, 0, 0, 0, 0x3c, 0x72, 0xf4] :
        [0xa0, 0x30, 0, 0x3c, 0x72, 0xf4], 0x10100);
      machine.mem[0x20030] = 0x72;
    }
    for (let i = 0; i < 3; i++) {
      assert.equal(shortcut.step(), ordinary.step());
      assert.deepEqual(shortcut.cpu._snapshotInstruction(), ordinary.cpu._snapshotInstruction());
      assert.equal(shortcut.cycles, ordinary.cycles);
      assert.equal(shortcut._chipDebt, ordinary._chipDebt);
    }
    assert.deepEqual(shortcut.mem, ordinary.mem);
  });
}
