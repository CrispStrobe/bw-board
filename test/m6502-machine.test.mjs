// The composable 6502 machine: VIA timer contracts, ACIA serial, and a
// hand-assembled ROM blinking via1.PA0 off T1 free-run rollovers — the
// exact shape bw_now() will lean on. Timer arithmetic under test: T1
// free-run period is LATCH+2 cycles (first timeout LATCH+1 after start).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { W65C22 } from '../src/w65c22.js';
import { W65C51 } from '../src/w65c51.js';
import { M6502Machine, EATER6502, HB6502 } from '../src/m6502-machine.js';

test('VIA T1 free-run: first timeout at LATCH+1, then every LATCH+2', () => {
    const via = new W65C22();
    via.write(0xb, 0x40);          // ACR: T1 free-run
    via.write(0x4, 100);           // latch = 100
    via.write(0x5, 0);             // load + start
    via.advance(100);
    assert.equal(via.read(0xd) & 0x40, 0, 'not yet at LATCH cycles');
    via.advance(1);
    assert.equal(via.read(0xd) & 0x40, 0x40, 'timeout at LATCH+1');
    via.read(0x4);                 // reading T1C-L clears the flag
    assert.equal(via.read(0xd) & 0x40, 0);
    via.advance(101);
    assert.equal(via.read(0xd) & 0x40, 0, 'period is LATCH+2, not LATCH+1');
    via.advance(1);
    assert.equal(via.read(0xd) & 0x40, 0x40, 'next timeout LATCH+2 later');
});

test('VIA T1 one-shot fires exactly once until reloaded', () => {
    const via = new W65C22();
    via.write(0x4, 50); via.write(0x5, 0);
    via.advance(51);
    assert.equal(via.read(0xd) & 0x40, 0x40);
    via.read(0x4);
    via.advance(200000);
    assert.equal(via.read(0xd) & 0x40, 0, 'no re-fire while wrapping');
    via.write(0x5, 0); via.advance(51);
    assert.equal(via.read(0xd) & 0x40, 0x40, 're-armed by T1C-H write');
});

test('VIA IFR bit 7 reflects IFR AND IER; IER uses set/clear semantics', () => {
    const via = new W65C22();
    via.write(0x4, 10); via.write(0x5, 0); via.advance(11); // IFR6 set
    assert.equal(via.read(0xd) & 0x80, 0, 'masked: no bit 7 without IER');
    assert.equal(via.irqAsserted, false);
    via.write(0xe, 0xc0);          // IER: set T1 enable
    assert.equal(via.read(0xd) & 0x80, 0x80);
    assert.equal(via.irqAsserted, true);
    via.write(0xe, 0x40);          // IER: clear T1 enable (bit 7 low)
    assert.equal(via.irqAsserted, false);
    assert.equal(via.read(0xe) & 0x40, 0, 'enable really cleared');
});

test('VIA ports: DDR masking on reads, input pins default high', () => {
    const via = new W65C22();
    via.write(0x2, 0x0f);          // DDRB: low nibble out
    via.write(0x0, 0xa5);          // ORB
    assert.equal(via.read(0x0), 0xf5, 'out bits from ORB, in bits from pins (high)');
    via.setInput('b', 7, 0);
    assert.equal(via.read(0x0), 0x75);
});

test('VIA T2 pulse-count mode counts PB6 falling edges', () => {
    const via = new W65C22();
    via.write(0xb, 0x20);          // ACR: T2 pulse count
    via.write(0x8, 2); via.write(0x9, 0); // count = 2
    via.setInput('b', 6, 0); via.setInput('b', 6, 1);
    assert.equal(via.read(0xd) & 0x20, 0, 'one pulse is not two');
    via.setInput('b', 6, 0);
    assert.equal(via.read(0xd) & 0x20, 0x20, 'flag on the count-th falling edge');
});

test('ACIA: TX bytes reach the hook, RX queue drives RDRF and overrun', () => {
    const sent = [];
    const acia = new W65C51({ onTx: (b) => sent.push(b) });
    acia.write(0, 0x48); acia.write(0, 0x69);
    assert.deepEqual(sent, [0x48, 0x69]);
    assert.equal(acia.read(1) & 0x10, 0x10, 'TDRE set (datasheet behavior)');
    assert.equal(acia.read(1) & 0x08, 0, 'no RX yet');
    acia.rxPush(0x41);
    assert.equal(acia.read(1) & 0x08, 0x08);
    acia.rxPush(0x42);             // arrives before the first is read
    assert.equal(acia.read(1) & 0x04, 0x04, 'overrun latched');
    assert.equal(acia.read(0), 0x41);
    assert.equal(acia.read(1) & 0x04, 0, 'overrun cleared by data read');
    assert.equal(acia.read(0), 0x42);
    assert.equal(acia.read(1) & 0x08, 0, 'queue drained');
});

// LDA/STA setup, then poll IFR6, clear it via T1C-L, toggle PA0. T1 latch
// 998 -> period 1000 cycles = 1.000 ms at the preset's 1 MHz.
const BLINK_ROM = [
    0xa9, 0xff, 0x8d, 0x03, 0x60,       // LDA #$FF, STA DDRA
    0xa9, 0x40, 0x8d, 0x0b, 0x60,       // LDA #$40, STA ACR (T1 free-run)
    0xa9, 0xe6, 0x8d, 0x04, 0x60,       // LDA #$E6, STA T1C-L (998 lo)
    0xa9, 0x03, 0x8d, 0x05, 0x60,       // LDA #$03, STA T1C-H (start)
    0xad, 0x0d, 0x60,                    // wait: LDA IFR
    0x29, 0x40,                          // AND #$40
    0xf0, 0xf9,                          // BEQ wait
    0xad, 0x04, 0x60,                    // LDA T1C-L (clear IFR6)
    0xad, 0x01, 0x60,                    // LDA ORA
    0x49, 0x01,                          // EOR #$01
    0x8d, 0x01, 0x60,                    // STA ORA (toggle PA0)
    0x4c, 0x14, 0x80,                    // JMP wait
];

test('machine: ROM blink toggles via1.PA0 every 1000 cycles exactly', () => {
    const events = [];
    const m = new M6502Machine(EATER6502, {
        onPinChange: (pin, level, tMs) => events.push({ pin, level, tMs }),
    });
    m.loadRom(BLINK_ROM);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.reset();
    m.advanceToMs(6);
    // DDRA write seeds all eight PA pins at level 0 (driven-low intent).
    const seeds = events.filter((e) => e.tMs < 0.1);
    assert.equal(seeds.length, 8);
    assert.ok(seeds.every((e) => e.level === 0));
    const edges = events.filter((e) => e.pin === 'via1.PA0' && e.tMs >= 0.1);
    assert.ok(edges.length >= 5, `expected 5+ edges, got ${edges.length}`);
    assert.deepEqual(edges.slice(0, 4).map((e) => e.level), [1, 0, 1, 0]);
    // The timer grid is exact; the poll loop adds up to ~9 cycles of
    // detection phase per edge (real hardware polls the same way). Anchor
    // on the first edge: no cumulative drift, bounded per-edge jitter.
    const t0 = edges[0].tMs * 1000;
    for (let i = 1; i < edges.length; i++) {
        const offUs = edges[i].tMs * 1000 - (t0 + i * 1000);
        assert.ok(Math.abs(offUs) <= 10, `edge ${i} off grid by ${offUs}us`);
    }
});

test('machine: serial ROM prints through the ACIA with a timestamp', () => {
    const serial = [];
    const m = new M6502Machine(EATER6502, {
        onSerial: (byte, tMs) => serial.push({ byte, tMs }),
    });
    m.loadRom([
        0xa9, 0x48, 0x8d, 0x00, 0x50,   // LDA #'H', STA $5000
        0xa9, 0x69, 0x8d, 0x00, 0x50,   // LDA #'i', STA $5000
        0xdb,                            // STP
    ]);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.reset();
    m.advanceToMs(1);
    assert.deepEqual(serial.map((s) => s.byte), [0x48, 0x69]);
    assert.ok(serial[1].tMs > serial[0].tMs);
    assert.ok(m.cpu.stopped, 'STP parked the machine before the horizon');
});

test('machine: overlapping config refuses loudly', () => {
    assert.throws(() => new M6502Machine({
        clockHz: 1_000_000,
        regions: [{ kind: 'ram', start: 0x0000, end: 0x6007 }],
        chips: [{ kind: 'via', name: 'via1', at: 0x6000 }],
    }), /overlap/);
});

test('machine: VIA T1 interrupt reaches the CPU through shared IRQB', () => {
    // CLI, enable T1 in IER, start T1 one-shot, WAI; handler stores marker.
    const m = new M6502Machine(EATER6502, {});
    m.loadRom([
        0xa9, 0xc0, 0x8d, 0x0e, 0x60,   // LDA #$C0, STA IER (enable T1)
        0xa9, 0x32, 0x8d, 0x04, 0x60,   // LDA #$32, STA T1C-L (50)
        0xa9, 0x00, 0x8d, 0x05, 0x60,   // LDA #$00, STA T1C-H (start one-shot)
        0x58,                            // CLI
        0xcb,                            // WAI
        0xa9, 0x77, 0x85, 0x10,         // LDA #$77, STA $10 (after RTI)
        0xdb,                            // STP
    ]);
    // IRQ handler at $9000: read T1C-L to clear, RTI.
    m.mem[0x9000] = 0xad; m.mem[0x9001] = 0x04; m.mem[0x9002] = 0x60;
    m.mem[0x9003] = 0x40;
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.mem[0xfffe] = 0x00; m.mem[0xffff] = 0x90;
    m.reset();
    m.advanceToMs(1);
    assert.equal(m.mem[0x10], 0x77, 'woke from WAI, vectored, returned');
    assert.equal(m.chips.via1.irqAsserted, false, 'flag cleared in handler');
});

// ---------------------------------------------------------------------------
// HB6502 preset (mike42/6502-computer, CC-BY-4.0)
// 65C02 + 65C22 + 65C51N, 1.8432 MHz, 32K RAM, 16K ROM at $C000.
// VIA at $8000, ACIA at $8400 — decoded by 74LS138 in the I/O window.
// ---------------------------------------------------------------------------

test('HB6502: config sanity — 1.8432 MHz, RAM to $7FFF, ROM at $C000', () => {
    assert.equal(HB6502.clockHz, 1_843_200);
    const ram = HB6502.regions.find((r) => r.kind === 'ram');
    const rom = HB6502.regions.find((r) => r.kind === 'rom');
    assert.deepEqual(ram, { kind: 'ram', start: 0x0000, end: 0x7fff });
    assert.deepEqual(rom, { kind: 'rom', start: 0xc000, end: 0xffff });
    const via = HB6502.chips.find((c) => c.kind === 'via');
    const acia = HB6502.chips.find((c) => c.kind === 'acia');
    assert.equal(via.at, 0x8000);
    assert.equal(acia.at, 0x8400);
});

// Same blink logic as the Eater test, re-targeted to the HB6502 address map:
// VIA at $8000, ROM entry at $C000. T1 latch 998 → period 1000 cycles =
// 1000/1843200 s ≈ 0.5425 ms at 1.8432 MHz.
const HB_BLINK_ROM = [
    0xa9, 0xff, 0x8d, 0x03, 0x80,       // LDA #$FF, STA $8003 (DDRA)
    0xa9, 0x40, 0x8d, 0x0b, 0x80,       // LDA #$40, STA $800B (ACR T1 free-run)
    0xa9, 0xe6, 0x8d, 0x04, 0x80,       // LDA #$E6, STA $8004 (T1C-L = 998 lo)
    0xa9, 0x03, 0x8d, 0x05, 0x80,       // LDA #$03, STA $8005 (T1C-H, start)
    0xad, 0x0d, 0x80,                    // wait: LDA $800D (IFR)
    0x29, 0x40,                          // AND #$40
    0xf0, 0xf9,                          // BEQ wait
    0xad, 0x04, 0x80,                    // LDA $8004 (clear IFR6)
    0xad, 0x01, 0x80,                    // LDA $8001 (ORA)
    0x49, 0x01,                          // EOR #$01
    0x8d, 0x01, 0x80,                    // STA $8001 (toggle PA0)
    0x4c, 0x14, 0xc0,                    // JMP $C014 (wait)
];

test('HB6502: ROM blink toggles via1.PA0 on the T1 grid', () => {
    const events = [];
    const m = new M6502Machine(HB6502, {
        onPinChange: (pin, level, tMs) => events.push({ pin, level, tMs }),
    });
    m.loadRom(HB_BLINK_ROM);           // loads at $C000 (first rom region)
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0xc0; // reset vector → $C000
    m.reset();
    m.advanceToMs(4);                   // ~4 ms at 1.8432 MHz ≈ 7373 cycles
    const seeds = events.filter((e) => e.tMs < 0.05);
    assert.equal(seeds.length, 8, 'DDRA seeds 8 PA pins');
    assert.ok(seeds.every((e) => e.level === 0));
    const edges = events.filter((e) => e.pin === 'via1.PA0' && e.tMs >= 0.05);
    assert.ok(edges.length >= 5, `expected 5+ edges, got ${edges.length}`);
    assert.deepEqual(edges.slice(0, 4).map((e) => e.level), [1, 0, 1, 0]);
    // Period is 1000 cycles ≈ 542.53 µs at 1.8432 MHz.
    const periodUs = 1000 / HB6502.clockHz * 1e6;
    const t0 = edges[0].tMs * 1000;
    for (let i = 1; i < edges.length; i++) {
        const offUs = edges[i].tMs * 1000 - (t0 + i * periodUs);
        assert.ok(Math.abs(offUs) <= 6, `edge ${i} off grid by ${offUs.toFixed(1)}µs`);
    }
});

test('HB6502: serial TX through the ACIA at $8400', () => {
    const serial = [];
    const m = new M6502Machine(HB6502, {
        onSerial: (byte, tMs) => serial.push({ byte, tMs }),
    });
    m.loadRom([
        0xa9, 0x48, 0x8d, 0x00, 0x84,   // LDA #'H', STA $8400
        0xa9, 0x69, 0x8d, 0x00, 0x84,   // LDA #'i', STA $8400
        0xdb,                            // STP
    ]);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0xc0;
    m.reset();
    m.advanceToMs(1);
    assert.deepEqual(serial.map((s) => s.byte), [0x48, 0x69]);
    assert.ok(serial[1].tMs > serial[0].tMs);
    assert.ok(m.cpu.stopped, 'STP parked the machine');
});

test('HB6502: open bus in the I/O gap reads $FF, writes vanish', () => {
    const m = new M6502Machine(HB6502, {});
    // $8800 (speaker toggle) and $8C00 (IRQ controller) are not modelled;
    // they sit in the open-bus gap between ACIA ($8403) and ROM ($C000).
    assert.equal(m._read(0x8800), 0xff, 'speaker address is open bus');
    assert.equal(m._read(0x8c00), 0xff, 'IRQ controller is open bus');
    m._write(0x8800, 0x42);             // should not throw
    assert.equal(m._read(0x8800), 0xff, 'still open bus after write');
});

test('HB6502: 32K RAM covers full $0000–$7FFF, ROM is read-only', () => {
    const m = new M6502Machine(HB6502, {});
    // RAM at the top of the 32K range
    m._write(0x7fff, 0xaa);
    assert.equal(m._read(0x7fff), 0xaa, 'top of RAM is writable');
    // Zero page is inside RAM
    m._write(0x00ff, 0xbb);
    assert.equal(m._read(0x00ff), 0xbb, 'zero page works');
    // ROM is not writable
    m.mem[0xc000] = 0xcc;
    m._write(0xc000, 0xdd);
    assert.equal(m._read(0xc000), 0xcc, 'ROM write ignored');
});
