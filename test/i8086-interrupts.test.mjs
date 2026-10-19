// The two interrupt behaviours the vector suite cannot reach. Its own README
// says the interrupt and trap flags are not exercised, so these are verified
// behaviourally or not at all: the one-instruction shadow after a segment
// load, and the 8086's mid-REP segment-override erratum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086 } from '../src/i8086.js';
import { I8086Machine } from '../src/i8086-machine.js';

const IF = 0x0200;

/** A bare core over a flat megabyte, with a controllable interrupt line. */
function core(code, { cs = 0x1000, ip = 0, pending = () => false } = {}) {
    const mem = new Uint8Array(1 << 20);
    const cpu = new I8086({
        read: (a) => mem[a & 0xfffff],
        write: (a, v) => { mem[a & 0xfffff] = v & 0xff; },
        in: () => 0xff,
        out: () => {},
        intPending: pending,
    });
    cpu.reset();
    cpu.cs = cs; cpu.ip = ip; cpu.flags |= IF;
    mem.set(code, (cs << 4) + ip);
    return { cpu, mem };
}

test('a segment-register load blocks the next interrupt, and only the next one', () => {
    // mov ss, ax ; mov sp, 0400h ; nop
    const { cpu } = core([0x8e, 0xd0, 0xbc, 0x00, 0x04, 0x90]);
    cpu.ax = 0x2000;
    assert.ok(cpu.canTakeInterrupt(), 'open before the load');

    cpu.step();                                  // mov ss, ax
    assert.equal(cpu.ss, 0x2000);
    assert.ok(!cpu.canTakeInterrupt(),
        'SHUT: SS is new and SP is still old, and an interrupt here would push '
        + 'three words into nowhere');

    cpu.step();                                  // mov sp, 0400h — the pair completes
    assert.equal(cpu.sp, 0x0400);
    assert.ok(cpu.canTakeInterrupt(), 'open again: the shadow lasted exactly one instruction');
});

test('every segment-register load arms it — POP as well as MOV', () => {
    for (const [name, code, setup] of [
        ['pop es', [0x07], () => {}],
        ['pop ss', [0x17], () => {}],
        ['pop ds', [0x1f], () => {}],
        ['pop cs', [0x0f], () => {}],
        ['mov sreg', [0x8e, 0xd8], () => {}],
    ]) {
        const { cpu } = core(code);
        cpu.ss = 0x3000; cpu.sp = 0x0100;
        setup(cpu);
        cpu.step();
        assert.ok(!cpu.canTakeInterrupt(), `${name} arms the shadow`);
    }
});

test('LES and LDS do NOT arm it, and the reason is not laziness', () => {
    // The shadow exists so `mov ss,ax` / `mov sp,imm` cannot be split. LES and
    // LDS load DS or ES, which can never be half of that pair, so there is no
    // behaviour to protect — and no evidence they are shadowed. Absent
    // evidence, the narrower answer, recorded as a test so it is a decision
    // rather than an oversight.
    const { cpu } = core([0xc4, 0x06, 0x00, 0x20]);   // les ax, [2000h]
    cpu.step();
    assert.ok(cpu.canTakeInterrupt(), 'les leaves the window open');
});

test('a REP is interruptible between iterations, and rewinds to the REP prefix', () => {
    // f3 a4 = rep movsb, CX = 4. The interrupt line goes high after the
    // first iteration.
    let iterations = 0;
    const { cpu, mem } = core([0xf3, 0xa4], { pending: () => iterations++ >= 0 });
    cpu.ds = 0x2000; cpu.es = 0x3000; cpu.si = 0; cpu.di = 0; cpu.cx = 4;
    for (let i = 0; i < 4; i++) mem[(0x2000 << 4) + i] = 0xa0 + i;

    cpu.step();
    assert.equal(cpu.cx, 3, 'exactly one iteration ran');
    assert.equal(cpu.ip, 0, 'IP rewound to the REP prefix, so the instruction restarts');
    assert.equal(cpu.repInterrupted, 1, 'and the cut is counted, because it is invisible otherwise');
    assert.equal(mem[(0x3000 << 4)], 0xa0);
    assert.equal(mem[(0x3000 << 4) + 1], 0x00, 'the rest has not been copied yet');
});

test('the erratum: an override BEFORE the REP is lost on resumption', () => {
    // 2e f3 a4 = CS: rep movsb. The source should be CS:SI throughout. It is
    // not: when the interrupt cuts the REP, the 8086 saves the address of the
    // REP PREFIX, so resumption re-fetches `f3 a4` and the CS override is
    // gone. The remaining bytes come from DS.
    //
    // This is a bug in the chip, reproduced rather than smoothed over,
    // because a program that hits it on hardware must hit it here too.
    let cut = false;
    const { cpu, mem } = core([0x2e, 0xf3, 0xa4], {
        pending: () => { const p = !cut; cut = true; return p; },
    });
    cpu.ds = 0x2000; cpu.es = 0x3000; cpu.si = 0; cpu.di = 0; cpu.cx = 3;
    // Distinct patterns so the destination says which segment it came from.
    for (let i = 0; i < 3; i++) {
        mem[(0x1000 << 4) + 0x100 + i] = 0xc0 + i;      // in CS (the override)
        mem[(0x2000 << 4) + 0x100 + i] = 0xd0 + i;      // in DS (the default), SAME offset
    }
    cpu.si = 0x100;                                      // same offset in both

    cpu.step();                                          // one iteration, then cut
    assert.equal(cpu.ip, 1, 'rewound to the REP at offset 1, NOT to the override at 0');
    assert.equal(mem[(0x3000 << 4)], 0xc0, 'the first byte came from CS, as written');

    cpu.step();                                          // resume — override gone
    cpu.step();
    assert.equal(mem[(0x3000 << 4) + 1], 0xd1,
        'the second byte came from DS: the override did not survive the interrupt');
    assert.equal(mem[(0x3000 << 4) + 2], 0xd2);
});

test('prefix ORDER decides it: an override after the REP survives', () => {
    // f3 2e a4 rewinds to the f3, so the 2e is re-fetched with it.
    let cut = false;
    const { cpu, mem } = core([0xf3, 0x2e, 0xa4], {
        pending: () => { const p = !cut; cut = true; return p; },
    });
    cpu.ds = 0x2000; cpu.es = 0x3000; cpu.di = 0; cpu.cx = 3;
    for (let i = 0; i < 3; i++) {
        mem[(0x1000 << 4) + 0x100 + i] = 0xc0 + i;
        mem[(0x2000 << 4) + 0x100 + i] = 0xd0 + i;
    }
    cpu.si = 0x100;

    cpu.step();
    assert.equal(cpu.ip, 0, 'rewound to the REP, which is the first byte here');
    cpu.step(); cpu.step();
    assert.equal(mem[(0x3000 << 4) + 1], 0xc1, 'still CS: the override sits after the rewind point');
    assert.equal(mem[(0x3000 << 4) + 2], 0xc2);
});

test('with no machine attached a REP runs to completion, so the vectors are untouched', () => {
    // intPending defaults to false. This is why all 646,000 vectors still
    // pass: the suite executes one instruction and expects the whole REP.
    const { cpu, mem } = core([0xf3, 0xa4]);
    cpu.ds = 0x2000; cpu.es = 0x3000; cpu.si = 0; cpu.di = 0; cpu.cx = 5;
    for (let i = 0; i < 5; i++) mem[(0x2000 << 4) + i] = i + 1;
    cpu.step();
    assert.equal(cpu.cx, 0, 'the whole thing, in one step');
    assert.equal(cpu.repInterrupted, 0);
    for (let i = 0; i < 5; i++) assert.equal(mem[(0x3000 << 4) + i], i + 1);
});

test('the machine layer honours the shadow when it delivers', () => {
    const m = new I8086Machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [{ kind: 'pic', name: 'pic1', at: 0x20 }],
    });
    // mov ss, ax ; mov sp, 0400h ; jmp $
    const rom = new Uint8Array(0x8000);
    rom.set([0xb8, 0x00, 0x20, 0x8e, 0xd0, 0xbc, 0x00, 0x04, 0xeb, 0xfe], 0);
    rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    m.loadRom(rom);
    m.reset();
    m.step();                                    // the far jump
    m.cpu.flags |= IF;
    // A real ISR at 0000:0100, and vector 8 pointing at it.
    m.mem.set([0xfe, 0x06, 0x00, 0x02, 0xb0, 0x20, 0xe6, 0x20, 0xcf], 0x0100);
    m.mem[0x20] = 0x00; m.mem[0x21] = 0x01; m.mem[0x22] = 0x00; m.mem[0x23] = 0x00;
    m._out(0x20, 0x13); m._out(0x21, 0x08); m._out(0x21, 0x01); m._out(0x21, 0xfe);

    m.step();                                    // mov ax, 2000h
    m.step();                                    // mov ss, ax   -> shadow armed
    assert.ok(!m.cpu.canTakeInterrupt(), 'the machine can see the shadow');
    m.chips.pic1.setIRQ(0, 1);                   // the interrupt arrives NOW

    m.step();
    assert.equal(m.mem[0x0200], 0, 'not delivered: the shadow held it off');
    assert.equal(m.cpu.sp, 0x0400, 'and the pair completed');

    m.step();
    assert.equal(m.mem[0x0200], 1, 'delivered on the very next instruction');
});
