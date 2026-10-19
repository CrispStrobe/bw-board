/**
 * The AY-3-8912 as the second audio producer (E6.8.11a) — and the SHAPE TEST
 * for the contract, which is what it was for.
 *
 * The contract was designed against `pc-speaker.js`, a chip whose output is
 * DERIVED: it holds no counters, reads a divisor, and can compute any
 * interval on demand. The AY is the other kind. It is clocked by the machine
 * at chip rate, its audible output IS its internal counter state, and by the
 * time a host asks for a buffer that waveform has already happened. It cannot
 * render on demand and must not be re-clocked by the renderer.
 *
 * THAT FORCED A CHANGE TO THE CONTRACT — `prepareAudio(sampleRate)`, called by
 * the bus on attach and with 0 on detach — which is exactly the outcome
 * putting a second producer early was meant to produce. Found after two
 * implementations instead of after four.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AY38912 } from '../src/ay-3-8912.js';
import { AudioBus } from '../src/audio-bus.js';
import { freqFromCrossings, claimedBinIsStrongest } from './audio-analysis.mjs';

const CLK = 1_773_400;                                  // the ZX Spectrum's AY clock

/** An AY with channel A playing a tone at about `hz`, everything else off. */
function toneA(hz, { vol = 15 } = {}) {
    const ay = new AY38912({ clockHz: CLK });
    const per = Math.round(CLK / (16 * 2 * hz));
    ay.select(0); ay.write(per & 0xff);
    ay.select(1); ay.write((per >> 8) & 0x0f);
    ay.select(7); ay.write(0x3e);                       // tone A on, noise off, B/C off
    ay.select(8); ay.write(vol);
    return ay;
}

test('a chip nobody is listening to pays nothing', () => {
    const ay = toneA(440);
    ay.advance(CLK);                                    // a whole second, unarmed
    const buf = new Float32Array(128);
    assert.equal(ay.renderAudio(buf, 128, 48000), 0, 'no frames, because none were kept');
    assert.ok(buf.every((v) => v === 0));
});

test('the two contracts agree on the AY, per voice', () => {
    for (const want of [220, 440, 1000]) {
        const ay = toneA(want);
        const claimed = ay.audioTone()[0];
        assert.ok(Math.abs(claimed.hz - want) / want < 0.02, `claimed ${claimed.hz} for ${want}`);
        assert.equal(claimed.on, true);

        ay.prepareAudio(48000);
        ay.advance(CLK / 8);                            // an eighth of a second
        const frames = 6000;
        const buf = new Float32Array(frames);
        const n = ay.renderAudio(buf, frames, 48000);
        assert.ok(n > frames * 0.9, `expected a full drain, got ${n}/${frames}`);

        const got = buf.subarray(0, n);
        const measured = freqFromCrossings(got, 48000);
        assert.ok(Math.abs(measured - claimed.hz) / claimed.hz < 0.02,
            `claimed ${claimed.hz} Hz, measured ${measured.toFixed(1)} Hz`);
        assert.ok(claimedBinIsStrongest(got, 48000, claimed.hz).ok,
            `${claimed.hz} Hz must be the STRONGEST bin, not merely present`);
    }
});

test('THE UNIPOLAR TRAP: the AY has a DC offset and the speaker does not', () => {
    // A PC speaker renders +/-1 about zero. The AY renders 0..1, because a
    // gated-off channel contributes zero and there is no negative half.
    // Counting crossings of ZERO measures the speaker and finds nothing at
    // all in the AY -- which would have read as a broken chip rather than a
    // broken test. The analysis is mean-relative for exactly this reason.
    const ay = toneA(440);
    ay.prepareAudio(48000);
    ay.advance(CLK / 8);
    const buf = new Float32Array(6000);
    const n = ay.renderAudio(buf, 6000, 48000);
    const got = buf.subarray(0, n);
    assert.ok(got.every((v) => v >= 0), 'the AY signal really is unipolar');
    let zeroCrossings = 0;
    for (let i = 1; i < got.length; i++) if (got[i - 1] < 0 && got[i] >= 0) zeroCrossings++;
    assert.equal(zeroCrossings, 0, 'and a zero-relative measurement finds nothing');
    assert.ok(Math.abs(freqFromCrossings(got, 48000) - 440) / 440 < 0.02,
        'while the mean-relative one finds 440');
});

test('volume is logarithmic, which the frequency test cannot see', () => {
    // The AY's 16 steps are roughly 3 dB apart. A linear ramp would measure
    // identically in every frequency test and sound wrong, so it gets its own
    // assertion -- the class of bug a single-axis check leaves standing.
    const peak = (v) => {
        const ay = toneA(440, { vol: v });
        ay.prepareAudio(48000);
        ay.advance(CLK / 16);
        const buf = new Float32Array(3000);
        const n = ay.renderAudio(buf, 3000, 48000);
        return Math.max(...buf.subarray(0, n));
    };
    const half = peak(8), full = peak(15);
    assert.ok(full > half, 'louder is louder');
    assert.ok(half / full < 0.4,
        `step 8 of 15 should be well under half amplitude on a log scale, got ${(half / full).toFixed(2)}`);
});

test('a noise-only channel is audible but has no pitch to agree about', () => {
    // audioTone() reports `on` for a channel with tone disabled and noise
    // enabled -- correctly, it IS audible -- beside an `hz` read from a tone
    // period nothing is using. That is fine as a face summary and would be a
    // lie as a claim about pitch. Writing the sample path is what made it
    // visible, and it is why the agreement test checks TONE-enabled channels
    // only.
    const ay = new AY38912({ clockHz: CLK });
    ay.select(6); ay.write(5);                          // noise period
    ay.select(7); ay.write(0x37);                       // tone A off, noise A ON
    ay.select(8); ay.write(15);
    const t = ay.audioTone()[0];
    assert.equal(t.on, true, 'it is audible');
    ay.prepareAudio(48000);
    ay.advance(CLK / 8);
    const buf = new Float32Array(6000);
    const n = ay.renderAudio(buf, 6000, 48000);
    const measured = freqFromCrossings(buf.subarray(0, n), 48000);
    // Noise has no stable pitch: whatever it measures, it is not the tone
    // register's frequency, and asserting agreement here would be asserting
    // a lie.
    assert.ok(!(Math.abs(measured - t.hz) / t.hz < 0.02),
        `noise must NOT match the unused tone period (${t.hz} Hz vs ${measured.toFixed(0)} Hz)`);
});

test('through the bus: prepareAudio is called on attach and disarmed on detach', () => {
    const ay = toneA(440);
    const bus = new AudioBus({ sampleRate: 48000, ringMs: 500 });
    bus.addSource(ay);                                  // arms it
    bus.advance(0);
    ay.advance(CLK / 10);                               // the machine clocks the chip
    bus.advance(100);                                   // 100 ms of emulated time
    const out = new Float32Array(4800);
    const real = bus.read(out, 4800);
    assert.ok(real > 4000, `expected most of it real, got ${real}`);
    assert.ok(Math.abs(freqFromCrossings(out.subarray(0, real), 48000) - 440) / 440 < 0.02,
        'and 440 survives the mixer and the ring');

    bus.removeSource(ay);
    ay.advance(CLK / 10);
    const after = new Float32Array(128);
    assert.equal(ay.renderAudio(after, 128, 48000), 0, 'detached, it stops accumulating');
});

// ---------------------------------------------------------------------------
// The 6502 tier end to end: a machine that had a real audio chip attachable
// and no way to hear it.
// ---------------------------------------------------------------------------
import { M6502Machine } from '../src/m6502-machine.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';

// THE AY'S XTAL MATCHES THE CPU CLOCK HERE, DELIBERATELY, and the next test
// explains why it has to. On this tier `advance(n)` is handed MACHINE cycles
// while `audioTone()` computes its frequency from the chip's OWN `clockHz`,
// so the two only agree when the two clocks are the same number.
const psgMachine = () => new M6502Machine({
    clockHz: CLK,
    // The machine REFUSES an overlap by name, so the chip gets a hole of its
    // own between RAM and ROM rather than sitting on top of RAM.
    // The machine REFUSES an overlap by name, so the chip gets a hole of its
    // own between RAM and ROM rather than sitting on top of RAM.
    regions: [{ kind: 'ram', start: 0, end: 0x5fff }, { kind: 'rom', start: 0x8000, end: 0xffff }],
    chips: [{ kind: 'psg8912', name: 'psg', at: 0x6000, xtal: CLK }],
});

/**
 * Run a machine for `ms` of emulated time, draining audio as a host would.
 *
 * DRAINING AS WE GO IS NOT A DETAIL. Both rings are small on purpose — the
 * bus holds 200 ms and the AY a quarter second — so a test that runs two
 * seconds and reads at the end measures whatever survived two ring overflows,
 * which is discontinuous audio and a meaningless frequency. The first version
 * of the test below did exactly that and reported a defect that was its own.
 * Only the REAL frames are kept: an underrun's padding is excluded rather
 * than measured.
 */
function runDraining(m, ms) {
    const bus = m.audio;
    const steps = Math.round(m.clockHz * ms / 1000);
    const tmp = new Float32Array(512);
    const chunks = [];
    for (let i = 0; i < steps; i++) {
        m.step();
        if ((i & 1023) === 0) {
            const n = bus.read(tmp, 512);
            if (n) chunks.push(Float32Array.from(tmp.subarray(0, n)));
        }
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return all;
}

test('6502: the machine surfaces both contracts, and declares only what it has', () => {
    const m = psgMachine();
    assert.equal(m.canRenderAudio(), true, 'a psg8912 can render samples');
    const tones = m.audioTone();
    assert.ok(Array.isArray(tones), 'ALWAYS an array — this tier is array-native');
    assert.equal(tones.length, 3, 'and the arity is the voice count, not merely "an array"');

    // A machine with no sound chip must not advertise samples: a control that
    // silently does nothing is worse than an absent one.
    const silent = new M6502Machine({
        clockHz: 1_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        chips: [],
    });
    assert.equal(silent.canRenderAudio(), false);
    assert.deepEqual(silent.audioTone(), [], 'no voices, not a fake one');
});

test('6502: capabilities().audio follows the machine, not the tier', () => {
    const withPsg = createM6502DebugTarget({ machine: psgMachine() });
    assert.deepEqual(withPsg.capabilities().audio, ['tone', 'samples']);

    const without = createM6502DebugTarget({
        machine: new M6502Machine({
            clockHz: 1_000_000,
            regions: [{ kind: 'ram', start: 0, end: 0xffff }],
            chips: [],
        }),
    });
    assert.deepEqual(without.capabilities().audio, ['tone']);
    assert.equal(without.readAudio(new Float32Array(64), 64), 0, 'and it renders nothing');
});

test('6502 END TO END: a program writes AY registers and the tier makes a sound', () => {
    const m = psgMachine();
    const per = Math.round(CLK / (16 * 2 * 440));
    const poke = (reg, val) => { m._write(0x6000, reg); m._write(0x6001, val); };
    poke(0, per & 0xff);
    poke(1, (per >> 8) & 0x0f);
    poke(7, 0x3e);
    poke(8, 15);
    assert.equal(m.audioTone()[0].hz, 440, 'the tone contract sees it');
    assert.equal(m.audio.active, true, 'and attaching the bus armed the chip');

    const got = runDraining(m, 200);
    assert.ok(got.length > 4000, `expected real audio out of the tier, got ${got.length} frames`);
    const measured = freqFromCrossings(got, m.audio.sampleRate);
    assert.ok(Math.abs(measured - 440) / 440 < 0.03,
        `the 6502 tier plays 440 Hz; measured ${measured.toFixed(1)}`);
});

test('a separate AY crystal is honoured — the defect the sample path found, now fixed', () => {
    // `psg8912` accepts an `xtal` so the AY can run on its own crystal rather
    // than the CPU's, which is the normal hookup and the ZX Spectrum's. It
    // used to be IGNORED: every chip is advanced with MACHINE cycles while
    // audioTone() derives frequency from the chip's OWN clockHz, so the chip
    // was ticked at one rate and reported at another. Claim 440, measure 9382.
    //
    // THE TONE CONTRACT COULD NEVER HAVE CAUGHT THIS. It reads a register and
    // does arithmetic; it is self-consistent, and there was nothing for it to
    // disagree with. Rendering samples gave it something to disagree with,
    // which is the whole argument for having two contracts — arriving from a
    // direction nobody planned, in a chip nobody was auditing.
    //
    // This test was written RED, pinning the broken behaviour, and flipped
    // when lego-47 chose the fix: scale `advance` to the crystal rather than
    // drop `xtal`, because a config option that looks honoured and is not is
    // the exact defect this repo keeps finding.
    const per = Math.round(CLK / (16 * 2 * 440));
    const program = (m) => {
        const poke = (reg, val) => { m._write(0x6000, reg); m._write(0x6001, val); };
        poke(0, per & 0xff); poke(1, (per >> 8) & 0x0f); poke(7, 0x3e); poke(8, 15);
    };

    // One clock: agreed before the fix and still does.
    const matched = psgMachine();
    program(matched);
    const okFreq = freqFromCrossings(runDraining(matched, 200), matched.audio.sampleRate);
    assert.ok(Math.abs(okFreq - 440) / 440 < 0.03,
        `one clock: claimed 440, measured ${okFreq.toFixed(0)}`);

    // Two clocks: the case that used to be wrong by the ratio of them.
    const split = new M6502Machine({
        clockHz: 1_000_000,                            // CPU at 1 MHz
        regions: [{ kind: 'ram', start: 0, end: 0x5fff }, { kind: 'rom', start: 0x8000, end: 0xffff }],
        chips: [{ kind: 'psg8912', name: 'psg', at: 0x6000, xtal: CLK }],   // AY at 1.7734 MHz
    });
    program(split);
    assert.equal(split.audioTone()[0].hz, 440, 'the claim is 440');
    const splitFreq = freqFromCrossings(runDraining(split, 200), split.audio.sampleRate);
    assert.ok(Math.abs(splitFreq - 440) / 440 < 0.05,
        `two clocks must now agree too: claimed 440, measured ${splitFreq.toFixed(0)}`);
});
