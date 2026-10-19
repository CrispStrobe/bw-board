/**
 * Z80 ACIA (MC6850) and CTC (Z80CTC) saveState/loadState round-trip tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MC6850 } from '../src/mc6850.js';
import { Z80CTC } from '../src/z80-ctc.js';

test('MC6850 ACIA: saveState/loadState round-trip', () => {
  const acia = new MC6850({});
  // Configure: enable RX interrupt (bit 7), store some control bits
  acia.write(0, 0x95); // control = 0x95, RX IRQ enabled
  acia.rxPush(0x42);   // push a byte
  acia.rxPush(0x43);   // push another (queued)

  assert.equal(acia.rdrf, true);
  assert.equal(acia.control, 0x95);

  const snap = acia.saveState();
  assert.equal(snap.rdrf, true);
  assert.equal(snap.control, 0x95);
  assert.equal(snap._rxByte, 0x42);
  assert.equal(snap.rx.length, 1); // 0x43 queued

  // Mutate
  acia.reset();
  assert.equal(acia.rdrf, false);

  // Restore
  acia.loadState(snap);
  assert.equal(acia.rdrf, true);
  assert.equal(acia.control, 0x95);
  // Read the byte — should be the snapshotted one
  assert.equal(acia.read(1), 0x42);
  assert.equal(acia.rdrf, true); // 0x43 still queued
  assert.equal(acia.read(1), 0x43);
});

test('Z80CTC: saveState/loadState round-trip preserves timer state', () => {
  const ctc = new Z80CTC({ clockHz: 4_000_000 });

  // Program channel 0: timer mode, prescaler 16, interrupt enabled, TC follows
  ctc.write(0, 0x85); // control: IE=1, timer, prescale=16, TC follows
  ctc.write(0, 100);   // TC = 100

  // Advance some cycles so the counter is partway through
  ctc.advance(800); // 800 / 16 = 50 prescaled ticks → counter = 100 - 50 = 50
  assert.equal(ctc.ch[0].count, 50);

  const snap = ctc.saveState();
  assert.equal(snap.ch[0].count, 50);
  assert.equal(snap.ch[0].tc, 100);
  assert.equal(snap.ch[0].running, true);

  // Advance an odd amount so the counter changes to a different value
  ctc.advance(480); // 480 / 16 = 30 ticks → counter = 50 - 30 = 20
  assert.equal(ctc.ch[0].count, 20, 'counter advanced to 20');

  // Restore
  ctc.loadState(snap);
  assert.equal(ctc.ch[0].count, 50, 'counter restored');
  assert.equal(ctc.ch[0].tc, 100, 'TC restored');
  assert.equal(ctc.ch[0].running, true, 'running restored');

  // Advance the same 480 cycles from restored state
  ctc.advance(480);
  const afterRestore = ctc.ch[0].count;

  // Fresh CTC: same programming, advance 800+480=1280
  const ctc2 = new Z80CTC({ clockHz: 4_000_000 });
  ctc2.write(0, 0x85);
  ctc2.write(0, 100);
  ctc2.advance(1280);

  assert.equal(afterRestore, ctc2.ch[0].count, 'lockstep count matches');
});

test('Z80CTC: vector saved and restored', () => {
  const ctc = new Z80CTC({});
  ctc.write(0, 0xF0); // vector = 0xF0 (bit 0 = 0 → vector write to ch0)
  assert.equal(ctc.vector, 0xF0);

  const snap = ctc.saveState();
  ctc.write(0, 0x00); // overwrite
  assert.equal(ctc.vector, 0x00);

  ctc.loadState(snap);
  assert.equal(ctc.vector, 0xF0, 'vector restored');
});
