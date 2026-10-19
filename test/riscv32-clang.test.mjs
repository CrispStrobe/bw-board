// Real compiler cross-check: these are the `.text` sections of C functions
// compiled by **clang 18** (`--target=riscv32 -march=rv32im -O2 -ffreestanding
// -fno-pic -mno-relax`), extracted from the ELF object and committed as base64
// fixtures — so the test needs no RISC-V toolchain, yet proves the core runs a
// real compiler's instruction selection, not just the hand-encoded programs the
// other suites use (which could share an encoding bug with the decoder).
//
// Each function is self-contained (no external calls or data → no relocations,
// confirmed at extraction). We load its .text at 0x100, put arguments in a0.. ,
// set ra (x1) = 0 as a return sentinel, run until pc returns to 0, and read a0.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32} from '../src/riscv32.js';

// int sumto(int n){int s=0;for(int i=1;i<=n;i++)s+=i;return s;}
const SUMTO = 'Y1igApMVFQATBvX/EwXl/7MGpgIzNaYCExX1AZPWFgAz5aYAM4WlABMF9f9ngAAAEwUAAGeAAAA=';
// unsigned gcd(unsigned a,unsigned b){while(b){unsigned t=b;b=a%b;a=t;}return a;}
const GCD = 'Y4wFABOGBQCzdbUCEwUGAOOaBf4TBQYAZ4AAAA==';
// int poly(int x){return ((x*x)*3 - (x<<2) + 7)^(x>>1);}  — mul, shifts, xor
const POLY = 'kxUVALOFpQCThcX/s4WlApOFdQATVRVAM8WlAGeAAAA=';

/** Load a function's .text at 0x100, call it with `args` in a0.., return a0. */
function callClangFn(b64, args) {
    const text = new Uint8Array(Buffer.from(b64, 'base64'));
    const mem = new Uint8Array(0x10000);
    mem.set(text, 0x100);
    const cpu = new RiscV32(mem, {resetPc: 0x100});
    args.forEach((v, i) => { cpu.x[10 + i] = v | 0; });
    cpu.x[1] = 0;                                  // ra = 0: a `ret` lands on pc 0
    let n = 0;
    while (!cpu.halted && (cpu.pc >>> 0) !== 0 && n++ < 5_000_000) cpu.step();
    assert.ok(!cpu.halted, 'the compiled function returned rather than trapping');
    return cpu.x[10] | 0;
}

test('clang: a summation loop (sumto)', () => {
    assert.equal(callClangFn(SUMTO, [100]), 5050);
    assert.equal(callClangFn(SUMTO, [1]), 1);
    assert.equal(callClangFn(SUMTO, [0]), 0);
});

test('clang: Euclid gcd (unsigned remainder loop — exercises REMU)', () => {
    assert.equal(callClangFn(GCD, [48, 36]) >>> 0, 12);
    assert.equal(callClangFn(GCD, [1071, 462]) >>> 0, 21);
    assert.equal(callClangFn(GCD, [17, 5]) >>> 0, 1);
});

test('clang: a polynomial (MUL + shifts + XOR agree with the compiler)', () => {
    // ((x*x)*3 - (x<<2) + 7) ^ (x>>1)
    const poly = x => (((x * x) * 3 - (x << 2) + 7) ^ (x >> 1)) | 0;
    for (const x of [5, 10, -3, 0, 123]) {
        assert.equal(callClangFn(POLY, [x]), poly(x), `poly(${x})`);
    }
});
