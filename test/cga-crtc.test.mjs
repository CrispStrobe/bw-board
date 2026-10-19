// E6.8.5 — the CGA card driven by a real MC6845. The 3D4h/3D5h CRTC now latches
// and reads back, the start address and cursor are emitted for the renderer, and
// the vertical-retrace proportion is derived from the CRTC's own registers — while
// an unprogrammed card reproduces the exact 262-total / 200-active frame it always
// had, so no game that polls 3DAh is disturbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CGACard } from '../src/cga-card.js';

function setReg(c, index, val) { c.write(0x04, index); c.write(0x05, val); }

test('power-on geometry is unchanged — 200 active of 262 total, the frame it always had', () => {
    const c = new CGACard(4_772_727);
    assert.ok(Math.abs(c._active / c._frame - 200 / 262) < 0.005, 'active/total ratio is 200/262');
    // The retrace bit still swings across a frame — a polling game still syncs.
    let low = false, high = false;
    for (let i = 0; i < c._frame; i++) { c.advance(1); (c._status() & 0x08) ? (high = true) : (low = true); }
    assert.ok(low && high, 'the vertical-retrace bit is both low (active) and high (blank) within one frame');
});

test('the start address (R12:R13) is emitted for the renderer', () => {
    const c = new CGACard(4_772_727);
    setReg(c, 12, 0x02); setReg(c, 13, 0x00);            // R12:R13 = 0x0200
    assert.equal(c.getVideoState().startAddr, 0x0200, 'a page flip moves the display base');
});

test('the cursor position and shape (R14:R15, R10, R11) are emitted', () => {
    const c = new CGACard(4_772_727);
    setReg(c, 14, 0x00); setReg(c, 15, 0xa0);            // cursor at offset 0x00A0
    setReg(c, 10, 6); setReg(c, 11, 7);                  // cursor scan lines 6..7
    const vs = c.getVideoState();
    assert.equal(vs.cursorAddr, 0x00a0);
    assert.equal(vs.cursorStart, 6);
    assert.equal(vs.cursorEnd, 7);
});

test('the CRTC read-back registers answer at 3D5h (R14-17), the write-only ones do not', () => {
    const c = new CGACard(4_772_727);
    setReg(c, 15, 0x5a);
    c.write(0x04, 15);
    assert.equal(c.read(0x05), 0x5a, 'R15 reads back');
    // 3D8h / 3D9h remain write-only open bus.
    assert.equal(c.read(0x08), 0xff, '3D8h mode is still write-only');
});

test('reprogramming the vertical registers moves the retrace proportion', () => {
    const c = new CGACard(4_772_727);
    const before = c._active / c._frame;
    // Halve the displayed rows (R6): fewer active lines -> smaller active window.
    setReg(c, 6, 12);
    const after = c._active / c._frame;
    assert.ok(after < before, 'fewer displayed rows shrinks the active window the CRTC defines');
});

test('CRTC state round-trips through getState/setState', () => {
    const c = new CGACard(4_772_727);
    setReg(c, 12, 0x03); setReg(c, 13, 0x20); setReg(c, 14, 0x01); setReg(c, 15, 0x11);
    const snap = c.getState();
    const d = new CGACard(4_772_727);
    d.setState(snap);
    assert.equal(d.getVideoState().startAddr, 0x0320, 'start address restored');
    assert.equal(d.getVideoState().cursorAddr, 0x0111, 'cursor restored');
});

test('the horizontal blanking window comes from R0/R1, not a constant (E6.8.5b)', () => {
    // THE OTHER HALF OF E6.8.5b, AND IT NEEDED NO CYCLE MODEL.
    //
    // The vertical split was derived from the CRTC's vertical registers in
    // 9fe3b9f; the horizontal one stayed `linePos >= this._line * 0.75` — a
    // guess sitting next to a derivation. On the standard CGA text programming
    // R0=113 (114 chars total) and R1=80 displayed, so display-enable ends at
    // 80/114 = 0.702, and the constant was ~7% of a scanline late.
    //
    // That window is load-bearing rather than cosmetic: a CGA writes snow if
    // the CPU touches video RAM while the card is fetching, so period code
    // polls 3DAh bit 0 for the gap and writes inside it. A gap reported late
    // hands a program time the hardware does not have.
    const c = new CGACard(4_772_727);
    const asProportion = () => c._hActive / c._line;

    assert.ok(Math.abs(asProportion() - 80 / 114) < 0.01,
        `power-on horizontal active is ${asProportion().toFixed(3)}, expected `
        + `${(80 / 114).toFixed(3)} from R0=${c.crtc.regs[0]}, R1=${c.crtc.regs[1]}`);
    assert.ok(Math.abs(asProportion() - 0.75) > 0.03,
        'the derived value coincides with the old 0.75 constant, so this test '
        + 'cannot tell a derivation from the guess it replaced');

    // And it MOVES with the card, which a constant cannot.
    c.write(0x04, 1);   // 3D4h: select R1
    c.write(0x05, 40);  // 3D5h: 40 displayed characters
    assert.ok(Math.abs(asProportion() - 40 / 114) < 0.01,
        `after reprogramming R1=40 the window is ${asProportion().toFixed(3)}, `
        + `expected ${(40 / 114).toFixed(3)} — a hardcoded split would not have moved`);
});

test('3DAh bit 0 actually goes low inside the active part of a line', () => {
    // The status bit is what programs read; asserting only the internal
    // boundary would pass even if _status() ignored it.
    const c = new CGACard(4_772_727);
    const at = (cycles) => { c.cycles = cycles; return c.read(0x0a); };
    // Early in a line, inside display: bit 0 low (display enabled).
    assert.equal(at(10) & 0x01, 0, 'bit 0 should be low early in an active line');
    // Past the derived boundary but before vertical retrace: bit 0 high.
    const late = c._hActive + 5;
    assert.equal(at(late) & 0x01, 0x01,
        `bit 0 should be high at cycle ${late}, past the ${c._hActive}-cycle window`);
});
