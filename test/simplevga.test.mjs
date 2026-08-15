// simplevga oracle tests — expectations from gfoot/simplevga6502's
// vga.s (Unlicense, adopted design): $8000 write-only overlay, stride
// 256, low-nibble pixels, sync bits IN vram, VIA port B bank line.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SimpleVGA, SVGA_W, SVGA_H, SVGA_STRIDE } from '../src/simplevga.js';
import { M6502Machine } from '../src/m6502-machine.js';

const BIT_HSYNC = 0x20, BIT_VSYNC = 0x40;

/** What vram_init produces, reduced to what signal() samples: HSYNC
 *  pulse bytes in every row's sync columns, one VSYNC row below the
 *  visible region. */
function initSync(card) {
  for (let row = 0; row < 256; row++) {
    for (let col = 164; col < 188; col++) {
      const linear = row * SVGA_STRIDE + col;
      card.bank = linear >> 15;
      card.write(0x8000 + (linear & 0x7fff), BIT_HSYNC | (row >= SVGA_H ? BIT_VSYNC : 0));
    }
  }
  card.bank = 0;
}

describe('SimpleVGA card', () => {
  it('no vram_init = NO SIGNAL, never a picture', () => {
    const card = new SimpleVGA();
    card.write(0x8000, 0x0f); // a pixel, but no sync anywhere
    const f = card.renderFrame();
    assert.equal(f.signal, false);
    assert.equal(f.indices, null);
  });

  it('with sync: low-nibble pixels at stride 256', () => {
    const card = new SimpleVGA();
    initSync(card);
    card.bank = 0;
    card.write(0x8000, 0x0c);                    // (0,0) = IRGB 1100 → intense red
    card.write(0x8000 + SVGA_STRIDE + 5, 0x03);  // (5,1) = green+blue
    const f = card.renderFrame();
    assert.equal(f.signal, true);
    assert.equal(f.indices[0], 0x0c);
    assert.equal(f.indices[SVGA_W + 5], 0x03);
    assert.equal(f.indices[1], 0, 'untouched pixel is color 0');
  });

  it('sync bits never leak into pixels', () => {
    const card = new SimpleVGA();
    initSync(card);
    card.bank = 0;
    card.write(0x8000 + 10, BIT_HSYNC | 0x05); // stray sync bit on a pixel byte
    const f = card.renderFrame();
    assert.equal(f.indices[10], 0x05, 'only the low nibble is color');
  });

  it('the bank line moves writes into the upper 32K (rows past 127)', () => {
    const card = new SimpleVGA();
    initSync(card);
    // Row 200, column 7: linear = 200*256+7 = 51207 → bank 1, offset 51207-32768
    card.setBank(1);
    card.write(0x8000 + (200 * SVGA_STRIDE + 7 - 0x8000), 0x09);
    const f = card.renderFrame();
    assert.equal(f.indices[200 * SVGA_W + 7], 0x09);
  });

  it('machine glue: a 65C02 program paints through the ROM window', () => {
    // ROM at $C000 (like the HB6502 shape) so $8000-$BFFF is open bus for
    // reads — the card still snoops ALL $8000+ writes, including the
    // ROM-covered range; here the program pokes $8000 directly.
    const rom = new Uint8Array(0x4000).fill(0xea);
    const code = [
      0xa9, 0x0e,             // lda #$0e  (intense red+green)
      0x8d, 0x00, 0x80,       // sta $8000
      0xdb,                   // stp
    ];
    rom.set(code, 0);
    rom[0x3ffc] = 0x00; rom[0x3ffd] = 0xc0;
    const m = new M6502Machine({
      clockHz: 1_000_000,
      regions: [
        { kind: 'ram', start: 0x0000, end: 0x3fff },
        { kind: 'rom', start: 0xc000, end: 0xffff },
      ],
      chips: [
        { kind: 'via', name: 'via1', at: 0x6000 },
        { kind: 'simplevga', name: 'vga', at: 0 },
      ],
    });
    m.loadRom(rom, 0xc000);
    m.reset();
    m.advanceToMs(1);
    const card = m.chips.vga;
    assert.equal(card.vram[0], 0x0e, 'the STA $8000 landed in VRAM bank 0');
    initSync(card);
    card.bank = 0; // initSync leaves bank 1; pixel readback is bank-independent
    assert.equal(card.renderFrame().indices[0] & 0x0f, 0x0e & 0x0f);
  });

  it('rgba: NO SIGNAL renders black, sync renders the palette', () => {
    const card = new SimpleVGA();
    assert.deepEqual([...card.rgba().slice(0, 4)], [0, 0, 0, 255]);
    initSync(card);
    card.bank = 0;
    card.write(0x8000, 0x0f); // intense white
    assert.deepEqual([...card.rgba().slice(0, 4)], [255, 255, 255, 255]);
  });
});

describe('videoFrame contract', () => {
  it('the debug target finds the vga card through videoFrame()', async () => {
    const { createM6502Adapter } = await import('../src/m6502-adapter.js');
    const { createM6502DebugTarget } = await import('../src/m6502-debug.js');
    const rom = new Uint8Array(0x4000).fill(0xea);
    rom[0x3ffc] = 0x00; rom[0x3ffd] = 0xc0;
    const adapter = createM6502Adapter({
      config: {
        clockHz: 1_000_000,
        regions: [
          { kind: 'ram', start: 0x0000, end: 0x3fff },
          { kind: 'rom', start: 0xc000, end: 0xffff },
        ],
        chips: [
          { kind: 'via', name: 'via1', at: 0x6000 },
          { kind: 'simplevga', name: 'vga', at: 0 },
        ],
      },
      rom, romAt: 0xc000,
    });
    adapter.machine.reset();
    const v = createM6502DebugTarget(adapter).video();
    assert.ok(v, 'card surfaces through video()');
    assert.equal(v.width, SVGA_W);
    assert.equal(v.height, SVGA_H);
    assert.equal(v.signal, false, 'honest: no vram_init yet, no signal');
  });
});
