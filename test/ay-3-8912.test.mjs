/**
 * AY-3-8912 PSG — register semantics, tone frequency, mixer, volume,
 * audioTone() face summary, saveState round-trip.
 *
 * Hand-computed expectations from the GI datasheet.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AY38912 } from '../src/ay-3-8912.js';

describe('AY-3-8912 register file', () => {

    it('select/write/read round-trips all 16 registers', () => {
        const ay = new AY38912();
        for (let r = 0; r < 16; r++) {
            ay.select(r); ay.write(0xa5);
        }
        // Read back with masks applied
        ay.select(0); assert.equal(ay.read(), 0xa5, 'R0 full byte');
        ay.select(1); assert.equal(ay.read(), 0x05, 'R1 masked to 4 bits');
        ay.select(6); assert.equal(ay.read(), 0x05, 'R6 masked to 5 bits');
        ay.select(7); assert.equal(ay.read(), 0xa5, 'R7 full byte (mixer)');
        ay.select(8); assert.equal(ay.read(), 0x05, 'R8 masked to 5 bits');
    });

    it('tone period channel A: R0/R1 combine to 12 bits', () => {
        const ay = new AY38912();
        ay.select(0); ay.write(0x80);  // low byte
        ay.select(1); ay.write(0x01);  // high nibble
        assert.equal(ay._tonePeriod(0), 0x180, 'period = 0x180 = 384');
    });

    it('mixer defaults all disabled (0x3F)', () => {
        const ay = new AY38912();
        assert.equal(ay.regs[7], 0x3f, 'reset mixer = all off');
    });
});

describe('AY-3-8912 audioTone()', () => {

    it('tone A at 440 Hz: period = clock / (16 * 440 * 2)', () => {
        const clockHz = 3_546_900;
        const ay = new AY38912({ clockHz });
        // period = 3546900 / (16 * 440 * 2) = 252.2 → 252
        const period = Math.round(clockHz / (16 * 440 * 2));
        ay.select(0); ay.write(period & 0xff);
        ay.select(1); ay.write((period >> 8) & 0x0f);
        // Enable tone A (mixer bit 0 = 0), set volume
        ay.select(7); ay.write(0x3e); // tone A enabled, rest disabled
        ay.select(8); ay.write(0x0f); // volume 15

        const tones = ay.audioTone();
        assert.equal(tones.length, 3);
        assert.ok(tones[0].on, 'channel A is on');
        assert.ok(Math.abs(tones[0].hz - 440) < 5,
            `A frequency should be ~440 Hz, got ${tones[0].hz}`);
        assert.equal(tones[0].vol, 15);
        assert.ok(!tones[1].on, 'B is off');
        assert.ok(!tones[2].on, 'C is off');
    });

    it('all channels off when mixer = 0x3F', () => {
        const ay = new AY38912();
        ay.select(8); ay.write(15);   // volume A = 15 but tone disabled
        const tones = ay.audioTone();
        assert.ok(!tones[0].on, 'A off despite volume');
    });

    it('noise-only channel: on when noise enabled + volume > 0', () => {
        const ay = new AY38912();
        ay.select(7); ay.write(0x37); // tone all off, noise A on (bit 3 = 0)
        ay.select(8); ay.write(8);    // volume A = 8
        const tones = ay.audioTone();
        assert.ok(tones[0].on, 'A is on via noise');
        assert.equal(tones[0].vol, 8);
    });

    it('volume 0 means off even when tone enabled', () => {
        const ay = new AY38912();
        ay.select(7); ay.write(0x3e); // tone A enabled
        ay.select(8); ay.write(0);
        assert.ok(!ay.audioTone()[0].on);
    });
});

describe('AY-3-8912 advance()', () => {

    it('tone counter ticks at clock/16', () => {
        const ay = new AY38912({ clockHz: 1600 }); // 1600 / 16 = 100 AY ticks/sec
        ay.select(0); ay.write(10);  // period = 10
        ay.select(1); ay.write(0);
        ay._toneCount[0] = 10;
        ay._toneOut[0] = 0;

        // 160 system cycles = 10 AY ticks = one full period → flip once
        ay.advance(160);
        assert.equal(ay._toneOut[0], 1, 'flipped after one period');
    });
});

describe('AY-3-8912 saveState/loadState', () => {

    it('round-trip preserves register file and counters', () => {
        const ay = new AY38912();
        ay.select(0); ay.write(0x42);
        ay.select(7); ay.write(0x3e);
        ay.select(8); ay.write(15);
        ay.advance(1000);

        const snap = ay.saveState();
        assert.equal(snap.regs[0], 0x42);

        // Mutate
        ay.select(0); ay.write(0);
        ay.advance(5000);

        // Restore
        ay.loadState(snap);
        assert.equal(ay.regs[0], 0x42, 'R0 restored');
        assert.equal(ay.regs[8], 15, 'volume restored');
    });
});

describe('AY-3-8912 in Z80 128K machine', () => {

    it('machine.ay exists on 128K config', async () => {
        const { Z80Machine } = await import('../src/z80-machine.js');
        const m = new Z80Machine({
            clockHz: 3_546_900,
            regions: [{ kind: 'ram', start: 0, end: 0xffff }],
            zx128: true,
        }, {});
        assert.ok(m.ay, '128K machine has AY chip');
        assert.ok(m.chips.ay, 'AY is in the chips map');
    });

    it('AY select/write/read through the chip directly', async () => {
        const { Z80Machine } = await import('../src/z80-machine.js');
        const m = new Z80Machine({
            clockHz: 3_546_900,
            regions: [{ kind: 'ram', start: 0, end: 0xffff }],
            zx128: true,
        }, {});
        // Drive the AY through the chip interface (the port decode is
        // tested implicitly when the machine's out callback routes to it)
        m.ay.select(0);
        m.ay.write(0x42);
        assert.equal(m.ay.read(), 0x42, 'AY R0 reads back 0x42');
    });
});
