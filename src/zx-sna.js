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

export default { saveSNA, loadSNA, SNA_SIZE };
