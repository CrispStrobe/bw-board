// The VGA board — the config half of the display-demo set's 256-colour member
// (ROADMAP E7.1). lego-47 measured that the DOS/host renderer ALREADY decodes
// mode 13h (vga8, 320x200 linear at A000:0000); the only thing missing was a
// shipped machine config that declares kind:'vga'. This is that config, plus a
// test that it is a real board — the VGA register block answers on its ports
// and the mode-13h framebuffer is addressable. The bare-metal demo ROM that
// programs mode 13h and paints a picture follows once the exact register
// signature the renderer keys off is pinned down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, VGADEMO8086 } from '../src/i8086-machine.js';

test('the board declares a VGA card and maps the mode-13h framebuffer at A0000', () => {
    const m = new I8086Machine(VGADEMO8086);
    assert.deepEqual(Object.keys(m.chips), ['vga1']);
    assert.ok(VGADEMO8086.regions.some((r) => r.start === 0xa0000 && r.end === 0xaffff),
        'the 64K mode-13h framebuffer at A000:0000 is mapped (320x200 linear needs 64000 bytes)');
    const rom = VGADEMO8086.regions.find((r) => r.kind === 'rom');
    assert.ok(rom.start <= 0xffff0 && rom.end >= 0xfffff, 'ROM covers the reset vector');
});

test('the VGA register block answers on this board — misc output latches and reads back', () => {
    const m = new I8086Machine(VGADEMO8086);
    // 3C2h writes the miscellaneous output register; 3CCh reads it back. A
    // round-trip proves the card is wired into the board's I/O space.
    m._out(0x3c2, 0x63);                       // the mode-13h misc value
    assert.equal(m._in(0x3cc), 0x63, 'misc output latched and read back at 3CCh');
});

test('the framebuffer is real RAM — a pixel written to A0000 reads back', () => {
    const m = new I8086Machine(VGADEMO8086);
    m._write(0xa0000, 0x2a);
    m._write(0xa0000 + 320 * 100 + 160, 0x0d);   // roughly screen centre in 320-wide
    assert.equal(m._read(0xa0000), 0x2a, 'top-left pixel byte holds');
    assert.equal(m._read(0xa0000 + 320 * 100 + 160), 0x0d, 'centre pixel byte holds');
});
