// The CGA card, port side only. The tests pin the one thing that decides
// whether a game runs: 3DAh bit 3 must be a real 60 Hz frame — high through
// vertical blank, LOW for the ~200/262 of the frame that is active — so the
// retrace poll both TERMINATES and does not run the game at full speed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CGACard } from '../src/cga-card.js';
import { I8086Machine } from '../src/i8086-machine.js';

test('3D8h/3D9h latch the exact byte written but are WRITE-ONLY on the bus', () => {
    const c = new CGACard(5_000_000);
    c.write(0x08, 0xa7);      // 3D8h mode — includes bits we do not decode
    c.write(0x09, 0x3f);      // 3D9h colour
    assert.equal(c.mode, 0xa7, 'mode latch holds every bit');
    assert.equal(c.color, 0x3f);
    // A real CGA cannot read these back — the bus floats high. Returning the
    // latch would invent a register the hardware does not have.
    assert.equal(c.read(0x08), 0xff, '3D8h is write-only on the bus');
    assert.equal(c.read(0x09), 0xff, '3D9h is write-only on the bus');
    // The renderer sees the latch through getVideoState, RAW, not translated.
    const v = c.getVideoState();
    assert.equal(v.mode, 0xa7);
    assert.equal(v.color, 0x3f);
});

test('3DAh bit 3 is LOW for most of the frame, not stuck high', () => {
    // A card that reads "in retrace" forever also makes the poll terminate —
    // instantly — and every game then runs flat out with tearing. Pin the
    // duty cycle: ~200 of 262 lines are active (bit low), ~62 are blank.
    const c = new CGACard(262 * 60);   // one cycle per scanline
    let high = 0;
    for (let i = 0; i < 262; i++) {
        c.cycles = i;
        if (c.read(0x0a) & 0x08) high++;
    }
    assert.ok(high >= 55 && high <= 70, `vertical retrace high ${high}/262, expected ~62`);
    assert.ok(262 - high >= 190, 'the display is active for most of the frame');
});

test('3DAh bit 3 rises exactly once per 60 Hz frame', () => {
    const c = new CGACard(1_000_000);       // frame = 16667 cycles
    let edges = 0;
    c.write(0, 0);
    let prev = 0;
    for (let t = 0; t < 1_000_000; t += 17) {   // ~one second, coarse sample
        c.cycles = t;
        const v = (c.read(0x0a) & 0x08) ? 1 : 0;
        if (v && !prev) edges++;
        prev = v;
    }
    // 60 frames per 1e6 cycles; coarse sampling may miss/merge a couple.
    assert.ok(edges >= 55 && edges <= 62, `~60 retrace edges/sec, got ${edges}`);
});

test('nextWake points at the next retrace transition', () => {
    const c = new CGACard(262 * 60);   // frame 262, active 200
    c.cycles = 0;
    assert.equal(c.nextWake(), 200, 'from frame start, 200 cycles to retrace');
    c.cycles = 200;
    assert.equal(c.nextWake(), 62, 'from retrace start, 62 cycles to frame end');
});

test('state round-trips', () => {
    const c = new CGACard(5_000_000);
    c.write(0x08, 0x2c); c.write(0x09, 0x11);
    c.advance(12345);
    const d = new CGACard(5_000_000);
    d.setState(c.getState());
    assert.equal(d.mode, 0x2c);
    assert.equal(d.color, 0x11);
    assert.equal(d.cycles, 12345);
});

// ---------------------------------------------------------------------------
function rom(code) {
    const img = new Uint8Array(0x8000);
    img.set(code, 0);
    img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // jmp F800:0000
    return img;
}

test('the retrace poll idiom TERMINATES instead of spinning forever', () => {
    //   mov dx, 03DAh
    // L1: in al, dx ; test al, 08h ; jnz L1   (wait until NOT in retrace)
    // L2: in al, dx ; test al, 08h ; jz  L2   (wait until retrace STARTS)
    //   hlt
    const code = [
        0xba, 0xda, 0x03,       // mov dx, 03DA
        0xec, 0xa8, 0x08, 0x75, 0xfb,   // L1: in; test 08; jnz L1
        0xec, 0xa8, 0x08, 0x74, 0xfb,   // L2: in; test 08; jz  L2
        0xf4,                   // hlt
    ];
    const m = new I8086Machine({
        clockHz: 1_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'cga', name: 'cga1', at: 0x3d0 }],
    });
    m.loadRom(rom(code));
    m.reset();
    m.step();   // far jump

    let steps = 0;
    while (!m.cpu.halted && steps < 500000) { m.step(); steps++; }
    assert.ok(m.cpu.halted, 'the game synced to a frame and moved on, rather than hanging');
    assert.ok(steps > 5, 'it actually polled across a frame boundary, not a stuck-high shortcut');
});

test('the card registers on the machine and answers at 3DAh', () => {
    const m = new I8086Machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'cga', name: 'cga1', at: 0x3d0 }],
    });
    m._out(0x3d8, 0x29);        // mode
    assert.equal(m.chips.cga1.getVideoState().mode, 0x29);
    // 3DAh is a live status port; reading it returns only the two live bits.
    const s = m._in(0x3da);
    assert.equal(s & ~0x09, 0, 'only display-enable and vretrace bits are set');
});
