/** Conservative local-work admission, not a performance/fidelity verdict. */
export const GIB = 1024 ** 3;
export const POLICIES = Object.freeze({
    build: Object.freeze({memoryBytes: 4 * GIB, diskBytes: 20 * GIB}),
    benchmark: Object.freeze({memoryBytes: 2 * GIB, diskBytes: 4 * GIB})
});

export function memoryAvailable (procMeminfo) {
    const match = procMeminfo.match(/^MemAvailable:\s+(\d+)\s+kB\s*$/m);
    if (!match) throw Error('MemAvailable unavailable; do not substitute total RAM or cache-blind free RAM');
    const bytes = Number(match[1]) * 1024;
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error('Invalid MemAvailable');
    return bytes;
}

export function decideResources (sample, kind) {
    if (!Object.hasOwn(POLICIES, kind)) throw Error('Unknown work kind');
    const policy = POLICIES[kind];
    const reasons = [];
    if (!Number.isSafeInteger(sample.cpus) || sample.cpus < 1 ||
        !Array.isArray(sample.load) || sample.load.length !== 3 ||
        sample.load.some(value => !Number.isFinite(value) || value < 0) ||
        !Number.isSafeInteger(sample.memoryAvailableBytes) || sample.memoryAvailableBytes < 0 ||
        !Array.isArray(sample.disks) || sample.disks.length === 0 ||
        sample.disks.some(disk => typeof disk.path !== 'string' || !disk.path ||
            !Number.isSafeInteger(disk.availableBytes) || disk.availableBytes < 0)) {
        return {allowed: false, kind, reasons: ['incomplete or invalid resource sample'], policy};
    }
    for (const [index, ratio] of [0.75, 0.75, 1].entries()) {
        if (sample.load[index] > sample.cpus * ratio) reasons.push(
            `${[1, 5, 15][index]}-minute load ${sample.load[index]} exceeds ${sample.cpus * ratio}`);
    }
    if (sample.memoryAvailableBytes < policy.memoryBytes) reasons.push('insufficient available memory');
    for (const disk of sample.disks) if (disk.availableBytes < policy.diskBytes) {
        reasons.push(`insufficient available disk: ${disk.path}`);
    }
    return {allowed: reasons.length === 0, kind, reasons, policy};
}
