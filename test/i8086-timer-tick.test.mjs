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
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';

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
