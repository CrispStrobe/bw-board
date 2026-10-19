// riscv32-snapshot.js on a small machine, no kernel needed: a program with a
// timer interrupt, UART output, stores across pages and a page it ZEROES that
// the base holds non-zero (the one page kind the Linux gate cannot reach —
// every page zero at the Linux prompt was already zero in the boot image).
// Snapshot mid-run, restore into a fresh machine, and both must run on
// identically. test/linux-riscv/snapshot.mjs is the same proof on Linux.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {assembleRiscv} from '../src/riscv-asm.js';
import {saveRiscvSnapshot, restoreRiscvSnapshot, readRiscvSnapshot, gzipBytes, gunzipBytes} from '../src/riscv32-snapshot.js';

// mtvec handler: count the tick in s1, push mtimecmp 997 ticks ahead, print
// '.' through the UART. Main loop: bump a counter, store it at a stride that
// crosses pages, and once zero the page at 0x40000 (seeded non-zero). (No
// `main` label: the assembler would make it the entry and skip the set-up.)
const PROGRAM = `
    la t0, trap
    csrw mtvec, t0
    li t0, 0x02004000
    li t1, 500
    sw t1, 0(t0)
    sw zero, 4(t0)
    li t0, 0x80
    csrs mie, t0
    li t0, 8
    csrs mstatus, t0
    li s0, 0
    li s2, 0x20000
    li s3, 0x40000
spin:
    addi s0, s0, 1
    andi t2, s0, 0x7fc
    slli t2, t2, 5
    add t2, t2, s2
    sw s0, 0(t2)
    li t3, 3000
    bne s0, t3, spin
    li t4, 1024
wipe:
    sw zero, 0(s3)
    addi s3, s3, 4
    addi t4, t4, -1
    bnez t4, wipe
    li s3, 0x40000
    j spin
trap:
    addi s1, s1, 1
    li t5, 0x0200bff8
    lw t6, 0(t5)
    addi t6, t6, 997
    li t5, 0x02004000
    sw t6, 0(t5)
    li t5, 0x10000000
    li t6, 46
    sb t6, 0(t5)
    mret
`;

function machine() {
    let out = '';
    const m = new RiscV32Machine({memSize: 1 << 20}, {onSerial: b => { out += String.fromCharCode(b); }});
    const {image} = assembleRiscv(PROGRAM, {textBase: 0x1000, dataBase: 0x8000});
    m.loadImage(image);
    m.mem.fill(0xa5, 0x40000, 0x41000);                  // the page the program zeroes
    return {m, out: () => out};
}

test('snapshot mid-run: the restored machine runs on identically, and every page kind restores', async () => {
    const a = machine();
    const base = a.m.mem.slice();
    a.m.run(40_000);
    const snap = saveRiscvSnapshot(a.m, {base, baseInfo: {kind: 'unit'}, console: a.out()});
    const {header, map} = readRiscvSnapshot(snap);
    // The three page kinds all occur, and the zeroed page is stored as ZERO
    // although the base has it non-zero.
    assert.equal(map[0x40000 / 4096], 0, 'the zeroed page is a ZERO page');
    assert.ok(map.includes(1) && map.includes(2), 'SAME and LITERAL pages occur too');
    assert.ok(header.state.cpu.instret === 40_000 && a.m.cpu.csr[0x304] === 0x80);
    assert.ok(a.out().length > 10, `timer ticks printed before the snapshot: ${a.out().length}`);

    // Restore into a fresh machine holding the same base, via gzip.
    const c = machine();
    const raw = await gunzipBytes(await gzipBytes(snap));
    restoreRiscvSnapshot(c.m, raw, {baseInfo: {kind: 'unit'}});
    assert.equal(c.m.mem[0x40000], 0, 'the ZERO page was zeroed over the base');
    assert.deepEqual(saveRiscvSnapshot(c.m, {base, baseInfo: {kind: 'unit'}, console: a.out()}), snap, 'save(restore(S)) === S');

    const before = a.out().length;
    a.m.run(60_000);
    c.m.run(60_000);
    assert.equal(c.out(), a.out().slice(before), 'identical output after the snapshot point');
    assert.deepEqual(saveRiscvSnapshot(c.m, {}), saveRiscvSnapshot(a.m, {}), 'identical final state');
});

test('a snapshot without a base restores into any machine of the same shape', () => {
    const a = machine();
    a.m.run(12_345);
    const snap = saveRiscvSnapshot(a.m);
    const fresh = new RiscV32Machine({memSize: 1 << 20});        // no program loaded at all
    restoreRiscvSnapshot(fresh, snap);
    a.m.run(5000); fresh.run(5000);
    assert.deepEqual(saveRiscvSnapshot(fresh), saveRiscvSnapshot(a.m));
});

test('refusals by name: wrong base, missing base, other RAM size, virtio disk, not a snapshot', () => {
    const a = machine();
    a.m.run(1000);
    const snap = saveRiscvSnapshot(a.m, {base: a.m.mem.slice(), baseInfo: {kind: 'unit', media: 'x'}});
    const code = fn => { try { fn(); } catch (e) { return e.code; } return 'no error'; };
    assert.equal(code(() => restoreRiscvSnapshot(machine().m, snap, {baseInfo: {kind: 'unit', media: 'y'}})), 'snapshot-base-mismatch');
    assert.equal(code(() => restoreRiscvSnapshot(machine().m, snap)), 'snapshot-needs-base');
    assert.equal(code(() => restoreRiscvSnapshot(new RiscV32Machine({memSize: 1 << 21}), saveRiscvSnapshot(a.m))), 'snapshot-config-mismatch');
    assert.equal(code(() => restoreRiscvSnapshot(new RiscV32Machine({memSize: 1 << 20, clint: false}), saveRiscvSnapshot(a.m))), 'snapshot-config-mismatch');
    const disk = new RiscV32Machine({memSize: 1 << 20, virtioDisk: new Uint8Array(4096)});
    assert.equal(code(() => saveRiscvSnapshot(disk)), 'snapshot-unsupported-device');
    assert.equal(code(() => readRiscvSnapshot(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]))), 'snapshot-bad-magic');
    assert.equal(code(() => readRiscvSnapshot(snap.subarray(0, snap.length - 4096))), 'snapshot-truncated');
});
