/**
 * .SNA — the oldest and simplest ZX Spectrum snapshot format (48K
 * variant), as documented across the emulation world for decades:
 * a 27-byte register header followed by the 48K RAM dump
 * ($4000-$FFFF). PC is not in the header; the saver pushes it onto
 * the stack and the loader pops it (the real-hardware trick was an
 * NMI button and RETN).
 *
 * Header layout (offsets):
 *   0 I | 1-2 HL' | 3-4 DE' | 5-6 BC' | 7-8 AF' | 9-10 HL | 11-12 DE
 *   13-14 BC | 15-16 IY | 17-18 IX | 19 IFF2 (bit 2) | 20 R
 *   21-22 AF | 23-24 SP | 25 IM | 26 border
 * All 16-bit values little-endian (low byte first: F before A).
 *
 * This gives our Spectrum the whole archive of real-world software
 * as loadable content, and lets any machine state travel to and from
 * other emulators. 128K .SNA and the .Z80 format are later steps.
 */

export const SNA_SIZE = 27 + 49152;

/** Serialize a running 48K machine to .SNA bytes. */
export function saveSNA(machine) {
    const cpu = machine.cpu;
    const out = new Uint8Array(SNA_SIZE);
    // Push PC like the NMI saver did: SP drops 2, PC lands there.
    const sp = (cpu.sp - 2) & 0xffff;
    const mem = machine.mem.slice(); // do not disturb the live machine
    mem[sp] = cpu.pc & 0xff;
    mem[(sp + 1) & 0xffff] = cpu.pc >> 8;

    const w = (off, v) => { out[off] = v & 0xff; out[off + 1] = (v >> 8) & 0xff; };
    out[0] = cpu.i;
    w(1, cpu.hl_); w(3, cpu.de_); w(5, cpu.bc_); w(7, cpu.af_);
    w(9, cpu.hl); w(11, cpu.de); w(13, cpu.bc);
    w(15, cpu.iy); w(17, cpu.ix);
    out[19] = cpu.iff2 ? 0x04 : 0x00;
    out[20] = cpu.r;
    w(21, cpu.af); w(23, sp);
    out[25] = cpu.im;
    out[26] = machine.ula ? machine.ula.border : 0;
    out.set(mem.subarray(0x4000, 0x10000), 27);
    return out;
}

/** Restore .SNA bytes onto a 48K machine (ROM already loaded). */
export function loadSNA(machine, buf) {
    if (buf.length < SNA_SIZE) throw new Error(`not a 48K .SNA: ${buf.length} bytes, expected ${SNA_SIZE}`);
    const cpu = machine.cpu;
    const r16 = (off) => buf[off] | (buf[off + 1] << 8);
    cpu.i = buf[0];
    cpu.hl_ = r16(1); cpu.de_ = r16(3); cpu.bc_ = r16(5); cpu.af_ = r16(7);
    cpu.hl = r16(9); cpu.de = r16(11); cpu.bc = r16(13);
    cpu.iy = r16(15); cpu.ix = r16(17);
    cpu.iff1 = cpu.iff2 = (buf[19] & 0x04) ? 1 : 0;
    cpu.r = buf[20];
    cpu.af = r16(21); cpu.sp = r16(23);
    cpu.im = buf[25];
    if (machine.ula) machine.ula.border = buf[26] & 0x07;
    machine.mem.set(buf.subarray(27, 27 + 49152), 0x4000);
    // RETN: pop PC, SP rises past it.
    cpu.pc = machine.mem[cpu.sp] | (machine.mem[(cpu.sp + 1) & 0xffff] << 8);
    cpu.sp = (cpu.sp + 2) & 0xffff;
    cpu.halted = 0;
    cpu.eiLatch = 0;
}

/** 128K SNA: 131103 bytes. */
export const SNA128_SIZE = 27 + 49152 + 4 + 5 * 16384;

/** Restore a 128K .SNA onto a zx128 machine. */
export function loadSNA128(machine, buf) {
    if (buf.length < SNA128_SIZE) {
        throw new Error(`not a 128K .SNA: ${buf.length} bytes, expected ${SNA128_SIZE}`);
    }
    if (!machine._zx128) {
        throw new Error('128K .SNA requires a zx128 machine (config.zx128 = true)');
    }
    const cpu = machine.cpu;
    const r16 = (off) => buf[off] | (buf[off + 1] << 8);

    // Header (same as 48K)
    cpu.i = buf[0];
    cpu.hl_ = r16(1); cpu.de_ = r16(3); cpu.bc_ = r16(5); cpu.af_ = r16(7);
    cpu.hl = r16(9); cpu.de = r16(11); cpu.bc = r16(13);
    cpu.iy = r16(15); cpu.ix = r16(17);
    cpu.iff1 = cpu.iff2 = (buf[19] & 0x04) ? 1 : 0;
    cpu.r = buf[20];
    cpu.af = r16(21); cpu.sp = r16(23);
    cpu.im = buf[25];
    if (machine.ula) machine.ula.border = buf[26] & 0x07;

    // 48K RAM: pages 5 ($4000), 2 ($8000), and the banked page at $C000
    machine.mem.set(buf.subarray(27, 27 + 49152), 0x4000);

    // Extension header at 49179
    const ext = 27 + 49152;
    cpu.pc = r16(ext);
    const port7ffd = buf[ext + 2];
    // byte ext+3 = TRDOS flag (ignored)

    // The banked page at $C000 in the 48K dump
    const bankedPage = port7ffd & 0x07;

    // Copy the $C000 portion of the 48K dump into the correct bank
    // (it's already in machine.mem at $C000, but we need it in pages[])
    machine.pages[bankedPage].set(
        buf.subarray(27 + 32768, 27 + 49152) // $C000-$FFFF from the dump
    );

    // Remaining 5 banks follow the extension, in order 0-7 skipping
    // pages 5, 2, and the currently banked page
    const skip = new Set([5, 2, bankedPage]);
    let off = ext + 4;
    for (let b = 0; b < 8; b++) {
        if (skip.has(b)) continue;
        machine.pages[b].set(buf.subarray(off, off + 16384));
        off += 16384;
    }

    // Apply banking
    machine._bank.locked = 0;
    machine._setBank(port7ffd);

    cpu.halted = 0;
    cpu.eiLatch = 0;
}

/** Serialize a running 128K machine as 128K .SNA. */
export function saveSNA128(machine) {
    if (!machine._zx128) throw new Error('saveSNA128 needs a zx128 machine');
    const cpu = machine.cpu;
    const out = new Uint8Array(SNA128_SIZE);
    const w = (off, v) => { out[off] = v & 0xff; out[off + 1] = (v >> 8) & 0xff; };

    // Header (same as 48K but NO pushed PC — 128K stores it in the extension)
    out[0] = cpu.i;
    w(1, cpu.hl_); w(3, cpu.de_); w(5, cpu.bc_); w(7, cpu.af_);
    w(9, cpu.hl); w(11, cpu.de); w(13, cpu.bc);
    w(15, cpu.iy); w(17, cpu.ix);
    out[19] = cpu.iff2 ? 0x04 : 0x00;
    out[20] = cpu.r;
    w(21, cpu.af); w(23, cpu.sp);
    out[25] = cpu.im;
    out[26] = machine.ula ? machine.ula.border : 0;

    // 48K RAM dump: pages 5 ($4000) + 2 ($8000) + banked ($C000)
    out.set(machine.mem.subarray(0x4000, 0x10000), 27);
    // $C000 region comes from the currently banked page
    const bankedPage = machine._bank.page;
    out.set(machine.pages[bankedPage], 27 + 32768);

    // Extension
    const ext = 27 + 49152;
    w(ext, cpu.pc);
    const port7ffd = bankedPage
        | (machine._bank.shadow << 3)
        | (machine._bank.rom << 4)
        | (machine._bank.locked << 5);
    out[ext + 2] = port7ffd;
    out[ext + 3] = 0; // TRDOS flag

    // Remaining 5 banks
    const skip = new Set([5, 2, bankedPage]);
    let off = ext + 4;
    for (let b = 0; b < 8; b++) {
        if (skip.has(b)) continue;
        out.set(machine.pages[b], off);
        off += 16384;
    }

    return out;
}

export default { saveSNA, loadSNA, SNA_SIZE, loadSNA128, saveSNA128, SNA128_SIZE };
