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

// ---------------------------------------------------------------------------
// ROTATION, POLL AND SPECIAL MASK MODE (2026-09-05)
//
// The header used to say: "OCW2's rotate commands are accepted and ignored",
// "NO POLL MODE (OCW3 bit 2) and no special mask mode". Accepted-and-ignored
// is the dangerous half: a program that rotates priority got NO error and a
// chip that kept servicing in the old order.
// ---------------------------------------------------------------------------

/** Bring a PIC up: ICW1 (single, ICW4), ICW2 base, ICW4, then unmask all. */
function ready(hooks) {
    const p = new I8259(hooks);
    p.write(0, 0x13);       // ICW1: ICW4 needed, single
    p.write(1, 0x08);       // ICW2: vector base 08h
    p.write(1, 0x01);       // ICW4: 8086 mode
    p.write(1, 0x00);       // OCW1: unmask everything
    return p;
}

test('OCW2 set-priority (cmd 110) makes the named level LOWEST', () => {
    const p = ready();
    // Default order is IR0 highest. Raise 2 and 5: 2 wins.
    p.setIRQ(5, 1); p.setIRQ(2, 1);
    assert.equal(p.acknowledge() & 7, 2, 'fixed priority: the lower number wins');

    const q = ready();
    q.write(0, 0xc0 | 3);   // set priority: level 3 becomes LOWEST -> order 4,5,6,7,0,1,2,3
    q.setIRQ(5, 1); q.setIRQ(2, 1);
    assert.equal(q.acknowledge() & 7, 5,
        'after rotation 5 outranks 2 — this is what "accepted and ignored" silently got wrong');
});

test('rotate on non-specific EOI drops the serviced level to lowest priority', () => {
    const p = ready();
    p.setIRQ(1, 1);
    assert.equal(p.acknowledge() & 7, 1);
    p.write(0, 0xa0);        // cmd 101: rotate on non-specific EOI
    assert.equal(p.isr, 0, 'the EOI still dismissed it');
    // 1 is now lowest, so order is 2,3,4,5,6,7,0,1 and 2 beats 0.
    p.setIRQ(0, 1); p.setIRQ(2, 1);
    assert.equal(p.acknowledge() & 7, 2, '0 is no longer top after the rotation');
});

test('rotate on SPECIFIC EOI rotates to the named level', () => {
    const p = ready();
    p.setIRQ(4, 1);
    p.acknowledge();
    p.write(0, 0xe0 | 4);    // cmd 111: specific EOI level 4, and rotate to it
    assert.equal(p.isr, 0);
    p.setIRQ(0, 1); p.setIRQ(5, 1);
    assert.equal(p.acknowledge() & 7, 5, 'order is now 5,6,7,0,...');
});

test('non-specific EOI clears the highest-priority in-service level, not the lowest-NUMBERED', () => {
    const p = ready();
    p.write(0, 0xc0 | 1);    // level 1 lowest -> order 2,3,4,5,6,7,0,1
    p.setIRQ(0, 1);
    p.acknowledge();         // 0 is in service (it is 7th in priority now)
    p.setIRQ(3, 1);
    p.acknowledge();         // 3 outranks 0 in this rotation, so it is serviced too
    assert.equal(p.isr, (1 << 0) | (1 << 3));
    p.write(0, 0x20);        // non-specific EOI
    assert.equal(p.isr, 1 << 0,
        'it must clear 3 (highest priority here), not 0 (lowest number)');
});

test('rotate-in-auto-EOI is an armed MODE, and rotates as each level is dismissed', () => {
    const p = new I8259();
    p.write(0, 0x13); p.write(1, 0x08); p.write(1, 0x03); p.write(1, 0x00);  // ICW4 auto-EOI
    p.write(0, 0x80);        // cmd 100: rotate in auto-EOI — SET
    p.setIRQ(1, 1);
    assert.equal(p.acknowledge() & 7, 1);
    assert.equal(p.isr, 0, 'auto-EOI dismisses immediately');
    p.setIRQ(0, 1); p.setIRQ(2, 1);
    assert.equal(p.acknowledge() & 7, 2, 'level 1 became lowest as it was dismissed');

    const q = new I8259();
    q.write(0, 0x13); q.write(1, 0x08); q.write(1, 0x03); q.write(1, 0x00);
    q.write(0, 0x00);        // cmd 000: rotate in auto-EOI — CLEAR
    q.setIRQ(1, 1); q.acknowledge();
    q.setIRQ(0, 1); q.setIRQ(2, 1);
    assert.equal(q.acknowledge() & 7, 0, 'unarmed, priority does not move');
});

test('POLL MODE: the read IS the acknowledge', () => {
    const p = ready();
    p.setIRQ(3, 1);
    p.write(0, 0x0c);        // OCW3 with P set
    const word = p.read(0);
    assert.equal(word & 0x80, 0x80, 'bit 7 says something was pending');
    assert.equal(word & 7, 3, 'and bits 2-0 name the level');
    assert.equal(p.isr, 1 << 3, 'the poll read set ISR exactly as an INTA would');
    assert.equal(p.irr & (1 << 3), 0, 'and cleared the request');
});

test('POLL MODE with nothing SERVICEABLE answers bit 7 clear, and does not acknowledge', () => {
    // WRITTEN THE OBVIOUS WAY FIRST, AND IT PASSED ON THE OLD IMPLEMENTATION.
    // With an empty IRR the old code's `read(0)` returned irr === 0, which is
    // the same 0x00 a correct poll returns, so the test agreed with a chip
    // that had no poll mode at all. Mutation-proving the whole file is the
    // only reason I know: ten of eleven failed and this one did not.
    //
    // A MASKED request discriminates. IRR is non-zero, so the old read returns
    // 0x08; nothing is SERVICEABLE, so a real poll returns 0x00.
    const p = ready();
    p.write(1, 0xff);                // mask everything
    p.setIRQ(3, 1);                  // pending in IRR, but not serviceable
    p.write(0, 0x0c);
    assert.equal(p.read(0), 0x00,
        'a poll reports what is SERVICEABLE, not what is merely latched in IRR');
    assert.equal(p.isr, 0, 'and it acknowledged nothing');
    assert.equal(p.irr, 1 << 3, 'the request is still latched, waiting for the mask to lift');
});

test('POLL is one-shot: the read after it is an ordinary IRR read', () => {
    const p = ready();
    p.setIRQ(2, 1);
    p.write(0, 0x0c);
    p.read(0);                       // consumes the poll
    p.setIRQ(6, 1);
    assert.equal(p.read(0), 1 << 6,
        'a sticky poll flag would turn this IRR read into an unintended acknowledge');
    assert.equal(p.isr, 1 << 2, 'so ISR must be unchanged by it');
});

test('SPECIAL MASK MODE lets a MASKED in-service level stop blocking lower priorities', () => {
    const p = ready();
    p.setIRQ(1, 1);
    p.acknowledge();                 // 1 in service, blocks 2..7
    p.setIRQ(4, 1);
    assert.equal(p.intActive, false, 'normally an in-service level blocks everything below it');

    p.write(1, 1 << 1);              // mask level 1
    p.write(0, 0x68);                // OCW3: ESMM|SMM — special mask ON
    assert.equal(p.intActive, true, 'the masked in-service level no longer blocks 4');

    p.write(0, 0x48);                // OCW3: ESMM set, SMM clear — special mask OFF
    assert.equal(p.intActive, false, 'and it blocks again when the mode is cleared');
});

test('SMM without ESMM changes nothing', () => {
    const p = ready();
    p.write(0, 0x28);                // SMM set, ESMM clear
    assert.equal(p.specialMask, false,
        'the enable bit guards the write — a stray OCW3 must not toggle the mode');
});

test('a checkpoint carries the priority order, and an OLD one restores to fixed', () => {
    const p = ready();
    p.write(0, 0xc0 | 3);            // rotate: 3 lowest
    const saved = p.getState();
    assert.equal(saved.lowestPriority, 3, 'the order is part of the state');

    const q = ready();
    q.setState(saved);
    q.setIRQ(5, 1); q.setIRQ(2, 1);
    assert.equal(q.acknowledge() & 7, 5, 'and the restored chip services in the saved order');

    // A checkpoint written before these fields existed must come back FIXED,
    // not undefined — which would make the priority walk produce NaN levels.
    const old = ready().getState();
    delete old.lowestPriority; delete old.specialMask;
    delete old.pollPending; delete old.rotateOnAutoEOI;
    const r = ready();
    r.setState(old);
    r.setIRQ(5, 1); r.setIRQ(2, 1);
    assert.equal(r.acknowledge() & 7, 2, 'an old checkpoint restores to IR0-highest');
});
