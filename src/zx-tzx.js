/**
 * TZX — the archive's full-featured tape container format (v1.20).
 *
 * TZX wraps the same logical tape blocks as TAP (flag + data +
 * checksum) but adds timing metadata, turbo speed blocks, direct
 * recording, and hardware info blocks. The format is publicly
 * documented at https://worldofspectrum.net/TZXformat.html.
 *
 * This implementation ADOPTS the standard-speed data path (block
 * type $10) and converts it to the same block array ZXTape consumes.
 * Turbo speed ($11), direct recording ($15), and other block types
 * that require EAR-level playback are REFUSED honestly — a stated
 * limitation until the bit-level EAR engine exists.
 *
 * Block types handled:
 *   $10 — Standard Speed Data: pause + 2-byte len + data (TAP block)
 *   $20 — Pause / Stop the Tape: consumed, noted
 *   $21 — Group Start: consumed (description only)
 *   $22 — Group End: consumed
 *   $30 — Text Description: consumed
 *   $31 — Message Block: consumed
 *   $32 — Archive Info: consumed
 *   $33 — Hardware Type: consumed
 *   $35 — Custom Info Block: consumed
 *
 * Block types refused (require EAR-level playback):
 *   $11 — Turbo Speed Data
 *   $12 — Pure Tone
 *   $13 — Pulse Sequence
 *   $14 — Pure Data
 *   $15 — Direct Recording
 *   $18 — CSW Recording
 *   $19 — Generalized Data
 *
 * @module
 */

const TZX_SIGNATURE = [0x5a, 0x58, 0x54, 0x61, 0x70, 0x65, 0x21]; // "ZXTape!"

/**
 * Parse a .TZX buffer into { blocks, notes }.
 * blocks: same shape as parseTap — [{flag, data}...]
 * notes: informational strings (descriptions, refused block types)
 *
 * @param {Uint8Array} buf
 * @returns {{ blocks: Array<{flag: number, data: Uint8Array}>, notes: string[] }}
 */
export function parseTzx(buf) {
    const blocks = [];
    const notes = [];

    // Validate header: "ZXTape!" + 0x1A + major + minor
    if (buf.length < 10) throw new Error('not a TZX file: too short');
    for (let i = 0; i < 7; i++) {
        if (buf[i] !== TZX_SIGNATURE[i]) throw new Error('not a TZX file: bad signature');
    }
    if (buf[7] !== 0x1a) throw new Error('not a TZX file: missing 0x1A');
    const major = buf[8], minor = buf[9];
    notes.push(`TZX v${major}.${minor}`);

    const r16 = (o) => buf[o] | (buf[o + 1] << 8);
    const r24 = (o) => buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
    const r32 = (o) => buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24);

    let i = 10;
    while (i < buf.length) {
        const id = buf[i++];
        switch (id) {
            case 0x10: { // Standard Speed Data Block
                if (i + 4 > buf.length) { i = buf.length; break; }
                // const pause = r16(i); // pause in ms after block (not used by trap loader)
                const len = r16(i + 2);
                i += 4;
                if (i + len > buf.length) { i = buf.length; break; }
                const blockData = buf.subarray(i, i + len);
                i += len;
                // Same as a TAP block: first byte is flag, last is checksum
                if (len >= 2) {
                    blocks.push({
                        flag: blockData[0],
                        data: blockData.subarray(1, len - 1), // strip flag and checksum
                    });
                }
                break;
            }

            // ── Turbo/direct blocks: refused honestly ──────────────
            case 0x11: { // Turbo Speed Data
                if (i + 18 > buf.length) { i = buf.length; break; }
                const len = r24(i + 15);
                i += 18 + len;
                notes.push('turbo speed data block ($11) — requires EAR-level playback, skipped');
                break;
            }
            case 0x12: { // Pure Tone
                i += 4;
                notes.push('pure tone block ($12) skipped');
                break;
            }
            case 0x13: { // Pulse Sequence
                const n = buf[i]; i += 1 + n * 2;
                notes.push('pulse sequence block ($13) skipped');
                break;
            }
            case 0x14: { // Pure Data
                if (i + 10 > buf.length) { i = buf.length; break; }
                const len = r24(i + 7);
                i += 10 + len;
                notes.push('pure data block ($14) skipped');
                break;
            }
            case 0x15: { // Direct Recording
                if (i + 8 > buf.length) { i = buf.length; break; }
                const len = r24(i + 5);
                i += 8 + len;
                notes.push('direct recording block ($15) skipped');
                break;
            }
            case 0x18: { // CSW Recording
                if (i + 4 > buf.length) { i = buf.length; break; }
                const len = r32(i);
                i += 4 + len;
                notes.push('CSW recording block ($18) skipped');
                break;
            }
            case 0x19: { // Generalized Data
                if (i + 4 > buf.length) { i = buf.length; break; }
                const len = r32(i);
                i += 4 + len;
                notes.push('generalized data block ($19) skipped');
                break;
            }

            // ── Metadata blocks: consumed ──────────────────────────
            case 0x20: { // Pause / Stop the Tape
                // const pause = r16(i);
                i += 2;
                break;
            }
            case 0x21: { // Group Start
                const nLen = buf[i]; i += 1;
                const name = String.fromCharCode(...buf.subarray(i, i + nLen));
                i += nLen;
                notes.push(`group: ${name}`);
                break;
            }
            case 0x22: break; // Group End: no data
            case 0x23: i += 2; break; // Jump to Block
            case 0x24: i += 2; break; // Loop Start
            case 0x25: break; // Loop End
            case 0x26: { // Call Sequence
                const n = r16(i); i += 2 + n * 2;
                break;
            }
            case 0x27: break; // Return from Sequence
            case 0x28: { // Select Block
                const len = r16(i); i += 2 + len;
                break;
            }
            case 0x2a: i += 4; break; // Stop if 48K
            case 0x2b: i += 4; break; // Set Signal Level

            case 0x30: { // Text Description
                const nLen = buf[i]; i += 1;
                const text = String.fromCharCode(...buf.subarray(i, i + nLen));
                i += nLen;
                notes.push(`text: ${text}`);
                break;
            }
            case 0x31: { // Message Block
                i += 1; // time
                const nLen = buf[i]; i += 1;
                i += nLen;
                break;
            }
            case 0x32: { // Archive Info
                const len = r16(i); i += 2 + len;
                break;
            }
            case 0x33: { // Hardware Type
                const n = buf[i]; i += 1 + n * 3;
                break;
            }
            case 0x35: { // Custom Info
                i += 16; // ID string
                const len = r32(i); i += 4 + len;
                break;
            }
            case 0x5a: { // "Glue" block (concat marker)
                i += 9;
                break;
            }

            default:
                // Unknown block: try to skip using the "extension rule"
                // (next 4 bytes = length). This is a guess for unknown IDs.
                notes.push(`unknown TZX block $${id.toString(16).padStart(2, '0')} — skipped`);
                if (i + 4 <= buf.length) {
                    const len = r32(i); i += 4 + len;
                } else {
                    i = buf.length;
                }
                break;
        }
    }

    return { blocks, notes };
}

/**
 * Create a ZXTape-compatible object from TZX data.
 * @param {Uint8Array} tzxBuf
 * @returns {import('./zx-tape.js').ZXTape}
 */
export function tzxToTape(tzxBuf) {
    const { blocks, notes } = parseTzx(tzxBuf);
    // Return a duck-type-compatible ZXTape
    return {
        blocks,
        notes,
        pos: 0,
        rewind() { this.pos = 0; },
        trap(cpu, mem, write) {
            if (this.pos >= this.blocks.length) {
                cpu.f &= ~0x01;
                return true;
            }
            const wantFlag = cpu.a;
            const load = (cpu.f & 0x01) !== 0;
            const block = this.blocks[this.pos++];
            if (block.flag !== wantFlag) {
                cpu.f &= ~0x01;
                return true;
            }
            const dest = cpu.ix & 0xffff;
            const len = (cpu.d << 8) | cpu.e;
            const n = Math.min(len, block.data.length);
            if (load) {
                const w = write ?? ((a, v) => { mem[a] = v; });
                for (let i = 0; i < n; i++) w((dest + i) & 0xffff, block.data[i]);
            }
            cpu.ix = (dest + n) & 0xffff;
            cpu.d = 0; cpu.e = 0;
            cpu.f |= 0x01;
            return true;
        },
    };
}

// ─── EAR-level pulse generation ───────────────────────────────────
// Standard tape timing (from the Spectrum ROM loader and TZX spec):
const STD_PILOT_PULSE = 2168;      // T-states per pilot half-pulse
const STD_PILOT_HEADER = 8063;     // pilot pulses for a header block
const STD_PILOT_DATA = 3223;       // pilot pulses for a data block
const STD_SYNC1 = 667;             // first sync pulse
const STD_SYNC2 = 735;             // second sync pulse
const STD_ZERO = 855;              // zero-bit half-pulse
const STD_ONE = 1710;              // one-bit half-pulse
const STD_PAUSE = 3_500_000;       // 1 second pause in T-states at 3.5 MHz

/**
 * Generate EAR edge list for a standard-speed data block ($10).
 * Uses the classic ROM loader timing.
 *
 * @param {Uint8Array} data - raw block bytes (flag + payload + checksum)
 * @param {number} startTs - starting T-state
 * @param {number} [pauseMs] - pause after block in ms
 * @returns {{ edges: Array<{tStates: number, level: 0|1}>, endTs: number }}
 */
export function standardBlockEdges(data, startTs, pauseMs = 1000) {
    const edges = [];
    let t = startTs;
    let level = 0;
    const toggle = (len) => { edges.push({ tStates: t, level }); t += len; level ^= 1; };

    // Pilot tone: header blocks get more pulses than data blocks
    const isHeader = data.length > 0 && data[0] === 0x00;
    const pilotCount = isHeader ? STD_PILOT_HEADER : STD_PILOT_DATA;
    for (let p = 0; p < pilotCount; p++) toggle(STD_PILOT_PULSE);

    // Sync pulses
    toggle(STD_SYNC1);
    toggle(STD_SYNC2);

    // Data bits: MSB first, each bit is two half-pulses
    for (let byteIdx = 0; byteIdx < data.length; byteIdx++) {
        const byte = data[byteIdx];
        for (let bit = 7; bit >= 0; bit--) {
            const pulse = (byte >> bit) & 1 ? STD_ONE : STD_ZERO;
            toggle(pulse);
            toggle(pulse);
        }
    }

    // Pause
    if (pauseMs > 0) {
        edges.push({ tStates: t, level: 1 }); // EAR high during pause
        t += Math.round(pauseMs * 3500); // T-states at 3.5 MHz
    }

    return { edges, endTs: t };
}

/**
 * Generate EAR edge list for a turbo-speed data block ($11).
 * Uses the block's own timing parameters.
 *
 * @param {object} spec - timing from the TZX $11 header
 * @param {Uint8Array} data - raw block data
 * @param {number} startTs
 * @returns {{ edges: Array<{tStates: number, level: 0|1}>, endTs: number }}
 */
export function turboBlockEdges(spec, data, startTs) {
    const edges = [];
    let t = startTs;
    let level = 0;
    const toggle = (len) => { edges.push({ tStates: t, level }); t += len; level ^= 1; };

    // Pilot
    for (let p = 0; p < spec.pilotCount; p++) toggle(spec.pilotPulse);

    // Sync
    toggle(spec.sync1);
    toggle(spec.sync2);

    // Data bits
    const totalBits = (data.length - 1) * 8 + spec.lastByteBits;
    for (let i = 0; i < totalBits; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = 7 - (i % 8);
        const pulse = (data[byteIdx] >> bitIdx) & 1 ? spec.onePulse : spec.zeroPulse;
        toggle(pulse);
        toggle(pulse);
    }

    // Pause
    if (spec.pauseMs > 0) {
        edges.push({ tStates: t, level: 1 });
        t += Math.round(spec.pauseMs * 3500);
    }

    return { edges, endTs: t };
}

/**
 * Parse a TZX $11 (turbo speed) block header into a timing spec.
 * @param {Uint8Array} buf - buffer starting at the first byte after the block ID
 * @returns {{ spec: object, data: Uint8Array, consumed: number }}
 */
export function parseTurboHeader(buf) {
    const r16 = (o) => buf[o] | (buf[o + 1] << 8);
    const r24 = (o) => buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
    const spec = {
        pilotPulse: r16(0),
        sync1: r16(2),
        sync2: r16(4),
        zeroPulse: r16(6),
        onePulse: r16(8),
        pilotCount: r16(10),
        lastByteBits: buf[12] || 8,
        pauseMs: r16(13),
    };
    const dataLen = r24(15);
    const data = buf.subarray(18, 18 + dataLen);
    return { spec, data, consumed: 18 + dataLen };
}

/**
 * Convert an entire TZX into EAR edges for bit-level playback.
 * Standard blocks get ROM-standard timing; turbo blocks get their
 * own timing. Blocks that cannot be converted (direct recording,
 * CSW, generalized) are skipped with notes.
 *
 * @param {Uint8Array} buf - raw TZX file
 * @returns {{ edges: Array<{tStates: number, level: 0|1}>, notes: string[] }}
 */
export function tzxToEarEdges(buf) {
    if (buf.length < 10) throw new Error('not a TZX file');
    for (let i = 0; i < 7; i++) if (buf[i] !== TZX_SIGNATURE[i]) throw new Error('bad TZX signature');

    const edges = [];
    const notes = [];
    const r16 = (o) => buf[o] | (buf[o + 1] << 8);
    const r24 = (o) => buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
    const r32 = (o) => buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24);
    let t = 0; // current T-state position
    let i = 10;

    while (i < buf.length) {
        const id = buf[i++];
        switch (id) {
            case 0x10: { // Standard Speed Data
                if (i + 4 > buf.length) { i = buf.length; break; }
                const pauseMs = r16(i);
                const len = r16(i + 2);
                i += 4;
                if (i + len > buf.length) { i = buf.length; break; }
                const data = buf.subarray(i, i + len);
                i += len;
                const result = standardBlockEdges(data, t, pauseMs);
                edges.push(...result.edges);
                t = result.endTs;
                break;
            }
            case 0x11: { // Turbo Speed Data
                if (i + 18 > buf.length) { i = buf.length; break; }
                const { spec, data, consumed } = parseTurboHeader(buf.subarray(i));
                i += consumed;
                const result = turboBlockEdges(spec, data, t);
                edges.push(...result.edges);
                t = result.endTs;
                notes.push(`turbo block: ${data.length} bytes, pilot=${spec.pilotPulse}T`);
                break;
            }
            case 0x12: { // Pure Tone
                const pulseLen = r16(i); const count = r16(i + 2); i += 4;
                let level = 0;
                for (let p = 0; p < count; p++) {
                    edges.push({ tStates: t, level }); t += pulseLen; level ^= 1;
                }
                break;
            }
            case 0x13: { // Pulse Sequence
                const n = buf[i++];
                let level = 0;
                for (let p = 0; p < n; p++) {
                    const len = r16(i); i += 2;
                    edges.push({ tStates: t, level }); t += len; level ^= 1;
                }
                break;
            }
            case 0x14: { // Pure Data
                if (i + 10 > buf.length) { i = buf.length; break; }
                const zeroPulse = r16(i), onePulse = r16(i + 2);
                const lastBits = buf[i + 4] || 8;
                const pauseMs = r16(i + 5);
                const dataLen = r24(i + 7);
                i += 10;
                const data = buf.subarray(i, i + dataLen);
                i += dataLen;
                let level = 0;
                const toggle = (len) => { edges.push({ tStates: t, level }); t += len; level ^= 1; };
                const totalBits = (dataLen - 1) * 8 + lastBits;
                for (let b = 0; b < totalBits; b++) {
                    const byteIdx = Math.floor(b / 8);
                    const bitIdx = 7 - (b % 8);
                    const pulse = (data[byteIdx] >> bitIdx) & 1 ? onePulse : zeroPulse;
                    toggle(pulse); toggle(pulse);
                }
                if (pauseMs > 0) { edges.push({ tStates: t, level: 1 }); t += Math.round(pauseMs * 3500); }
                break;
            }
            case 0x15: { // Direct Recording — still refused
                if (i + 8 > buf.length) { i = buf.length; break; }
                const len = r24(i + 5); i += 8 + len;
                notes.push('direct recording ($15) skipped — needs sample-level EAR');
                break;
            }
            case 0x18: { const len = r32(i); i += 4 + len; notes.push('CSW ($18) skipped'); break; }
            case 0x19: { const len = r32(i); i += 4 + len; notes.push('generalized ($19) skipped'); break; }
            case 0x20: { // Pause
                const pauseMs = r16(i); i += 2;
                if (pauseMs > 0) { edges.push({ tStates: t, level: 1 }); t += Math.round(pauseMs * 3500); }
                break;
            }
            case 0x21: { const n = buf[i]; i += 1 + n; break; }
            case 0x22: break;
            case 0x23: i += 2; break;
            case 0x24: i += 2; break;
            case 0x25: break;
            case 0x26: { const n = r16(i); i += 2 + n * 2; break; }
            case 0x27: break;
            case 0x28: { const len = r16(i); i += 2 + len; break; }
            case 0x2a: i += 4; break;
            case 0x2b: i += 4; break;
            case 0x30: { const n = buf[i]; i += 1 + n; break; }
            case 0x31: { i += 1; const n = buf[i]; i += 1 + n; break; }
            case 0x32: { const len = r16(i); i += 2 + len; break; }
            case 0x33: { const n = buf[i]; i += 1 + n * 3; break; }
            case 0x35: { i += 16; const len = r32(i); i += 4 + len; break; }
            case 0x5a: i += 9; break;
            default:
                if (i + 4 <= buf.length) { const len = r32(i); i += 4 + len; }
                else i = buf.length;
                break;
        }
    }

    return { edges, notes };
}

export default { parseTzx, tzxToTape, tzxToEarEdges, standardBlockEdges, turboBlockEdges, parseTurboHeader };
