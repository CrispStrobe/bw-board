/**
 * YM3812 (OPL2) — E6.8.11 step 5, the FM half.
 *
 * THE AGREEMENT TEST EARNED ITSELF HERE. The very first run of this core
 * claimed 440 Hz and produced 880 — a spurious x2 in the phase increment.
 * That is exactly the failure lego-47 predicted when he rejected a bare
 * Goertzel at the claimed frequency: "the drift that actually happens is off
 * by an octave, from a divisor counted per-edge instead of per-cycle", and a
 * detector that only asks "is there some 440 here" passes it. Zero crossings
 * over whole periods, plus the claimed bin having to be STRONGEST, caught it
 * inside a minute of the chip existing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { YM3812 } from '../src/ym3812.js';
import { freqFromCrossings, claimedBinIsStrongest } from './audio-analysis.mjs';

const RATE = 3_579_545 / 72;

/** An OPL with channel 0 keyed on at `hz`, additive so the carrier is plain. */
function voice(hz, { alg = 1, block = 4 } = {}) {
    const o = new YM3812();
    const w = (a, v) => { o.write(0, a); o.write(1, v); };
    // Bit 5 is EG-TYPE, and it is the difference between an organ and a
    // marimba: 1 SUSTAINS while the key is held, 0 is percussive and keeps
    // decaying to silence even under a held key. A pitch test needs the note
    // still there when it measures, so it asks for the sustaining kind.
    w(0x20, 0x21); w(0x23, 0x21);            // multiple = 1, EG-type = sustaining
    w(0x40, 0x00); w(0x43, 0x00);            // total level = 0, i.e. loudest
    w(0x60, 0xf0); w(0x63, 0xf0);            // fastest attack, no decay
    // RR=0 IS NOT "a fast release", it is NO release -- the OPL holds the
    // level indefinitely. A test that wants to hear a note die has to ask
    // for one, and this is the kind of register whose zero means "never"
    // rather than "immediately".
    w(0x80, 0x08); w(0x83, 0x08);            // sustain 0, release rate 8
    w(0xc0, alg & 1);
    const fnum = Math.round(hz * Math.pow(2, 20 - block) / RATE);
    w(0xa0, fnum & 0xff);
    w(0xb0, 0x20 | ((block & 7) << 2) | ((fnum >> 8) & 3));
    return { o, w };
}

const render = (o, ms = 200, frames = 9600) => {
    o.prepareAudio(48000);
    o.advanceMs(ms);
    const buf = new Float32Array(frames);
    const n = o.renderAudio(buf, frames);
    return buf.subarray(0, n);
};

test('the two contracts agree across the register range', () => {
    // Block chosen per pitch: a 10-bit F-number cannot reach every frequency
    // from every block, and saturating it would test the clamp rather than
    // the chain.
    for (const [hz, block] of [[220, 4], [440, 4], [880, 5], [1760, 6]]) {
        const { o } = voice(hz, { block });
        const claimed = o.audioTone();
        assert.equal(claimed.length, 1, 'one channel keyed on, one voice claimed');
        const buf = render(o);
        const measured = freqFromCrossings(buf, 48000);
        assert.ok(Math.abs(measured - claimed[0].hz) / claimed[0].hz < 0.02,
            `claimed ${claimed[0].hz} Hz, measured ${measured.toFixed(1)}`);
        assert.ok(claimedBinIsStrongest(buf, 48000, claimed[0].hz).ok,
            `${claimed[0].hz} Hz must be the STRONGEST bin, not merely present`);
    }
});

test('FM modulation keeps the carrier pitch and changes the timbre', () => {
    // The point of an OPL: the modulator bends the carrier's phase, which
    // adds harmonics WITHOUT moving the fundamental. If FM moved the pitch,
    // every instrument would be out of tune, and the agreement test is what
    // would say so.
    const add = render(voice(440, { alg: 1 }).o);
    assert.ok(Math.abs(freqFromCrossings(add, 48000) - 440) / 440 < 0.02, 'additive is 440');

    // A MODULATOR AT TOTAL LEVEL 0 IS AN EXTREME NO REAL PATCH USES: at full
    // scale the modulation index is a whole cycle, the harmonics swamp the
    // fundamental, and "which bin is strongest" stops being a question about
    // pitch. Real instrument patches attenuate the modulator, which is what
    // the TL register is for -- so the test asks for a realistic one.
    const { o, w } = voice(440, { alg: 0 });
    w(0x40, 0x18);                                   // modulator attenuated
    const fm = render(o);
    assert.ok(claimedBinIsStrongest(fm, 48000, 440).ok,
        'with a real modulator level the fundamental still wins — FM adds harmonics, '
        + 'it does not move the pitch, and if it did every instrument would be out of tune');
});

test('a voice with no key-on claims nothing — the arity is meaningful', () => {
    const o = new YM3812();
    assert.deepEqual(o.audioTone(), [],
        'nine channels exist; none is claiming a pitch it is not playing');
    const { o: keyed } = voice(440);
    assert.equal(keyed.audioTone().length, 1, 'one keyed channel, one voice');
});

test('key-off releases: the note decays instead of stopping dead', () => {
    const { o, w } = voice(440);
    o.prepareAudio(48000);
    o.advanceMs(50);
    const before = new Float32Array(2048);
    o.renderAudio(before, 2048);
    const loud = Math.max(...before.map(Math.abs));
    assert.ok(loud > 0.05, `the note should be audible first, peak ${loud.toFixed(3)}`);

    w(0xb0, 0x00);                                   // key off, same channel
    assert.deepEqual(o.audioTone(), [], 'and it stops claiming a pitch immediately');
    o.advanceMs(400);
    const after = new Float32Array(4096);
    const n = o.renderAudio(after, 4096);
    const tail = Math.max(...after.subarray(Math.max(0, n - 512)).map(Math.abs));
    assert.ok(tail < loud / 4, `the tail should have decayed, ${tail.toFixed(3)} vs ${loud.toFixed(3)}`);
});

test('what it does not model is REFUSED BY NAME, not silently approximated', () => {
    const o = new YM3812();
    const w = (a, v) => { o.write(0, a); o.write(1, v); };
    w(0xbd, 0x20);                                   // rhythm mode
    w(0x08, 0x80);                                   // CSM
    const names = o.report().unsupported.map((u) => u.what);
    assert.ok(names.some((n) => /rhythm/i.test(n)),
        'a program that enables rhythm gets the melodic channels it had, which is '
        + 'wrong — so it is recorded rather than left to sound merely odd');
    assert.ok(names.some((n) => /CSM/i.test(n)));
});

test('the status read is a status byte, not open bus', () => {
    const o = new YM3812();
    // A detection routine writes the timer registers and reads 388h. There are
    // no timers here, so the IRQ bits never set — which is honest, and is why
    // a program that DEPENDS on timer detection will not find this card.
    assert.equal(o.read(0) & 0x80, 0, 'no IRQ pending, ever');
});

// ---------------------------------------------------------------------------
// On a real machine, at the port a real program writes to.
// ---------------------------------------------------------------------------
import { I8086Machine } from '../src/i8086-machine.js';

test('an 8086 program at 388h/389h makes the OPL sound, and the machine mixes it', () => {
    const m = new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0xfffff }],
        chips: [{ kind: 'opl2', name: 'opl', at: 0x388 }],
    });
    assert.equal(m.canRenderAudio(), true, 'the OPL can render samples');

    // Exactly what an AdLib driver does: address to 388h, data to 389h.
    const w = (a, v) => { m._out(0x388, a); m._out(0x389, v); };
    w(0x20, 0x21); w(0x23, 0x21);
    w(0x40, 0x00); w(0x43, 0x00);
    w(0x60, 0xf0); w(0x63, 0xf0);
    w(0x80, 0x08); w(0x83, 0x08);
    w(0xc0, 0x01);
    const block = 4;
    const fnum = Math.round(440 * Math.pow(2, 20 - block) / RATE);
    w(0xa0, fnum & 0xff);
    w(0xb0, 0x20 | (block << 2) | ((fnum >> 8) & 3));

    assert.deepEqual(m.audioTone(), [{ hz: 440, on: true, vol: 15 }],
        'the machine reports the OPL voice through the same contract as a speaker');

    // Attaching the bus arms the chip; then run the machine's own clock.
    const bus = m.audio;
    const chunks = [];
    const tmp = new Float32Array(4096);
    for (let ms = 0; ms < 200; ms++) {
        m._advanceChips(Math.round(4_772_727 / 1000));
        bus.advance(ms + 1);
        const n = bus.read(tmp, 4096);
        if (n) chunks.push(Float32Array.from(tmp.subarray(0, n)));
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(total);
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    assert.ok(total > 4000, `expected real audio through the machine, got ${total}`);
    const measured = freqFromCrossings(all, 48000);
    assert.ok(Math.abs(measured - 440) / 440 < 0.03,
        `440 Hz survives the machine, the mixer and the ring; measured ${measured.toFixed(1)}`);
});
