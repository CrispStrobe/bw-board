// The BIOS timer tick, pinned. int08 chains to a hooked INT 1Ch and step()
// delivers the ~18.2 Hz tick from machine time to a program that listens -- the
// fix that let retro-dos-graphics/speaker.asm play its melody. This guards the
// two things a well-meaning "make it match real BIOS" edit would break:
//   1. a program that hooks INT 1Ch and spins IS called (the tick reaches it);
//   2. the ordering is EOI-before-tail-call, so the tick keeps coming, not once;
//   3. a program that hooks nothing gets NO ticks -- the gate leaves the corpus
//      untouched, which is why this could ship without perturbing 500 programs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/i8086-asm.js';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086, DOSBOX8086_XT } from '../src/i8086-dos.js';

// A COM that hooks INT 1Ch to a handler bumping a counter at 0000:0500, then
// enables interrupts and spins in HLT waiting for the tick.
const HOOKS_1C = `
    org 100h
    xor ax, ax
    mov ds, ax                         ; DS = 0 -> the IVT
    mov word ptr [70h], offset handler ; IVT[1Ch] offset
    mov [72h], cs                      ; IVT[1Ch] segment
    mov word ptr [500h], 0             ; the tick counter at 0000:0500
    sti
spin:
    hlt
    jmp spin
handler:
    push ds
    push ax
    xor ax, ax
    mov ds, ax
    inc word ptr [500h]
    pop ax
    pop ds
    iret
`;

// A COM that hooks nothing and spins -- the control for the gate.
const HOOKS_NOTHING = `
    org 100h
    sti
spin:
    hlt
    jmp spin
`;

function run(src, steps) {
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m).install();
    dos.loadCom(assemble(src).bytes);
    for (let i = 0; i < steps && !dos.terminated; i++) dos.step();
    return m;
}

test('a program that hooks INT 1Ch and spins IS called by the timer tick', () => {
    const m = run(HOOKS_1C, 3_000_000);
    const ticks = m._read(0x500) | (m._read(0x501) << 8);
    assert.ok(ticks > 0, `the hooked 1Ch handler ran (${ticks} ticks) -- without the int08 chain it is 0`);
});

test('the tick KEEPS coming -- EOI before the tail-call, not one tick then silence', () => {
    // One tick would mean the ordering regressed to nested-then-EOI, leaving
    // IRQ0 in service on a PIC machine. Many ticks means the acknowledge-first
    // ordering held.
    const m = run(HOOKS_1C, 3_000_000);
    const ticks = m._read(0x500) | (m._read(0x501) << 8);
    assert.ok(ticks >= 3, `more than one tick was delivered (${ticks})`);
});

test('a program that hooks nothing gets NO ticks -- the gate holds', () => {
    // The BIOS tick count at 0040:006C only advances if int08 ran; the gate
    // means it never fires for a program that listens for no timer.
    const m = run(HOOKS_NOTHING, 500_000);
    const biosTicks = m._read(0x46c) | (m._read(0x46d) << 8);
    assert.equal(biosTicks, 0, 'no timer interrupt was delivered to a program that hooks none');
});

// ---------------------------------------------------------------------------
// THE ASSERTION THIS FILE WAS MISSING.
//
// Every test above asserts PRESENCE or ORDERING -- `ticks > 0`, `ticks >= 3`,
// `ticks === 0`. All three passed while the 18.2 Hz BIOS tick ran at 76.35 Hz,
// because ORDER DOES NOT CHANGE WHEN EVERY DELAY SCALES BY THE SAME FACTOR.
// The 8254 was being handed machine cycles and counting them as its own ticks,
// so a 1.193182 MHz part ran at the CPU's 5 MHz: 4.19x fast, and invisible to
// every relative check in this file.
//
// A quantity with units gets its units pinned.
// ---------------------------------------------------------------------------
import { I8254 } from '../src/i8254.js';

test('the PIT runs from ITS OWN 1.193182 MHz crystal, not the CPU clock', () => {
    // Directly, so the arithmetic is checked without a machine around it.
    let edges = 0;
    const pit = new I8254({ onOutput: (ch, level) => { if (ch === 0 && level === 1) edges++; } });
    pit.write(3, 0x36);              // counter 0, mode 3, lobyte/hibyte
    pit.write(0, 0xff); pit.write(0, 0xff);   // divisor 65535 -> the BIOS tick
    // One full second of emulated time, handed over in 1 ms slices.
    for (let i = 0; i < 1000; i++) pit.advanceMs(1);
    // Mode 3 toggles OUT twice per period; count rising edges only.
    assert.ok(Math.abs(edges - 18.2) < 1,
        `expected ~18.2 Hz from 1193182/65535, measured ${edges} Hz — `
        + 'a PIT fed the CPU clock reads 76 here');
});

test('the fractional carry is load-bearing: 4-cycle advances must not vanish', () => {
    // _advanceChips is called PER INSTRUCTION. A short instruction is 4 cycles,
    // which at 5 MHz is 0.8 us -- LESS THAN ONE 1.193 MHz count. Truncating
    // each call to whole ticks would round nearly all of them to zero and stop
    // the clock. This drives the chip exactly the way the machine does.
    let edges = 0;
    const pit = new I8254({ onOutput: (ch, level) => { if (ch === 0 && level === 1) edges++; } });
    pit.write(3, 0x36);
    pit.write(0, 0xff); pit.write(0, 0xff);
    const msPerCall = 4 * 1000 / 5_000_000;         // 4 CPU cycles at 5 MHz
    const calls = Math.round(1000 / msPerCall);     // one second of them
    for (let i = 0; i < calls; i++) pit.advanceMs(msPerCall);
    assert.ok(Math.abs(edges - 18.2) < 1,
        `${edges} edges from ${calls} sub-tick advances — the remainder is being dropped`);
});

// ---------------------------------------------------------------------------
// ONE TICK SOURCE, NOT TWO.
//
// The DOS layer synthesises a BIOS tick from machine time for a bench that has
// no chips. A machine with an 8254 wired to a PIC makes its own. If both fired,
// a program that hooks INT 8 -- which is precisely what a scheduler does --
// would receive a hardware IRQ0 at the divisor's rate AND an 18.2 Hz phantom
// from an unrelated clock, and nothing would report the collision.
// ---------------------------------------------------------------------------
const withChips = (chips) => new I8086Machine({
    clockHz: 5_000_000,
    regions: [{kind: 'ram', start: 0, end: 0xbffff}],
    chips,
});

/** Bring the 8259 up and point IRQ0 at `base | 0`. ICW2 is a RUN-TIME write. */
const initPic = (m, base) => {
    m._out(0x20, 0x11);      // ICW1: edge, cascade off, ICW4 to follow
    m._out(0x21, base);      // ICW2: vector base
    m._out(0x21, 0x00);      // ICW3
    m._out(0x21, 0x01);      // ICW4: 8086 mode
    return m;
};

test('the question is which VECTOR the hardware delivers, not whether it is wired', () => {
    // Asking "is a PIT wired to a PIC" was the wrong question and it cost a
    // regression: a scheduler that remaps IRQ0 to vector 70h leaves INT 8 and
    // INT 1Ch free ON PURPOSE, and the synthetic tick must keep serving them.
    // Measured on that configuration: 163 INT 1Ch ticks over 9 simulated
    // seconds with the vector-aware test, ZERO with the wiring-only one.
    assert.equal(withChips([]).hasHardwareTimerIrq(), false, 'no chips at all');
    assert.equal(withChips([
        {kind: 'pit', name: 'pit1', at: 0x40, irq: 0},
    ]).hasHardwareTimerIrq(), false, 'a wired PIT with no PIC cannot deliver');
    assert.equal(withChips([
        {kind: 'pic', name: 'pic1', at: 0x20},
        {kind: 'pit', name: 'pit1', at: 0x40},
    ]).hasHardwareTimerIrq(), false, 'a PIC and a PIT with no irq key are not wired to each other');

    const wired = () => withChips([
        {kind: 'pic', name: 'pic1', at: 0x20},
        {kind: 'pit', name: 'pit1', at: 0x40, irq: 0},
    ]);

    // UNCONFIGURED IS NOT INT 8. Before ICW2 the vector base is 0, so IRQ0
    // would land on vector 0 — and a machine whose 8259 has never been
    // initialised is not competing with the synthetic tick.
    assert.equal(wired().hasHardwareTimerIrq(), false,
        'wired but never initialised: ICW2 has not chosen a vector yet');

    // The PC mapping: IRQ0 -> INT 8. THIS is the collision the synthetic tick
    // must stand down for.
    assert.equal(initPic(wired(), 0x08).hasHardwareTimerIrq(), true,
        'IRQ0 mapped to vector 8 — hardware owns the BIOS tick');

    // The scheduler's mapping: IRQ0 -> 70h, INT 8 deliberately left free.
    assert.equal(initPic(wired(), 0x70).hasHardwareTimerIrq(), false,
        'IRQ0 remapped to 70h — nothing reaches INT 8, so the synthetic tick must still serve it');

    // The shipped DOS bench is the case the synthetic tick exists for.
    assert.equal(new I8086Machine(DOSBOX8086_XT).hasHardwareTimerIrq(), false,
        'DOSBOX8086_XT carries a PIT but no PIC — it cannot make its own tick');
});
