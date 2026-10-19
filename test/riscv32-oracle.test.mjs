// Oracle gate: our RV32 core in lockstep with Spike (riscv-isa-sim), instruction
// by instruction, over the riscv-tests ISA suites (rv32ui/uc/um/ua/si/mi, p and
// v environments), riscv-arch-test 3.10.0 (RV32IMAC + Zifencei + privilege)
// and our own M/S/U, Sv32 and atomics programs.
//
// The Spike traces are committed (test/fixtures/riscv-oracle/*.json.br, built
// by test/riscv-oracle/build-fixtures.mjs from pinned sources — see
// PROVENANCE.md there), so this needs neither Spike nor a RISC-V toolchain.
// Per instruction it compares pc, privilege, instruction bits, every GPR Spike
// wrote (and that we wrote no other), every CSR Spike logged, each store, and
// every trap's cause/epc/tval — and stops at the first difference.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {brotliDecompressSync} from 'node:zlib';
import {unpackTraceRows} from './riscv-oracle/spike-trace.mjs';
import {lockstep} from './riscv-oracle/lockstep.mjs';
import {runRiscvTest} from './riscv-oracle/riscv-tests-runner.mjs';

const load = name => JSON.parse(brotliDecompressSync(
    readFileSync(new URL(`./fixtures/riscv-oracle/${name}.json.br`, import.meta.url))).toString());

// Where our core and Spike legitimately differ: both behaviours are allowed by
// the spec, and we chose the other. Each must reproduce EXACTLY — the same
// Spike record, the same difference — so a new divergence in the same program
// cannot hide behind an old one.
const KNOWN = new Map([
    ['rv32mi-p-breakpoint', {record: 96, has: 'x11 = 0x00000000 after 0x800001e0',
        why: 'debug triggers (Sdtrig) are optional; we implement none, so tdata1 reads 0 where Spike has an mcontrol trigger'}],
    ['rv32mi-p-ma_fetch', {record: 115, has: 'csr 0x301 = 0x40141105',
        why: 'misa is read-only here (WARL allows it); Spike lets software clear misa.C, which this test then exercises'}],
]);

const SUITES = [
    ['riscv-tests', 144],
    ['arch-test', 101],
    ['programs', 3],
];

for (const [suite, expected] of SUITES) {
    test(`oracle: ${suite} — every program agrees with Spike in lockstep`, () => {
        const fx = load(suite);
        const names = Object.keys(fx.tests);
        assert.equal(names.length, expected, `${suite} fixture holds ${expected} programs`);
        const failures = [];
        let compared = 0;
        for (const name of names) {
            const t = fx.tests[name];
            const recs = unpackTraceRows(t.trace);
            assert.ok(recs.length > 50, `${name}: a real trace (${recs.length} records)`);
            const r = lockstep(t, recs);
            compared += r.compared;
            const known = KNOWN.get(name);
            if (known) {
                assert.equal(r.ok, false, `${name} is recorded as a known divergence but now agrees — drop it from KNOWN`);
                if (!r.diff.includes(`Spike record ${known.record} `) || !r.diff.includes(known.has))
                    failures.push(`${name}: the known divergence (${known.why}) moved or changed:\n${r.diff}`);
                continue;
            }
            if (!r.ok) failures.push(`${name}:\n${r.diff}`);
        }
        assert.deepEqual(failures, [], failures.join('\n\n'));
        assert.ok(compared > 1000 * expected / 10, `compared ${compared} instructions`);
    });
}

test('oracle: every KNOWN divergence names a program in the fixtures', () => {
    const all = new Set(SUITES.flatMap(([s]) => Object.keys(load(s).tests)));
    for (const name of KNOWN.keys()) assert.ok(all.has(name), `${name} exists`);
});

test('oracle: the riscv-tests pass on our core by their own verdict (tohost = 1)', () => {
    const fx = load('riscv-tests');
    const bad = [];
    for (const [name, t] of Object.entries(fx.tests)) {
        const r = runRiscvTest(t, {maxSteps: 5_000_000});
        if (r.result !== 'pass') bad.push(`${name}: ${r.result} ${r.code ?? ''}`);
    }
    assert.deepEqual(bad, []);
});
