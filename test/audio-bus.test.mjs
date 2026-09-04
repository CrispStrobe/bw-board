/**
 * The shared audio bus (E6.8.11a): one mixer and one ring for all three tiers.
 *
 * The load-bearing behaviours are the ones that hide problems if they are
 * wrong, so those are what this file leans on: emulated time driving the
 * frame count, underruns being COUNTED rather than merely padded, an
 * over-running emulator dropping rather than overwriting unread audio, and
 * clipping being a number instead of a noise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioBus } from '../src/audio-bus.js';
import { PCSpeaker } from '../src/pc-speaker.js';
import { freqFromCrossings, claimedBinIsStrongest } from './audio-analysis.mjs';

/** A source that emits a constant, so mixing is arithmetic we can check. */
const dc = (v) => ({ renderAudio(dest, frames) { dest.fill(v, 0, frames); return frames; } });

test('the first advance renders nothing — it establishes the origin', () => {
    const bus = new AudioBus({ sampleRate: 1000 });
    bus.addSource(dc(1));
    // A machine running for ten seconds before anyone listened must not be
    // asked for ten seconds of audio the moment someone does.
    assert.equal(bus.advance(10_000), 0);
    assert.equal(bus.available, 0);
    assert.equal(bus.advance(10_100), 100, 'and then 100 ms is 100 frames at 1 kHz');
});

test('frames follow EMULATED time, and the fraction is carried not lost', () => {
    const bus = new AudioBus({ sampleRate: 44100 });
    bus.addSource(dc(0));
    bus.advance(0);
    let total = 0;
    // 1 ms at 44100 Hz is 44.1 frames. Ten of them must be 441, not 440.
    for (let i = 1; i <= 10; i++) total += bus.advance(i);
    assert.equal(total, 441, 'the 0.1 frame per ms is carried, not dropped');
});

test('sources SUM, and a short source contributes silence rather than stale samples', () => {
    const bus = new AudioBus({ sampleRate: 1000 });
    bus.addSource(dc(0.25)).addSource(dc(0.5));
    bus.advance(0); bus.advance(10);
    const out = new Float32Array(10);
    assert.equal(bus.read(out, 10), 10);
    for (const v of out) assert.ok(Math.abs(v - 0.75) < 1e-6, `expected 0.75, got ${v}`);

    // A source that writes only half its frames must not leave the other
    // source's samples showing through the rest.
    const half = { renderAudio(dest, frames) { dest.fill(1, 0, frames >> 1); return frames >> 1; } };
    const b2 = new AudioBus({ sampleRate: 1000 });
    b2.addSource(half);
    b2.advance(0); b2.advance(10);
    const o2 = new Float32Array(10);
    b2.read(o2, 10);
    assert.equal(o2[0], 1);
    assert.equal(o2[9], 0, 'the unwritten tail is silence');
});

test('an UNDERRUN pads with silence and is COUNTED', () => {
    const bus = new AudioBus({ sampleRate: 1000 });
    bus.addSource(dc(1));
    bus.advance(0); bus.advance(5);                 // only 5 frames produced
    const out = new Float32Array(20).fill(0.5);
    const real = bus.read(out, 20);
    assert.equal(real, 5, 'five frames of real audio');
    assert.equal(out[19], 0, 'and the rest is silence, not stale buffer');
    // Padding is unavoidable; hiding it is not. This is the whole point.
    assert.equal(bus.stats.underruns, 15, 'the invented frames are counted');
});

test('an emulator running AHEAD drops rather than overwriting unread audio', () => {
    // A 10 ms ring at 1 kHz holds 10 frames. Ask for 50.
    const bus = new AudioBus({ sampleRate: 1000, ringMs: 10 });
    bus.addSource(dc(1));
    bus.advance(0);
    const got = bus.advance(50);
    assert.equal(got, 10, 'only what fits is rendered');
    assert.equal(bus.stats.dropped, 40,
        'and the excess is counted — audio nobody will hear in time is worse played late');
});

test('CLIPPING is clamped and counted, not left to be heard', () => {
    const bus = new AudioBus({ sampleRate: 1000 });
    bus.addSource(dc(0.8)).addSource(dc(0.8));      // sums to 1.6
    bus.advance(0); bus.advance(10);
    const out = new Float32Array(10);
    bus.read(out, 10);
    for (const v of out) assert.equal(v, 1, 'clamped to full scale');
    assert.equal(bus.stats.clipped, 10, '"the mix is distorting" is a number, not a noise');
});

test('no sources means no work — the bus costs nothing when nobody listens', () => {
    const bus = new AudioBus({ sampleRate: 1000 });
    assert.equal(bus.active, false);
    bus.advance(0);
    assert.equal(bus.advance(1000), 0, 'a whole second of emulated time renders nothing');
    assert.equal(bus.stats.rendered, 0);
});

test('time going backwards re-anchors instead of rendering a negative interval', () => {
    // A state restore moves emulated time backwards. That must not produce a
    // negative frame count or a spike when it moves forward again.
    const bus = new AudioBus({ sampleRate: 1000 });
    bus.addSource(dc(1));
    bus.advance(0); bus.advance(100);
    const before = bus.stats.rendered;
    assert.equal(bus.advance(50), 0, 'backwards renders nothing');
    assert.equal(bus.advance(60), 10, 'and forward from there is 10 ms, not 60');
    assert.equal(bus.stats.rendered, before + 10);
});

test('END TO END: a real speaker through the bus still measures its claimed tone', () => {
    // The agreement test from audio-contract, but through the mixer and the
    // ring rather than straight out of the chip -- because a bus that
    // resampled, dropped or duplicated frames would break the frequency while
    // every unit test above still passed.
    const spk = new PCSpeaker({ readDivisor: () => 2712 });   // 440 Hz
    spk.setControl(3);
    const bus = new AudioBus({ sampleRate: 48000, ringMs: 1000 });
    bus.addSource(spk);
    bus.advance(0);
    bus.advance(500);                                // half a second of emulated time
    const out = new Float32Array(24000);
    const real = bus.read(out, 24000);
    assert.ok(real > 20000, `expected most of the buffer to be real audio, got ${real}`);
    const buf = out.subarray(0, real);
    const measured = freqFromCrossings(buf, 48000);
    assert.ok(Math.abs(measured - 440) / 440 < 0.01,
        `through the bus the tone must still be 440, measured ${measured.toFixed(1)}`);
    assert.ok(claimedBinIsStrongest(buf, 48000, 440).ok, '440 is still the strongest bin');
});
