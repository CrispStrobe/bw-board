// The Hercules example — the mono-graphics member of the display-demo set
// (ROADMAP E7.1). It boots bare-metal, un-protects graphics at the HGC config
// register, selects graphics mode, and fills the 720x348 mono framebuffer at
// B000:0000 with vertical bars.
//
// This tests what THIS lane owns: the firmware drives the correct HGC STATE —
// the 3BFh config latch, the 3B8h mode register, and the four interleaved 8KB
// banks of the mono framebuffer. Turning that into pixels is the renderer's
// job, and as of 2026-09-04 the DOS/host renderer does NOT yet decode HGC (its
// videoFrame() refuses mode 6h by name). So the board is deliberately NOT wired
// into the Machine-Loader — this is verified state, ready for the renderer's
// four-bank decode. State here, pixels there, one seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, HERCDEMO8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'hercules-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));

function boot() {
    const m = new I8086Machine(HERCDEMO8086);
    m.loadRom(demo);
    m.reset();
    for (let i = 0; i < 3000; i++) m.step();
    return m;
}

test('it selects HGC graphics mode and un-protects it at the config register', () => {
    const vs = boot().chips.hgc1.getVideoState();
    assert.equal(vs.graphics, true, '3B8h bit 1 set = graphics');
    assert.equal(vs.mode & 0x08, 0x08, '3B8h bit 3 set = video enabled');
    assert.equal(vs.config & 0x01, 0x01, '3BFh bit 0 set = graphics mode un-protected (works on real hardware too)');
});

test('it fills all FOUR interleaved 8KB banks — the HGC y-mod-4 layout, not CGA parity', () => {
    const m = boot();
    // Four banks at +0x0000/+0x2000/+0x4000/+0x6000, each holding every 4th line.
    for (let bank = 0; bank < 4; bank++) {
        assert.equal(m._read(0xb0000 + bank * 0x2000), 0xf0, `bank ${bank} (scanlines y%4==${bank}) written`);
    }
    // A whole bank, not just its first byte: 87 lines x 90 bytes = 7830 = 0x1E96.
    assert.equal(m._read(0xb0000 + 0x1e00), 0xf0, 'deep into bank 0 is still filled');
});

test('the pattern byte is 4-on-4-off — four-pixel-wide vertical bars in mono', () => {
    // 0xF0 = 11110000: four lit pixels then four dark, MSB = leftmost pixel.
    assert.equal(boot()._read(0xb0000), 0xf0, 'first framebuffer byte = 4 on, 4 off');
});

test('the board maps the HGC mono page and carries only the Hercules card', () => {
    const m = new I8086Machine(HERCDEMO8086);
    assert.deepEqual(Object.keys(m.chips), ['hgc1']);
    assert.ok(HERCDEMO8086.regions.some((r) => r.start === 0xb0000 && r.end === 0xb7fff),
        'the 32K mono page at B000:0000 is mapped');
    // Distinct from CGA's B800 — Hercules lives 32K lower in the video hole.
    assert.ok(!HERCDEMO8086.regions.some((r) => r.start === 0xb8000), 'no CGA page here');
});
