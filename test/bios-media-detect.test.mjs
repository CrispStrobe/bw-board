// The BIOS works out what is in the drive, instead of assuming a 360K disk.
//
// WHAT THIS PINS, AND WHY IT IS ITS OWN FILE. The ROM used to carry ONE
// diskette parameter table describing a 360K floppy, so EOT -- the last
// sector the controller will transfer before it decides the track has ended
// -- was 9 on every medium. The driver sets MT, so at EOT the chip switches
// to the other head. On a 1.44M disk a two-sector read at sector 9 therefore
// returned sector 9 and then HEAD 1'S SECTOR 1, with CF clear and AH=00,
// because the controller did exactly what it was told. ELKS's kernel loaded
// with every second sector wrong and slid into executing zeros. E6.8.8b.
//
// The obvious fix -- change the 9 to an 18 -- is wrong, and test/bios-fdc's
// multi-track read is the counter-example: it reads nine sectors from head 0
// sector 6 of a 360K disk and REQUIRES the run past the end of the track and
// the head switch at EOT=9. EOT is a property of the medium, not a constant
// that was too small, so the ROM probes and publishes a table per disk.
//
// THE PROBE USES VERIFY, NOT READ: the 8237 runs in verify mode and drives no
// bus cycle, so nothing is written anywhere and a wrong guess cannot corrupt
// a buffer that was never named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { assembleRaw } from '../src/i8086-asm.js';
import { buildBios } from '../scripts/build-bios.mjs';

const rom = buildBios();
const PROG = 0x0600;

const G360 = { cylinders: 40, heads: 2, sectors: 9, bytesPerSector: 512 };
const G144 = { cylinders: 80, heads: 2, sectors: 18, bytesPerSector: 512 };

/** Every sector identifiable, so a sector off the wrong head is recognisable. */
function image(geom) {
    const n = geom.cylinders * geom.heads * geom.sectors;
    const img = new Uint8Array(n * 512);
    for (let s = 0; s < n; s++)
        for (let i = 0; i < 512; i++) img[s * 512 + i] = (s * 31 + i) & 0xff;
    img[510] = 0x55; img[511] = 0xaa;
    return img;
}
const lba = (g, c, h, r) => (c * g.heads + h) * g.sectors + (r - 1);
const sector = (img, g, c, h, r) =>
    img.subarray(lba(g, c, h, r) * 512, (lba(g, c, h, r) + 1) * 512);

function ready(geom) {
    const m = new I8086Machine(PCXT8086);
    m.loadRom(rom.bytes);
    const img = image(geom);
    m.chips.fdc1.insert(0, img, geom);
    m.reset();
    const int19 = rom.symbols.get('int19').value;
    let n = 0;
    while (n < 3_000_000 && !(m.cpu.cs === 0xf000 && m.cpu.ip === int19)) { m.step(); n++; }
    assert.ok(n < 3_000_000, 'POST never reached INT 19h');
    m.image = img;
    return m;
}

function run(m, source, cap = 6_000_000) {
    const code = assembleRaw(`${source}\n hlt\n`, 0);
    m.mem.set(code, PROG);
    m.cpu.cs = 0; m.cpu.ip = PROG;
    m.cpu.ss = 0; m.cpu.sp = 0x7000;
    m.cpu.ds = 0; m.cpu.es = 0;
    m.cpu.halted = false;
    m.cpu.flags |= 0x0200;
    let n = 0;
    while (n < cap && !m.cpu.halted) { m.step(); n++; }
    assert.ok(m.cpu.halted, `the injected program did not reach its HLT in ${cap} steps`);
}
const CALL13 = (regs) => ` ${regs}\n int 13h\n pushf\n pop si`;
const result = (m) => ({ ah: m.cpu.ax >> 8, al: m.cpu.ax & 0xff, cf: m.cpu.si & 1 });

/** The table INT 1Eh currently points at, which is what the driver reads. */
function dptAddr(m) {
    return ((m.mem[0x7a] | (m.mem[0x7b] << 8)) << 4) + (m.mem[0x78] | (m.mem[0x79] << 8));
}
const eotNow = (m) => m.mem[dptAddr(m) + 4];

/** One sector read, enough to make the driver probe the medium. */
const READ1 = ' mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h';

test('a 360K disk still gets the 360K table, which is what kept the pinned tests', () => {
    const m = ready(G360);
    run(m, CALL13(READ1));
    assert.equal(result(m).cf, 0, 'the read worked');
    assert.equal(eotNow(m), 9,
        'a 9-sector medium must still be told EOT=9, or the multi-track read in '
        + 'test/bios-fdc.test.mjs loses its head switch at the end of the track');
});

test('a 1.44M disk gets EOT=18, which is the entire bug', () => {
    const m = ready(G144);
    run(m, CALL13(READ1));
    assert.equal(result(m).cf, 0, 'the read worked');
    assert.equal(eotNow(m), 18, 'an 18-sector medium must be told EOT=18');
});

test('REGRESSION: two sectors from sector 9 of a 1.44M disk are 9 and 10, not 9 and head 1', () => {
    // The defect itself, in the form it actually appeared. With EOT=9 the
    // second sector came back as head 1 sector 1 and the status said success.
    const m = ready(G144);
    run(m, CALL13(' mov ax, 0202h\n mov cx, 0009h\n xor dx, dx\n mov bx, 5000h'));
    assert.equal(result(m).cf, 0, 'CF clear');
    assert.equal(result(m).ah, 0, 'AH=00');

    const first = sector(m.image, G144, 0, 0, 9);
    const second = sector(m.image, G144, 0, 0, 10);
    const wrong = sector(m.image, G144, 0, 1, 1);   // what EOT=9 delivered
    for (let i = 0; i < 512; i += 61) {
        assert.equal(m.mem[0x5000 + i], first[i], `first sector, byte ${i}`);
        assert.equal(m.mem[0x5200 + i], second[i],
            `second sector, byte ${i}: this is the byte that came from the wrong `
            + 'head when the table said EOT=9');
    }
    assert.notDeepEqual(
        Array.from(m.mem.subarray(0x5200, 0x5210)), Array.from(wrong.subarray(0, 16)),
        'the second sector is head 1 sector 1 -- the head switched at EOT');
});

test('AH=08h reports the geometry of the medium once the driver has looked', () => {
    const m = ready(G144);
    run(m, CALL13(READ1));
    run(m, CALL13(' mov ax, 0800h\n xor dx, dx'));
    assert.equal(m.cpu.cx & 0x3f, 18, 'sectors per track');
    assert.equal((m.cpu.cx >> 8) & 0xff, 79, 'last cylinder: 80 of them, numbered from 0');
});

test('AH=08h does NOT probe: it stays configuration rather than controller traffic', () => {
    // Asked before any transfer, it answers what the BIOS currently believes,
    // which is the 360K default. Probing here would make the answer depend on
    // when it was asked, and would put disk traffic behind a call that has
    // never made any.
    const m = ready(G144);
    const before = m.chips.fdc1.stats;
    run(m, CALL13(' mov ax, 0800h\n xor dx, dx'));
    assert.equal(m.cpu.cx & 0x3f, 9, 'the default 360K answer, not a probe');
    assert.equal((m.cpu.cx >> 8) & 0xff, 39, 'and its cylinder count');
    assert.equal(m.chips.fdc1.stats.badReads, before.badReads, 'no controller traffic');
});

test('a guest that hooks INT 1Eh is obeyed, which the ROM claimed but did not do', () => {
    // The table header always said a program hooking INT 1Eh "really does
    // change what the controller is told". It did not: the driver read
    // cs:[dpt+N], the ROM's own copy, at eleven sites and the vector was
    // written once at POST and never read back. Now the driver reads through
    // the vector, so this is a test of the documented contract.
    const m = ready(G144);
    run(m, CALL13(READ1));
    assert.equal(eotNow(m), 18, 'detected first');

    // Plant a table of our own with a distinctive EOT and point INT 1Eh at it.
    const MINE = 0x4000;
    m.mem.set(m.mem.subarray(dptAddr(m), dptAddr(m) + 11), MINE);
    m.mem[MINE + 4] = 7;
    m.mem[0x78] = MINE & 0xff; m.mem[0x79] = (MINE >> 8) & 0xff;
    m.mem[0x7a] = 0; m.mem[0x7b] = 0;

    run(m, CALL13(' mov ax, 0800h\n xor dx, dx'));
    assert.equal(m.cpu.cx & 0x3f, 7,
        'AH=08h answers from the table INT 1Eh points at, so the hook took effect');
});

test('the 1.2M table is DECLARED, NOT MEASURED', () => {
    // No image in this tier is 1.2M, so the detection branch for it has never
    // read a disk. The table is asserted to exist and to say fifteen; that it
    // is the RIGHT table for a real 1.2M drive is not something this suite
    // has any standing to claim, and saying so here is cheaper than a comment
    // nobody reads.
    const at = rom.symbols.get('dpt12m').value;
    assert.equal(rom.bytes[at + 4], 15, 'EOT=15 for fifteen sectors on a track');
    assert.equal(rom.bytes[rom.symbols.get('dpt144').value + 4], 18);
    assert.equal(rom.bytes[rom.symbols.get('dpt').value + 4], 9);
});
