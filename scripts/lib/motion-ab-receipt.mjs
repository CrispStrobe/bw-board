/** Strict diagnostic parsing; synthetic parser tests are not engine evidence. */
export const gluePolicy = (baselineHash, candidateHash, allowPairedGlue = false) => {
    if (baselineHash === candidateHash) return 'identical original glue';
    if (!allowPairedGlue) throw Error('Different glue requires explicit --paired-glue');
    return 'explicit paired-glue comparison; each engine loads its own unmodified original build glue';
};
export const median = values => {
    if (!values.length || values.some(value => !Number.isFinite(value))) throw Error('Invalid median input');
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export const assertSameMotionGuest = (baseline, candidate) => {
    // ELF file hashes remain provenance, not equality: GCC's temporary object
    // filename changes non-loaded symbol metadata even for identical sources.
    if (!baseline?.guestSha256 || !candidate?.guestSha256 ||
        !Array.isArray(baseline.guestObservations) || baseline.guestObservations.length !== 5 ||
        JSON.stringify(baseline.guestObservations) !== JSON.stringify(candidate.guestObservations)) {
        throw Error('Missing guest hash or differing cycle-indexed observations across A/B runs');
    }
};
export const motionProbeResult = (stdout, exitCode) => {
    const samples = stdout.split('\n').filter(line => line.startsWith('MICROBIT_WASM_SAMPLE '))
        .map(line => JSON.parse(line.slice('MICROBIT_WASM_SAMPLE '.length)));
    if (samples.length !== 5 || samples.some((s, index) => s.index !== index ||
        s.cycles !== 64_000_000 || s.cpuHz !== 64_000_000 ||
        !Number.isFinite(s.wallSeconds) || s.wallSeconds <= 0 ||
        !Number.isFinite(s.rtx) || s.rtx <= 0 || Math.abs(s.rtx * s.wallSeconds - 1) > 1e-10) ||
        !/^# tests 2$/m.test(stdout) || !/^# skipped 0$/m.test(stdout) ||
        !/^[ \t]*ok 1 - reads both sensor identities, poses, actual DMA, matrix and buttons$/m.test(stdout)) {
        throw Error('Incomplete or inconsistent actual motion harness result');
    }
    const allWindowsMeet1x = samples.every(s => s.rtx >= 1);
    if (exitCode !== (allWindowsMeet1x ? 0 : 1) ||
        !new RegExp(`^# fail ${allWindowsMeet1x ? 0 : 1}$`, 'm').test(stdout) ||
        !new RegExp(`^# pass ${allWindowsMeet1x ? 2 : 1}$`, 'm').test(stdout)) {
        throw Error('Unexpected exit/failure count');
    }
    const hashes = [...stdout.matchAll(/^MICROBIT_WASM_GUEST_SHA256=([a-f0-9]{64})$/gm)];
    if (hashes.length !== 1 || samples.some(s =>
        ['accelRaw', 'magRaw'].some(key => !Array.isArray(s[key]) || s[key].length !== 3 ||
            s[key].some(value => !Number.isSafeInteger(value))) ||
        ['accelSamples', 'magSamples', 'scans'].some(key => !Number.isSafeInteger(s[key]) || s[key] <= 0))) {
        throw Error('Missing guest hash or complete guest observations');
    }
    // Compare every reported guest field; only host timing may differ.
    const guestObservations = samples.map(s => Object.fromEntries(Object.keys(s).sort()
        .filter(key => !['wallSeconds', 'rtx'].includes(key)).map(key => [key, s[key]])));
    return {samples, guestSha256: hashes[0][1], guestObservations,
        allWindowsMeet1x, medianRtx: median(samples.map(s => s.rtx)),
        minimumRtx: Math.min(...samples.map(s => s.rtx))};
};
