// The 8086 extractor: a 74HC138-decoded breadboard with a twenty-bit
// address space and separate I/O port space comes back as the machine
// config; contention across the two spaces refuses with the address named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract8086Machine } from '../src/i8086-extract.js';

// A typical 8086 breadboard:
//   - 74HC138 #1 (mem decode): E3=M/IO (high on memory cycles), E1B=GND, E2B=GND
//     Y0: A19..A16=0000 → RAM  $00000-$0FFFF (64K)
//     Y7: A19..A16=1111 → ROM  $F0000-$FFFFF (64K, covers reset vector)
//   - 74HC138 #2 (IO decode):  E3=~M/IO (inverter), E1B=GND, E2B=GND
//     Y0: A7..A5=000 → PPI at port $00
//     Y1: A7..A5=001 → UART at port $20
//   - 74HC04 inverter to get ~M/IO for the IO decoder
function breadboardCircuit() {
    const parts = [
        { id: 'cpu1', kind: 'i8086' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'ppi1', kind: 'i8255' },
        { id: 'uart1', kind: 'ns16c550' },
        { id: 'dec1', kind: '74hc138' },   // memory decoder
        { id: 'dec2', kind: '74hc138' },   // I/O decoder
        { id: 'inv1', kind: '74hc04' },    // inverter
        { id: 'gnd1', kind: 'gnd' },
        { id: 'vcc1', kind: 'vcc' },
    ];
    const wires = [];
    const w = (f, ft, t, tt) => wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });

    // Memory decoder: E3 = M/IO (high during memory), E1B=GND, E2B=GND
    // Inputs: A = A16, B = A17, C = A18. A19 selects between top/bottom half.
    // Actually, to decode the full 20-bit space into 8 × 128K blocks, we use
    // A17/A18/A19 and wire A16 low on E2B... Actually, let's use a simpler
    // decode. For a typical 8086 breadboard:
    //   RAM = 64K at 00000h-0FFFFh: selected when A16-A19 are all 0
    //   ROM = 64K at F0000h-FFFFFh: selected when A16-A19 are all 1
    // Use 74HC138 with A = A17, B = A18, C = A19, E1B = A16 inverted, E2B = GND, E3 = M/IO
    // Wait, that's complex. Let me use NAND gates like the Z80 test.

    // Simpler approach: use NAND glue like Searle.
    // Replace 74HC138 with 74HC00 glue logic.
    return breadboardNandCircuit();
}

// Simpler circuit using NAND gates, directly following the Z80 test pattern.
// RAM at $00000-$0FFFF, ROM at $F8000-$FFFFF, PPI at port $00, UART at port $20.
function breadboardNandCircuit() {
    const parts = [
        { id: 'cpu1', kind: 'i8086' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'ppi1', kind: 'i8255' },
        { id: 'uart1', kind: 'ns16c550' },
        { id: 'g1', kind: '74hc00' },   // glue NAND #1
        { id: 'g2', kind: '74hc00' },   // glue NAND #2
        { id: 'inv1', kind: '74hc04' },
        { id: 'gnd1', kind: 'gnd' },
        { id: 'vcc1', kind: 'vcc' },
    ];
    const wires = [];
    const w = (f, ft, t, tt) => wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });

    // Wire low address lines to memory chips
    for (let i = 0; i < 15; i++) { w('cpu1', `a${i}`, 'ram1', `a${i}`); w('cpu1', `a${i}`, 'rom1', `a${i}`); }

    // PPI register selects: A0, A1
    w('cpu1', 'a0', 'ppi1', 'a0'); w('cpu1', 'a1', 'ppi1', 'a1');
    // UART register selects: A0, A1, A2
    w('cpu1', 'a0', 'uart1', 'a0'); w('cpu1', 'a1', 'uart1', 'a1'); w('cpu1', 'a2', 'uart1', 'a2');

    // Memory decode:
    // RAM at $00000-$0FFFF: selected when M/IO=1 AND A16-A19 all zero.
    //   OR all of A16-A19 with M/IO inverted: if any are 1 or M/IO=0, not selected.
    //   inv1.1: ~M/IO; inv1.2: ~A19; inv1.3: ~A18; inv1.4: ~A17; inv1.5: ~A16
    //   RAM CSB = NAND(M/IO, ~A19, ~A18, ~A17, ~A16) ... but NAND is 2-input.
    //
    // Simpler: use a cascade of ORs. RAM selected when
    // A19=0, A18=0, A17=0, A16=0, M/IO=1.
    //   Step 1: inv1.1: ~M/IO
    //   Step 2: g1.1: NAND(~M/IO, ~M/IO) = ~~M/IO = M/IO ... useless
    //
    // Actually, let me just use a clean decode with a 74HC138.

    // Let's do the 138-based decode properly. It works well for 8086.
    return decode138Circuit();
}

function decode138Circuit() {
    const parts = [
        { id: 'cpu1', kind: 'i8086' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'ppi1', kind: 'i8255' },
        { id: 'dec1', kind: '74hc138' },   // memory decoder
        { id: 'dec2', kind: '74hc138' },   // I/O decoder
        { id: 'inv1', kind: '74hc04' },
        { id: 'gnd1', kind: 'gnd' },
        { id: 'vcc1', kind: 'vcc' },
    ];
    const wires = [];
    const w = (f, ft, t, tt) => wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });

    // Wire low address lines to RAM and ROM
    for (let i = 0; i < 15; i++) { w('cpu1', `a${i}`, 'ram1', `a${i}`); w('cpu1', `a${i}`, 'rom1', `a${i}`); }

    // PPI register selects
    w('cpu1', 'a0', 'ppi1', 'a0'); w('cpu1', 'a1', 'ppi1', 'a1');

    // Memory decoder (dec1): decodes A17-A19 with M/IO as enable.
    // E1B = GND (always enabled), E2B = A16 (forces A16=0 for the bottom half),
    // E3 = M/IO (active during memory cycles).
    // A = A17, B = A18, C = A19.
    // Y0: A19=0, A18=0, A17=0, A16=0 → addresses $00000-$0FFFF → RAM
    // Y7: A19=1, A18=1, A17=1, A16=0 → addresses $E0000-$EFFFF
    // But we want ROM at $F8000-$FFFFF which needs A16=1. With E2B=A16,
    // the decoder is disabled when A16=1. That means Y7 covers $E0000-$EFFFF,
    // not $F0000-$FFFFF.
    //
    // For ROM at the top of memory we need a different approach.
    // Let's use: E2B = GND, E1B = GND, E3 = M/IO.
    // A = A17, B = A18, C = A19.
    // This decodes 8 × 128K blocks:
    //   Y0: $00000-$1FFFF (128K)
    //   Y7: $E0000-$FFFFF (128K)
    // RAM CSB = Y0 → RAM at $00000-$0FFFF (only 32K used but selected over 128K)
    // ROM CEB = Y7 → ROM at $E0000-$FFFFF (only 32K used but selected over 128K)
    // The ROM covers the reset vector at FFFF0h. ✓

    w('gnd1', 'gnd', 'dec1', 'e1b');
    w('gnd1', 'gnd', 'dec1', 'e2b');
    w('cpu1', 'mio', 'dec1', 'e3');
    w('cpu1', 'a17', 'dec1', 'a');
    w('cpu1', 'a18', 'dec1', 'b');
    w('cpu1', 'a19', 'dec1', 'c');
    w('dec1', 'y0', 'ram1', 'csb');    // RAM at $00000-$1FFFF
    w('dec1', 'y7', 'rom1', 'ceb');    // ROM at $E0000-$FFFFF

    // I/O decoder (dec2): decodes A5-A7 with ~M/IO as enable.
    // E1B = GND, E2B = GND, E3 = inv1.1y (~M/IO → active during IO cycles).
    // A = A5, B = A6, C = A7.
    // Y0: A7=0, A6=0, A5=0 → ports $00-$1F → PPI
    w('cpu1', 'mio', 'inv1', '1a');
    w('inv1', '1y', 'dec2', 'e3');
    w('gnd1', 'gnd', 'dec2', 'e1b');
    w('gnd1', 'gnd', 'dec2', 'e2b');
    w('cpu1', 'a5', 'dec2', 'a');
    w('cpu1', 'a6', 'dec2', 'b');
    w('cpu1', 'a7', 'dec2', 'c');
    w('dec2', 'y0', 'ppi1', 'csb');    // PPI at ports $00-$1F

    return { parts, wires };
}

test('the 138-decoded breadboard extracts to the 8086 machine config', () => {
    const r = extract8086Machine(decode138Circuit());
    assert.ok(r.ok, r.reasons.join('; '));
    assert.deepEqual(r.regions, [
        { kind: 'ram', start: 0x00000, end: 0x1ffff },
        { kind: 'rom', start: 0xe0000, end: 0xfffff },
    ]);
    assert.equal(r.chips.length, 1);
    assert.equal(r.chips[0].kind, 'ppi');
    assert.equal(r.chips[0].name, 'ppi1');
    assert.equal(r.chips[0].at, 0x00);
    assert.ok(r.notes.some((n) => /ppi1 mirrors/.test(n)));
    assert.ok(r.lines.some((l) => /MAP RAM/.test(l)));
    assert.ok(r.lines.some((l) => /MAP ROM/.test(l)));
    assert.ok(r.lines.some((l) => /CHIP ppi1 = I8255 AT PORT/.test(l)));
});

test('no CPU refuses', () => {
    const r = extract8086Machine({ parts: [{ id: 'ram1', kind: '62256' }], wires: [] });
    assert.equal(r.ok, false);
    assert.match(r.reasons[0], /no 8086/);
});

test('no ROM at the reset vector refuses', () => {
    const c = decode138Circuit();
    // Rewire ROM to Y0 (same as RAM, but that will cause contention).
    // Instead, swap ROM to Y1 which is $20000-$3FFFF — below the reset vector.
    c.wires = c.wires.filter((w) => !(w.from === 'dec1' && w.fromTerminal === 'y7'));
    c.wires.push({ from: 'dec1', fromTerminal: 'y1', to: 'rom1', toTerminal: 'ceb' });
    const r = extract8086Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons[0], /FFFF0h/);
});

test('memory-space contention refuses with the address', () => {
    const c = decode138Circuit();
    // Wire both RAM and ROM to Y0 — overlap at $00000
    c.wires = c.wires.filter((w) => !(w.from === 'dec1' && w.fromTerminal === 'y7'));
    c.wires.push({ from: 'dec1', fromTerminal: 'y0', to: 'rom1', toTerminal: 'ceb' });
    const r = extract8086Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons[0], /memory-space contention/);
});

test('an undriven chip-select refuses', () => {
    const c = decode138Circuit();
    // Disconnect PPI's CSB
    c.wires = c.wires.filter((w) => !(w.to === 'ppi1' && w.toTerminal === 'csb'));
    const r = extract8086Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /undriven/);
});

test('PPI register-select check: a1 must ride A1', () => {
    const c = decode138Circuit();
    // Swap PPI A1 to A3 instead of A1
    c.wires = c.wires.filter((w) => !(w.to === 'ppi1' && w.toTerminal === 'a1'));
    c.wires.push({ from: 'cpu1', fromTerminal: 'a3', to: 'ppi1', toTerminal: 'a1' });
    const r = extract8086Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /a1 must ride A1/);
});

// A circuit with both a PPI and a UART on the IO bus
function fullCircuit() {
    const c = decode138Circuit();
    // Add UART at ports $20-$3F via dec2.Y1
    c.parts.push({ id: 'uart1', kind: 'ns16c550' });
    const w = (f, ft, t, tt) => c.wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });
    w('dec2', 'y1', 'uart1', 'cs2b');   // CS2B = Y1 (active low)
    w('cpu1', 'a0', 'uart1', 'a0');
    w('cpu1', 'a1', 'uart1', 'a1');
    w('cpu1', 'a2', 'uart1', 'a2');
    // CS0 and CS1 tied high
    w('vcc1', 'vcc', 'uart1', 'cs0');
    w('vcc1', 'vcc', 'uart1', 'cs1');
    return c;
}

test('PPI and UART on separate IO decoder outputs coexist', () => {
    const r = extract8086Machine(fullCircuit());
    assert.ok(r.ok, r.reasons.join('; '));
    const ppi = r.chips.find((c) => c.kind === 'ppi');
    const uart = r.chips.find((c) => c.kind === 'uart16550');
    assert.ok(ppi, 'PPI extracted');
    assert.ok(uart, 'UART extracted');
    assert.equal(ppi.at, 0x00);
    assert.equal(uart.at, 0x20);
});

test('port-space contention refuses when two IO chips share an address', () => {
    const c = fullCircuit();
    // Wire UART's CS2B to the same decoder output as PPI (Y0)
    c.wires = c.wires.filter((w) => !(w.to === 'uart1' && w.toTerminal === 'cs2b'));
    c.wires.push({ from: 'dec2', fromTerminal: 'y0', to: 'uart1', toTerminal: 'cs2b' });
    const r = extract8086Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons[0], /port-space contention/);
});

test('MC6850 on the IO bus extracts with register-select check', () => {
    const c = decode138Circuit();
    // Replace the UART parts with an MC6850
    c.parts.push({ id: 'acia1', kind: 'mc6850' });
    const w = (f, ft, t, tt) => c.wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });
    // ACIA: CS0 = dec2.Y1 inverted? No — CS0 and CS1 are active-high, CS2B active-low.
    // Use dec2.Y1 (active-low) → CS2B. CS0 = VCC, CS1 = VCC.
    w('dec2', 'y1', 'acia1', 'cs2b');
    w('vcc1', 'vcc', 'acia1', 'cs0');
    w('vcc1', 'vcc', 'acia1', 'cs1');
    w('cpu1', 'a0', 'acia1', 'rs');
    const r = extract8086Machine(c);
    assert.ok(r.ok, r.reasons.join('; '));
    const acia = r.chips.find((ch) => ch.kind === 'acia6850');
    assert.ok(acia, 'ACIA extracted');
    assert.equal(acia.at, 0x20);
});

test('the Intel support chips (8254 PIT, 8259 PIC, 8251 USART) extract on the IO bus', () => {
    const c = decode138Circuit();
    c.parts.push({ id: 'pit1', kind: 'i8254' });
    c.parts.push({ id: 'pic1', kind: 'i8259' });
    c.parts.push({ id: 'usart1', kind: 'i8251' });
    const w = (f, ft, t, tt) => c.wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });
    // PIT on dec2.Y1 (ports 0x20-0x3F); A0/A1 pick the register.
    w('dec2', 'y1', 'pit1', 'csb');
    w('cpu1', 'a0', 'pit1', 'a0'); w('cpu1', 'a1', 'pit1', 'a1');
    // PIC on dec2.Y2 (0x40-0x5F); A0 picks command/data.
    w('dec2', 'y2', 'pic1', 'csb');
    w('cpu1', 'a0', 'pic1', 'a0');
    // USART on dec2.Y3 (0x60-0x7F); C/D picks data/control.
    w('dec2', 'y3', 'usart1', 'csb');
    w('cpu1', 'a0', 'usart1', 'cd');

    const r = extract8086Machine(c);
    assert.ok(r.ok, r.reasons.join('; '));
    const pit = r.chips.find((x) => x.kind === 'pit');
    const pic = r.chips.find((x) => x.kind === 'pic');
    const usart = r.chips.find((x) => x.kind === 'usart8251');
    assert.ok(pit && pic && usart, 'all three extracted');
    assert.equal(pit.at, 0x20);
    assert.equal(pic.at, 0x40);
    assert.equal(usart.at, 0x60);
    assert.ok(r.lines.some((l) => /pit1 = I8254 AT PORT/.test(l)), r.lines.join('; '));
    assert.ok(r.lines.some((l) => /pic1 = I8259 AT PORT/.test(l)), r.lines.join('; '));
    assert.ok(r.lines.some((l) => /usart1 = I8251 AT PORT/.test(l)), r.lines.join('; '));
});

test('an i8088 CPU is recognised the same as an i8086', () => {
    const c = decode138Circuit();
    c.parts = c.parts.map((p) => (p.id === 'cpu1' ? { ...p, kind: 'i8088' } : p));
    const r = extract8086Machine(c);
    assert.ok(r.ok, r.reasons.join('; '));
    assert.ok(r.regions.some((x) => x.kind === 'rom'), 'the 8088 build still extracts a ROM');
});

test('a PIT whose A1 line is misrouted refuses with the pin named', () => {
    const c = decode138Circuit();
    c.parts.push({ id: 'pit1', kind: 'i8254' });
    const w = (f, ft, t, tt) => c.wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });
    w('dec2', 'y1', 'pit1', 'csb');
    w('cpu1', 'a0', 'pit1', 'a0');
    w('cpu1', 'a3', 'pit1', 'a1');   // A3, not A1 — a wiring slip
    const r = extract8086Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /a1 must ride A1/);
});
