/** Strict parsing; parser fixtures are not measured engine evidence. */
import {median} from './motion-ab-receipt.mjs';

export function f0GpioTimingResult (stdout, exitCode) {
    const parseLines = prefix => stdout.split('\n').filter(line => line.startsWith(prefix))
        .map(line => JSON.parse(line.slice(prefix.length)));
    const samples = parseLines('F0_WASM_SAMPLE '), guests = parseLines('F0_WASM_GUEST ');
    if (samples.length !== 5 || guests.length !== 1 ||
        !/^# tests 2$/m.test(stdout) || !/^# skipped 0$/m.test(stdout) ||
        !/^ok 1 - F0 gpio: active guest and RAM\/MMIO observations$/m.test(stdout)) {
        throw Error('Incomplete active F0 proof');
    }
    const workloads = {};
    for (const [position, workload] of ['gpio'].entries()) {
        const guest = guests[position];
        if (guest.workload !== workload || ['elfSha256', 'imageSha256'].some(key =>
            !/^[a-f0-9]{64}$/.test(guest[key]))) throw Error('Invalid F0 guest provenance');
        const windows = samples.slice(position * 5, position * 5 + 5);
        let previous = 0;
        for (const [index, s] of windows.entries()) {
            if (s.workload !== workload || s.index !== index ||
                s.cycles !== 48_000_000 || s.cpuHz !== 48_000_000 ||
                !Number.isFinite(s.wallSeconds) || s.wallSeconds <= 0 ||
                !Number.isFinite(s.rtx) || s.rtx <= 0 || Math.abs(s.rtx * s.wallSeconds - 1) > 1e-10 ||
                ['iterations', 'checksum', 'input', 'mirror'].some(key =>
                    !Number.isInteger(s[key]) || s[key] < 0 || s[key] > 0xffffffff) ||
                s.iterations <= previous ||
                ![s.iterations, s.iterations - 1].includes((s.checksum ^ 255) >>> 0) ||
                ![s.iterations, s.iterations - 1].includes(s.mirror) ||
                s.input !== (workload === 'gpio' && index % 2 ? 2 : 0) ||
                s.output !== (workload === 'gpio' ? index % 2 : null)) {
                throw Error('Inconsistent F0 window or guest observations');
            }
            previous = s.iterations;
        }
        const allWindowsMeet1x = windows.every(s => s.rtx >= 1), ordinal = position * 2 + 2;
        if (!new RegExp(`^${allWindowsMeet1x ? 'ok' : 'not ok'} ${ordinal} - F0 ${workload}: all five 48M-cycle windows meet 1x$`, 'm').test(stdout)) {
            throw Error('Unexpected F0 timing test verdict');
        }
        workloads[workload] = {guest, samples: windows, allWindowsMeet1x,
            medianRtx: median(windows.map(s => s.rtx)), minimumRtx: Math.min(...windows.map(s => s.rtx)),
            guestObservations: windows.map(s => Object.fromEntries(Object.keys(s).sort()
                .filter(key => !['wallSeconds', 'rtx'].includes(key)).map(key => [key, s[key]])))};
    }
    const failures = Object.values(workloads).filter(w => !w.allWindowsMeet1x).length;
    if (exitCode !== (failures ? 1 : 0) ||
        !new RegExp(`^# fail ${failures}$`, 'm').test(stdout) ||
        !new RegExp(`^# pass ${2 - failures}$`, 'm').test(stdout) ||
        !/^# cancelled 0$/m.test(stdout) || !/^# todo 0$/m.test(stdout)) {
        throw Error('Unexpected F0 failure counts or exit');
    }
    return {workloads, allWindowsMeet1x: failures === 0};
}

export function assertSameGpioGuest (baseline, candidate) {
    for (const workload of ['gpio']) {
        const a = baseline?.workloads?.[workload], b = candidate?.workloads?.[workload];
        if (!a || !b || !/^[a-f0-9]{64}$/.test(a.guest.imageSha256) ||
            a.guest.imageSha256 !== b.guest.imageSha256 || a.guestObservations.length !== 5 ||
            JSON.stringify(a.guestObservations) !== JSON.stringify(b.guestObservations)) {
            throw Error('Different loaded F0 image or cycle-indexed observations');
        }
    }
}
