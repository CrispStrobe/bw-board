// The reseat gate (ROADMAP §3.8.3): an example drawn around one CPU, reseated
// onto an 8086 in the SCHEMATIC, must still be the same board — same program,
// same observable behaviour. This test drives the gate through the two cases
// that prove it works: the real pair MATCHES, and a deliberately wrong reseat
// goes RED. "A gate that has never failed is not known to work" — so the RED
// case is written FIRST-class here, not as an afterthought.
//
// The pair: e4-via-blink (6502 / W65C22 port B, the shipped original) against
// BLINK8086 (8086 / 8255 port B, the minimal-GPIO 8086). Both walk a single bit
// across eight LEDs; the gate compares the EDGE SEQUENCE, family-agnostic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reseatGate, compareObservables } from '../src/reseat-gate.js';
import { extract6502Machine } from '../src/m6502-extract.js';
import { M6502Machine } from '../src/m6502-machine.js';
import { I8086Machine, BLINK8086 } from '../src/i8086-machine.js';

const here = dirname(fileURLToPath(import.meta.url));
const GALLERY = join(here, '..', '..', 'wt', 'i8086-ui-cui', 'gallery', 'e4-via-blink.json');
const BLINK_ROM = new Uint8Array(readFileSync(join(here, '..', 'rom', 'blink-demo.bin')));

// ---- the original: e4-via-blink (6502), paired with the baseline program ----
// The circuit ships no program; the baseline (see RESEAT-GATE.md STEP ZERO and
// scripts/reseat-baseline-6502.mjs) pairs it with this walking-bit program.
function build6502Original() {
    const cfg = extract6502Machine(JSON.parse(readFileSync(GALLERY, 'utf8')));
    assert.ok(cfg.ok, 'e4-via-blink extracts to a machine');
    cfg.clockHz = 1_000_000; // no crystal in the drawn circuit; 1 MHz baseline
    const via = cfg.chips.find((c) => c.kind === 'via').at; // ORB=+0, DDRB=+2
    const lo = (a) => a & 0xff, hi = (a) => (a >> 8) & 0xff;
    const prog = [
        0xa9, 0xff, 0x8d, lo(via + 2), hi(via + 2), // LDA #$FF ; STA DDRB
        0xa9, 0x01,                                 // LDA #$01  (walking bit)
        0x8d, lo(via), hi(via),                     // L1: STA ORB
        0xa0, 0x00, 0xc8, 0xd0, 0xfd,               // LDY #0 ; L2: INY ; BNE L2
        0x0a, 0xd0, 0xf5,                           // ASL A ; BNE L1
        0xa9, 0x01, 0x4c, 0x07, 0x80,               // LDA #$01 ; JMP L1 ($8007)
    ];
    const rom = new Uint8Array(0x8000);
    rom.set(prog, 0);
    rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80; // reset vector -> $8000
    const m = new M6502Machine(cfg);
    m.loadRom(rom);
    m.reset();
    return m;
}
const read6502PortB = (m) => m.chips.via1._pbOut() & m.chips.via1.ddrb;

// ---- the reseat: BLINK8086 (8086 / 8255), LEDs on port B --------------------
function build8086Reseat() {
    const m = new I8086Machine(BLINK8086);
    m.loadRom(BLINK_ROM);
    m.reset();
    m.chips.ppi1.setInputPort('c', 0xff); // switches open -> LEDs = the walking bit
    return m;
}
const read8086PortB = (m) => m.chips.ppi1.outB & m.chips.ppi1.dirB;
// A WRONG reseat wires the LEDs to port A while the program drives port B: the
// program runs and nothing lights. The gate reads where the LEDs ARE (port A).
const read8086PortA = (m) => m.chips.ppi1.outA & m.chips.ppi1.dirA;

// Step budgets: enough for a full 8-position walk on each board (6502 ~3.6k to
// reach 0x80, 8086 ~58k; both measured, headroom added).
const STEPS_6502 = 6000;
const STEPS_8086 = 72000;

test('GREEN: e4-via-blink (6502) and BLINK8086 (8086) walk the SAME port-B sequence', () => {
    const r = reseatGate(
        { build: build6502Original, read: read6502PortB, steps: STEPS_6502 },
        { build: build8086Reseat, read: read8086PortB, steps: STEPS_8086 },
    );
    assert.equal(r.verdict, 'MATCH', r.reason);
    assert.deepEqual(r.expected, [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
        'the shared shape is the walking bit');
    assert.deepEqual(r.actual, r.expected);
});

test('RED: LEDs mis-wired to port A (program drives B) — the gate FAILS', () => {
    const r = reseatGate(
        { build: build6502Original, read: read6502PortB, steps: STEPS_6502 },
        { build: build8086Reseat, read: read8086PortA, steps: STEPS_8086 }, // wrong port
    );
    assert.equal(r.verdict, 'DIFFER', 'a port mismatch MUST fail the gate (§ the one invariant)');
    assert.equal(r.actual.length, 0, 'nothing lights on the mis-wired port');
    assert.match(r.reason, /NO edges|drives a port/);
});

test('the gate drops a leading all-dark settle edge by default, keeps it on demand', () => {
    // Configuring a port as output before the first data write is one all-dark
    // edge — an equivalent, not a mismatch.
    const withSettle = [{ step: 1, value: 0x00 }, { step: 5, value: 0x01 }, { step: 9, value: 0x02 }];
    const without = [{ step: 3, value: 0x01 }, { step: 7, value: 0x02 }];
    assert.equal(compareObservables(withSettle, without).match, true, 'settle edge ignored by default');
    assert.equal(compareObservables(withSettle, without, { keepLeadingSettle: true }).match, false,
        'timing-strict keeps the settle edge and they differ');
});
