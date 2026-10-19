// WAI fast-forward: a parked 65C02 advanced ONE cycle per step() call —
// slower than executing — so an idling firmware ground the machine loop
// harder than a spinning one. The machine now jumps a waiting CPU to the
// nearest time-driven wake horizon (VIA T1/T2, RIOT timer, bit-bang
// events, the vga phase edge), and any advancing chip that cannot name
// its horizon vetoes the jump: a skipped event is a correctness bug, a
// crawl is only slow.
//
// The firmware idiom under test is the native 65C02 one the C target
// emits: T1 free-running at 1 ms, T1 enabled in IER so the IRQ line
// asserts, I flag left SET from reset — WAI wakes on the line WITHOUT
// vectoring, execution resumes after the WAI. No vector table exists in
// the image; a taken interrupt would jump through $FFFE into zeros and
// the wake count would collapse, so the count doubling as the
// no-vectoring proof is deliberate.
//
// Deterministic (step calls vs cycles), never wall-clock — three machines
// have shown time budgets fire falsely under load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { M6502Machine, EATER6502 } from '../src/m6502-machine.js';

// org $8000 — T1 free-run with period 1000 cycles (1 ms at 1 MHz):
// latch = 998, ACR=$40, IER=$C0; loop: INC $10, read T1C-L (clears
// IFR6, drops the line), WAI, repeat. (First cut jumped to $8012 —
// an RTS tail — and each wake detoured 130 cycles re-running setup;
// the wake COUNT stayed 1:1, only the period stretched. Check targets.)
const PROG = [
    0xa9, 0xe6,             // LDA #$E6      (998 & $FF)
    0x8d, 0x04, 0x60,       // STA $6004     T1 latch low
    0xa9, 0x40,             // LDA #$40
    0x8d, 0x0b, 0x60,       // STA $600B     ACR: T1 free-run
    0xa9, 0x03,             // LDA #$03      (998 >> 8)
    0x8d, 0x05, 0x60,       // STA $6005     T1 high — timer starts
    0xa9, 0xc0,             // LDA #$C0
    0x8d, 0x0e, 0x60,       // STA $600E     IER: set + T1
    // loop:
    0xe6, 0x10,             // INC $10       one wake = one count
    0xad, 0x04, 0x60,       // LDA $6004     read T1C-L clears IFR6
    0xcb,                   // WAI
    0x4c, 0x14, 0x80        // JMP loop ($8014)
];

const boot = () => {
    const m = new M6502Machine(EATER6502, {});
    m.loadRom(PROG);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.reset();
    return m;
};

test('a parked 65C02 jumps to the next T1 expiry instead of crawling', () => {
    const m = boot();
    let stepCalls = 0;
    const orig = m.cpu.step.bind(m.cpu);
    m.cpu.step = () => { stepCalls++; return orig(); };
    m.advanceToMs(100); // 100,000 cycles at 1 MHz
    assert.ok(m.cycles >= 100_000, `time advanced (${m.cycles} cycles)`);
    // parked: ~6 loop instructions + a handful of parked steps per ms.
    // crawling would be ~1000 step calls per ms of park alone.
    assert.ok(stepCalls < m.cycles / 20,
        `parked, not crawling: ${stepCalls} step calls over ${m.cycles} cycles`);
});

test('each wake resumes AFTER the WAI, once per millisecond, unvectored', () => {
    const m = boot();
    m.advanceToMs(100);
    const wakes = m.mem[0x10];
    // ~100 T1 expiries in 100 ms. One INC per wake proves the ISR-less
    // wake resumed at the instruction after WAI (a vectored interrupt
    // would leave this loop through $FFFE = $0000 and stop counting; a
    // fall-through without a wake would overcount wildly).
    assert.ok(wakes >= 97 && wakes <= 103,
        `one wake per T1 expiry (${wakes} wakes in 100 ms)`);
});

test('the veto: an advancing chip without a horizon forces the crawl', () => {
    const m = boot();
    m.chips.opaque = { advance () {} }; // no nextWake
    let stepCalls = 0;
    const orig = m.cpu.step.bind(m.cpu);
    m.cpu.step = () => { stepCalls++; return orig(); };
    m.advanceToMs(10);
    // crawling: every parked cycle is a step call.
    assert.ok(stepCalls > m.cycles / 5,
        `the veto crawls (${stepCalls} step calls over ${m.cycles} cycles)`);
    // and correctness holds either way
    assert.ok(m.mem[0x10] >= 9 && m.mem[0x10] <= 11, `wakes still exact (${m.mem[0x10]})`);
});
