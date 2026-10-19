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

test('8254 is the default variant', () => {
    assert.equal(pit().variant, '8254');
    assert.equal(new I8254({ variant: '8253' }).variant, '8253');
    assert.equal(new I8254({ variant: 'nonsense' }).variant, '8254', 'unknown falls back to 8254');
});

test('8253 variant: the read-back command is ignored (no 8254 extension)', () => {
    const t = new I8254({ variant: '8253' });
    t.write(3, 0x34);   // counter 0, rw=3, mode 2
    t.write(0, 100); t.write(0, 0);
    t.advance(10);
    // On an 8254, 0xC2 latches status+count and the FIRST read returns the
    // status byte (0xB4 here: OUT high, rw=3, mode 2). On the 8253 the command
    // is illegal (counter 3) and ignored, so the counter is NOT latched and the
    // reads return the LIVE count (90) directly — no status byte in front.
    t.write(3, 0xc2);
    const lo = t.read(0);
    const hi = t.read(0);
    assert.equal(lo | (hi << 8), 90, 'reads returned the live count, not a latched status');
});

test('8253 vs 8254: same read-back word, different first read', () => {
    const setup = (v) => {
        const t = new I8254({ variant: v });
        t.write(3, 0x34); t.write(0, 100); t.write(0, 0); t.advance(10);
        t.write(3, 0xc2);
        return t.read(0);          // the first read after the read-back word
    };
    assert.equal(setup('8254') & 0x80, 0x80, '8254: first read is the status byte (OUT bit set)');
    assert.equal(setup('8253'), 90, '8253: first read is the live count LSB');
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

// ---------------------------------------------------------------------------
// MODES 1 AND 5, AND BCD (2026-09-05)
//
// The header used to say, honestly: "NO MODES 1 OR 5 ... the gate is assumed
// asserted and a counter simply counts" and "NO BCD. The BCD bit is stored and
// read back in the status byte, but the counter counts in binary regardless."
//
// Both were real accuracy gaps with observable consequences, and the second is
// the more interesting one: the BCD bit ROUND-TRIPPED. A program could set it,
// read the status byte back, and see it set -- the one check a program is
// likely to make agreed with the datasheet while the counting did not.
// ---------------------------------------------------------------------------

test('mode 1: a GATE EDGE starts the one-shot, and OUT is low for exactly the count', () => {
    const t = pit({});
    t.write(3, 0x32);               // counter 0, rw=3, mode 1, binary
    t.write(0, 4); t.write(0, 0);   // count = 4
    // A count write does NOT start mode 1 -- only a gate edge does. This is
    // the whole difference from mode 4, and the reason the old level-only
    // model could never fire it.
    assert.equal(t.counters[0].out, 1, 'OUT idles high before the trigger');
    t.advance(10);
    assert.equal(t.counters[0].out, 1, 'no gate edge, so nothing has started');

    t.counters[0].setGate(0);
    t.counters[0].setGate(1);       // rising edge: trigger
    assert.equal(t.counters[0].out, 0, 'OUT goes low on the trigger');
    t.advance(3);
    assert.equal(t.counters[0].out, 0, 'still low three counts in');
    t.advance(1);
    assert.equal(t.counters[0].out, 1, 'high at terminal count');
});

test('mode 1 is RETRIGGERABLE: an edge mid-count restarts the full period', () => {
    const t = pit({});
    t.write(3, 0x32);
    t.write(0, 6); t.write(0, 0);
    t.counters[0].setGate(0); t.counters[0].setGate(1);
    t.advance(4);                    // 2 counts left
    assert.equal(t.counters[0].out, 0);
    t.counters[0].setGate(0); t.counters[0].setGate(1);   // retrigger
    t.advance(4);
    assert.equal(t.counters[0].out, 0, 'the retrigger restarted the whole 6, not the remaining 2');
    t.advance(2);
    assert.equal(t.counters[0].out, 1, 'and it ends 6 counts after the LAST edge');
});

test('mode 1 keeps counting while the gate is LOW (it is edge-triggered, not level-gated)', () => {
    const t = pit({});
    t.write(3, 0x32);
    t.write(0, 3); t.write(0, 0);
    t.counters[0].setGate(0); t.counters[0].setGate(1);
    t.counters[0].setGate(0);        // drop the gate immediately after triggering
    t.advance(3);
    assert.equal(t.counters[0].out, 1,
        'a low gate must not freeze a one-shot the edge already armed');
});

test('mode 5: OUT stays HIGH through the count and strobes low for one tick', () => {
    const edges = [];
    const t = pit({ onOutput: (ch, lv) => edges.push(lv) });
    t.write(3, 0x3a);               // counter 0, rw=3, mode 5, binary
    t.write(0, 3); t.write(0, 0);
    t.counters[0].setGate(0); t.counters[0].setGate(1);
    assert.equal(t.counters[0].out, 1, 'mode 5 does NOT drop OUT on the trigger (mode 1 does)');
    t.advance(2);
    assert.equal(t.counters[0].out, 1, 'still high mid-count');
    t.advance(1);
    assert.equal(t.counters[0].out, 1, 'back high after a one-tick strobe');
    assert.ok(edges.includes(0), 'and the strobe was visible as a low edge');
});

test('BCD: the counter counts in DECADES, so 0x20 decrements to 0x19', () => {
    const t = pit({});
    t.write(3, 0x31);               // counter 0, rw=3, mode 0, BCD
    t.write(0, 0x20); t.write(0, 0x00);   // count = 20 (decimal), 0x20 in BCD
    t.advance(1);
    assert.equal(t.counters[0].ce, 0x19,
        'a binary decrement would give 0x1f; BCD borrows a decade');
});

test('BCD: terminal count arrives after the DECIMAL count, not the hex one', () => {
    const t = pit({});
    t.write(3, 0x31);
    t.write(0, 0x20); t.write(0, 0x00);   // 20 decimal
    t.advance(19);
    assert.equal(t.counters[0].out, 0, 'not yet at 19');
    t.advance(1);
    assert.equal(t.counters[0].out, 1, 'terminal count at exactly 20 ticks');
});

test('BCD: a reload of 0 is ten thousand, not sixty-five thousand', () => {
    const t = pit({});
    t.write(3, 0x31);
    t.write(0, 0); t.write(0, 0);
    assert.equal(t.counters[0]._fullCount(), 10000, 'four decades, not sixteen bits');
});

test('gate: a LOW level suspends mode 0, and mode 2 is forced OUT high', () => {
    const t = pit({});
    t.write(3, 0x30);               // mode 0
    t.write(0, 5); t.write(0, 0);
    t.counters[0].setGate(0);
    t.advance(10);
    assert.equal(t.counters[0].out, 0, 'mode 0 is level-gated: a low gate stops the count');
    t.counters[0].setGate(1);
    t.advance(5);
    assert.equal(t.counters[0].out, 1, 'and it resumes when the gate returns');

    const u = pit({});
    u.write(3, 0x34);               // mode 2
    u.write(0, 4); u.write(0, 0);
    u.counters[0].setGate(0);
    assert.equal(u.counters[0].out, 1, 'a falling gate FORCES mode 2 OUT high, not merely pauses it');
});

test('ticksToEdge schedules modes 1, 4 and 5 instead of reporting Infinity', () => {
    const t = pit({});
    t.write(3, 0x32);               // mode 1
    t.write(0, 7); t.write(0, 0);
    t.counters[0].setGate(0); t.counters[0].setGate(1);
    assert.equal(t.counters[0].ticksToEdge(), 7,
        'Infinity here lets the pump step straight past the pulse');
    t.advance(3);
    assert.equal(t.counters[0].ticksToEdge(), 4);
});
