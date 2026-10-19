/**
 * How fast does this thing actually run?
 *
 * "Fast enough to run PC software" is a claim with a unit, and the unit is
 * not instructions per second — it is EMULATED CYCLES PER WALL SECOND divided
 * by the clock of the machine being modelled. A 4.77 MHz XT that runs at 1.0x
 * is real time: a program that took ten seconds on the hardware takes ten
 * seconds here, and every timing loop, every BIOS tick and every serial baud
 * rate is right by construction rather than by fudging.
 *
 * Instructions per second is reported too, because it is the number people
 * expect, but it is the weaker one: it moves with the instruction mix and
 * says nothing about whether a period-correct program will behave.
 *
 * THREE WORKLOADS, and the spread between them is the interesting part rather
 * than any single number:
 *
 *   core      a bare I8086 over flat memory, no chips, no machine. The
 *             ceiling — what the decoder and the ALU cost with nothing else
 *             in the way.
 *   machine   the same work through I8086Machine: region decode on every
 *             memory access, port decode, chip advance, interrupt poll.
 *             The difference from `core` is what the bus costs.
 *   boot      a real MS-DOS 2.0 boot off a real uPD765 over DMA. Mixed
 *             everything: string ops, far calls, disk, video, interrupts.
 * SINGLE RUN, AND THE VARIANCE IS REAL. Back-to-back runs of `core` on an
 * idle box have measured 18.8x and 24.5x — a 30% spread from JIT warm-up and
 * whatever else the machine is doing. Treat a number here as an order of
 * magnitude, not a measurement: it answers "is this real-time or nowhere near
 * it", and it will not tell you whether a change cost you 10%. Anyone wanting
 * that needs repeated runs and a median, which this deliberately does not
 * pretend to do.
 *
 * Run: node scripts/bench-i8086.mjs [--json]
 */
import { I8086 } from '../src/i8086.js';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';
import { findMsdosFiles, build } from './build-dos-image.mjs';

const XT_HZ = 4_772_727;
const json = process.argv.includes('--json');

/** Wall-clock a function, in seconds. */
function timed(fn) {
    const t0 = process.hrtime.bigint();
    const r = fn();
    return { secs: Number(process.hrtime.bigint() - t0) / 1e9, ...r };
}

/** A mix that is not a `nop` loop: ALU, memory, branch, string, stack. */
const MIX = [
    0xb8, 0x34, 0x12,             // mov ax, 1234h
    0x01, 0xd8,                   // add ax, bx
    0x8b, 0x1e, 0x00, 0x20,       // mov bx, [2000h]
    0x89, 0x1e, 0x02, 0x20,       // mov [2002h], bx
    0x50, 0x58,                   // push ax / pop ax
    0xf7, 0xe3,                   // mul bx
    0x81, 0xff, 0x00, 0x01,       // cmp di, 0100h
    0x74, 0x02,                   // je +2
    0x47, 0x47,                   // inc di / inc di
    0xa4,                         // movsb
    0xe9, 0xe4, 0xff,             // jmp back to the top
];

function benchCore(instructions) {
    const mem = new Uint8Array(1 << 20);
    const cpu = new I8086({
        read: (a) => mem[a & 0xfffff],
        write: (a, v) => { mem[a & 0xfffff] = v & 0xff; },
        in: () => 0xff, out: () => {},
    });
    cpu.reset();
    cpu.cs = 0x1000; cpu.ip = 0; cpu.ds = 0x2000; cpu.es = 0x3000; cpu.ss = 0x4000;
    cpu.sp = 0xfffe; cpu.si = 0; cpu.di = 0;
    mem.set(MIX, 0x10000);
    return timed(() => {
        let cycles = 0;
        for (let i = 0; i < instructions; i++) cycles += cpu.step();
        return { instructions, cycles };
    });
}

function benchMachine(instructions) {
    const m = new I8086Machine({
        clockHz: XT_HZ,
        regions: [{ kind: 'ram', start: 0, end: 0x9ffff }, { kind: 'rom', start: 0xf0000, end: 0xfffff }],
        chips: [
            { kind: 'pic', name: 'pic1', at: 0x20 },
            { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },
            { kind: 'ppi', name: 'ppi1', at: 0x60 },
            { kind: 'cga', name: 'cga1', at: 0x3d0 },
        ],
    });
    m.mem.set(MIX, 0x10000);
    m.cpu.reset();
    m.cpu.cs = 0x1000; m.cpu.ip = 0; m.cpu.ds = 0x2000; m.cpu.es = 0x3000;
    m.cpu.ss = 0x4000; m.cpu.sp = 0xfffe;
    const before = m.cycles;
    return timed(() => {
        for (let i = 0; i < instructions; i++) m.step();
        return { instructions, cycles: m.cycles - before };
    });
}

const rows = [];
const core = benchCore(3_000_000);
rows.push(['core', core]);
const mach = benchMachine(3_000_000);
rows.push(['machine', mach]);

// A real boot, if the MS-DOS binaries are present. This is the workload that
// matters: string moves, far calls, disk through the service layer, video
// writes, and a timer interrupt firing throughout. The synthetic mixes above
// bracket it; this is the one a user would recognise.
let boot = null;
const found = findMsdosFiles();
if (found.ok) {
    const built = build(found.files);
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m, { disk: built.image }).install();
    dos.type('\r\rdir\r');
    dos.loadBoot(built.image.subarray(0, 512), 0x00);
    boot = timed(() => {
        let n = 0;
        const before = m.cycles;
        while (n < 400_000) { dos.step(); n++; }
        return { instructions: n, cycles: m.cycles - before };
    });
    rows.push(['boot', boot]);
}

const out = rows.map(([name, r]) => ({
    workload: name,
    instructions: r.instructions,
    seconds: +r.secs.toFixed(3),
    mips: +(r.instructions / r.secs / 1e6).toFixed(2),
    cyclesPerSec: Math.round(r.cycles / r.secs),
    xRealXT: +(r.cycles / r.secs / XT_HZ).toFixed(1),
}));

// ---------------------------------------------------------------------------
// vs CORE: THE ONLY COLUMN THAT SURVIVES A DIFFERENT DAY.
//
// `core` runs the bare I8086 over flat memory and touches NO machine code at
// all, so it is a pure BOX-LOAD PROXY. That makes machine/core and boot/core
// the only figures here that mean anything across runs.
//
// This column exists because its absence produced a wrong answer. Two sets of
// measurements a few hours apart showed core 8.70x -> 14.50x, machine
// 2.90 -> 4.40 and boot 1.00 -> 1.50, which reads as "everything got 1.5x
// faster" and is not what happened: the BOX got 1.67x quieter, and normalised
// against it the machine layer had got about 10% WORSE -- with a 2x page-table
// optimisation already in. Reporting the absolutes alone would have claimed an
// improvement and been wrong about the DIRECTION.
//
// So the ratio is printed beside the absolutes rather than left for the reader
// to compute, because the reader will not, and the two numbers they compare
// will come from two different days.
// ---------------------------------------------------------------------------
const coreRow = out.find((r) => r.workload === 'core');
for (const r of out) {
    r.vsCore = coreRow && coreRow.xRealXT > 0
        ? +(r.xRealXT / coreRow.xRealXT).toFixed(3)
        : null;
}

if (json) { console.log(JSON.stringify(out, null, 2)); }
else {
    console.log(`\nAgainst a 4.772727 MHz IBM XT. 1.0x = real time.\n`);
    console.log('workload    instructions      MIPS   emulated cycles/s     vs real XT   vs core');
    for (const r of out) {
        console.log(
            `${r.workload.padEnd(11)} ${String(r.instructions).padStart(11)}  ${String(r.mips).padStart(8)}   `
            + `${String(r.cyclesPerSec).padStart(17)}   ${String(r.xRealXT + 'x').padStart(12)}`
            + `   ${String(r.vsCore ?? '-').padStart(7)}`);
    }
    console.log(
        '\nCOMPARE THE LAST COLUMN, NOT THE OTHERS. `core` touches no machine code,\n'
        + 'so it is a load proxy: on a busier box every absolute here falls together.\n'
        + 'machine/core and boot/core are the only figures that survive a different day.');
    if (!boot) console.log(`\nboot: NOT MEASURED — ${found.reason}`);
    console.log();
}
