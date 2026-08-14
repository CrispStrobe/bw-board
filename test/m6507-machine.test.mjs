/**
 * 6507SBC machine: R6507 + 6532 RIOT + 4K ROM.
 * Smoke tests with a hand-assembled blink ROM (RIOT timer polled,
 * LED on PB0, button on PA7).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M6507Machine, SBC6507 } from '../src/m6507-machine.js';

test('6507SBC: config sanity', () => {
    assert.equal(SBC6507.clockHz, 1_000_000);
    const m = new M6507Machine();
    assert.ok(m.riot);
    assert.ok(m.cpu);
});

test('6507SBC: ROM at $1000, RIOT RAM at $0000, mirroring', () => {
    const m = new M6507Machine();
    // Write to RIOT RAM
    m.riot.write(0x00, 0xaa);          // RAM[0]
    assert.equal(m._read(0x0000), 0xaa, 'RIOT RAM at $0000');
    // Same address mirrored (A12=0, only low 8 bits matter for RIOT)
    assert.equal(m._read(0x0100), 0xaa, 'mirrors at $0100');
    assert.equal(m._read(0x0200), 0xaa, 'mirrors at $0200');
    // ROM
    m.rom[0] = 0x42;
    assert.equal(m._read(0x1000), 0x42, 'ROM at $1000');
    // ROM writes vanish
    m._write(0x1000, 0xff);
    assert.equal(m._read(0x1000), 0x42, 'ROM is read-only');
});

test('6507SBC: address masking — $FFFC maps to $1FFC', () => {
    const m = new M6507Machine();
    // Set up reset vector at $1FFC (= $FFFC masked)
    m.rom[0x0ffc] = 0x00;   // low byte → $F000 → maps to $1000
    m.rom[0x0ffd] = 0xf0;   // high byte
    // Put a NOP at ROM start
    m.rom[0x0000] = 0xea;   // NOP
    m.rom[0x0001] = 0xdb;   // STP
    m.reset();
    assert.equal(m.cpu.pc & 0x1fff, 0x1000, 'PC points into ROM');
    m.step();  // NOP
    m.step();  // STP
    assert.equal(m.cpu.stopped, true);
});

// Hand-assembled blink ROM for the 6507SBC:
// RIOT register addresses (RS=A7=1, within the A12=0 half):
//   $82 = PB (ORB, A1=1 A0=0)
//   $83 = DDRB (A1=1 A0=1)
//   $96 = TIM64T (A4=1, A2=1, A1:A0=10 → /64 prescaler)
//   $84 = timer read (A2=1, A0=0)
//   $85 = interrupt flags read (A2=1, A0=1)
//
// Assembled at $F000 (6502 address), which maps to $1000 in 8K space.
// All absolute addresses in the ROM use the $F0xx form so the 6507's
// mask transparently maps them.
//
// Program:
//   $F000: LDA #$01       A9 01         ; PB0 mask
//   $F002: STA $0083      8D 83 00      ; DDRB = PB0 output
//   blink:
//   $F005: LDA $0082      AD 82 00      ; read PB
//   $F008: EOR #$01       49 01         ; toggle PB0
//   $F00A: STA $0082      8D 82 00      ; write PB
//   $F00D: LDA #$F9       A9 F9         ; 249 → (249+1)*64 = 16000 cycles = 16ms
//   $F00F: STA $0096      8D 96 00      ; TIM64T
//   wait:
//   $F012: LDA $0085      AD 85 00      ; read interrupt flags
//   $F015: BPL wait       10 FB         ; bit 7 = timer flag, loop until set
//   $F017: JMP $F005      4C 05 F0      ; back to blink
//
// Timer: latch=249, prescaler=/64 → (249+1)*64 = 16000 cycles = 16.0 ms
function makeBlinkRom() {
    const rom = new Uint8Array(4096);
    const code = [
        0xa9, 0x01, 0x8d, 0x83, 0x00,       // LDA #$01, STA $0083 (DDRB)
        0xad, 0x82, 0x00,                     // LDA $0082 (PB)
        0x49, 0x01,                            // EOR #$01
        0x8d, 0x82, 0x00,                     // STA $0082 (PB)
        0xa9, 0xf9,                            // LDA #$F9 (249)
        0x8d, 0x96, 0x00,                     // STA $0096 (TIM64T)
        0xad, 0x85, 0x00,                     // wait: LDA $0085 (flags)
        0x10, 0xfb,                            // BPL wait
        0x4c, 0x05, 0xf0,                     // JMP $F005 (blink)
    ];
    rom.set(code, 0); // at offset 0 = $F000
    // Reset vector at $FFFC → $F000 (offset 0x0FFC in ROM)
    rom[0x0ffc] = 0x00;
    rom[0x0ffd] = 0xf0;
    return rom;
}

test('6507SBC: blink ROM toggles riot.PB0 on RIOT timer grid', () => {
    const events = [];
    const m = new M6507Machine(SBC6507, {
        onPinChange: (pin, level, tMs) => events.push({ pin, level, tMs }),
    });
    m.loadRom(makeBlinkRom());
    m.reset();
    m.advanceToMs(100); // ~100 ms should produce ~6 toggle edges

    // First event: DDRB write seeds PB0 at level 0
    const pb0 = events.filter((e) => e.pin === 'riot.PB0');
    assert.ok(pb0.length >= 5, `expected 5+ PB0 edges, got ${pb0.length}`);

    // Sequence: DDRB seed (PB0=0 at ~0.013ms), first toggle to 1 (~0.021ms),
    // then after each 16ms timer period: toggle 0, 1, 0, 1...
    // The first two events happen within 0.05ms; the timer-paced toggles
    // start at ~16ms. Filter to the timer-paced edges.
    const toggles = pb0.filter((e) => e.tMs > 1.0);
    assert.ok(toggles.length >= 4, `expected 4+ timer-paced toggles, got ${toggles.length}`);
    // First timer-paced toggle: the code read PB (was 1 from initial write),
    // EOR → 0, so first timer-paced edge is level 0.
    for (let i = 0; i < Math.min(4, toggles.length); i++) {
        assert.equal(toggles[i].level, i % 2 === 0 ? 0 : 1,
            `toggle ${i} expected ${i % 2 === 0 ? 0 : 1}`);
    }

    // Timer period: (249+1)*64 = 16000 cycles = 16.0 ms at 1 MHz
    const periodMs = 16.0;
    if (toggles.length >= 3) {
        const t0 = toggles[0].tMs;
        for (let i = 1; i < Math.min(5, toggles.length); i++) {
            const expected = t0 + i * periodMs;
            const delta = Math.abs(toggles[i].tMs - expected);
            assert.ok(delta < 0.5, `toggle ${i} at ${toggles[i].tMs.toFixed(2)}ms, expected ~${expected.toFixed(2)}ms (off by ${delta.toFixed(2)}ms)`);
        }
    }
});

test('6507SBC: button on PA7 — setInput changes port read', () => {
    const m = new M6507Machine();
    m.loadRom(new Uint8Array(4096));
    // PA7 defaults high (input, pullup)
    assert.equal(m._read(0x80) & 0x80, 0x80, 'PA7 high by default');
    // Press button (active-low)
    m.riot.setInput('a', 7, 0);
    assert.equal(m._read(0x80) & 0x80, 0x00, 'PA7 low when pressed');
    // Release
    m.riot.setInput('a', 7, 1);
    assert.equal(m._read(0x80) & 0x80, 0x80, 'PA7 high when released');
});

test('6507SBC: no IRQ — RIOT timer flag does not interrupt CPU', () => {
    const m = new M6507Machine();
    const rom = new Uint8Array(4096);
    // Code: enable timer IRQ in RIOT, start timer, then NOPs
    rom.set([
        0xa9, 0x02,                     // LDA #$02
        0x8d, 0x9c, 0x00,               // STA $009C (TIM1T with IRQ enable, A3=1)
        0x58,                            // CLI (enable interrupts at CPU level)
        0xea, 0xea, 0xea, 0xea,         // NOP × 4
        0xea, 0xea, 0xea, 0xea,         // NOP × 4
        0xea, 0xea, 0xea, 0xea,         // NOP × 4
        0xdb,                            // STP
    ], 0);
    rom[0x0ffc] = 0x00; rom[0x0ffd] = 0xf0; // reset → $F000
    // IRQ vector would be at $FFFE → $1FFE
    rom[0x0ffe] = 0x00; rom[0x0fff] = 0xf0; // IRQ handler (never reached)
    m.loadRom(rom);
    m.reset();
    m.advanceToMs(1);
    // RIOT timer should have fired, but 6507 has no IRQ pin
    assert.equal(m.riot.timerFlag, true, 'timer fired');
    assert.equal(m.riot.irqAsserted, true, 'RIOT asserts IRQ');
    // But CPU just marched through NOPs to STP — no interrupt taken
    assert.equal(m.cpu.stopped, true, 'CPU reached STP, no interrupt detour');
});
