/**
 * `readMem` must not trust the length it hands the C side.
 *
 * `emu_dbg_read_mem` answers out of a FIXED 256-byte scratch buffer and does
 * not clamp the length it was asked for. Ask for more and it returns a pointer
 * to 256 good bytes followed by unrelated heap: no error, no short count, and
 * nothing for a caller to test. `readMem` used to wrap the whole requested
 * length around that pointer, so `readMem('code', 0, 0x10000)` — the read the
 * hex view and the disassembler both issue — came back as a few hundred bytes
 * of program and 65 KB of zeroes, which looks exactly like a blank chip.
 *
 * Driven against a FAKE wasm rather than the real binary, deliberately. The
 * vendored emulator lives in the consumer, not here, and the property under
 * test is not "the emulator works" — it is "this adapter respects the C side's
 * buffer limit". The fake encodes that limit exactly: it fills at most 256
 * bytes per call and leaves the rest of the scratch region holding stale
 * garbage, which is what the real one does. A fake that zero-filled instead
 * would let the broken version pass, because zeroes are what the bug produced.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmu8051DebugTarget } from '../src/emu8051-debug.js';

/** The C scratch buffer. Reads must cross this to prove anything. */
const SCRATCH = 256;
const SCRATCH_PTR = 4096;

/** Memory contents with no run of equal bytes, so stale data cannot look right. */
const pattern = (n) => Uint8Array.from({ length: n }, (_, i) => ((i * 7) + 3) & 0xFF);

function fakeWasm(memory) {
    const heap = new Uint8Array(65536);
    // Poison the scratch region: whatever a short fill leaves behind must be
    // recognisably wrong, exactly as unrelated heap would be.
    heap.fill(0xAB, SCRATCH_PTR, SCRATCH_PTR + 4096);
    let lastLen = 0;
    return {
        HEAPU8: heap,
        /** Fills at most SCRATCH bytes, and never says it did less. */
        _emu_dbg_read_mem(space, addr, len) {
            lastLen = len;
            const n = Math.min(len, SCRATCH);
            for (let i = 0; i < n; i++) heap[SCRATCH_PTR + i] = memory[(addr + i) & 0xFFFF] ?? 0;
            return SCRATCH_PTR;
        },
        _emu_dbg_read(space, addr) { return memory[addr & 0xFFFF] ?? 0; },
        // The factory refuses a build with no debug surface — correctly, since a
        // pre-boundary-D emulator would fail later and less clearly. These are
        // the exports it checks for; none is exercised by a readMem test.
        _emu_dbg_state() { return 0; },
        _emu_dbg_run() {},
        _emu_dbg_halt() {},
        _emu_dbg_step() {},
        _emu_dbg_reset() {},
        _emu_dbg_run_until_ns() { return 0; },
        _emu_dbg_write_mem() {},
        _emu_dbg_pc() { return 0; },
        get lastLen() { return lastLen; },
    };
}

describe('readMem across the C scratch buffer', () => {
    it('returns the program, not heap, for a read longer than the buffer', () => {
        const memory = pattern(0x800);
        const t = createEmu8051DebugTarget(fakeWasm(memory));
        for (const len of [SCRATCH + 1, 512, 1024, 0x800]) {
            const got = t.readMem('code', 0, len);
            assert.equal(got.length, len, `readMem must return the length asked for (${len})`);
            const bad = Array.from(got).findIndex((b, i) => b !== memory[i]);
            assert.equal(bad, -1,
                `readMem('code', 0, ${len}) diverged at byte ${bad}; a divergence at ` +
                `exactly ${SCRATCH} means the bulk read stopped being chunked`);
        }
    });

    it('never asks the C side for more than it can answer', () => {
        const wasm = fakeWasm(pattern(0x400));
        const t = createEmu8051DebugTarget(wasm);
        t.readMem('code', 0, 0x400);
        assert.ok(wasm.lastLen <= SCRATCH,
            `asked for ${wasm.lastLen} bytes in one call; the buffer holds ${SCRATCH}`);
    });

    it('advances the ADDRESS as well as the output offset', () => {
        const memory = pattern(0x800);
        const t = createEmu8051DebugTarget(fakeWasm(memory));
        const got = t.readMem('code', 0x300, 0x200);
        assert.deepEqual(Array.from(got), Array.from(memory.slice(0x300, 0x500)),
            'a chunking loop that forgot the address returns the first chunk repeatedly');
    });
});
