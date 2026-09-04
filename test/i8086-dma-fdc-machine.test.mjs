// The 8237 and the uPD765 were written, documented and unit-tested, and no
// machine could instantiate either of them: I8086Machine's chip factory had no
// 'dma' and no 'fdc' kind, so `chips: [{kind:'fdc', ...}]` threw "unknown chip
// kind" and nothing in the tier ever put one on a bus.
//
// Sixth instance of the pattern this repo keeps naming: a property nothing
// drives is a property nothing tests, and it looks identical to a passing one.
// Both chips' own suites were green throughout. What was missing was the two
// lines that let a config reach them — and it was found, as four of the five
// before it were, by a change from an unrelated direction: vendoring the tier
// into the overlay, where a gate that refuses modules nothing imports listed
// i8237.js and upd765.js by name.
//
// So these tests drive them THROUGH A MACHINE, on ports, which is the surface
// that did not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';

/**
 * THE MACHINE IS NOT DEFINED HERE, ON PURPOSE. `PCXT8086` is the board preset
 * exported by src/i8086-machine.js and shipped to users in the Circuit
 * Designer's "load an 8086 board" list. This file used to carry its own copy
 * called XTDISK, and the two were separate descriptions of one machine.
 *
 * They had already drifted: the preset's RAM stopped at 0x9FFFF, so writes to
 * the CGA text page at B800:0000 vanished into unmapped space, while this
 * file's copy mapped it. A user's board and this suite's board were different
 * computers, and each of us only ran one of them -- so a program would have
 * worked here and shown a blank screen in the app, with nothing failing.
 *
 * The offer on the table was an assertion that the two configs are equal. This
 * is better: there is one config, so there is nothing to keep equal. An
 * equality check between two hand-maintained copies still leaves two copies,
 * and it only fires after someone has already written the second one wrong.
 */

test('a machine config can name a dma and an fdc at all', () => {
    const m = new I8086Machine(PCXT8086);
    assert.ok(m.chips.dma1, 'the 8237 is on the bus');
    assert.ok(m.chips.fdc1, 'the uPD765 is on the bus');
    // Before this wiring both of these threw `unknown chip kind`.
});

test('the FDC answers its main status register on the real port', () => {
    const m = new I8086Machine(PCXT8086);
    // 3F4h is the MSR. After reset the controller wants a command byte: RQM
    // set, DIO clear (host -> controller).
    const msr = m._in(0x3f4);
    assert.equal(msr & 0x80, 0x80, 'RQM: the controller is ready for a byte');
    assert.equal(msr & 0x40, 0x00, 'DIO clear: it expects to be written to, not read');
    // 3F0h, 3F1h, 3F3h and 3F6h are not decoded by the XT card; the bus floats.
    assert.equal(m._in(0x3f0), 0xff, 'undecoded ports float high rather than inventing a register');
});

test('the page latch reaches the SAME 8237 the data ports do', () => {
    // This is the assertion the two-window arrangement exists for. The latch is
    // a separate 74LS670 at 80h-8Fh, 0x70 ports away from the chip it extends,
    // and the address it supplies must be the same channel's.
    const m = new I8086Machine(PCXT8086);
    m._out(0x83, 0x2b);              // 83h is channel 1's page on an XT
    assert.equal(m._in(0x83), 0x2b, 'read back through the port');
    assert.equal(m.chips.dma1.channels[1].page, 0x2b,
        'and it landed in channel 1 of the 8237 itself, not in a second copy');
});

test('port 80h has no channel behind it, and is still a real byte', () => {
    // The XT wrote POST codes there. It latches nothing and drives nothing,
    // but a stored value reads back, which cannot mislead anyone and is more
    // useful than open bus when a ROM is using it as a progress display.
    const m = new I8086Machine(PCXT8086);
    m._out(0x80, 0x41);
    assert.equal(m._in(0x80), 0x41);
    for (const ch of m.chips.dma1.channels) {
        assert.equal(ch.page, 0, 'no channel page was disturbed');
    }
});

test('the FDC interrupt reaches the PIC through the generic irq wiring', () => {
    const m = new I8086Machine(PCXT8086);
    // ICW1 single + ICW4, base 08h, 8086 mode, unmask IRQ6 only.
    m._out(0x20, 0x13); m._out(0x21, 0x08); m._out(0x21, 0x01); m._out(0x21, 0xbf);
    assert.equal(m.chips.pic1.irr & (1 << 6), 0, 'quiet to begin with');
    m.chips.fdc1.hooks.onIrqChange(true);
    assert.equal(m.chips.pic1.irr & (1 << 6), 1 << 6, 'IRQ6 asserted at the PIC');
    m.chips.fdc1.hooks.onIrqChange(false);
    assert.equal(m.chips.pic1.irr & (1 << 6), 0, 'and released');
});

test('a page latch naming no 8237 is refused, with the reason', () => {
    assert.throws(() => new I8086Machine({
        ...PCXT8086,
        chips: [{ kind: 'dmapage', name: 'page', at: 0x80, dma: 'nosuch' }],
    }), /names dma 'nosuch'/,
    'silently registering an inert latch would give a machine that decodes 80h-8Fh, '
    + 'accepts every write, and supplies A16-A19 to nothing');
});

test('the page bytes survive a snapshot, and are not stored twice', () => {
    const m = new I8086Machine(PCXT8086);
    m._out(0x87, 0x3c);                       // channel 0's page
    const snap = m.saveState();
    assert.equal(Object.keys(snap.chips).filter((n) => n === 'page').length, 0,
        'the latch is a WINDOW, not a chip: its state lives in the 8237 and a '
        + 'second entry would restore it twice');
    const m2 = new I8086Machine(PCXT8086);
    m2.loadState(snap);
    assert.equal(m2._in(0x87), 0x3c, 'and it comes back through the latch window');
});
