import test from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { ZX_W, ZX_H, ZX_BORDER, ZX_PALETTE } from '../src/zx-ula.js';

/**
 * The Spectrum face surface on the Z80 debug target: video() serves
 * the ULA's frame, setKeys() routes key names into the matrix, and
 * insertTape() attaches a TAP — the same contract shape m6502-debug
 * gives the browser (setButtons/video), Spectrum-flavored.
 */

const zx = () => {
    const m = new Z80Machine({
        clockHz: 3_500_000,
        regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }],
        ula: true,
    });
    return { m, t: createZ80DebugTarget({ machine: m }) };
};

test('video(): the ULA frame reaches the debug target', () => {
    const { m, t } = zx();
    // Paint one ink pixel: top-left bitmap byte $80, attr ink=2 (red).
    m.mem[0x4000] = 0x80;
    m.mem[0x5800] = 0x02;
    const f = t.video();
    assert.ok(f, 'a frame is served');
    assert.equal(f.width, ZX_W + 2 * ZX_BORDER);
    assert.equal(f.height, ZX_H + 2 * ZX_BORDER);
    const px = (ZX_BORDER * f.width + ZX_BORDER) * 4;
    assert.deepEqual([...f.rgba.slice(px, px + 3)], ZX_PALETTE[2].slice(0, 3), 'the ink pixel is red');
});

test('setKeys(): names land in the ULA matrix, and clear again', () => {
    const { m, t } = zx();
    assert.equal(t.setKeys(['a']), true);
    assert.equal(m.ula.in(0xfdfe) & 0x01, 0, 'A half-row bit 0 pulled low');
    assert.equal(t.setKeys([]), true);
    assert.equal(m.ula.in(0xfdfe) & 0x1f, 0x1f, 'released');
});

test('insertTape() through the target; absent hardware answers false', () => {
    const { m, t } = zx();
    // One header block: len=3 (flag+byte+checksum).
    assert.equal(t.insertTape(Uint8Array.from([3, 0, 0x00, 0xaa, 0xaa])), true);
    assert.equal(m.tape.blocks.length, 1);

    const bare = createZ80DebugTarget({
        machine: { cpu: {}, mem: new Uint8Array(65536), chips: {}, tMs: 0, cycles: 0 },
    });
    assert.equal(bare.setKeys(['a']), false, 'no ULA: setKeys refuses');
    assert.equal(bare.video(), null, 'no video chip: null');
    assert.equal(bare.insertTape(Uint8Array.of(0)), false, 'no tape support: refuses');
});

test('audioTone(): 440 Hz square on the beeper reads back as ~440 Hz', async () => {
    const { ZXULA } = await import('../src/zx-ula.js');
    const u = new ZXULA(new Uint8Array(65536));
    // Half-period of 440 Hz at 3.5 MHz ≈ 3977 T-states.
    for (let i = 0; i < 40; i++) {
        u.advance(3977);
        u.out(0xfe, ((i & 1) << 4), u.tStates);
    }
    const tone = u.audioTone();
    assert.ok(tone.on, 'a sustained square is a tone');
    assert.ok(Math.abs(tone.hz - 440) < 5, `estimated ${tone.hz} Hz`);
    // Silence after: the window slides past the last edge.
    u.advance(400_000);
    assert.deepEqual(u.audioTone(), { hz: 0, on: false });
    // A lone click is not a tone.
    const u2 = new ZXULA(new Uint8Array(65536));
    u2.advance(1000); u2.out(0xfe, 0x10, u2.tStates);
    u2.advance(1000);
    assert.equal(u2.audioTone().on, false);
});

test('FLASH: attribute bit 7 swaps ink/paper on the 16-frame phase', async () => {
    const { ZXULA, ZX_BORDER } = await import('../src/zx-ula.js');
    const mem = new Uint8Array(65536);
    mem[0x4000] = 0x80;         // one ink pixel top-left
    mem[0x5800] = 0x80 | 0x02;  // FLASH, ink red, paper black
    const u = new ZXULA(mem);
    const px = (f) => { const w = f.width; return f.indices[(ZX_BORDER * w) + ZX_BORDER]; };
    assert.equal(px(u.renderFrame()), 2, 'phase 0: ink red');
    u.frame = 16;
    assert.equal(px(u.renderFrame()), 0, 'phase 1: swapped to paper black');
    u.frame = 32;
    assert.equal(px(u.renderFrame()), 2, 'phase 0 again');
});

test('machine snapshot: save/load round-trips and resumes identically', async () => {
    const { Z80Machine } = await import('../src/z80-machine.js');
    const prog = [0x21, 0x00, 0x40, 0x34, 0x23, 0x18, 0xfc]; // LD HL,$4000 / loop: INC (HL) / INC HL / JR loop
    const build = () => {
        const m = new Z80Machine({ clockHz: 3_500_000, regions: [{ kind: 'rom', start: 0, end: 0x00ff }], ula: true }, {});
        m.load(Uint8Array.from(prog), 0);
        m.cpu.pc = 0; m.cpu.sp = 0xff00;
        return m;
    };
    const a = build();
    a.advanceToMs(40);
    const snap = a.saveState();
    const b = build();
    b.loadState(snap);
    assert.equal(b.cpu.pc, a.cpu.pc);
    assert.equal(b.cpu.hl, a.cpu.hl);
    assert.equal(b.ula.frame, a.ula.frame);
    assert.deepEqual([...b.mem.slice(0x4000, 0x4020)], [...a.mem.slice(0x4000, 0x4020)]);
    // Resumed execution stays in lockstep with the original.
    a.advanceToMs(80); b.advanceToMs(80);
    assert.equal(b.cpu.pc, a.cpu.pc);
    assert.equal(b.cpu.hl, a.cpu.hl);
    assert.deepEqual([...b.mem.slice(0x4000, 0x4040)], [...a.mem.slice(0x4000, 0x4040)]);
});

test('Kempston joystick: the face button mask reads back as 000FUDLR on port $1F', () => {
    const { m, t } = zx();
    const inPort = (p) => m.cpu.inPort(p);
    assert.equal(inPort(0x1f), 0x00, 'idle joystick reads 0');
    assert.equal(t.setButtons(0b00100), true);      // face: right
    assert.equal(inPort(0x1f), 0x01, 'right = Kempston bit 0');
    t.setButtons(0b01000);                          // face: left
    assert.equal(inPort(0x1f), 0x02);
    t.setButtons(0b00001);                          // face: down
    assert.equal(inPort(0x1f), 0x04);
    t.setButtons(0b00010);                          // face: up
    assert.equal(inPort(0x1f), 0x08);
    t.setButtons(0b10010);                          // fire + up
    assert.equal(inPort(0x1f), 0x18);
    t.setButtons(0);
    assert.equal(inPort(0x1f), 0x00, 'released');
    // Decode: any odd port with A5 low answers; even ports stay ULA's.
    t.setButtons(0b00100);
    assert.equal(inPort(0xdf), 0x01, 'mirrors where A5 is low and A0 high');
    assert.equal(inPort(0xfe) & 0x1f, 0x1f, 'the ULA keyboard is untouched');
});
