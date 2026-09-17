// A GUEST PROGRAM FINDS THE ROM THE DOCUMENTED WAY AND CALLS IT.
//
// WHY THIS EXISTS, and it is a gap rather than a duplicate. Every case in
// test/rp2040-bootrom.test.mjs reaches an operator by reading the tables in
// JAVASCRIPT and setting PC straight at the entry — `run(fx2f, {0: m, 1: k})`.
// That grades the arithmetic and nothing else. The sequence a real consumer
// performs is four steps the guest does itself:
//
//   1. read the u16 at 0x16          -> the data table
//   2. read the u16 at 0x18          -> rom_table_lookup, Thumb bit set
//   3. blx it with ('S' | 'F'<<8)    -> the 'SF' table
//   4. load an entry and blx THAT    -> the operator
//
// Measured before this file was written: `loadProgram`/`bootFromFlash` appear
// ZERO times in rp2040-bootrom.test.mjs. No test had ever executed that
// sequence from inside the emulated core. Kaluma does perform it, but only
// from a REPL line, and a REPL line is not evidence that a loaded program can.
//
// The distinction is not pedantic. A wrong Thumb bit, a table pointer that is
// only usable from the host, or a register convention that differs from the
// one the JS harness happens to use would all be INVISIBLE to a test that sets
// PC by hand, and fatal to a consumer. The harness masks exactly the failures
// this file is for.
//
// SECOND GAP CLOSED HERE: the six fixed-point conversions are graded bit-exact
// against Math.fround and, until now, no runtime that ever booted on this ROM
// had called one — Kaluma routes JS numbers through doubles and never asks.
// "Graded" and "exercised" are different claims, and they part company exactly
// where an ABI detail is wrong.
//
// The oracle is the one the graded tests already use, `Math.fround(m / 2**k)`
// compared as float32 bits, deliberately rather than a second expression of
// the same rule: two oracles that drift disagree about the code and not about
// the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import buildBootrom from '../src/rp2040-bootrom.js';
import { createRp2040jsAdapter, RAM_START } from '../src/rp2040js-adapter.js';

const F32 = (x) => { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, x); return new DataView(b).getUint32(0); };
const SUBNORMAL = (x) => x !== 0 && Math.abs(x) < 1.1754943508222875e-38;

/** Where the guest reads its arguments and writes its answer. */
const ARGS = 0x20001000;      // +0 arg0, +4 arg1, +8 result, +12 SF index

/**
 * The guest, in Thumb-1. It takes the SF entry INDEX from memory rather than
 * having one baked in, so a single program exercises every conversion and the
 * lookup is performed afresh each run.
 */
const GUEST = [
    0xb5f0,             // push {r4-r7, lr}
    0x2316,             // movs r3, #0x16
    0x8818,             // ldrh r0, [r3, #0]     ; the DATA table, per the header
    0x2318,             // movs r3, #0x18
    0x881a,             // ldrh r2, [r3, #0]     ; rom_table_lookup, Thumb bit set
    0x2146,             // movs r1, #0x46        ; 'F'
    0x0209,             // lsls r1, r1, #8
    0x3153,             // adds r1, #0x53        ; 'S'  -> 0x4653, little-endian "SF"
    0x4790,             // blx  r2               ; r0 = the 'SF' table
    0x0004,             // movs r4, r0
    0x2620,             // movs r6, #0x20
    0x0636,             // lsls r6, r6, #24      ; 0x20000000
    0x2701,             // movs r7, #1
    0x033f,             // lsls r7, r7, #12      ; 0x00001000
    0x433e,             // orrs r6, r7           ; r6 = ARGS
    0x68f3,             // ldr  r3, [r6, #12]    ; which SF entry
    0x009b,             // lsls r3, r3, #2
    0x191b,             // adds r3, r3, r4
    0x681d,             // ldr  r5, [r3, #0]     ; the operator's address
    0x6830,             // ldr  r0, [r6, #0]
    0x6871,             // ldr  r1, [r6, #4]
    0x47a8,             // blx  r5               ; call it
    0x60b0,             // str  r0, [r6, #8]     ; publish the answer
    0xbdf0              // pop  {r4-r7, pc}
];
/** Index of `adds r1, #0x53` — the half of the 'SF' code the mutation flips. */
const SF_CODE_AT = 7;

const RETURN = 0x20040000;

async function guestRunner (program = GUEST) {
    const adapter = createRp2040jsAdapter();
    const { rp2040, core } = adapter;
    adapter.loadProgram(program);
    return {
        rp2040,
        core,
        /** @returns {number|null} the u32 the guest published, or null if it never returned */
        call (index, arg0, arg1, limit = 20000) {
            rp2040.writeUint32(ARGS + 0, arg0 >>> 0);
            rp2040.writeUint32(ARGS + 4, arg1 >>> 0);
            rp2040.writeUint32(ARGS + 8, 0xdeadbeef);   // so a missing write is visible
            rp2040.writeUint32(ARGS + 12, index >>> 0);
            core.PC = RAM_START;
            core.SP = RAM_START + rp2040.sram.length;
            core.registers[14] = RETURN | 1;
            for (let i = 0; i < limit; i++) {
                if ((core.PC >>> 0) === RETURN) return rp2040.readUint32(ARGS + 8) >>> 0;
                core.executeInstruction();
            }
            return null;
        }
    };
}

test('a guest program performs the documented lookup and reaches the conversions', async () => {
    const g = await guestRunner();
    // fix2float is index 12. The guest is told only the index; it must find
    // the table itself.
    for (const [m, k] of [[1, 0], [1, 8], [-1, 8], [65536, 16], [123456, 10], [-65536, 16]]) {
        const want = Math.fround(m / Math.pow(2, k));
        if (SUBNORMAL(want)) continue;
        const got = g.call(12, m >>> 0, k);
        assert.notEqual(got, null, `the guest never returned for fix2float(${m}, ${k})`);
        assert.equal(got, F32(want), `guest fix2float(${m}, ${k})`);
    }
});

test('every fixed-point conversion has a runtime caller, not just a grade', async () => {
    const g = await guestRunner();
    let seed = 0x13579bdf;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };

    // index 12 fix2float, 14 ufix2float — signed and unsigned, scaled.
    for (let i = 0; i < 60; i++) {
        const m = next() | 0, k = next() % 32;
        const want = Math.fround(m / Math.pow(2, k));
        if (SUBNORMAL(want)) continue;
        assert.equal(g.call(12, m >>> 0, k), F32(want), `guest fix2float(${m}, ${k})`);
    }
    for (let i = 0; i < 60; i++) {
        const m = next() >>> 0, k = next() % 32;
        const want = Math.fround(m / Math.pow(2, k));
        if (SUBNORMAL(want)) continue;
        assert.equal(g.call(14, m, k), F32(want), `guest ufix2float(${m}, ${k})`);
    }
    // index 11 int2float, 13 uint2float — the unscaled pair, k ignored.
    for (let i = 0; i < 40; i++) {
        const m = next() | 0;
        assert.equal(g.call(11, m >>> 0, 0), F32(Math.fround(m)), `guest int2float(${m})`);
    }
    for (let i = 0; i < 40; i++) {
        const m = next() >>> 0;
        assert.equal(g.call(13, m, 0), F32(Math.fround(m)), `guest uint2float(${m})`);
    }
    // index 8 float2fix, 10 float2ufix — back the other way, truncating.
    for (const [v, k, want] of [[1.5, 1, 3], [2.5, 1, 5], [-2.5, 1, -5], [0.25, 2, 1], [-0.25, 2, -1]]) {
        assert.equal(g.call(8, F32(v), k) | 0, want, `guest float2fix(${v}, ${k})`);
    }
    for (const [v, k, want] of [[1.5, 1, 3], [2.5, 1, 5], [0.25, 2, 1], [7, 0, 7]]) {
        assert.equal(g.call(10, F32(v), k) >>> 0, want >>> 0, `guest float2ufix(${v}, ${k})`);
    }
});

test('MUTATION: the guest really uses the lookup — a wrong code breaks it', async () => {
    // Without this the test above proves nothing about the ABI: a guest that
    // ignored the lookup and jumped at a baked-in address would pass it
    // identically. Ask for "XF" instead of "SF" and the lookup MISSES, which
    // this ROM answers with 0, so the guest blx-es a null pointer.
    //
    // WHAT IT ACTUALLY DOES, measured rather than left as "it fails somehow":
    // the guest still RETURNS and still writes, 220 steps against the clean
    // run's 134, and publishes 0. A null blx does not fault here — it lands in
    // the ROM's zeros, slides, and leaves r0 at 0 — which is the same null-slide
    // signature that made ROADMAP R3 present as `2.5+1.0 == 0`.
    //
    // The assertion stays "not the right answer" rather than "exactly 0",
    // because 0 is a property of where the slide happens to end and would make
    // this brittle against ROM layout changes. But a pass whose reason has not
    // been looked at is a pass for an unknown reason, so the reason is here.
    const mutated = GUEST.slice();
    mutated[SF_CODE_AT] = 0x3158;        // adds r1, #0x58 -> 'X', so the code is "XF"
    const g = await guestRunner(mutated);
    const want = F32(Math.fround(123456 / 1024));
    const got = g.call(12, 123456, 10);
    assert.notEqual(got, want,
        'the guest produced the right answer while asking for a code this ROM does not have — '
        + 'it is not using the looked-up pointer, so the unmutated test proves nothing about the ABI');

    // And the same program, unmutated, must still be right — otherwise the
    // mutation proved only that the harness is broken.
    const clean = await guestRunner();
    assert.equal(clean.call(12, 123456, 10), want, 'the unmutated guest must still be correct');
});
