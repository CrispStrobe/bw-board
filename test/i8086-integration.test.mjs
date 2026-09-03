// Where the two lanes meet: E6.3's HARDWARE interrupt path (PIT -> PIC ->
// core) and E6.4's SOFTWARE one (int 21h -> trap segment -> serviced ->
// hand-rolled IRET) in one machine. Neither branch could test this alone,
// and the failure mode it protects against is silent: one timer tick and
// then nothing, because nobody acknowledged the PIC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, TRAP_SEG } from '../src/i8086-dos.js';

/** A machine with both: 768K of RAM for DOS, and a PIC + PIT wired IRQ0. */
const BOTH = Object.freeze({
    clockHz: 5_000_000,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0xbffff },
        { kind: 'ram', start: 0xf0000, end: 0xf03ff },   // the trap page — install() needs it
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },
    ],
});

/** Program the PIT for a fast periodic tick and unmask IRQ0 on the PIC. */
function armTimer(divisor = 0x0040) {
    return [
        // ICW1 must say SINGLE (bit 1). With 11h the PIC waits for an ICW3
        // that never comes, eats ICW2/ICW4 as it, and never leaves
        // initialisation — so no interrupt is ever delivered and nothing
        // says why. Cost: one debugging round.
        0xb0, 0x13, 0xe6, 0x20,                 // out 20h, 13h   ICW1: init, single, ICW4
        0xb0, 0x08, 0xe6, 0x21,                 // out 21h, 08h   ICW2: vector base 08h
        0xb0, 0x01, 0xe6, 0x21,                 // out 21h, 01h   ICW4: 8086 mode
        0xb0, 0xfe, 0xe6, 0x21,                 // out 21h, FEh   OCW1: unmask IRQ0 only
        0xb0, 0x34, 0xe6, 0x43,                 // out 43h, 34h   counter 0, mode 2, 16-bit
        0xb0, divisor & 0xff, 0xe6, 0x40,       // out 40h, lo
        0xb0, (divisor >> 8) & 0xff, 0xe6, 0x40,// out 40h, hi
        0xfb,                                    // sti
    ];
}

test('a timer IRQ with no handler installed keeps ticking, because the BIOS acknowledges the PIC', () => {
    // The trap in this trap: install() claims all 256 vectors, hardware ones
    // included, so IRQ0 lands in the DOS layer. Without an end-of-interrupt
    // the PIC keeps IRQ0 in service and exactly ONE tick is ever delivered.
    // A count above one is the whole assertion.
    const m = new I8086Machine(BOTH);
    const prog = [...armTimer(), 0xeb, 0xfe];        // arm, then spin
    const dos = createDos8086(m).install().loadCom(Uint8Array.from(prog));
    for (let i = 0; i < 200_000; i++) dos.step();

    const lo = m._read(0x40 * 16 + 0x6c) | (m._read(0x40 * 16 + 0x6d) << 8);
    assert.ok(lo > 1, `the BIOS tick count advanced past one (${lo})`);
    assert.deepEqual(dos.report().unsupported, [],
        'and the timer was serviced, not counted as an unsupported call');
});

test("a program's own timer handler and DOS services coexist", () => {
    const m = new I8086Machine(BOTH);
    // 0100: set vector 08h to our handler at 0200h, arm the timer, print,
    //       spin until the handler has run twice, then exit through DOS.
    // 0x160 bytes, not 0x120: the ISR sits at COM offset 200h and the string
    // at 240h, and a Uint8Array silently DROPS writes past its end — the
    // first run of this test printed a screenful of NULs because of it.
    const prog = new Uint8Array(0x160);
    let p = 0;
    const emit = (...b) => { for (const x of b) prog[p++] = x; };
    emit(0xb4, 0x25, 0xb0, 0x08);                    // ah=25h al=08h
    emit(0xba, 0x00, 0x02);                          // dx = 0200h
    emit(0xcd, 0x21);                                // int 21h  (software path)
    emit(...armTimer());                             // hardware path, armed
    emit(0xba, 0x40, 0x02);                          // dx = 0240h (the '$' string)
    emit(0xb4, 0x09, 0xcd, 0x21);                    // print it
    // wait: while [0250h] < 2, spin
    const waitAt = p;
    emit(0x83, 0x3e, 0x50, 0x02, 0x02);              // cmp word [0250], 2
    emit(0x72, (0x100 + waitAt - (0x100 + p + 2)) & 0xff);   // jb back
    emit(0xb8, 0x00, 0x4c, 0xcd, 0x21);              // exit
    // 0200: the timer ISR — count, acknowledge, return
    p = 0x100;
    emit(0xff, 0x06, 0x50, 0x02);                    // inc word [0250]
    emit(0xb0, 0x20, 0xe6, 0x20);                    // out 20h, 20h  (EOI, by hand)
    emit(0xcf);                                       // iret
    // 0240: 'tick$'
    p = 0x140;
    emit(0x74, 0x69, 0x63, 0x6b, 0x24);

    const dos = createDos8086(m).install().loadCom(prog);
    const r = dos.run(2_000_000);

    assert.ok(r.terminated, 'the program exited through int 21h/4Ch');
    assert.equal(dos.stdout, 'tick', 'the software path still worked with IRQs live');
    const psp = 0x0800;
    const count = m._read((psp << 4) + 0x250) | (m._read((psp << 4) + 0x251) << 8);
    assert.ok(count >= 2, `the program's own ISR ran ${count} times`);
    // The program owns vector 08h now; DOS still owns 21h.
    assert.equal(m._read(0x08 * 4 + 2) | (m._read(0x08 * 4 + 3) << 8), psp);
    assert.equal(m._read(0x21 * 4 + 2) | (m._read(0x21 * 4 + 3) << 8), TRAP_SEG);
});

test('a Tier B machine with no PIC at all is unharmed by the acknowledge path', () => {
    // eoi() looks the PIC up in the config rather than assuming port 20h,
    // because a machine without one would otherwise write into open bus on
    // every tick — harmless here, but the kind of assumption that becomes a
    // bug the moment a breadboard decodes something else at 20h.
    const m = new I8086Machine({
        clockHz: 5_000_000,
        regions: [
            { kind: 'ram', start: 0, end: 0xbffff },
            { kind: 'ram', start: 0xf0000, end: 0xf03ff },
        ],
        chips: [],
    });
    const dos = createDos8086(m).install().loadCom(Uint8Array.from([
        0xcd, 0x08,                                   // int 08h, by hand
        0xb8, 0x00, 0x4c, 0xcd, 0x21,
    ]));
    const r = dos.run(10_000);
    assert.ok(r.terminated);
    const lo = m._read(0x40 * 16 + 0x6c) | (m._read(0x40 * 16 + 0x6d) << 8);
    assert.equal(lo, 1, 'the tick still counted');
    assert.deepEqual(dos.report().unsupported, []);
});
