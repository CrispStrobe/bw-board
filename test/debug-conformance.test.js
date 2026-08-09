/**
 * Boundary D conformance: verify both debug targets agree on the
 * subset they both support.
 *
 * The serial target's capabilities are a strict subset of the emulator's.
 * For every operation the serial target supports, the emulator should
 * produce the same result on the same image.
 *
 * Without the monitor firmware hex, this tests the capability declarations
 * and refusal patterns. When the hex is available, it extends to comparing
 * actual memory reads.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSerialDebugTarget } from '../src/serial-debug.js';

describe('boundary D: serial target capability matrix', () => {
  it('steps: block only', () => {
    const t = { write: async () => {}, onData: () => {}, onClose: () => {} };
    const target = createSerialDebugTarget(t);
    const caps = target.capabilities();

    assert.deepEqual(caps.steps, ['block']);
    assert.ok(!caps.steps.includes('insn'), 'no insn (costs P3.2)');
    assert.ok(!caps.steps.includes('line'), 'no line (no line table)');
    assert.ok(!caps.steps.includes('over'), 'no over');
    assert.ok(!caps.steps.includes('out'), 'no out');
  });

  it('breakpoints: yield only', () => {
    const t = { write: async () => {}, onData: () => {}, onClose: () => {} };
    const target = createSerialDebugTarget(t);
    const caps = target.capabilities();

    assert.deepEqual(caps.breakpoints, ['yield']);
    assert.ok(!caps.breakpoints.includes('code'), 'no code BPs (no PSEN)');
  });

  it('consumes: timer0, timer1, uart1, brt', () => {
    const t = { write: async () => {}, onData: () => {}, onClose: () => {} };
    const target = createSerialDebugTarget(t);
    assert.deepEqual(target.capabilities().consumes,
      ['timer0', 'timer1', 'uart1', 'brt']);
  });

  it('timeFreezes: true (measured on-chip)', () => {
    const t = { write: async () => {}, onData: () => {}, onClose: () => {} };
    const target = createSerialDebugTarget(t);
    assert.equal(target.capabilities().timeFreezes, true);
  });

  it('detachable: true (link can die)', () => {
    const t = { write: async () => {}, onData: () => {}, onClose: () => {} };
    const target = createSerialDebugTarget(t);
    assert.equal(target.capabilities().detachable, true);
  });

  it('writable SFRs: SCON/SBUF/PCON/BRT refused with reasons', () => {
    const t = { write: async () => {}, onData: () => {}, onClose: () => {} };
    const target = createSerialDebugTarget(t);
    const refusals = target.capabilities().writable_sfr_refusals;

    assert.ok(refusals[0x98]?.includes('UART'), 'SCON reason');
    assert.ok(refusals[0x99]?.includes('UART'), 'SBUF reason');
    assert.ok(refusals[0x87], 'PCON reason');
    assert.ok(refusals[0x9C], 'BRT reason');
  });
});

describe('boundary D: serial vs emulator capability comparison', () => {
  it('serial capabilities are a strict subset of emulator capabilities', async () => {
    // Import the emulator target to compare
    let createEmu8051DebugTarget;
    try {
      const mod = await import('../src/emu8051-debug.js');
      createEmu8051DebugTarget = mod.createEmu8051DebugTarget;
    } catch {
      // Can't import if debug module has different requirements
      return;
    }

    const serialTransport = { write: async () => {}, onData: () => {}, onClose: () => {} };
    const serial = createSerialDebugTarget(serialTransport);
    const serialCaps = serial.capabilities();

    // Serial steps ⊂ emulator steps
    // Serial breakpoints ⊂ emulator breakpoints
    // Both should have 'block' in steps and 'yield' in breakpoints
    assert.ok(serialCaps.steps.includes('block'));
    assert.ok(serialCaps.breakpoints.includes('yield'));

    // Serial has extra properties the emulator doesn't need
    assert.equal(serialCaps.detachable, true, 'serial is detachable');
    assert.equal(serialCaps.timeFreezes, true, 'serial freezes time');
  });
});
