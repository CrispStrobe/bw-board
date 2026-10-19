/**
 * MOO reader -- the compact form of the SingleStepTests suites, and the
 * reason the 8086 grind can run on every push instead of on one developer's
 * box.
 *
 * WHY THIS EXISTS. `grind-i8086.mjs` reports 646,000/646,000 and
 * `grind-i8086-disasm.mjs` reports the same on TEXT, and until now neither
 * number ran in CI: the suite is an out-of-tree clone, the sampled grind in
 * `test/i8086.test.mjs` skips when it is absent, and a skip reads the same as
 * a pass in a summary line. That is the failure `.github/workflows/ci.yml`
 * already carries a paragraph about, in the emu8051-stc checkout.
 *
 * The suite ships two encodings of the SAME data: `v1/` as gzipped JSON and
 * `v1_binary/` as gzipped MOO. On this machine that is 174 MB against 94 MB,
 * and the binary form parses without materialising 646,000 objects through
 * `JSON.parse`. Cheap enough to check out and run per push.
 *
 * THE FORMAT IS NOT OURS AND NOTHING IS VENDORED. MOO (Machine Opcode
 * Operation) is documented at github.com/dbalsom/moo (MIT) with reference
 * parsers in Rust, C++ and Python; this is an independent reader written from
 * that specification, in the house style, with no third-party code. Chunked,
 * little-endian throughout: a `MOO ` header, then a `TEST` chunk per vector,
 * each holding NAME / BYTS / INIT / FINA / CYCL subchunks.
 *
 * TWO PLACES THE PUBLISHED TABLES ARE EASY TO MISREAD, both found by parsing
 * a real file rather than by trusting the document:
 *
 *   - NAME and BYTS carry an INNER length as well as the chunk length. The
 *     spec's tables do list it, but it reads like the chunk header repeated,
 *     and skipping it yields a name with four bytes of binary in front of it.
 *   - `RAM ` is space-padded to four characters, like `MOO ` itself. A
 *     comparison against `'RAM'` silently never matches, and the memory
 *     assertions then pass by having nothing to check -- a gate that cannot
 *     fail rather than one that is wrong.
 *
 * The tests come back in EXACTLY the shape the JSON produces -- same field
 * names, same `[addr, value]` ram pairs, same "final.regs holds only what
 * changed" convention -- so both grinders consume either source with no
 * branch in their comparison logic. `test/moo.test.mjs` pins that by
 * requiring the two encodings of one opcode file to agree, field for field,
 * across all 2,000 of its vectors.
 *
 * WHAT V1.0 DOES NOT CARRY: a per-test INDEX, or a HASH subchunk. The JSON has `test_hash` and the
 * disassembler grinder keyed its three exclusions on it, so this reader
 * returns `test_hash: null` and the grinder had to gain a key that exists in
 * both encodings. See the exclusion table there; the key is now the bytes
 * themselves, which is what the exclusion is ABOUT.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Register order of the REGS bitmask, LSB first, per the MOO specification. */
const REG_ORDER = ['ax', 'bx', 'cx', 'dx', 'cs', 'ss', 'ds', 'es',
    'sp', 'bp', 'si', 'di', 'ip', 'flags'];

/** Four-character chunk id at `o`. Ids are space-padded (`MOO `, `RAM `). */
const id4 = (b, o) => b.toString('ascii', o, o + 4);

/**
 * Walk the subchunks of `[start, end)`, calling `fn(type, dataOffset, length)`.
 * Advancing by the DECLARED length rather than by what we understood is what
 * makes an unknown chunk skippable instead of fatal -- the format's own
 * forward-compatibility rule, and the reason EA32 or a future chunk does not
 * break this reader.
 */
function walk(b, start, end, fn) {
    let o = start;
    while (o + 8 <= end) {
        const type = id4(b, o);
        const len = b.readUInt32LE(o + 4);
        fn(type, o + 8, len);
        o += 8 + len;
    }
}

/** REGS -> a plain object of only the registers the bitmask claims. */
function readRegs(b, o) {
    const mask = b.readUInt16LE(o);
    const regs = {};
    let p = o + 2;
    for (let i = 0; i < REG_ORDER.length; i++) {
        if (mask & (1 << i)) { regs[REG_ORDER[i]] = b.readUInt16LE(p); p += 2; }
    }
    return regs;
}

/** RAM -> the JSON's `[[addr, value], ...]`, in file order. */
function readRam(b, o) {
    const n = b.readUInt32LE(o);
    const ram = new Array(n);
    for (let i = 0; i < n; i++) {
        const e = o + 4 + i * 5;
        ram[i] = [b.readUInt32LE(e), b[e + 4]];
    }
    return ram;
}

/** INIT or FINA -> `{regs, ram, queue}`, the JSON's state object. */
function readState(b, start, end) {
    const state = { regs: {}, ram: [], queue: [] };
    walk(b, start, end, (type, o, len) => {
        if (type === 'REGS') state.regs = readRegs(b, o);
        else if (type === 'RAM ') state.ram = readRam(b, o);
        else if (type === 'QUEU') state.queue = [...b.subarray(o + 4, o + 4 + b.readUInt32LE(o))];
        // RMSK, RM32, RG32, EA32 and anything later are skipped by length.
    });
    return state;
}

/**
 * Parse one decompressed MOO buffer.
 * @returns {{cpu: string, version: string, tests: Array<object>}}
 */
export function parseMoo(b) {
    if (id4(b, 0) !== 'MOO ') throw new Error(`not a MOO file: magic ${JSON.stringify(id4(b, 0))}`);
    const headerLen = b.readUInt32LE(4);
    const version = `${b[8]}.${b[9]}`;
    const declared = b.readUInt32LE(12);
    const cpu = id4(b, 16).trim();

    const tests = [];
    walk(b, 8 + headerLen, b.length, (type, o, len) => {
        if (type !== 'TEST') return;               // META, RMSK, RM32 at file level
        const t = { name: '', bytes: [], initial: null, final: null, cycles: [], test_hash: null };
        // THE INDEX IS POSITIONAL IN v1.0, and that is a measured fact rather
        // than an assumption: the TEST chunk has a leading field for it and an
        // IDX subchunk is specified, and in this suite the field is zero in
        // every one of the 2,000 vectors of every file and no IDX is emitted.
        // Reading it and believing it would have numbered all 646,000 vectors
        // `#0` -- which matters, because the disassembler grinder's exclusion
        // table names its three rows by number. So: use whichever the file
        // actually carries, and fall back to ORDER, which is what the JSON's
        // own zero-based `test_num` counts. The cross-format test in
        // test/moo.test.mjs is what proves the two orders are the same one.
        const declaredIdx = b.readUInt32LE(o);
        walk(b, o + 4, o + len, (st, so, slen) => {
            // NAME and BYTS carry an inner length before their payload.
            if (st === 'NAME') t.name = b.toString('ascii', so + 4, so + 4 + b.readUInt32LE(so));
            else if (st === 'BYTS') t.bytes = [...b.subarray(so + 4, so + 4 + b.readUInt32LE(so))];
            else if (st === 'INIT') t.initial = readState(b, so, so + slen);
            else if (st === 'FINA') t.final = readState(b, so, so + slen);
            else if (st === 'HASH') t.test_hash = b.toString('hex', so, so + slen);
            else if (st === 'IDX ') t.test_num = b.readUInt32LE(so);
            // CYCL is bus-cycle detail: prefetch-queue-inclusive traces that
            // mean nothing to an instruction-stepped core, so it is read past
            // rather than decoded. See i8086.js on why cycles are not compared.
        });
        if (t.test_num === undefined) t.test_num = declaredIdx || tests.length;
        tests.push(t);
    });

    if (declared !== tests.length) {
        throw new Error(`MOO header declares ${declared} tests, ${tests.length} found`);
    }
    return { cpu, version, tests };
}

/** Read and decompress a `.MOO` or `.MOO.gz`. */
export function readMooFile(path) {
    const raw = readFileSync(path);
    // gzip magic, rather than trusting the extension.
    return parseMoo(raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw);
}
