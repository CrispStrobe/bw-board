/**
 * WHAT AN INTERRUPT CONTROLLER WOULD BUY, measured rather than argued.
 *
 * `set <pin> to <n> percent` (stc12_setpwm) REFUSES on the 8086 today. The
 * reason is not that PWM is hard: it is that a DAC would give the same visible
 * LED brightness by a different mechanism, so a scope, a motor or an RC filter
 * would disagree with the lamp -- a substitution whose warning a learner cannot
 * act on. Genuine PWM has to switch the pin.
 *
 * A busy loop can switch the pin, and it costs the CPU: a `FOREVER` that fades
 * an LED can then do nothing else, where an STC12's PCA runs the duty in
 * hardware and the program carries on. The difference between those two is the
 * whole claim, so this file measures it instead of asserting it.
 *
 * NOTHING HERE CHANGES A SHIPPED PRESET. `DOSBOX8086_XT` has no PIC and its
 * PIT has no `irq` key, and adding one is a change to what every program on
 * that bench can observe (20h-21h stop being open bus), which is a decision
 * with a corpus run attached and not a side effect of a language feature.
 * These tests build their own config inline, exactly as the speaker's machine
 * test does, so the CAPABILITY is proved and the DECISION stays open.
 *
 * @module
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { DOSBOX8086_XT } from '../src/i8086-dos.js';
import { assemble } from '../src/i8086-asm.js';

/** The shipped bench plus the two lines an ISR needs. */
const XT_WITH_PIC = Object.freeze({
    ...DOSBOX8086_XT,
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },
        { kind: 'ppi', name: 'ppi1', at: 0x60 },
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },   // <- OUT0 -> IRQ0
        { kind: 'pcspeaker', name: 'spk', ppi: 'ppi1', pit: 'pit1' },
    ],
});

/** Bring up the 8259, point INT 08h at 0000:0400, start counter 0. */
const SETUP = (divisor, extra = '') => `
    CLI
    MOV AX, 0
    MOV DS, AX
    MOV WORD PTR [32], 400h       ; IVT entry 8 (IRQ0) -> 0000:0400
    MOV WORD PTR [34], 0
    ${extra}
    MOV AL, 11h
    OUT 20h, AL                   ; ICW1: edge triggered, ICW4 to follow
    MOV AL, 8
    OUT 21h, AL                   ; ICW2: IRQ0 becomes INT 08h
    MOV AL, 0
    OUT 21h, AL                   ; ICW3
    MOV AL, 1
    OUT 21h, AL                   ; ICW4: 8086 mode
    MOV AL, 0FEh
    OUT 21h, AL                   ; unmask IRQ0 and nothing else
    MOV AL, 36h
    OUT 43h, AL                   ; counter 0, mode 3, lobyte/hibyte
    MOV AL, ${divisor & 0xff}
    OUT 40h, AL
    MOV AL, ${(divisor >> 8) & 0xff}
    OUT 40h, AL
    STI
`;

const load = (config, main, isr) => {
    const m = new I8086Machine(config);
    m.mem.set(assemble(main, { variant: '80186' }).bytes, 0x100);
    m.mem.set(assemble(isr, { variant: '80186' }).bytes, 0x400);
    m.cpu.cs = 0; m.cpu.ip = 0x100; m.cpu.ss = 0; m.cpu.sp = 0xfffe;
    return m;
};

const COUNT_ISR = `
    PUSH AX
    INC WORD PTR [500h]
    MOV AL, 20h
    OUT 20h, AL                   ; EOI -- without it the PIC never re-arms
    POP AX
    IRET
`;

test('the shipped bench delivers NO timer interrupt, which is why setpwm refuses', () => {
    // A TRIPWIRE AS MUCH AS A TEST. If someone adds a PIC to DOSBOX8086_XT
    // this goes red, and it should: that change is the one that wants a corpus
    // run beside it, and it must not arrive as a quiet side effect.
    const m = load(DOSBOX8086_XT, SETUP(50) + 'SPIN:\n    JMP SPIN\n', COUNT_ISR);
    for (let i = 0; i < 200_000; i++) m.step();
    assert.equal(m.mem[0x500] | (m.mem[0x501] << 8), 0,
        'DOSBOX8086_XT has no 8259 and its PIT has no irq key: nothing can arrive');
});

test('with an 8259 and OUT0 wired, IRQ0 arrives and the ISR runs', () => {
    const m = load(XT_WITH_PIC, SETUP(50) + 'SPIN:\n    JMP SPIN\n', COUNT_ISR);
    for (let i = 0; i < 200_000; i++) m.step();
    const ticks = m.mem[0x500] | (m.mem[0x501] << 8);
    assert.ok(ticks > 1000, `expected thousands of ticks, got ${ticks}`);
    // The whole path is already built -- 8259, PIT OUT0, IVT, IF, EOI. What is
    // missing from the bench is two lines of config, not an implementation.
});

test('PWM from the tick hits the duty AND leaves the program running', () => {
    // The ISR owns the pin: it advances a phase 0..99 and drives P1.0 high
    // while phase < duty. The main loop does something else the whole time,
    // which is the property a busy-loop PWM cannot have.
    const PWM_ISR = `
    PUSH AX
    MOV AL, [511h]
    INC AL
    CMP AL, 100
    JB  KEEP
    MOV AL, 0
KEEP:
    MOV [511h], AL
    CMP AL, [510h]
    JB  ON
    MOV AL, [530h]
    AND AL, 0FEh
    JMP DRIVE
ON:
    MOV AL, [530h]
    OR  AL, 1
DRIVE:
    MOV [530h], AL                ; the port-A shadow, as the pin writes use
    OUT 60h, AL
    MOV AL, 20h
    OUT 20h, AL
    POP AX
    IRET
`;
    const measured = [];
    for (const duty of [0, 25, 50, 75, 100]) {
        const main = SETUP(50, `MOV AL, 80h
    OUT 63h, AL
    MOV BYTE PTR [510h], ${duty}
    MOV BYTE PTR [511h], 0`) + 'WORK:\n    INC WORD PTR [520h]\n    JMP WORK\n';
        const m = load(XT_WITH_PIC, main, PWM_ISR);

        // WEIGHTED BY CYCLES, NOT BY INSTRUCTIONS, and the difference is not
        // cosmetic: the ISR executes the same instruction count every tick
        // whatever the duty, and the pin holds its previous value while it
        // does, so an instruction-weighted average is biased low. Measured:
        // 25/50/75 read as 24.0/48.6/74.1 by instruction and 24.7/49.5/74.9 by
        // cycle. An LED integrates over TIME, so time is what must be counted.
        const STEPS = 400_000;
        let highCycles = 0, totalCycles = 0;
        for (let i = 0; i < STEPS; i++) {
            const before = m.cycles;
            const pin = m.chips.ppi1.outA & 1;
            m.step();
            const dt = m.cycles - before;
            if (i > STEPS / 4) { totalCycles += dt; if (pin) highCycles += dt; }
        }
        const pct = 100 * highCycles / totalCycles;
        measured.push({ duty, pct });

        assert.ok(Math.abs(pct - duty) <= 1.0,
            `duty ${duty}% measured ${pct.toFixed(1)}% — off by more than one point`);

        // AND THE PROGRAM KEPT RUNNING. This is the claim that separates an
        // ISR from a busy loop, and it is asserted rather than assumed.
        const work = m.mem[0x520] | (m.mem[0x521] << 8) | (m.mem[0x522] << 16);
        assert.ok(work > 5000,
            `the main loop only managed ${work} iterations — the ISR is starving it`);
    }

    // The endpoints must be EXACT, not merely close: 0% that leaks and 100%
    // that dips are the two failures a fade makes visible at the ends.
    assert.equal(measured[0].pct, 0, '0% must be fully off');
    assert.equal(measured[4].pct, 100, '100% must be fully on');
});
