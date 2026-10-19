// Z8430 CTC oracle tests — every expectation hand-computed from the
// Zilog datasheet's control-word table and timer arithmetic.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Z80CTC } from '../src/z80-ctc.js';

describe('Z8430 CTC', () => {
  it('timer mode: prescale 256, TC 125 at 4MHz = 8ms period', () => {
    const ctc = new Z80CTC({ clockHz: 4_000_000 });
    ctc.write(0, 0xa5); // IE=1, timer, prescale 256, TC follows, control
    ctc.write(0, 125);
    // 125 * 256 = 32000 cycles per period; at 4MHz that is 8ms.
    ctc.advance(31999);
    assert.equal(ctc.irqAsserted, false, 'one cycle short: no zero yet');
    ctc.advance(1);
    assert.equal(ctc.irqAsserted, true, 'exactly 32000 cycles: zero + IRQ');
  });

  it('the down-counter is live-readable and reloads at zero', () => {
    const ctc = new Z80CTC();
    ctc.write(1, 0x25); // no IE, timer, prescale 256, TC follows
    ctc.write(1, 10);
    assert.equal(ctc.read(1), 10);
    ctc.advance(256 * 3);
    assert.equal(ctc.read(1), 7, 'three prescaled ticks down');
    ctc.advance(256 * 7);
    assert.equal(ctc.read(1), 10, 'reached zero and reloaded to TC');
    assert.equal(ctc.irqAsserted, false, 'no IE, no IRQ');
  });

  it('prescale 16 runs 16x faster than 256', () => {
    const ctc = new Z80CTC();
    ctc.write(2, 0x05); // timer, prescale 16, TC follows
    ctc.write(2, 100);
    ctc.advance(16 * 25);
    assert.equal(ctc.read(2), 75);
  });

  it('IM2 vector: base from channel 0, offset = channel << 1', () => {
    const ctc = new Z80CTC();
    ctc.write(0, 0x40); // bit0=0 → vector write: base 0x40
    ctc.write(2, 0xa5); ctc.write(2, 1); // ch2 fast timer with IE
    ctc.advance(256);
    assert.equal(ctc.irqAsserted, true);
    assert.equal(ctc.ackVector(), 0x40 | (2 << 1), 'vector 0x44 for channel 2');
    assert.equal(ctc.irqAsserted, false, 'acknowledge clears the channel');
  });

  it('software reset stops the channel and clears pending state', () => {
    const ctc = new Z80CTC();
    ctc.write(0, 0xa5); ctc.write(0, 1);
    ctc.advance(256);
    assert.equal(ctc.irqAsserted, true);
    ctc.write(0, 0x03); // reset, control
    assert.equal(ctc.irqAsserted, false);
    const before = ctc.read(0);
    ctc.advance(10_000);
    assert.equal(ctc.read(0), before, 'stopped: the counter does not move');
  });

  it('counter mode is a NAMED limitation, not silent wrongness', () => {
    const ctc = new Z80CTC();
    ctc.write(3, 0x45); // counter mode, TC follows
    ctc.write(3, 5);
    ctc.advance(100_000);
    assert.equal(ctc.read(3), 0, 'no external CLK/TRG modelled: does not advance');
    assert.ok(ctc.notes.includes('counter-mode'));
  });

  it('TC 0 counts the full 256', () => {
    const ctc = new Z80CTC();
    ctc.write(1, 0xa5); ctc.write(1, 0);
    ctc.advance(256 * 255);
    assert.equal(ctc.irqAsserted, false, '255 ticks: not yet');
    ctc.advance(256);
    assert.equal(ctc.irqAsserted, true, 'the 256th tick fires');
  });
});

