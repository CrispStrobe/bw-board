import test from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';

/**
 * MC6845 in the Z80 machine: an address/data port pair, and the
 * framebuffer is SYSTEM RAM — the chip holds a live subarray view, so
 * a CPU store appears on screen with no copying, like the silicon.
 */

test('CRTC wired as a port chip: CPU programs it, RAM stores hit the screen', () => {
    const m = new Z80Machine({
        clockHz: 1_000_000,
        regions: [{ kind: 'ram', start: 0x0000, end: 0xffff }],
        ports: [{ kind: 'crtc', name: 'crtc1', at: 0x38, vramAt: 0xf000, vramSize: 0x0800 }],
    }, {});
    // LD A,'H' / LD ($F000),A, then program R1=16 cols, R6=2 rows,
    // R9=7 (8 scanlines per row) through the address/data pair. HALT.
    m.load(Uint8Array.from([
        0x3e, 0x48, 0x32, 0x00, 0xf0,
        0x3e, 0x01, 0xd3, 0x38, 0x3e, 0x10, 0xd3, 0x39,
        0x3e, 0x06, 0xd3, 0x38, 0x3e, 0x02, 0xd3, 0x39,
        0x3e, 0x09, 0xd3, 0x38, 0x3e, 0x07, 0xd3, 0x39,
        0x76,
    ]), 0);
    m.cpu.pc = 0; m.cpu.sp = 0xff00;
    m.advanceToMs(50);

    const f = m.chips.crtc1.videoFrame();
    assert.equal(f.width, 16 * 8, 'geometry from the programmed registers');
    assert.equal(f.height, 2 * 8);
    const lit = (frame) => {
        let n = 0;
        for (let i = 0; i < frame.rgba.length; i += 4) if (frame.rgba[i] || frame.rgba[i + 1]) n++;
        return n;
    };
    const before = lit(f);
    assert.ok(before > 5, `the H stored via RAM renders (${before} lit px)`);

    // The live-view property: poke RAM directly, no OUT, no copy — the
    // next frame shows it, because the chip's vram IS machine memory.
    m.mem[0xf001] = 0x49; // 'I'
    const after = lit(m.chips.crtc1.videoFrame());
    assert.ok(after > before, `a bare RAM store lit more pixels (${before} → ${after})`);
});
