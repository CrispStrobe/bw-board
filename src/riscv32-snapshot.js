/**
 * Whole-machine snapshots of a {@link RiscV32Machine}: save the complete state
 * at one instruction boundary and put it back later, so a host can open a
 * machine where an earlier run left it — the Linux lesson opens at the shell
 * prompt instead of replaying a 68-million-instruction boot.
 *
 * WHAT IS SAVED. Everything the next instruction can observe: the hart
 * (x0-x31, pc, privilege, the CSR file, counters and their 64-bit offsets,
 * LR/SC reservation, WFI/halt, the software TLB — see RiscV32.saveState for why
 * the TLB is saved, not flushed), the machine's firmware state (SBI timer
 * forwarding, getchar queue, idle-skip total, exit code), CLINT, PLIC and
 * UART registers including the UART's receive FIFO, and RAM. A restored
 * machine is instruction-for-instruction the machine that was saved: saving
 * it again gives the same bytes, and running it gives the same output
 * (test/linux-riscv/snapshot.mjs proves both against a cold boot).
 *
 * RAM AS A DELTA. RAM is stored per 4 KiB page as one of three kinds: all
 * zero, identical to a BASE image, or literal. The base is whatever the
 * restoring machine already holds in RAM when restore is called — for Linux,
 * the RAM right after bootLinux() placed the kernel, initramfs and device tree
 * (riscv32-linux-session.js). Pages the boot never touched (most of the kernel
 * text) then cost one byte. A snapshot made without a base has no "same"
 * pages and restores into any machine of the same shape.
 *
 * FORMAT (uncompressed; hosts gzip it for transport — gzipBytes/gunzipBytes):
 *
 *   0   8 bytes  magic "BWRV32S1" (the 1 is the format version)
 *   8   u32 LE   header length H
 *   12  H bytes  header, UTF-8 JSON: {format, pageSize, pages, literal,
 *                base, state, console, meta}
 *   12+H         page map: one byte per RAM page — 0 zero, 1 same as base,
 *                2 literal
 *   ...          the literal pages, 4096 bytes each, in page order
 *
 * The encoding is deterministic (no timestamps, fixed key order), so the same
 * machine state always gives the same bytes — a pinned sha256 of a snapshot
 * is reproducible from the pinned media and this code.
 *
 * Browser-safe: no Node imports (CompressionStream for gzip).
 *
 * @module
 */

export const SNAPSHOT_MAGIC = 'BWRV32S1';
export const SNAPSHOT_PAGE = 4096;
const PAGE_ZERO = 0, PAGE_SAME = 1, PAGE_LITERAL = 2;

const refuse = (code, msg) => { const e = new Error(msg); e.code = code; throw e; };

function isZeroPage(m32, w) {
    for (let i = 0; i < SNAPSHOT_PAGE / 4; i++) if (m32[w + i] !== 0) return false;
    return true;
}

function samePage(a32, b32, w) {
    for (let i = 0; i < SNAPSHOT_PAGE / 4; i++) if (a32[w + i] !== b32[w + i]) return false;
    return true;
}

const view32 = u8 => (u8.byteOffset & 3) === 0 && (u8.length & 3) === 0
    ? new Int32Array(u8.buffer, u8.byteOffset, u8.length >>> 2)
    : new Int32Array(u8.slice().buffer);

/**
 * Save `machine` (a RiscV32Machine) as snapshot bytes (uncompressed).
 * @param {object} machine
 * @param {{base?: Uint8Array, baseInfo?: object, console?: string, meta?: object}} [opts]
 *   `base`: the RAM image a restoring machine will already hold (same length
 *   as machine.mem) — pages equal to it are stored as "same". `baseInfo`
 *   describes that base for the restorer to check (e.g. the media hashes);
 *   it is required when `base` is given. `console`: text a host shows as the
 *   machine's past output. `meta`: free-form provenance (JSON).
 * @returns {Uint8Array}
 */
export function saveRiscvSnapshot(machine, opts = {}) {
    const mem = machine.mem;
    if (mem.length % SNAPSHOT_PAGE) refuse('snapshot-bad-ram', `RAM size ${mem.length} is not a whole number of 4 KiB pages`);
    const {base} = opts;
    if (base && base.length !== mem.length) refuse('snapshot-bad-base', `base image is ${base.length} bytes, RAM is ${mem.length}`);
    if (base && !opts.baseInfo) refuse('snapshot-bad-base', 'a base image needs baseInfo, so a restore can check it has the same base');
    const state = machine.saveState();
    const pages = mem.length / SNAPSHOT_PAGE;
    const map = new Uint8Array(pages);
    const m32 = view32(mem), b32 = base ? view32(base) : null;
    let literal = 0;
    for (let p = 0; p < pages; p++) {
        const w = p * (SNAPSHOT_PAGE / 4);
        if (b32 && samePage(m32, b32, w)) map[p] = PAGE_SAME;
        else if (isZeroPage(m32, w)) map[p] = PAGE_ZERO;
        else { map[p] = PAGE_LITERAL; literal++; }
    }
    const header = {
        format: 1, pageSize: SNAPSHOT_PAGE, pages, literal,
        base: base ? opts.baseInfo : null,
        state,
        console: opts.console ?? '',
        meta: opts.meta ?? null
    };
    const hb = new TextEncoder().encode(JSON.stringify(header));
    const out = new Uint8Array(12 + hb.length + pages + literal * SNAPSHOT_PAGE);
    for (let i = 0; i < 8; i++) out[i] = SNAPSHOT_MAGIC.charCodeAt(i);
    new DataView(out.buffer).setUint32(8, hb.length, true);
    out.set(hb, 12);
    out.set(map, 12 + hb.length);
    let o = 12 + hb.length + pages;
    for (let p = 0; p < pages; p++) {
        if (map[p] !== PAGE_LITERAL) continue;
        out.set(mem.subarray(p * SNAPSHOT_PAGE, (p + 1) * SNAPSHOT_PAGE), o);
        o += SNAPSHOT_PAGE;
    }
    return out;
}

/** Parse the header (and locate the page map) without touching a machine.
 *  Refuses a wrong magic, a truncated file or a map/literal-count mismatch. */
export function readRiscvSnapshot(bytes) {
    if (!(bytes instanceof Uint8Array)) refuse('snapshot-bad-bytes', 'a snapshot must be a Uint8Array');
    if (bytes.length < 12) refuse('snapshot-truncated', 'snapshot is shorter than its fixed header');
    const magic = String.fromCharCode(...bytes.subarray(0, 8));
    if (magic !== SNAPSHOT_MAGIC) {
        refuse('snapshot-bad-magic', `not a RiscV32 snapshot (magic ${JSON.stringify(magic)}, want ${SNAPSHOT_MAGIC}` +
            `${bytes[0] === 0x1f && bytes[1] === 0x8b ? '; it is gzip — gunzipBytes() it first' : ''})`);
    }
    const hl = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(8, true);
    if (12 + hl > bytes.length) refuse('snapshot-truncated', 'snapshot header runs past the end of the file');
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + hl)));
    if (header.format !== 1 || header.pageSize !== SNAPSHOT_PAGE) refuse('snapshot-bad-format', `unsupported snapshot format ${header.format}/${header.pageSize}`);
    const mapAt = 12 + hl;
    const map = bytes.subarray(mapAt, mapAt + header.pages);
    let literal = 0;
    for (let p = 0; p < map.length; p++) if (map[p] === PAGE_LITERAL) literal++; else if (map[p] > PAGE_LITERAL) refuse('snapshot-bad-format', `page ${p} has kind ${map[p]}`);
    if (map.length !== header.pages || literal !== header.literal ||
        bytes.length !== mapAt + header.pages + literal * SNAPSHOT_PAGE) {
        refuse('snapshot-truncated', `snapshot size ${bytes.length} does not match its page map (${header.pages} pages, ${literal} literal)`);
    }
    return {header, map, dataAt: mapAt + header.pages};
}

/**
 * Restore snapshot bytes into `machine`, IN PLACE: pages the snapshot marks
 * "same" keep what the machine's RAM holds now, so when the snapshot has a
 * base the caller must have put exactly that base there first (and says so
 * with `baseInfo`, compared field by field with the snapshot's). Returns the
 * header ({state, console, meta, …}).
 * @param {object} machine a RiscV32Machine built with the saving machine's config
 * @param {Uint8Array} bytes uncompressed snapshot
 * @param {{baseInfo?: object}} [opts]
 */
export function restoreRiscvSnapshot(machine, bytes, opts = {}) {
    const {header, map, dataAt} = readRiscvSnapshot(bytes);
    if (header.pages * SNAPSHOT_PAGE !== machine.mem.length) {
        refuse('snapshot-config-mismatch', `snapshot RAM is ${header.pages * SNAPSHOT_PAGE} bytes, this machine has ${machine.mem.length}`);
    }
    if (header.base) {
        const have = opts.baseInfo;
        if (!have) refuse('snapshot-needs-base', `this snapshot stores RAM as a delta against ${JSON.stringify(header.base)}; restore needs that base in RAM and its baseInfo`);
        for (const k of Object.keys(header.base)) {
            if (header.base[k] !== have[k]) {
                refuse('snapshot-base-mismatch', `snapshot base ${k} is ${JSON.stringify(header.base[k])}, the machine's is ${JSON.stringify(have[k])}`);
            }
        }
    }
    // State first: a config mismatch refuses before any RAM is written.
    machine.loadState(header.state);
    const mem = machine.mem;
    let o = dataAt;
    for (let p = 0; p < map.length; p++) {
        const at = p * SNAPSHOT_PAGE;
        if (map[p] === PAGE_ZERO) mem.fill(0, at, at + SNAPSHOT_PAGE);
        else if (map[p] === PAGE_LITERAL) { mem.set(bytes.subarray(o, o + SNAPSHOT_PAGE), at); o += SNAPSHOT_PAGE; }
    }
    machine.output = header.console || '';
    return header;
}

async function pipeThrough(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
}

/** gzip, via CompressionStream (browsers; Node >= 18). */
export async function gzipBytes(bytes) {
    if (typeof CompressionStream === 'undefined') throw new Error('CompressionStream is unavailable');
    return pipeThrough(bytes, new CompressionStream('gzip'));
}

/** gunzip, via DecompressionStream (browsers; Node >= 18). Bytes that are not
 *  gzip (no 1f 8b magic) are returned as they are, so a caller may pass either. */
export async function gunzipBytes(bytes) {
    if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes;
    if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream is unavailable');
    return pipeThrough(bytes, new DecompressionStream('gzip'));
}

export default saveRiscvSnapshot;
