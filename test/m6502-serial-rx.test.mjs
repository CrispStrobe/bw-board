// Typing into the serial console must reach firmware the way silicon
// does: through the ACIA's rxPush(), which raises RDRF. The adapter used
// to poke the raw rx overflow array — status never rose, MS BASIC polled
// forever, and typing at MEMORY SIZE? did nothing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createM6502Adapter } from '../src/m6502-adapter.js';

describe('6502 serial receive', () => {
  it('sendSerial raises the ACIA data-ready flag and delivers the byte', () => {
    const adapter = createM6502Adapter({}); // default Eater map: via1 + acia1
    const acia = adapter.machine.chips.acia1;
    assert.equal(acia.rdrf, false, 'idle: no data ready');
    assert.equal(adapter.sendSerial(0x38), true, 'byte accepted');
    assert.equal(acia.rdrf, true, 'RDRF raised — firmware polling status sees it');
    // Status register (reg 1) bit 3 = RDRF; data register (reg 0) returns the byte.
    assert.equal((acia.read(1) >> 3) & 1, 1, 'status register shows data ready');
    assert.equal(acia.read(0), 0x38, 'data register delivers the byte');
  });
});
