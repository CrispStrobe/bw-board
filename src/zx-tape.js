/**
 * ZX Spectrum tape: TAP container + the LD-BYTES fast-load trap.
 *
 * A .TAP file is the simplest of the tape containers: a sequence of
 * [len:word][flag:byte][data...][checksum:byte] blocks, where len
 * counts flag+data+checksum. Header blocks (flag $00, 17 data bytes)
 * describe the next data block (flag $FF).
 *
 * Loading is done the way every serious emulator does it: a ROM TRAP.
 * The 48K ROM's LD-BYTES routine lives at $0556 and its contract is
 * registers, documented exhaustively: IX = destination, DE = length,
 * A' = expected flag byte, carry set = LOAD (reset = VERIFY). When PC
 * hits $0556 with a tape attached, the machine copies the next
 * matching block directly into memory, sets carry for success, and
 * returns — skipping the pilot-tone minutes a bit-level EAR stream
 * would cost. Bit-level EAR playback (for turbo/custom loaders) is a
 * stated later step, not pretended here.
 */

/** Parse a .TAP buffer into blocks: [{flag, data(Uint8Array)}...] */
export function parseTap(buf) {
    const blocks = [];
    let i = 0;
    while (i + 2 <= buf.length) {
        const len = buf[i] | (buf[i + 1] << 8);
        i += 2;
        if (len < 2 || i + len > buf.length) break;
        blocks.push({ flag: buf[i], data: buf.subarray(i + 1, i + len - 1) });
        i += len;
    }
    return blocks;
}

export class ZXTape {
    /** @param {Uint8Array} tapBuf raw .TAP contents */
    constructor(tapBuf) {
        this.blocks = parseTap(tapBuf);
        this.pos = 0;
    }

    rewind() { this.pos = 0; }

    /**
     * The LD-BYTES trap body. Call when PC = $0556.
     * @param {import('./z80.js').Z80} cpu
     * @param {Uint8Array} mem
     * @param {(a: number, v: number) => void} [write] bus write — a 128K
     *   machine passes its banked writeBus so a load into the $C000
     *   window lands in the mapped PAGE, not the flat array.
     * @returns {boolean} true when handled (caller RETs the CPU)
     */
    trap(cpu, mem, write) {
        if (this.pos >= this.blocks.length) {
            // No tape left: report failure the way BREAK does — carry
            // reset — so the ROM prints its error instead of hanging.
            cpu.f &= ~0x01;
            return true;
        }
        // At the $0556 ENTRY the flag byte and load/verify carry are in
        // CURRENT AF — the routine's own EX AF,AF' sits two bytes in
        // ($0558), so shadow AF still holds caller junk here. Measured
        // the hard way: the shadow read made every load a VERIFY.
        const wantFlag = cpu.a;
        const load = (cpu.f & 0x01) !== 0;
        const block = this.blocks[this.pos++];
        if (block.flag !== wantFlag) {
            cpu.f &= ~0x01; // flag mismatch: error, block consumed (real tape moves on)
            return true;
        }
        const dest = cpu.ix & 0xffff;
        const len = (cpu.d << 8) | cpu.e;
        const n = Math.min(len, block.data.length);
        if (load) {
            const w = write ?? ((a, v) => { mem[a] = v; });
            for (let i = 0; i < n; i++) w((dest + i) & 0xffff, block.data[i]);
        }
        // Register state a successful LD-BYTES leaves behind, per the
        // ROM listing: IX past the end, DE zero, carry set.
        cpu.ix = (dest + n) & 0xffff;
        cpu.d = 0; cpu.e = 0;
        cpu.f |= 0x01;
        return true;
    }
}

export default ZXTape;
