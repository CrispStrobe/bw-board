/**
 * EVERY CODE BYTE REACHES THE BUS EXACTLY ONCE.
 *
 * This file exists because that property broke and nothing noticed. The
 * prefix loop in step() used to PEEK at the next byte with this.read() to
 * decide whether it was a prefix, and when it was not, fall out of the loop
 * into `const op = this._fetch8()` -- which read the very same address a
 * second time:
 *
 *     26 2E 90  (ES: CS: NOP)  ->  reads 65536, 65537, 65538, 65538
 *
 * One extra bus access on every prefixed instruction. Over RAM that is
 * invisible, which is why it survived; over a memory-mapped window with read
 * side effects it triggers the device twice, and a core that cannot be
 * trusted to fetch an opcode once cannot be trusted to drive a device at all.
 *
 * WHAT MAKES THIS WORTH A FILE OF ITS OWN is how it was missed. The peek was
 * introduced by the commit that REMOVED an older double-read, and that commit
 * verified the fix by inspecting `busTrace` -- where the peek is genuinely
 * silent, because a bare this.read() pushes no trace entry. The trace was
 * clean and the bus was not. The regression then crossed a repository pin
 * before a downstream performance test caught it, and the bisect that found
 * it (lego-be) counted read() CALLBACK INVOCATIONS, not trace entries.
 *
 * So these tests deliberately do not look at busTrace. They count what the
 * bus actually sees, because that is the thing the trace is a model OF, and
 * the failure mode here was believing the model over the thing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { I8086 } from '../src/i8086.js';

/** Run one instruction at 0x1000:0000 and return every address read(). */
function readsFor(bytes, init = {}) {
    const reads = [];
    const cpu = new I8086({
        read: a => { reads.push(a); return bytes[a - 0x10000] ?? 0; },
        write: () => {}, in: () => 0xff, out: () => {},
    });
    cpu.cs = 0x1000; cpu.ip = 0;
    Object.assign(cpu, init);
    cpu.step();
    return reads;
}

/** The code bytes an instruction fetched, in order, ignoring data accesses. */
const codeReads = reads => reads.filter(a => a >= 0x10000 && a < 0x10000 + 16);

test('a prefixed instruction fetches each code byte exactly once', () => {
    for (const [name, bytes] of [
        ['ES: CS: NOP',        [0x26, 0x2e, 0x90]],
        ['CS: NOP',            [0x2e, 0x90]],
        ['SS: NOP',            [0x36, 0x90]],
        ['DS: NOP',            [0x3e, 0x90]],
        ['LOCK NOP',           [0xf0, 0x90]],
        ['REP NOP',            [0xf3, 0x90]],
        ['ES: ES: ES: NOP',    [0x26, 0x26, 0x26, 0x90]],
    ]) {
        const code = codeReads(readsFor(bytes));
        const seen = new Set(code);
        assert.equal(code.length, seen.size,
            `${name}: fetched a code byte twice -- ${JSON.stringify(code)}`);
        assert.deepEqual(code, bytes.map((_, i) => 0x10000 + i),
            `${name}: fetched ${JSON.stringify(code)}`);
    }
});

test('an UNprefixed instruction is unaffected', () => {
    assert.deepEqual(codeReads(readsFor([0x90])), [0x10000]);
    assert.deepEqual(codeReads(readsFor([0xb8, 0x34, 0x12])), [0x10000, 0x10001, 0x10002]);
});

test('a prefix does not double-trigger a read side effect', () => {
    // The reason the extra access matters. A device in the code window that
    // counts reads must see one read per byte, not two for the opcode.
    const hits = new Map();
    const bytes = [0x26, 0x2e, 0x90];
    const cpu = new I8086({
        read: a => { hits.set(a, (hits.get(a) ?? 0) + 1); return bytes[a - 0x10000] ?? 0; },
        write: () => {}, in: () => 0xff, out: () => {},
    });
    cpu.cs = 0x1000; cpu.ip = 0;
    cpu.step();
    for (const [addr, n] of hits)
        assert.equal(n, 1, `address ${addr} was read ${n} times, not once`);
});

test('the prefix still takes effect after being consumed once', () => {
    // Reading the byte once must not mean acting on it zero times: ES: MOV
    // AL,[BX] has to come from ES, not DS. Guards against a fix that removes
    // the duplicate read by removing the prefix handling with it.
    const bytes = [0x26, 0x8a, 0x07];
    const reads = readsFor(bytes, { bx: 0x0200, es: 0x2000, ds: 0x3000 });
    assert.ok(reads.includes(0x20200), `data read came from ${reads.at(-1).toString(16)}, not ES:BX`);
    assert.ok(!reads.includes(0x30200), 'segment override was ignored -- read came from DS');
});
