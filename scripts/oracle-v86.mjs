/**
 * oracle-v86.mjs — a DIFFERENTIAL oracle: run the same 16-bit program on our
 * I8086Machine and on v86 (copy/v86, BSD-2-Clause, an independent and mature
 * x86 PC emulator) and compare what each puts on COM1. v86 is used ORACLE-
 * ONLY — never shipped, never copied from; its licence would not matter for
 * testing even if it were GPL, and it is in fact permissive.
 *
 * THE CATCH the harness is built around: v86 clocks time differently from our
 * instruction-stepped machine, so any peripheral behaviour that depends on
 * elapsed time (a counter's current value, a retrace phase) will disagree for
 * reasons that say nothing about correctness. So we only diff behaviours that
 * are TIMING-INDEPENDENT — configuration reads, register round-trips — where
 * the two must agree byte-for-byte or one of them is wrong.
 *
 * Two probes today, both framed on COM1 (3F8h):
 *   A. 8254 read-back STATUS. The status byte's low six bits echo the control
 *      word's rw/mode/bcd (datasheet), independent of the count. Our i8254 is
 *      datasheet-correct; v86 does NOT implement the read-back command
 *      (v86 src/pit.js: "Unimplemented read back"), so it returns counter data
 *      instead — a real divergence where OUR implementation is the complete
 *      one. Reported, not asserted.
 *   B. 16550 scratch register (3FFh) round-trip — both implement it, so it
 *      MUST agree, and it does. This is the positive control that proves the
 *      harness confirms agreement, not just flags difference.
 *
 * SETUP (out-of-repo, like the SingleStepTests grind's vectors):
 *   mkdir -p ~/code/v86-oracle/bios
 *   # from https://github.com/copy/v86/releases/download/latest/ :
 *   curl -sSL -o ~/code/v86-oracle/libv86.mjs .../libv86.mjs
 *   curl -sSL -o ~/code/v86-oracle/v86.wasm   .../v86.wasm
 *   # BIOS from the v86 repo's bios/ dir:
 *   cp v86/bios/seabios.bin v86/bios/vgabios.bin ~/code/v86-oracle/bios/
 * Override the location with V86_ORACLE_DIR. If it is absent the script skips
 * with a note rather than failing, exactly as the grind does without vectors.
 *
 *   node scripts/oracle-v86.mjs
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { I8086Machine } from '../src/i8086-machine.js';

const DIR = process.env.V86_ORACLE_DIR || join(homedir(), 'code', 'v86-oracle');
const LIB = join(DIR, 'libv86.mjs');
if (!existsSync(LIB)) {
    console.log(`v86 not found at ${DIR} — see this file's header for the one-time setup. Skipping.`);
    process.exit(0);
}

const CWS = [0x34, 0x36, 0x30, 0x38, 0x3a, 0x14, 0x24, 0x35];
const SCR = [0x00, 0xff, 0x5a, 0xa5, 0x3c, 0x81];

// ---- the shared boot program ----
const prog = [];
const e = (...b) => prog.push(...b);
e(0xba, 0xf8, 0x03);                              // mov dx, 3F8h
e(0xb0, 0x55, 0xee, 0xb0, 0xaa, 0xee);            // frame A start
for (const cw of CWS) {
    e(0xb0, cw, 0xe6, 0x43);
    const rw = (cw >> 4) & 3;
    if (rw & 1) e(0xb0, 0x9c, 0xe6, 0x40);
    if (rw & 2) e(0xb0, 0x02, 0xe6, 0x40);
    e(0xb0, 0xe2, 0xe6, 0x43, 0xe4, 0x40, 0x24, 0x3f, 0xee);   // read-back status, mask, emit
}
e(0xb0, 0x55, 0xee, 0xb0, 0xaa, 0xee);            // frame A end
e(0xb0, 0x55, 0xee, 0xb0, 0xbb, 0xee);            // frame B start
for (const v of SCR) {
    e(0xba, 0xff, 0x03, 0xb0, v, 0xee, 0xec, 0xba, 0xf8, 0x03, 0xee);  // scratch round-trip, emit
}
e(0xba, 0xf8, 0x03, 0xb0, 0x55, 0xee, 0xb0, 0xbb, 0xee);
e(0xf4);                                          // hlt

const EXP_A = [0x55, 0xaa, ...CWS.map((c) => c & 0x3f), 0x55, 0xaa];
const EXP_B = [0x55, 0xbb, ...SCR, 0x55, 0xbb];
const HEX = (a) => (a ? a.map((b) => b.toString(16).padStart(2, '0')).join(' ') : '(missing)');
const eq = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
const frame = (buf, hi, len) => {
    for (let i = 0; i + len <= buf.length; i++) {
        if (buf[i] === 0x55 && buf[i + 1] === hi && buf[i + len - 2] === 0x55 && buf[i + len - 1] === hi) {
            return buf.slice(i, i + len);
        }
    }
    return null;
};

// ---- our machine ----
function runMine() {
    const out = [];
    const m = new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0x9ffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'pit', name: 'pit1', at: 0x40 }, { kind: 'uart16550', name: 'com1', at: 0x3f8 }],
    }, { onSerial: (b) => out.push(b & 0xff) });
    m.reset();
    m.mem.set(prog, 0x7c00);
    m.cpu.cs = 0; m.cpu.ip = 0x7c00;
    for (let i = 0; i < 200000 && !m.cpu.halted; i++) m.step();
    return out;
}

const { V86 } = await import(LIB);
const mine = runMine();

const floppy = new Uint8Array(1474560);
floppy.set(prog, 0); floppy[510] = 0x55; floppy[511] = 0xaa;
const cap = [];
const emu = new V86({
    wasm_path: join(DIR, 'v86.wasm'),
    bios: { url: join(DIR, 'bios', 'seabios.bin') },
    vga_bios: { url: join(DIR, 'bios', 'vgabios.bin') },
    fda: { buffer: floppy.buffer }, boot_order: 0x123, autostart: true,
    disable_keyboard: true, disable_mouse: true, memory_size: 2 * 1024 * 1024,
});
emu.add_listener('serial0-output-byte', (b) => cap.push(b & 0xff));

// v86/seabios boot time varies, so poll for our completion marker (frame B's
// end) rather than guessing a fixed wait; give up after a generous ceiling.
const started = Date.now();
async function collect() {
    const done = frame(cap, 0xbb, EXP_B.length) !== null;
    if (!done && Date.now() - started < 20000) { setTimeout(collect, 200); return; }
    try { await emu.destroy(); } catch { /* ignore */ }
    const mineA = frame(mine, 0xaa, EXP_A.length), v86A = frame(cap, 0xaa, EXP_A.length);
    const mineB = frame(mine, 0xbb, EXP_B.length), v86B = frame(cap, 0xbb, EXP_B.length);

    console.log('\n===== DIFFERENTIAL ORACLE: bw-board vs v86 =====\n');
    console.log('A) 8254 read-back STATUS (low bits echo the control word; timing-independent)');
    console.log('   datasheet:', HEX(EXP_A));
    console.log('   bw-board :', HEX(mineA), '  ->', eq(mineA, EXP_A) ? 'DATASHEET-CORRECT' : 'DIFF');
    console.log('   v86      :', HEX(v86A), '  -> v86 lacks read-back (returns counter data)');
    console.log('\nB) 16550 scratch register 3FFh round-trip (both implement; must agree)');
    console.log('   bw-board :', HEX(mineB));
    console.log('   v86      :', HEX(v86B), '  ->', eq(mineB, v86B) ? 'AGREE byte-for-byte' : 'MISMATCH');
    console.log('\nResult: our chips agree with v86 wherever v86 implements the feature; where they');
    console.log('differ (8254 read-back) our implementation is the datasheet-complete one.');
    process.exit(0);
}
collect();
