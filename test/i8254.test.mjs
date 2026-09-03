import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8254 } from '../src/i8254.js';

function pit(hooks) { return new I8254(hooks); }

test('mode 0: OUT goes high when the count reaches zero', () => {
    const edges = [];
    const t = pit({ onOutput: (ch, lv) => edges.push({ ch, lv }) });
    // Control: counter 0, rw=3 (LSB then MSB), mode 0, binary
    t.write(3, 0x30);
    assert.equal(t.counters[0].out, 0, 'OUT starts low in mode 0');
    // Load count = 5
    t.write(0, 5); t.write(0, 0);
    assert.equal(t.counters[0].ce, 5);
    t.advance(4);
    assert.equal(t.counters[0].out, 0, 'not yet');
    t.advance(1);
    assert.equal(t.counters[0].out, 1, 'OUT high at zero');
    // Further ticking does not toggle again
    t.advance(10);
    assert.equal(t.counters[0].out, 1, 'stays high');
});

test('mode 2: rate generator reloads and pulses OUT low for one tick', () => {
    const edges = [];
    const t = pit({ onOutput: (ch, lv) => edges.push({ ch, lv }) });
    // Counter 0, rw=3, mode 2, binary
    t.write(3, 0x34);
    assert.equal(t.counters[0].out, 1, 'OUT starts high in mode 2');
    t.write(0, 4); t.write(0, 0);   // count = 4
    // mode 2: OUT high for 3 ticks, low for 1, then reloads
    t.advance(3);
    assert.equal(t.counters[0].out, 1, 'still high after 3');
    // The 4th tick: ce goes to 1, pulse low then high, reload
    t.advance(1);
    // After the pulse, out should be 1 again (reloaded)
    assert.equal(t.counters[0].out, 1, 'reloaded');
    // The pulse should have produced low-then-high edges
    assert.ok(edges.some((e) => e.lv === 0), 'pulsed low');
    assert.ok(edges.some((e) => e.lv === 1), 'returned high');
});

test('mode 3: square wave toggles', () => {
    const edges = [];
    const t = pit({ onOutput: (ch, lv) => edges.push({ ch, lv }) });
    // Counter 0, rw=3, mode 3, binary
    t.write(3, 0x36);
    t.write(0, 6); t.write(0, 0);   // count = 6
    // mode 3 with count 6: toggle every 3 ticks (6/2)
    const start = t.counters[0].out;
    t.advance(3);
    assert.notEqual(t.counters[0].out, start, 'toggled after half-period');
    t.advance(3);
    assert.equal(t.counters[0].out, start, 'back to start after full period');
});

test('reading a counter returns the counting element', () => {
    const t = pit();
    t.write(3, 0x30);    // counter 0, rw=3, mode 0
    t.write(0, 100); t.write(0, 0);
    t.advance(30);
    // Read LSB then MSB
    const lo = t.read(0);
    const hi = t.read(0);
    assert.equal(lo | (hi << 8), 70);
});

test('latch freezes the count for reading without stopping it', () => {
    const t = pit();
    t.write(3, 0x30);
    t.write(0, 100); t.write(0, 0);
    t.advance(30);
    // Latch counter 0
    t.write(3, 0x00);   // SC=0, RW=0 = latch command
    t.advance(20);       // counter keeps going
    const lo = t.read(0);
    const hi = t.read(0);
    assert.equal(lo | (hi << 8), 70, 'latched value, not the current one');
    // After the latched read completes, next read is live
    const lo2 = t.read(0);
    const hi2 = t.read(0);
    assert.equal(lo2 | (hi2 << 8), 50, 'live value after latch consumed');
});

test('counter 1 and 2 work independently', () => {
    const t = pit();
    // Counter 1: mode 0, count 10
    t.write(3, 0x70);   // SC=1, rw=3, mode 0
    t.write(1, 10); t.write(1, 0);
    // Counter 2: mode 0, count 20
    t.write(3, 0xb0);   // SC=2, rw=3, mode 0
    t.write(2, 20); t.write(2, 0);
    t.advance(10);
    assert.equal(t.counters[0].out, 0, 'counter 0 was never loaded');
    assert.equal(t.counters[1].out, 1, 'counter 1 done');
    assert.equal(t.counters[2].out, 0, 'counter 2 not yet');
    t.advance(10);
    assert.equal(t.counters[2].out, 1, 'counter 2 done');
});

test('read-back command latches count and status', () => {
    const t = pit();
    t.write(3, 0x34);   // counter 0, rw=3, mode 2
    t.write(0, 100); t.write(0, 0);
    t.advance(10);
    // Read-back: latch count AND status for counter 0 (bit 1 = counter 0)
    // bits: 11xx_xx10 → SC=3(readback), ~count=0, ~status=0, counters=bit1=ch0
    t.write(3, 0xc2);   // 1100_0010: latch both for counter 0
    // Status read comes first
    const status = t.read(0);
    assert.equal(status & 0x80, 0x80, 'OUT is high');
    assert.equal((status >> 1) & 7, 2, 'mode 2');
    // Then count
    const lo = t.read(0);
    const hi = t.read(0);
    assert.equal(lo | (hi << 8), 90);
});

test('control register reads as 0xFF', () => {
    const t = pit();
    assert.equal(t.read(3), 0xff);
});

test('rw=1 writes/reads only LSB', () => {
    const t = pit();
    t.write(3, 0x10);   // counter 0, rw=1(LSB only), mode 0
    t.write(0, 42);
    assert.equal(t.counters[0].ce, 42);
    t.advance(2);
    assert.equal(t.read(0), 40);
});

test('rw=2 writes/reads only MSB', () => {
    const t = pit();
    t.write(3, 0x20);   // counter 0, rw=2(MSB only), mode 0
    t.write(0, 1);       // reload = 0x0100 = 256
    assert.equal(t.counters[0].ce, 256);
    t.advance(6);
    assert.equal(t.read(0), 0);   // MSB: (250 >> 8) = 0
});

test('count of zero means 65536 (0x10000)', () => {
    const t = pit();
    t.write(3, 0x30);
    t.write(0, 0); t.write(0, 0);   // count = 0 → 65536
    assert.equal(t.counters[0].ce, 0x10000);
});

test('nextWake reports ticks to the nearest edge', () => {
    const t = pit();
    t.write(3, 0x30);
    t.write(0, 50); t.write(0, 0);
    assert.equal(t.nextWake(), 50, 'mode 0: 50 ticks to OUT going high');
    t.advance(20);
    assert.equal(t.nextWake(), 30);
});

test('state round-trips', () => {
    const t = pit();
    t.write(3, 0x34);
    t.write(0, 100); t.write(0, 0);
    t.advance(25);
    const snap = t.getState();
    const t2 = pit();
    t2.setState(snap);
    assert.equal(t2.counters[0].ce, t.counters[0].ce);
    assert.equal(t2.counters[0].mode, 2);
    t.advance(10); t2.advance(10);
    assert.equal(t2.counters[0].ce, t.counters[0].ce);
});
