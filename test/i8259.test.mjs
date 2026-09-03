import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8259 } from '../src/i8259.js';

function pic(hooks) { return new I8259(hooks); }

function initPIC(p, vectorBase = 0x08) {
    // ICW1: single, ICW4 needed
    p.write(0, 0x13);    // 0001_0011: edge, single, ICW4 needed
    // ICW2: vector base
    p.write(1, vectorBase);
    // ICW4: 8086 mode, normal EOI
    p.write(1, 0x01);    // 0000_0001: 8086 mode
}

test('initialization sequence sets the vector base', () => {
    const p = pic();
    initPIC(p, 0x20);
    assert.equal(p.vectorBase, 0x20);
    assert.equal(p.autoEOI, false);
});

test('auto-EOI mode from ICW4', () => {
    const p = pic();
    p.write(0, 0x13);   // ICW1
    p.write(1, 0x08);   // ICW2
    p.write(1, 0x03);   // ICW4: 8086 mode + auto-EOI
    assert.equal(p.autoEOI, true);
});

test('an IRQ raises INT; acknowledge returns the vector and sets ISR', () => {
    const edges = [];
    const p = pic({ onInterrupt: (a) => edges.push(a) });
    initPIC(p, 0x08);

    p.setIRQ(3, 1);
    assert.equal(p.intActive, true);
    assert.ok(edges.includes(true));

    const vec = p.acknowledge();
    assert.equal(vec, 0x08 + 3, 'vector = base | irq');
    assert.equal(p.isr & (1 << 3), 1 << 3, 'ISR bit 3 set');
    assert.equal(p.irr & (1 << 3), 0, 'IRR bit 3 cleared');
});

test('a masked IRQ does not raise INT', () => {
    const p = pic();
    initPIC(p);
    p.write(1, 0x08);   // OCW1: mask IRQ 3
    p.setIRQ(3, 1);
    assert.equal(p.intActive, false, 'IRQ 3 is masked');
    p.setIRQ(0, 1);
    assert.equal(p.intActive, true, 'IRQ 0 is not masked');
});

test('priority: IRQ 0 beats IRQ 7, and an in-service IRQ blocks lower priority', () => {
    const p = pic();
    initPIC(p);
    p.setIRQ(7, 1);
    p.setIRQ(0, 1);
    // Acknowledge should take IRQ 0 first
    const v1 = p.acknowledge();
    assert.equal(v1, 0x08, 'IRQ 0 first');
    // Now IRQ 0 is in-service. IRQ 7 is pending but lower priority → blocked.
    assert.equal(p.intActive, false, 'IRQ 7 blocked by IRQ 0 in service');
    // Non-specific EOI clears IRQ 0's ISR
    p.write(0, 0x20);   // OCW2: non-specific EOI
    assert.equal(p.intActive, true, 'IRQ 7 now serviceable');
    const v2 = p.acknowledge();
    assert.equal(v2, 0x08 + 7);
});

test('specific EOI clears a named level', () => {
    const p = pic();
    initPIC(p);
    p.setIRQ(2, 1);
    p.acknowledge();     // takes IRQ 2, sets ISR bit 2
    assert.equal(p.isr, 1 << 2);
    // Specific EOI for level 2
    p.write(0, 0x62);   // 0110_0010: specific EOI, level 2
    assert.equal(p.isr, 0);
});

test('non-specific EOI clears the highest-priority in-service bit', () => {
    const p = pic();
    initPIC(p);
    p.setIRQ(1, 1);
    p.acknowledge();     // ISR bit 1
    p.setIRQ(5, 1);
    // Non-specific EOI clears bit 1 (highest priority in ISR)
    p.write(0, 0x20);
    assert.equal(p.isr, 0);
    assert.equal(p.intActive, true, 'IRQ 5 now unblocked');
});

test('auto-EOI does not set the ISR bit', () => {
    const p = pic();
    p.write(0, 0x13);
    p.write(1, 0x08);
    p.write(1, 0x03);   // auto-EOI
    p.setIRQ(4, 1);
    p.acknowledge();
    assert.equal(p.isr, 0, 'ISR stays clear in auto-EOI');
});

test('OCW3 switches between reading IRR and ISR', () => {
    const p = pic();
    initPIC(p);
    p.setIRQ(2, 1);
    // Default: read IRR
    assert.equal(p.read(0) & (1 << 2), 1 << 2, 'IRR shows bit 2');
    p.acknowledge();     // moves bit 2 from IRR to ISR
    // Read ISR via OCW3
    p.write(0, 0x0b);   // OCW3: read ISR (bit 0=1, bit 1=1, bit 3=1)
    assert.equal(p.read(0) & (1 << 2), 1 << 2, 'ISR shows bit 2');
    // Switch back to IRR
    p.write(0, 0x0a);   // OCW3: read IRR
    assert.equal(p.read(0) & (1 << 2), 0, 'IRR no longer has bit 2');
});

test('IMR reads back at A0=1', () => {
    const p = pic();
    initPIC(p);
    p.write(1, 0x5a);   // OCW1: mask
    assert.equal(p.read(1), 0x5a);
});

test('re-initialization resets state', () => {
    const p = pic();
    initPIC(p, 0x08);
    p.setIRQ(1, 1);
    p.acknowledge();
    assert.ok(p.isr > 0);
    // Re-init
    initPIC(p, 0x20);
    assert.equal(p.isr, 0);
    assert.equal(p.irr, 0);
    assert.equal(p.imr, 0);
    assert.equal(p.vectorBase, 0x20);
});

test('lowering an IRQ line clears the request', () => {
    const p = pic();
    initPIC(p);
    p.setIRQ(0, 1);
    assert.equal(p.intActive, true);
    p.setIRQ(0, 0);
    assert.equal(p.intActive, false);
    assert.equal(p.irr, 0);
});

test('cascade mode expects ICW3', () => {
    const p = pic();
    // ICW1: cascade (SNGL=0), ICW4 needed
    p.write(0, 0x11);    // 0001_0001
    p.write(1, 0x08);    // ICW2
    p.write(1, 0x04);    // ICW3: slave on IR2
    p.write(1, 0x01);    // ICW4
    assert.equal(p.vectorBase, 0x08);
    assert.equal(p._initPhase, 0, 'initialization complete');
});

test('initPhase and initWarning expose why a mid-init PIC stays silent', () => {
    const p = pic();
    assert.equal(p.initPhase, 0);
    assert.equal(p.initWarning, null, 'operational chip has no warning');

    // The trap lego-47 hit: ICW1 = 11h selects CASCADE (SNGL clear), so the
    // chip needs an ICW3 that a single-PIC init never sends. It then eats the
    // intended ICW2 and ICW4 as ICW3/ICW2 and never leaves initialisation.
    p.write(0, 0x11);              // ICW1, cascade + ICW4
    assert.equal(p.initPhase, 1);
    assert.match(p.initWarning, /awaiting ICW2/);
    p.write(1, 0x08);             // meant as ICW2 — consumed as ICW2, phase -> ICW3
    assert.equal(p.initPhase, 2);
    assert.match(p.initWarning, /awaiting ICW3/);
    p.write(1, 0x01);             // meant as ICW4 — consumed as ICW3, phase -> ICW4
    assert.equal(p.initPhase, 3);
    assert.match(p.initWarning, /awaiting ICW4/);

    // Still deaf: an IRQ raises nothing because init never finished.
    p.setIRQ(0, 1);
    assert.equal(p.intActive, false, 'a chip stuck in init does not interrupt');

    // The correct single-PIC init (ICW1 = 13h) clears the warning.
    p.write(0, 0x13); p.write(1, 0x08); p.write(1, 0x01);
    assert.equal(p.initPhase, 0);
    assert.equal(p.initWarning, null);
});

test('initWarning round-trips through save/load', () => {
    const p = pic();
    p.write(0, 0x11);             // leave it mid-init
    const snap = p.getState();
    const q = pic();
    q.setState(snap);
    assert.equal(q.initPhase, 1);
    assert.match(q.initWarning, /awaiting ICW2/);
});

test('state round-trips', () => {
    const p = pic();
    initPIC(p, 0x30);
    p.setIRQ(5, 1);
    p.write(1, 0xdf);    // mask all but IRQ 5
    const snap = p.getState();

    const p2 = pic();
    p2.setState(snap);
    assert.equal(p2.vectorBase, 0x30);
    assert.equal(p2.imr, 0xdf);
    assert.equal(p2.irr, 1 << 5);
    assert.equal(p2.intActive, true);
    assert.equal(p2.acknowledge(), 0x30 + 5);
});
