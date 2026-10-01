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
    return {samples, allWindowsMeet1x, medianRtx: median(samples.map(s => s.rtx)),
        minimumRtx: Math.min(...samples.map(s => s.rtx))};
};
