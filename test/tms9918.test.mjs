// TMS9918A oracle tests — every expected value hand-computed from the
// TI datasheet (registers §2.1.2, VRAM interface §2.2, Graphics I §3.3,
// Graphics II §3.4, Text §3.5, sprites + status §3.7). The machine-glue
// test at the end proves the chip lives at a decoded address and
// interrupts the CPU at frame rate.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TMS9918 } from '../src/tms9918.js';
import { M6502Machine } from '../src/m6502-machine.js';

const DATA = 0, CTRL = 1;
const WIDTH = 256;

/** Set a VRAM write address, then write bytes through the data port. */
function pokeVram(v, addr, bytes) {
  v.write(CTRL, addr & 0xff);
  v.write(CTRL, 0x40 | ((addr >> 8) & 0x3f));
  for (const b of bytes) v.write(DATA, b);
}

describe('TMS9918 CPU interface', () => {
  it('register write: data byte first, then 0x80|reg', () => {
    const v = new TMS9918();
    v.write(CTRL, 0x0e);
    v.write(CTRL, 0x87);
    assert.equal(v.regs[7], 0x0e);
    assert.equal(v.backdrop, 0x0e & 0x0f);
  });

  it('VRAM write sequence autoincrements', () => {
    const v = new TMS9918();
    pokeVram(v, 0x1000, [0xaa, 0xbb, 0xcc]);
    assert.equal(v.vram[0x1000], 0xaa);
    assert.equal(v.vram[0x1001], 0xbb);
    assert.equal(v.vram[0x1002], 0xcc);
  });

  it('VRAM read is buffered: set-read-address prefetches (§2.2.2)', () => {
    const v = new TMS9918();
    pokeVram(v, 0x2000, [0x11, 0x22]);
    v.write(CTRL, 0x00);
    v.write(CTRL, 0x20); // 00xx = read address 0x2000, prefetch fires
    assert.equal(v.read(DATA), 0x11);
    assert.equal(v.read(DATA), 0x22);
  });

  it('status read returns F and clears it; latch resets too', () => {
    const v = new TMS9918();
    v.advance(v._cyclesPerFrame); // one frame → F set
    const s = v.read(CTRL);
    assert.equal(s & 0x80, 0x80);
    assert.equal(v.read(CTRL) & 0x80, 0, 'second read must see F cleared');
  });

  it('IRQ is F AND IE (R1 bit 5)', () => {
    const v = new TMS9918();
    v.advance(v._cyclesPerFrame);
    assert.equal(v.irqAsserted, false, 'no IE, no IRQ');
    v.write(CTRL, 0x20); v.write(CTRL, 0x81); // R1 = 0x20 (IE)
    assert.equal(v.irqAsserted, true);
    v.read(CTRL); // status read clears F
    assert.equal(v.irqAsserted, false);
  });
});

describe('TMS9918 Graphics I rendering (§3.3)', () => {
  it('a solid pattern paints fg where bits are 1, bg elsewhere', () => {
    const v = new TMS9918();
    // R1: 16K + screen enable; tables at defaults (bases 0 → name 0x0000)
    v.write(CTRL, 0x40 | 0x80); v.write(CTRL, 0x81); // R1 = 0xC0
    // pattern 1: top row 0xF0 (left half on), rest 0
    // pattern table base 0 collides with name table base 0 — separate:
    v.write(CTRL, 0x01); v.write(CTRL, 0x84); // R4=1 → patterns at 0x0800
    v.write(CTRL, 0x02); v.write(CTRL, 0x83); // R3=2 → colors at 0x0080
    pokeVram(v, 0x0800 + 8, [0xf0, 0, 0, 0, 0, 0, 0, 0]); // pattern #1
    pokeVram(v, 0x0080, [0x41]);   // color group 0: fg=4 (dark blue), bg=1 (black)
    pokeVram(v, 0x0000, [1]);      // name[0,0] = pattern 1
    const f = v.renderFrame();
    assert.equal(f.mode, 'graphics1');
    assert.equal(f.indices[0], 4, 'pixel (0,0): bit set → fg');
    assert.equal(f.indices[3], 4, 'pixel (3,0): still the high nibble of 0xF0');
    assert.equal(f.indices[4], 1, 'pixel (4,0): bit clear → bg');
    assert.equal(f.indices[8], 1, 'tile (1,0) shows pattern 0 (empty) with bg');
  });

  it('color 0 is transparent and shows the backdrop (R7)', () => {
    const v = new TMS9918();
    v.write(CTRL, 0x40); v.write(CTRL, 0x81);       // screen on
    v.write(CTRL, 0x07); v.write(CTRL, 0x87);       // R7 backdrop = cyan (7)
    // name all zero, pattern 0 empty, color group 0 = 0x00 → all transparent
    const f = v.renderFrame();
    assert.equal(f.indices[0], 7, 'transparent bg → backdrop color');
  });
});

describe('TMS9918 Text mode (§3.5)', () => {
  it('40 columns, 6-wide cells, colors from R7 only', () => {
    const v = new TMS9918();
    v.write(CTRL, 0x50); v.write(CTRL, 0x81); // R1: screen on + M1 (text)
    v.write(CTRL, 0xf4); v.write(CTRL, 0x87); // R7: fg white(15), bg dark blue(4)
    v.write(CTRL, 0x01); v.write(CTRL, 0x84); // patterns at 0x0800
    pokeVram(v, 0x0800 + 'A'.charCodeAt(0) * 8, [0xfc, 0, 0, 0, 0, 0, 0, 0]);
    pokeVram(v, 0x0000, ['A'.charCodeAt(0)]);
    const f = v.renderFrame();
    assert.equal(f.mode, 'text');
    // 8px left border, then the cell: top row of 0xFC = 6 set bits
    assert.equal(f.indices[8], 15, 'first text pixel is fg');
    assert.equal(f.indices[8 + 5], 15, 'sixth pixel still fg (0xFC high six bits)');
    assert.equal(f.indices[WIDTH + 8], 4, 'row below is bg');
    assert.equal(f.indices[0], 4, 'border is bg');
  });
});

describe('TMS9918 sprites (§3.7)', () => {
  const setup = () => {
    const v = new TMS9918();
    v.write(CTRL, 0x40); v.write(CTRL, 0x81);  // screen on, 8x8, mag 1
    v.write(CTRL, 0x10); v.write(CTRL, 0x85);  // R5 → sprite attrs at 0x0800
    v.write(CTRL, 0x01); v.write(CTRL, 0x86);  // R6 → sprite patterns at 0x0800... no: (1&7)<<11 = 0x0800
    return v;
  };

  it('renders an 8x8 sprite at (x, y+1) with its tag color', () => {
    const v = setup();
    pokeVram(v, 0x0800 + 4 * 8, [0x80, 0, 0, 0, 0, 0, 0, 0]); // pattern 4: one px top-left
    // attrs at 0x0800 too? separate: move attrs to 0x1000
    v.write(CTRL, 0x20); v.write(CTRL, 0x85);  // R5=0x20 → attrs at 0x1000
    pokeVram(v, 0x1000, [9, 5, 4, 0x08, 0xd0]); // y=9 → line 10, x=5, pattern 4, color 8; then terminator
    const f = v.renderFrame();
    assert.equal(f.indices[10 * WIDTH + 5], 8, 'sprite pixel at (5, 10)');
  });

  it('the fifth sprite on a line sets 5S with its number', () => {
    const v = setup();
    v.write(CTRL, 0x20); v.write(CTRL, 0x85);
    pokeVram(v, 0x0800, [0xff, 0, 0, 0, 0, 0, 0, 0]); // pattern 0: solid top row
    const attrs = [];
    for (let i = 0; i < 6; i++) attrs.push(0, i * 30, 0, 0x01); // six sprites, same lines
    attrs.push(0xd0);
    pokeVram(v, 0x1000, attrs);
    v.renderFrame();
    assert.equal(v.status & 0x40, 0x40, '5S set');
    assert.equal(v.status & 0x1f, 4, 'the fifth sprite is number 4');
  });

  it('two opaque sprites overlapping set coincidence', () => {
    const v = setup();
    v.write(CTRL, 0x20); v.write(CTRL, 0x85);
    pokeVram(v, 0x0800, [0xff, 0, 0, 0, 0, 0, 0, 0]);
    pokeVram(v, 0x1000, [0, 10, 0, 0x02, 0, 12, 0, 0x03, 0xd0]); // overlap at x 12-17
    v.renderFrame();
    assert.equal(v.status & 0x20, 0x20, 'C set');
  });
});

describe('TMS9918 in the machine', () => {
  it('lives at its decoded address and interrupts at frame rate', () => {
    // Minimal machine: RAM low, ROM high, VDP at $9000. The ROM program
    // enables the VDP frame interrupt, then WAIs; the IRQ handler
    // increments $10 and RTIs. Two frames → two increments.
    const rom = new Uint8Array(0x4000).fill(0xea);
    const code = [
      0xa9, 0x20,             // lda #$20      (R1 value: IE)
      0x8d, 0x01, 0x90,       // sta $9001     (first byte of the pair)
      0xa9, 0x81,             // lda #$81      (0x80 | reg 1)
      0x8d, 0x01, 0x90,       // sta $9001
      0x58,                   // cli
      0xcb,                   // wai
      0x4c, 0x0b, 0xc0,       // jmp $c00b (back to wai)
    ];
    const isr = [
      0x48,                   // pha
      0xad, 0x01, 0x90,       // lda $9001  (status read clears F)
      0xe6, 0x10,             // inc $10
      0x68,                   // pla
      0x40,                   // rti
    ];
    rom.set(code, 0);
    rom.set(isr, 0x100);
    rom[0x3ffc] = 0x00; rom[0x3ffd] = 0xc0; // reset → $c000
    rom[0x3ffe] = 0x00; rom[0x3fff] = 0xc1; // irq → $c100
    const m = new M6502Machine({
      clockHz: 1_000_000,
      regions: [
        { kind: 'ram', start: 0x0000, end: 0x3fff },
        { kind: 'rom', start: 0xc000, end: 0xffff },
      ],
      chips: [{ kind: 'vdp', name: 'vdp', at: 0x9000 }],
    });
    m.loadRom(rom, 0xc000);
    m.reset();
    m.advanceToMs(2.5 * 1000 / 60); // 2.5 frame times
    assert.equal(m.mem[0x10], 2, 'exactly two frame interrupts in 2.5 frames');
  });
});
