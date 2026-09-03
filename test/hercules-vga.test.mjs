// The Hercules and VGA port cards. Hercules is a mono CGA; the tests that
// matter for it are the same — the retrace bit is a real frame, not stuck.
// VGA's weight is in its two traps: the attribute flip-flop that a 3DAh read
// resets (so an observer must have a side-effect-free peek), and the six-bit
// DAC RGB sequence. And the register banks it must expose so a renderer can
// tell mode 13h from a planar mode it should refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HerculesCard } from '../src/hercules-card.js';
import { VGACard } from '../src/vga-card.js';
import { I8086Machine } from '../src/i8086-machine.js';

// ---- Hercules -------------------------------------------------------------
test('Hercules 3B8h/3BFh latch but are write-only on the bus', () => {
    const h = new HerculesCard(5_000_000);
    h.write(0x08, 0x0a);      // 3B8h mode: graphics + video enable
    h.write(0x0f, 0x03);      // 3BFh config
    assert.equal(h.mode, 0x0a);
    assert.equal(h.config, 0x03);
    assert.equal(h.read(0x08), 0xff, '3B8h write-only');
    assert.equal(h.read(0x0f), 0xff, '3BFh write-only');
    const v = h.getVideoState();
    assert.equal(v.mode, 0x0a);
    assert.equal(v.graphics, true, 'bit 1 means graphics mode');
});

test('Hercules 3BAh bit 7 (vsync) toggles once per frame, not stuck', () => {
    const h = new HerculesCard(370 * 50);   // one cycle per scanline
    let high = 0;
    for (let i = 0; i < 370; i++) { h.cycles = i; if (h.read(0x0a) & 0x80) high++; }
    assert.ok(high > 0 && high < 370, `vsync is a pulse, not a level (${high}/370)`);
    assert.ok(370 - high >= 300, 'the display is active for most of the frame');
});

test('the Hercules vsync poll terminates', () => {
    const code = [
        0xba, 0xba, 0x03,       // mov dx, 03BA
        0xec, 0xa8, 0x80, 0x74, 0xfb,   // L1: in; test 80h; jz L1 (wait until vsync sets)
        0xf4,                   // hlt
    ];
    const img = new Uint8Array(0x8000);
    img.set(code, 0);
    img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    const m = new I8086Machine({
        clockHz: 1_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'hercules', name: 'hgc', at: 0x3b0 }],
    });
    m.loadRom(img); m.reset(); m.step();
    let steps = 0;
    while (!m.cpu.halted && steps < 500000) { m.step(); steps++; }
    assert.ok(m.cpu.halted, 'the vsync wait ended rather than spinning');
});

// ---- VGA: the attribute flip-flop trap ------------------------------------
test('VGA attribute writes toggle index/data, and a 3DAh READ resets the flip-flop', () => {
    const v = new VGACard(25_000_000);
    v.write(0x00, 0x10);      // index phase -> attrIndex = 0x10
    v.write(0x00, 0x41);      // data phase  -> attr[0x10] = 0x41
    assert.equal(v.attr[0x10], 0x41);

    // Mid-sequence: select an index, then a status read resyncs to index.
    v.write(0x00, 0x05);      // index phase -> expecting DATA next
    v.read(0x1a);             // 3DAh read RESETS the flip-flop to index
    v.write(0x00, 0x0c);      // because it reset, this is an INDEX again
    v.write(0x00, 0x22);      // data -> attr[0x0c] = 0x22
    assert.equal(v.attr[0x0c], 0x22);
    assert.notEqual(v.attr[0x05] & 0xff, 0x22, 'the 3DAh read prevented a stray write to attr[5]');
});

test('peekStatus and getVideoState are side-effect-free (no flip-flop reset)', () => {
    const v = new VGACard(25_000_000);
    v.write(0x00, 0x07);      // index phase -> expecting DATA next
    v.peekStatus();           // must NOT reset
    v.getVideoState();        // must NOT reset
    v.write(0x00, 0x99);      // still data phase -> attr[0x07] = 0x99
    assert.equal(v.attr[0x07], 0x99, 'the observer peeks did not desync the program');
});

// ---- VGA: the DAC RGB sequence --------------------------------------------
test('VGA DAC latches six-bit RGB triples with an auto-incrementing index', () => {
    const v = new VGACard(25_000_000);
    v.write(0x08, 0x10);              // write index 0x10
    v.write(0x09, 0x3f); v.write(0x09, 0x20); v.write(0x09, 0x00);  // R,G,B
    assert.deepEqual([v.dac[0x30], v.dac[0x31], v.dac[0x32]], [0x3f, 0x20, 0x00]);
    assert.equal(v.getVideoState().dacWriteIndex, 0x11, 'index auto-incremented after B');

    v.write(0x08, 0x00); v.write(0x09, 0xff);   // six-bit clamp
    assert.equal(v.dac[0], 0x3f, 'the DAC is six bits, 0xFF clamps to 0x3F');

    v.write(0x07, 0x10);             // read index 0x10
    assert.equal(v.read(0x09), 0x3f);
    assert.equal(v.read(0x09), 0x20);
    assert.equal(v.read(0x09), 0x00);
});

// ---- VGA: the mode discriminators the renderer needs ----------------------
test('getVideoState exposes the registers that identify mode 13h vs planar', () => {
    const v = new VGACard(25_000_000);
    v.write(0x04, 0x04); v.write(0x05, 0x08);   // sequencer 04h bit 3 = chain-4
    v.write(0x00, 0x10); v.write(0x00, 0x40);   // attribute 10h bit 6 = 8-bit colour
    v.write(0x02, 0x63);                        // misc output
    v.write(0x14, 0x01); v.write(0x15, 0x27);   // CRTC 01h (horizontal display end)

    const s = v.getVideoState();
    assert.ok(s.seq[0x04] & 0x08, 'chain-4 visible');
    assert.ok(s.attr[0x10] & 0x40, '8-bit colour visible');
    assert.equal(s.misc, 0x63);
    assert.equal(s.crtc[0x01], 0x27, 'a CRTC total is latched');
});

test('VGA status bit 3 is the vertical retrace, and state round-trips', () => {
    const v = new VGACard(449 * 70);   // one cycle per scanline
    let high = 0;
    for (let i = 0; i < 449; i++) { v.cycles = i; if (v.peekStatus() & 0x08) high++; }
    assert.ok(high > 0 && 449 - high >= 380, `retrace is a minority of the frame (${high}/449)`);

    v.cycles = 0;
    v.write(0x08, 0x05); v.write(0x09, 0x11); v.write(0x09, 0x22); v.write(0x09, 0x33);
    const w = new VGACard(449 * 70);
    w.setState(v.getState());
    assert.equal(w.dac[0x05 * 3], 0x11);
    assert.equal(w.dac[0x05 * 3 + 2], 0x33);
});

// ---- machine registration -------------------------------------------------
test('the machine registers hercules and vga kinds', () => {
    const m = new I8086Machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'vga', name: 'vga1', at: 0x3c0 }],
    });
    m._out(0x3c8, 0x00);
    m._out(0x3c9, 0x3f); m._out(0x3c9, 0x00); m._out(0x3c9, 0x00);   // entry 0 = red
    assert.equal(m.chips.vga1.getVideoState().dac[0], 0x3f);
    // A bus read of 3DAh works (and, per hardware, resets the attr flip-flop).
    assert.equal(m._in(0x3da) & ~0x09, 0, 'only display/retrace bits live');
});
