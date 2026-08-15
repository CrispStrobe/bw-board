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

export default { parseTzx, tzxToTape };
