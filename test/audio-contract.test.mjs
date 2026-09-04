/**
 * E6.8.11a — the two audio contracts, and the test that they agree.
 *
 * `audioTone()` says what the hardware is CONFIGURED to produce.
 * `renderAudio()` says what it SOUNDS like. They are written separately, on
 * purpose, and this file is the cross-check between them — the discipline §8
 * of the core plan records for the CGA pixel layout, where sharing the code
 * would have been less work and would have caught nothing.
 *
 * THE FIRST VERSION OF THIS TEST COULD NOT FAIL, and the reason is worth
 * keeping in front of whoever edits it. It ran a Goertzel filter at the
 * claimed frequency and asserted the energy was high. But a Goertzel AT 440 Hz
 * reports energy for any signal CONTAINING 440 Hz — one that is mostly 880 Hz
 * with a weak fundamental, one where 440 is buried in noise, a square wave
 * whose third harmonic dominates. It answers "is there some 440 here" when
 * the claim is "440 is what this IS".
 *
 * That matters because of the drift that actually happens: OFF BY AN OCTAVE,
 * from a divisor counted per-edge instead of per-cycle. A bare Goertzel at
 * 440 passes that silently — the exact failure this test exists to catch.
 *
 * So both checks below are required, and `mutation` at the bottom proves they
 * can fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PCSpeaker } from '../src/pc-speaker.js';
import { freqFromCrossings, claimedBinIsStrongest } from './audio-analysis.mjs';

/** The whole agreement check, for any producer of both contracts. */
export function contractsAgree(chip, sampleRate = 48000, frames = 48000) {
    const tone = chip.audioTone();
    const t = Array.isArray(tone) ? tone[0] : tone;
    const buf = new Float32Array(frames);
    chip.renderAudio(buf, frames, sampleRate);
    if (!t.on) return { silent: true, allZero: buf.every((v) => v === 0) };
    const measured = freqFromCrossings(buf, sampleRate);
    const strongest = claimedBinIsStrongest(buf, sampleRate, t.hz);
    return {
        silent: false,
        claimed: t.hz,
        measured,
        withinOnePercent: Math.abs(measured - t.hz) / t.hz < 0.01,
        strongest: strongest.ok,
    };
}

const speaker = (divisor) => {
    const s = new PCSpeaker({ readDivisor: () => divisor });
    s.setControl(3);                                   // gate + data
    return s;
};

test('the speaker declares a tone and renders a stream that agrees with it', () => {
    // 1193182 / 2712 = 440 Hz. Also a middle-C-ish and a high one, because a
    // single frequency can agree by luck.
    for (const [divisor, want] of [[2712, 440], [4560, 262], [1193, 1000]]) {
        const r = contractsAgree(speaker(divisor));
        assert.equal(r.claimed, want, `divisor ${divisor}`);
        assert.ok(r.withinOnePercent,
            `claimed ${r.claimed} Hz, measured ${r.measured.toFixed(1)} Hz`);
        assert.ok(r.strongest, `${r.claimed} Hz must be the STRONGEST bin, not merely present`);
    }
});

test('a silent speaker renders silence, not stale buffer contents', () => {
    const s = new PCSpeaker({ readDivisor: () => 2712 });
    s.setControl(0);                                   // gate and data both off
    const buf = new Float32Array(64).fill(0.5);        // pre-dirtied
    s.renderAudio(buf, 64, 48000);
    assert.ok(buf.every((v) => v === 0),
        'silence is a signal; an untouched buffer replays whatever was there');
});

test('phase is continuous across calls', () => {
    // Rendering in two halves must equal rendering in one go. Restarting the
    // phase per call is inaudible in a test that renders once and a click
    // every buffer in an app that renders forever.
    const one = new Float32Array(2048);
    speaker(2712).renderAudio(one, 2048, 48000);
    const s = speaker(2712);
    const two = new Float32Array(2048);
    s.renderAudio(two.subarray(0, 1024), 1024, 48000);
    s.renderAudio(two.subarray(1024), 1024, 48000);
    assert.deepEqual([...two], [...one]);
});

test('MUTATION: the octave error is caught — this is why the Goertzel alone was not a test', () => {
    // A divisor counted per-edge instead of per-cycle renders at 2f while
    // audioTone() still claims f. This is the real drift, and a bare Goertzel
    // at f passes it because the octave contains f's bin energy.
    const s = speaker(2712);
    const claimed = s.audioTone().hz;                  // 440
    const buf = new Float32Array(48000);
    // Render the WRONG thing: double frequency, same claim.
    const wrong = new PCSpeaker({ readDivisor: () => 1356 });   // half the divisor
    wrong.setControl(3);
    wrong.renderAudio(buf, 48000, 48000);
    assert.equal(wrong.audioTone().hz, 880, 'the mutant really is an octave up');

    const measured = freqFromCrossings(buf, 48000);
    assert.ok(Math.abs(measured - claimed) / claimed > 0.5,
        `zero crossings catch it: measured ${measured.toFixed(0)} against a claim of ${claimed}`);

    const strongest = claimedBinIsStrongest(buf, 48000, claimed);
    assert.equal(strongest.ok, false,
        'and the claimed bin is NOT strongest — 880 beats 440 in an 880 Hz square');
});
