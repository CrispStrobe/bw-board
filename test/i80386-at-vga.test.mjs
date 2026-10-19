import assert from 'node:assert/strict';
import test from 'node:test';

import ExperimentalI80386ATMachine, {
  PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA,
} from '../src/experimental/i80386-at-machine.js';

const geometry = {cylinders: 1, heads: 1, sectors: 1};

function machine() {
  return new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA, {
    ataImage: new Uint8Array(512),
    ataGeometry: geometry,
  });
}

test('opt-in 386 AT VGA profile exposes option ROM, VGA ports, and planar memory', () => {
  const at = machine();
  assert.ok(at.chips.vga1);
  assert.equal(at.chips.cga1, undefined);
  assert.equal(at.cpu.read(0xa0000), 0xff, 'disabled VGA RAM leaves the aperture open bus');

  const optionRom = new Uint8Array(0x7e00);
  optionRom.set([0x55, 0xaa, 0x3f, 0x90]);
  at.loadRom(optionRom, 0xc0000);
  assert.deepEqual(Array.from({length: 4}, (_, index) => at.cpu.read(0xc0000 + index)),
    [0x55, 0xaa, 0x3f, 0x90]);

  const out = (port, value) => at.cpu.outPort(port, value, 8);
  out(0x3c2, 0x02);
  out(0x3c4, 2); out(0x3c5, 0x0f);
  out(0x3c4, 4); out(0x3c5, 0x0e);
  out(0x3ce, 5); out(0x3cf, 0x00);
  out(0x3ce, 6); out(0x3cf, 0x05);
  out(0x3ce, 8); out(0x3cf, 0xff);
  at.cpu.write(0xa0010, 0x61);
  at.cpu.write(0xa0011, 0x62);
  assert.equal(at.vgaMemory.planes[0][0x10], 0x61);
  assert.equal(at.vgaMemory.planes[1][0x10], 0x62);
  assert.equal(at.cpu.read(0xa0010), 0x61);
  assert.equal(at.cpu.read(0xa0011), 0x62);
});

test('VGA profile advertises an EGA-class display and a valid CMOS checksum', () => {
  const at = machine();
  const cmos = at.chips.rtc1.ram;
  assert.equal(cmos[0x14] & 0x30, 0, 'equipment byte selects EGA/VGA video class');
  const checksum = Array.from(cmos.slice(0x10, 0x2e)).reduce((sum, value) => sum + value, 0) & 0xffff;
  assert.equal(cmos[0x2e] << 8 | cmos[0x2f], checksum);
});
