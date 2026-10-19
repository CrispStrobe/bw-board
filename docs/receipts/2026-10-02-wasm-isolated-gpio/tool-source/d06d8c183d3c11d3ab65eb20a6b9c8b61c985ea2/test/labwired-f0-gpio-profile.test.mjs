/** Selected active F0 workloads, not silicon CPI or browser qualification. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, mkdtempSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {buildLabwiredSystem} from '../src/labwired-bridge.js';
import {createLabwiredAdapter, plain} from '../src/labwired-adapter.js';

const nodeDir = process.env.LABWIRED_WASM;
let toolchain = true;
for (const tool of ['arm-none-eabi-gcc', 'arm-none-eabi-objcopy']) {
    try { execFileSync(tool, ['--version'], {stdio: 'pipe'}); } catch { toolchain = false; }
}
const skip = !nodeDir ? 'F0 timing requires a verified LABWIRED_WASM artifact'
    : !toolchain ? 'F0 timing requires arm-none-eabi-gcc and objcopy' : false;
if (skip && process.env.LABWIRED_F0_REQUIRED === '1') throw Error(skip);
const requireRtx = process.env.LABWIRED_REQUIRE_F0_RTX === '1';
const wasm = skip ? null : createRequire(import.meta.url)(join(nodeDir, 'labwired_wasm.js'));
const fixture = fileURLToPath(new URL('./fixtures/labwired/f0-timing/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clockHz = 48_000_000;

function compile (workload) {
    const directory = mkdtempSync(join(tmpdir(), 'bw-f0-timing-'));
    const output = join(directory, 'active.elf'), image = join(directory, 'active.bin');
    const flags = workload === 'gpio' ? ['-DBW_F0_GPIO'] : [];
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0', '-mthumb', '-nostdlib',
        '-Wl,--build-id=none,-T,active.ld', ...flags, 'active.S', '-o', output],
    {cwd: fixture, stdio: 'pipe'});
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', output, image], {stdio: 'pipe'});
    const firmware = new Uint8Array(readFileSync(output));
    return {firmware, elfSha256: hash(firmware), imageSha256: hash(readFileSync(image))};
}
function makeAdapter (guest) {
    const built = buildLabwiredSystem({chipKind: 'stm32f030',
        netlist: {parts: [{id: 'f0', kind: 'stm32f030'}], nets: []}});
    assert.equal(built.ok, true);
    assert.deepEqual(built.refusals, []);
    assert.equal(built.clockHz, clockHz);
    return createLabwiredAdapter({wasm, chipYaml: built.chipYaml, systemYaml: built.systemYaml,
        firmware: guest.firmware, firmwareOnly: true, clockHz});
}
function runCycles (adapter, cycles) {
    let remaining = cycles;
    while (remaining > 0) {
        const budget = Math.min(remaining, 48_000);
        const ran = adapter.sim.step_batch(budget);
        assert.ok(Number.isInteger(ran) && ran > 0 && ran <= budget, 'bounded actual progress required');
        remaining -= ran;
    }
}
function observe (adapter, workload, high) {
    const bytes = adapter.sim.read_memory(0x20000000, 16);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const iterations = view.getUint32(0, true), checksum = view.getUint32(4, true);
    const input = view.getUint32(8, true), mirror = view.getUint32(12, true);
    assert.ok(iterations > 0, 'active guest must complete iterations');
    // A bounded stop can occur between the three receipt stores, but never
    // more than one iteration apart. Do not silently run extra uncounted cycles.
    for (const previous of [(checksum ^ 255) >>> 0, mirror]) {
        assert.ok(previous === iterations || previous === iterations - 1, 'RAM receipt consistency');
    }
    let output = null;
    if (workload === 'gpio') {
        assert.equal(input, high ? 2 : 0, 'guest reads the actual held PA1 input');
        const snapshot = plain(adapter.sim.get_peripheral_snapshot('gpioPortA'));
        assert.ok(Number.isInteger(snapshot.odr), 'actual GPIO snapshot required');
        output = snapshot.odr & 1;
        assert.equal(output, high ? 1 : 0, 'guest drives PA0 via BSRR');
    } else assert.equal(input, 0);
    return {iterations, checksum, input, mirror, output};
}

for (const workload of ['gpio']) {
    const guest = skip ? null : compile(workload);
    test(`F0 ${workload}: active guest and RAM/MMIO observations`, {skip}, () => {
        const adapter = makeAdapter(guest);
        try {
            let previous = 0;
            for (const high of [false, true, false]) {
                if (workload === 'gpio') adapter.sim.set_board_io_input('PA1', high);
                runCycles(adapter, 2_000_000);
                const sample = observe(adapter, workload, high);
                assert.ok(sample.iterations > previous);
                previous = sample.iterations;
            }
        } finally { adapter.sim.free(); }
    });
    test(`F0 ${workload}: all five 48M-cycle windows meet 1x`, {
        skip: skip || (!requireRtx ? 'enable LABWIRED_REQUIRE_F0_RTX for qualification' : false)
    }, () => {
        const adapter = makeAdapter(guest);
        try {
            if (workload === 'gpio') adapter.sim.set_board_io_input('PA1', false);
            runCycles(adapter, 6_000_000);
            console.log('F0_WASM_GUEST ' + JSON.stringify({workload,
                elfSha256: guest.elfSha256, imageSha256: guest.imageSha256}));
            const measured = [];
            let previous = 0;
            for (let index = 0; index < 5; index++) {
                const high = index % 2 === 1;
                if (workload === 'gpio') adapter.sim.set_board_io_input('PA1', high);
                const start = performance.now();
                runCycles(adapter, clockHz);
                const wallSeconds = (performance.now() - start) / 1000;
                const sample = observe(adapter, workload, high);
                assert.ok(sample.iterations > previous);
                previous = sample.iterations;
                const rtx = 1 / wallSeconds;
                console.log('F0_WASM_SAMPLE ' + JSON.stringify({workload, index,
                    cycles: clockHz, cpuHz: clockHz, wallSeconds, rtx, ...sample}));
                measured.push(rtx);
            }
            assert.ok(measured.every(rtx => Number.isFinite(rtx) && rtx >= 1),
                `every window must meet 1x: ${JSON.stringify(measured)}`);
        } finally { adapter.sim.free(); }
    });
}
