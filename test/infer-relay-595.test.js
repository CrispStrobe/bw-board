// Name-convention synthesis: relay pins and the bit-banged 74HC595 trio.
// Both found 2026-08-17 the same way: the bench regeneration turned the
// relay-clicker's relay and the shift-register example's 595 into plain
// LEDs, and the e2e suite asked where the parts went.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inferNetlist } from '../src/infer-netlist.js';

test('a pin named relay gets a relay behind an NPN driver, not an LED', () => {
  const { parts, nets } = inferNetlist({
    device: 'stc12c5a60s2',
    pins: [{ name: 'relay_ctrl', port: 1, bit: 0, direction: 'output' }],
  });
  const relay = parts.find(p => p.kind === 'relay');
  const npn = parts.find(p => p.kind === 'npn');
  assert.ok(relay, 'a relay part exists');
  assert.ok(npn, 'driven through a transistor — an MCU pin cannot source a coil');
  assert.ok(!parts.some(p => p.kind === 'led' && p.id.includes('relay')),
    'the relay pin did not ALSO become an LED');
  // Topology: pin → R → base; coil_b → collector.
  const baseNet = nets.find(n => n.terminals.some(t => t.terminal === 'base'));
  assert.ok(baseNet, 'base net exists');
  const coilNet = nets.find(n => n.terminals.some(t => t.terminal === 'coil_b'));
  assert.ok(coilNet.terminals.some(t => t.terminal === 'collector'),
    'coil_b switches through the collector');
});

test('bit-banged data+clock+latch become the behavioral shift register', () => {
  const { parts, nets } = inferNetlist({
    device: 'stc12c5a60s2',
    pins: [
      { name: 'data', port: 1, bit: 0, direction: 'output' },
      { name: 'clock', port: 1, bit: 1, direction: 'output' },
      { name: 'latch', port: 1, bit: 2, direction: 'output' },
    ],
  });
  const sr = parts.find(p => p.kind === 'shift_register');
  assert.ok(sr, 'the trio synthesizes a shift_register part');
  assert.equal(parts.filter(p => p.kind === 'led').length, 8, 'its 8 output LEDs');
  for (const role of ['data', 'clock', 'latch']) {
    const net = nets.find(n => n.id === `net_595_${role}`);
    assert.ok(net && net.terminals.some(t => t.part === 'MCU'),
      `${role} is wired MCU → shift register`);
  }
  // The consumed pins did not ALSO become three plain LEDs.
  assert.ok(!parts.some(p => p.kind === 'led' && /data|clock|latch/.test(p.id)),
    'trio pins are not separately LED-ified');
});

test('a lone pin named clock stays an ordinary pin', () => {
  const { parts } = inferNetlist({
    device: 'stc12c5a60s2',
    pins: [{ name: 'clock', port: 1, bit: 1, direction: 'output' }],
  });
  assert.ok(!parts.some(p => p.kind === 'shift_register'),
    'no trio, no shift register — a common name alone must not trigger');
});
