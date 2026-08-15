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
  // The MEASURED vram_init frame: ONE 32K bank holds 128 rows; HSYNC
  // idle-high on visible bytes, LOW in pulse columns 164-187; VSYNC
  // idle-low, high on its marker row (117 in snake.rom). The second
  // bank is the double buffer, initialized separately when tested.
  const keepBank = card.bank;
  for (let row = 0; row < 128; row++) {
    for (let col = 0; col < 256; col++) {
      const inPulse = col >= 164 && col < 188;
      let b = inPulse ? 0x90 : 0xb0;
      if (row === 117 && inPulse) b |= BIT_VSYNC;
      card.write(0x8000 + row * SVGA_STRIDE + col, b);
    }
  }
  card.bank = keepBank;
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

  it('the bank line PAGE-FLIPS between two frames (double buffer)', () => {
    const card = new SimpleVGA();
    card.setBank(0); initSync(card);
    card.setBank(1); initSync(card);
    card.setBank(1);
    card.write(0x8000 + 20 * SVGA_STRIDE + 7, 0xb0 | 0x09);
    let f = card.renderFrame();
    assert.equal(f.indices[20 * SVGA_W + 7], 0x09, 'bank 1 frame shows its pixel');
    card.setBank(0);
    f = card.renderFrame();
    assert.equal(f.indices[20 * SVGA_W + 7], 0, 'bank 0 frame does not');
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
    // initSync overwrites the whole stream; re-poke the pixel the way a
    // real program does: pixel nibble OR'd into the idle sync bits.
    initSync(card);
    card.bank = 0;
    card.write(0x8000, 0xb0 | 0x0e);
    assert.equal(card.renderFrame().indices[0], 0x0e);
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
    assert.equal(v.height, 100); // measured default rows
    assert.equal(v.signal, false, 'honest: no vram_init yet, no signal');
  });
});

describe('input contract (the snake hookup)', () => {
  const cfg = {
    clockHz: 1_000_000,
    regions: [
      { kind: 'ram', start: 0x0000, end: 0x3fff },
      { kind: 'rom', start: 0xc000, end: 0xffff },
    ],
    chips: [
      { kind: 'via', name: 'via1', at: 0x6000 },
      { kind: 'simplevga', name: 'vga', at: 0 },
    ],
  };
  const boot = () => {
    const rom = new Uint8Array(0x4000).fill(0xea);
    rom[0x3ffc] = 0x00; rom[0x3ffd] = 0xc0;
    const m = new M6502Machine(cfg);
    m.loadRom(rom, 0xc000);
    m.reset();
    return m;
  };

  it('setButtons drives PA0-3 active-low; IRA reads them back', () => {
    const m = boot();
    m.setButtons(0b0101); // down + right pressed
    // DDRA all input by default; read IRA through the bus at $6001
    const ira = m._read(0x6001);
    assert.equal(ira & 0x01, 0, 'PA0 (down) low = pressed');
    assert.equal(ira & 0x02, 0x02, 'PA1 (up) high = released');
    assert.equal(ira & 0x04, 0, 'PA2 (right) low = pressed');
    assert.equal(ira & 0x08, 0x08, 'PA3 (left) high = released');
  });

  it('the vga card pulses PA4 at 60 Hz machine time', () => {
    const m = boot();
    let edges = 0;
    let last = m._read(0x6001) & 0x10;
    // run one simulated second in 1ms slices, counting PA4 transitions
    for (let ms = 1; ms <= 1000; ms++) {
      m.advanceToMs(ms);
      const now = m._read(0x6001) & 0x10;
      if (now !== last) { edges++; last = now; }
    }
    // 60 Hz square = 120 edges/second; sampling at 1ms sees all of them
    assert.ok(edges >= 118 && edges <= 122, `expected ~120 PA4 edges, got ${edges}`);
  });
});
