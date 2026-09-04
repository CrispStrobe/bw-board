/**
 * reseat-baseline-6502.mjs — STEP ZERO of the reseat gate (ROADMAP §3.8.3).
 *
 * The reseat gate compares an ORIGINAL board's observable behaviour against a
 * reseated one. Before anything can be gated, the original's behaviour has to
 * be a READ artifact, not an unread golden file. lego-47's contract: "capture
 * the trace yourself and eyeball it before you gate anything against it."
 *
 * This captures the e4-via-blink baseline the honest way:
 *   1. read the shipped circuit  (bw-circuit-ui gallery/e4-via-blink.json)
 *   2. extract6502Machine(it)     -> the same MachineConfig the UI would run
 *   3. pair it with a program     (the circuit ships NO program; the baseline
 *      is circuit + program, and BOTH are written down here — a walking bit on
 *      VIA port B, the E4 lesson "Port B drives 8 LEDs")
 *   4. run it and record the CHANGE-SAMPLED port-B edge sequence
 *      (contract #1: sample on change, record (step, port, pins & dir))
 *
 * The circuit has no crystal the MAP grammar can read, so the extractor emits
 * no clockHz; the eater's 1 MHz is the documented baseline clock. That choice
 * only scales tMs — the STEP-indexed edge sequence below is clock-independent.
 *
 *   node scripts/reseat-baseline-6502.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extract6502Machine } from '../src/m6502-extract.js';
import { M6502Machine } from '../src/m6502-machine.js';

const here = dirname(fileURLToPath(import.meta.url));
const GALLERY = join(here, '..', '..', 'wt', 'i8086-ui-cui', 'gallery', 'e4-via-blink.json');

// ---- 1+2: the circuit, extracted -----------------------------------------
const circuit = JSON.parse(readFileSync(GALLERY, 'utf8'));
const cfg = extract6502Machine(circuit);
if (!cfg.ok) throw new Error('extract6502Machine failed: ' + (cfg.reasons || []).join('; '));
cfg.clockHz = 1_000_000; // no crystal in the drawn circuit; 1 MHz baseline (scales tMs only)

console.log('# e4-via-blink extracted config');
console.log('  regions:', JSON.stringify(cfg.regions));
console.log('  chips:  ', JSON.stringify(cfg.chips));
for (const n of cfg.notes || []) console.log('  note:   ', n);
// W65C22 register map off via1.at ($4000): ORB=+0, ORA=+1, DDRB=+2, DDRA=+3.
const VIA = cfg.chips.find((c) => c.kind === 'via').at;
const ORB = VIA, DDRB = VIA + 2;

// ---- 3: the program (walking bit on port B) ------------------------------
// The baseline is circuit + THIS program. A single bit marches across port B's
// eight LEDs; when it walks off the top it re-enters at bit 0. No switches on
// this board (E4 is "the first I/O chip"), so port B is the whole observable.
const lo = (a) => a & 0xff, hi = (a) => (a >> 8) & 0xff;
const prog = [
    0xa9, 0xff,               // 8000  LDA #$FF
    0x8d, lo(DDRB), hi(DDRB), // 8002  STA DDRB      ; port B all output
    0xa9, 0x01,               // 8005  LDA #$01      ; the walking bit
    // L1 = 8007
    0x8d, lo(ORB), hi(ORB),   // 8007  STA ORB       ; drive the LEDs
    0xa0, 0x00,               // 800A  LDY #$00      ; delay: 256 iters
    0xc8,                     // 800C  INY           ; L2
    0xd0, 0xfd,               // 800D  BNE L2        ; -3 -> 800C
    0x0a,                     // 800F  ASL A         ; march the bit left
    0xd0, 0xf5,               // 8010  BNE L1        ; -11 -> 8007 (bit still on)
    0xa9, 0x01,               // 8012  LDA #$01      ; walked off top -> re-enter
    0x4c, 0x07, 0x80,         // 8014  JMP L1        ; -> 8007
];

const rom = new Uint8Array(0x8000);      // regions: rom $8000-$FFFF (32 KB)
rom.set(prog, 0);                        // program at image offset 0 == $8000
rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;  // reset vector $FFFC/$FFFD -> $8000

// ---- 4: run + capture the change-sampled port-B trace --------------------
let step = 0;
const pin = new Array(8).fill(0);        // reconstruct the port-B byte from pins
let last = -1;
const trace = [];                        // { step, portB } on every net change
const m = new M6502Machine(cfg, {
    onPinChange: (name, level) => {
        const mo = /^via1\.PB(\d)$/.exec(name);
        if (!mo) return;
        pin[+mo[1]] = level;
        const b = pin.reduce((v, l, i) => v | (l << i), 0);
        if (b !== last) { trace.push({ step, portB: b }); last = b; }
    },
});
m.loadRom(rom);
m.reset();
const STEPS = 8000;
for (step = 1; step <= STEPS; step++) m.step();

// Coalesce to one row per step (a single STA can flip several pins in one
// instruction): keep the net port value at the end of each step.
const perStep = [];
for (const r of trace) {
    if (perStep.length && perStep[perStep.length - 1].step === r.step) perStep[perStep.length - 1].portB = r.portB;
    else perStep.push({ ...r });
}

console.log(`\n# change-sampled port-B trace (${perStep.length} edges over ${STEPS} steps)`);
console.log('  step   portB   LEDs');
for (const r of perStep.slice(0, 20)) {
    const bits = r.portB.toString(2).padStart(8, '0').replace(/0/g, '.').replace(/1/g, '#');
    console.log(`  ${String(r.step).padStart(5)}   0x${r.portB.toString(16).padStart(2, '0')}    ${bits}`);
}
if (perStep.length > 20) console.log(`  ... (${perStep.length - 20} more; pattern repeats)`);

// The eyeball check: the distinct values, in the order first seen.
const order = [];
for (const r of perStep) if (!order.includes(r.portB)) order.push(r.portB);
console.log('\n# distinct port-B values, in order of first appearance:');
console.log('  ' + order.map((v) => '0x' + v.toString(16).padStart(2, '0')).join(' -> '));
