// The 8086 breadboard machine and its boundary-A adapter. The point of
// these tests is the two things this machine has that the 6502 one does
// not — a twenty-bit memory space and a SECOND decode space for I/O ports
// — and the end-to-end proof that a ROM can blink an LED through an 8255.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { createI8086Adapter } from '../src/i8086-adapter.js';

/**
 * The blink ROM, hand-assembled. A 32K image whose last sixteen bytes
 * carry the far jump the 8086 fetches at FFFF:0000 — every ROM for one of
 * these machines ends this way, because the reset vector is sixteen bytes
 * below the top of the megabyte and there is nowhere else to put it.
 *
 *   F800:0000  B0 80     mov al, 80h      ; mode 0, all three ports output
 *              E6 03     out 03h, al      ; -> the PPI control register
 *   F800:0004  B0 FF     mov al, 0FFh     ; loop:
 *              E6 00     out 00h, al      ; every LED on
 *              B0 00     mov al, 0
 *              E6 00     out 00h, al      ; every LED off
 *              EB F6     jmp loop
 */
function blinkRom() {
    const rom = new Uint8Array(0x8000);
    rom.set([0xb0, 0x80, 0xe6, 0x03,
        0xb0, 0xff, 0xe6, 0x00,
        0xb0, 0x00, 0xe6, 0x00,
        0xeb, 0xf6], 0);
    rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // jmp F800:0000
    return rom;
}

test('reset fetches from FFFF:0000, which is why the vector lives at the top', () => {
    const m = new I8086Machine();
    m.loadRom(blinkRom());
    m.reset();
    assert.equal(m.cpu.cs, 0xffff);
    assert.equal(m.cpu.ip, 0);
    assert.equal(m.cpu.pc, 0xffff0);
    m.step();                                  // the far jump
    assert.equal(m.cpu.cs, 0xf800);
    assert.equal(m.cpu.ip, 0);
});

test('the memory space is twenty bits, and ROM refuses writes', () => {
    const m = new I8086Machine();
    m.mem[0x00100] = 0;
    m.cpu.reset();
    m._write(0x00100, 0x42);
    assert.equal(m._read(0x00100), 0x42, 'RAM takes it');
    m._write(0xf8000, 0x42);
    assert.equal(m._read(0xf8000), 0x00, 'a write to ROM vanishes, as on the bench');
    assert.equal(m._read(0x50000), 0xff, 'unmapped memory reads as an undriven bus');
});

test('ports are a separate decode space from memory', () => {
    const m = new I8086Machine();
    // Port 0 is the PPI's port A. The same NUMBER in memory is plain RAM.
    m._out(0x03, 0x80);                        // all ports output
    m._out(0x00, 0x5a);
    assert.equal(m.chips.ppi1.read(0), 0x5a);
    m._write(0x0000, 0x99);
    assert.equal(m.chips.ppi1.read(0), 0x5a, 'a memory write at 0 did not reach the PPI');
    assert.equal(m.mem[0], 0x99);
});

test('display revision changes only on paths that can change visible output', () => {
    const m = new I8086Machine();
    const initial = m.displayRevision;

    m._write(0x0100, 0x42);
    assert.equal(m.displayRevision, initial, 'ordinary RAM does not dirty the display');

    m._write(0xb8000, 0x41);
    assert.equal(m.displayRevision, initial + 1, 'video RAM dirties the display');

    m._out(0x3d8, 0x09);
    assert.equal(m.displayRevision, initial + 2, 'display control ports dirty the display');

    m.loadRom(Uint8Array.of(0xaa), 0xa0000);
    assert.equal(m.displayRevision, initial + 3, 'bulk loads overlapping video RAM dirty it');

    const snapshot = m.saveState();
    m.loadState(snapshot);
    assert.equal(m.displayRevision, initial + 4, 'restoring memory dirties the display');
});

test('a partial-decode window mirrors the registers through it', () => {
    const m = new I8086Machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        chips: [{ kind: 'ppi', name: 'ppi1', at: 0x40, span: 16 }],
    });
    m._out(0x43, 0x80);
    m._out(0x40, 0x11);
    // The window is sixteen wide and the chip has four registers, so the
    // decoder never wired the high address lines and port 44h IS port 40h.
    assert.equal(m._in(0x44), 0x11);
    assert.equal(m._in(0x4c), 0x11);
});

test('a rejected config fails loudly rather than half-decoding', () => {
    assert.throws(() => new I8086Machine({
        clockHz: 1, regions: [], chips: [{ kind: 'ppi', name: 'p', at: 0, span: 2 }],
    }), /span 2 smaller than its 4 registers/);
    assert.throws(() => new I8086Machine({
        clockHz: 1, regions: [], chips: [{ kind: 'nosuchchip', name: 'p', at: 0 }],
    }), /unknown chip kind/);
});

test('a ROM blinks an LED through the 8255', () => {
    const edges = [];
    const m = new I8086Machine(BREADBOARD8086, {
        onPinChange: (pin, level, tMs) => edges.push({ pin, level, tMs }),
    });
    m.loadRom(blinkRom());
    m.reset();
    for (let i = 0; i < 40; i++) m.step();

    const pa0 = edges.filter((e) => e.pin === 'ppi1.PA0');
    // The first edge is the mode-set write clearing the latches, then the
    // program's alternation. Every LED goes dark at configuration time.
    assert.equal(pa0[0].level, 0);
    assert.deepEqual(pa0.slice(1, 5).map((e) => e.level), [1, 0, 1, 0]);
    assert.ok(pa0[1].tMs > 0, 'edges carry machine time');
    // All eight port-A pins move together — it is one OUT instruction.
    for (let bit = 0; bit < 8; bit++) {
        assert.ok(edges.some((e) => e.pin === `ppi1.PA${bit}`), `PA${bit} moved`);
    }
});

test('the adapter drives a board and reads its inputs back', () => {
    const setPins = [];
    const inputs = new Map([['ppi1.PB0', 0], ['ppi1.PB1', 1]]);
    const board = {
        advanceTo() { },
        setPin(name, mode, high) { setPins.push([name, mode, high]); },
        readPin(name) { return inputs.get(name) ?? 1; },
    };

    // Port A out, port B in: control 82h (bit1 = port B input).
    const rom = blinkRom();
    rom[1] = 0x82;
    const a = createI8086Adapter({ rom });
    a.attachBoard(board);
    a.advanceNs(20_000);          // 20 us of machine time

    assert.ok(setPins.length > 0, 'the board saw pin edges');
    assert.ok(setPins.every(([, mode]) => mode === 'pushpull'),
        'a PPI output is a push-pull driver');
    assert.ok(setPins.some(([name, , high]) => name === 'ppi1.PA0' && high === true));

    // Port B is an input, so nothing drives it and the board's levels reach
    // the chip instead.
    assert.ok(!setPins.some(([name]) => name.startsWith('ppi1.PB')));
    assert.equal(a.machine.chips.ppi1.read(1) & 0x03, 0b10);
});

test('the UART is on the port bus and its transmit reaches the adapter', () => {
    const out = [];
    const a = createI8086Adapter({ rom: blinkRom() });
    a.onSerial((b) => out.push(b));
    a.attachBoard({ advanceTo() { }, setPin() { }, readPin: () => 1 });
    // THR is register 0 of the UART at port 10h, with DLAB clear.
    a.machine._out(0x13, 0x03);   // LCR: 8N1, DLAB off
    a.machine._out(0x10, 0x48);   // 'H'
    a.machine._out(0x10, 0x69);   // 'i'
    assert.deepEqual(out, [0x48, 0x69]);

    a.sendSerial(0x41);
    assert.equal(a.machine._in(0x10), 0x41, 'and a received byte reads back from RBR');
});

test('a halted machine still lets time pass', () => {
    const m = new I8086Machine();
    const rom = new Uint8Array(0x8000);
    rom.set([0xf4], 0);                                  // hlt
    rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    m.loadRom(rom);
    m.reset();
    m.step();                                            // the far jump
    m.step();                                            // hlt
    assert.ok(m.cpu.halted);
    const before = m.cycles;
    m.step();
    assert.ok(m.cycles > before, 'the clock does not stop because the CPU parked');
});

test('state round-trips through save and load', () => {
    const m = new I8086Machine();
    m.loadRom(blinkRom());
    m.reset();
    for (let i = 0; i < 20; i++) m.step();
    const snap = m.saveState();

    const n = new I8086Machine();
    n.loadState(snap);
    assert.equal(n.cpu.cs, m.cpu.cs);
    assert.equal(n.cpu.ip, m.cpu.ip);
    assert.equal(n.cycles, m.cycles);
    assert.equal(n.chips.ppi1.read(0), m.chips.ppi1.read(0));
    // ...and it keeps running from there.
    for (let i = 0; i < 8; i++) { m.step(); n.step(); }
    assert.equal(n.cpu.ip, m.cpu.ip);
});
