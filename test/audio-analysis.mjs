/**
 * Frequency analysis for the audio-contract agreement check (E6.8.11a).
 *
 * NOT a .test.mjs, deliberately: this used to live inside
 * audio-contract.test.mjs and be imported from audio-bus.test.mjs, which
 * meant the contract tests RAN TWICE whenever both files were collected. A
 * helper that is also a test file is a helper that reports numbers nobody
 * asked for.
 *
 * WHY TWO METHODS AND NOT ONE. The first version of the agreement check ran a
 * Goertzel filter at the claimed frequency and asserted the energy was high.
 * That cannot fail: a Goertzel AT 440 Hz reports energy for any signal
 * CONTAINING 440 Hz -- one that is mostly 880 with a weak fundamental, one
 * where 440 is buried in noise, a square wave whose third harmonic dominates.
 * It answers "is there some 440 here" when the claim is "440 is what this IS".
 *
 * The drift that actually happens is OFF BY AN OCTAVE, from a divisor counted
 * per-edge instead of per-cycle, and a bare Goertzel at 440 passes it
 * silently. So both of these are required, and the mutation test in
 * audio-contract.test.mjs proves they fail it.
 */

/**
 * Frequency from crossings of the signal's MEAN — a FREQUENCY, not a score.
 *
 * MEAN-RELATIVE AND NOT ZERO-RELATIVE, and the second producer is why. A PC
 * speaker is one bit driving a cone and renders BIPOLAR, ±1 about zero. The
 * AY-3-8912 renders UNIPOLAR: its levels run 0..1, because a gated-off
 * channel contributes zero and there is no negative half. Counting crossings
 * of zero measures the speaker correctly and finds NOTHING at all in the AY,
 * which would have read as a broken chip rather than as a broken test.
 *
 * Removing the mean is right for both: for a symmetric signal the mean is
 * already zero and nothing changes.
 */
export function freqFromCrossings(buf, sampleRate) {
    let mean = 0;
    for (let i = 0; i < buf.length; i++) mean += buf[i];
    mean /= buf.length || 1;
    let first = -1, last = -1, crossings = 0;
    for (let i = 1; i < buf.length; i++) {
        if (buf[i - 1] < mean && buf[i] >= mean) {
            if (first < 0) first = i; else last = i;
            crossings++;
        }
    }
    if (crossings < 2 || last <= first) return 0;
    // Measured over WHOLE periods only: from the first rising crossing to the
    // last, which is exactly (crossings-1) periods. Counting over the whole
    // buffer instead folds in two partial periods at the ends.
    return (crossings - 1) * sampleRate / (last - first);
}

/** Goertzel energy at one frequency. */
function goertzel(buf, sampleRate, hz) {
    const w = 2 * Math.PI * hz / sampleRate;
    const coeff = 2 * Math.cos(w);
    // DC removed for the same reason as above: a unipolar producer's offset
    // is energy at 0 Hz, and leaving it in flatters every bin equally without
    // telling us anything about pitch.
    let mean = 0;
    for (let i = 0; i < buf.length; i++) mean += buf[i];
    mean /= buf.length || 1;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < buf.length; i++) { s0 = (buf[i] - mean) + coeff * s1 - s2; s2 = s1; s1 = s0; }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/**
 * The claimed frequency must be the STRONGEST bin, not merely present. That
 * is the difference between a detector and a confirmation, and it is what
 * makes the octave error fail.
 */
export function claimedBinIsStrongest(buf, sampleRate, hz) {
    const probes = [hz, hz * 2, hz / 2, hz * 3, hz * 0.75, hz * 1.5];
    const energies = probes.map((f) => goertzel(buf, sampleRate, f));
    const best = energies.indexOf(Math.max(...energies));
    return { ok: best === 0, energies, probes };
}
