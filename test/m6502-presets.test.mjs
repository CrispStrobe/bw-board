// The survey presets, run against goldens: hand-assembled ROMs whose
// expected behavior comes from the source builds' own documentation
// (Wilson primer expansion map; KiT's 16550-at-$7820 with divisor 13).
// Re-invent, assert against expectations, cross-check on silicon later —
// the owner's stated procedure for the whole 6502 breadboard survey.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M6502Machine, WILSON6502, KIT1 } from '../src/m6502-machine.js';
import { NS16C550 } from '../src/ns16c550.js';

test('NS16C550: divisor latch, LSR polling idiom, FIFO trigger IRQ, loopback', () => {
    const sent = [];
    const u = new NS16C550({ onTx: (b) => sent.push(b), clockHz: 1_000_000 });

    // Program divisor 13 through DLAB — the KiT recipe: 1 MHz/(16*13) ≈ 4808.
    u.write(3, 0x83);            // LCR: DLAB=1, 8N1
    u.write(0, 13); u.write(1, 0);
    u.write(3, 0x03);            // DLAB=0
    assert.equal(Math.round(u.baud), 4808);

    // THRE polling is the whole reason the 16550 beats the W65C51 here.
    assert.equal(u.read(5) & 0x20, 0x20, 'THRE readable via LSR bit 5');
    u.write(0, 0x4b);
    assert.deepEqual(sent, [0x4b]);
    assert.equal(u.read(5) & 0x20, 0x20, 'THR empty again immediately');

    // 16450 mode: a second byte OVERWRITES the unread one and latches OE —
    // the datasheet's meaning of overrun in non-FIFO mode.
    u.rxPush(0x41); u.rxPush(0x42);
    assert.equal(u.read(5) & 0x03, 0x03, 'DR + OE');
    assert.equal(u.read(0), 0x42, 'the newcomer overwrote');
    assert.equal(u.read(5) & 0x01, 0x00);

    // FIFO mode, trigger 4: IRQ only once four bytes are waiting.
    u.write(2, 0x41);            // FCR: FIFO on, trigger 4
    u.write(1, 0x01);            // IER: RX data available
    u.rxPush(1); u.rxPush(2); u.rxPush(3);
    assert.equal(u.irqAsserted, false, 'below trigger level');
    u.rxPush(4);
    assert.equal(u.irqAsserted, true, 'at trigger level');
    assert.equal(u.read(2) & 0x0f, 0x04, 'IIR reports RX data');
    while (u.read(5) & 0x01) u.read(0);
    assert.equal(u.irqAsserted, false);

    // ETBEI while THR is empty fires immediately — the datasheet subtlety.
    u.write(1, 0x02);
    assert.equal(u.irqAsserted, true);
    assert.equal(u.read(2) & 0x0f, 0x02, 'IIR reports THRE');
    assert.equal(u.irqAsserted, false, 'reading IIR cleared the THRE source');

    // Overrun latches when the FIFO is full and clears on LSR read.
    u.write(1, 0);
    for (let i = 0; i < 17; i++) u.rxPush(i);
    assert.equal(u.read(5) & 0x02, 0x02, 'OE latched');
    assert.equal(u.read(5) & 0x02, 0x00, 'OE cleared by the read');
    u.write(2, 0x03);            // clear RX FIFO

    // Loopback: SOUT disconnected, THR lands in the RX path.
    u.write(4, 0x10);
    u.write(0, 0x5a);
    assert.deepEqual(sent, [0x4b], 'nothing new on the wire');
    assert.equal(u.read(0), 0x5a, 'byte came back around');
});

// org $8000 on KIT1: program divisor 13, print "KiT" by polling THRE,
// then echo forever by polling DR. UART regs at $7820 (RBR/THR/DLL),
// $7821 (IER/DLM), $7823 (LCR), $7825 (LSR).
const KIT_ROM = [
    0xa9, 0x83, 0x8d, 0x23, 0x78,             // LDA #$83 / STA LCR      DLAB on
    0xa9, 0x0d, 0x8d, 0x20, 0x78,             // LDA #13  / STA DLL
    0xa9, 0x00, 0x8d, 0x21, 0x78,             // LDA #0   / STA DLM
    0xa9, 0x03, 0x8d, 0x23, 0x78,             // LDA #$03 / STA LCR      DLAB off
    0xa2, 0x00,                               // LDX #0
    0xbd, 0x3e, 0x80,                         // loop: LDA msg,X
    0xf0, 0x06,                               // BEQ echo
    0x20, 0x31, 0x80,                         // JSR putc
    0xe8,                                     // INX
    0xd0, 0xf5,                               // BNE loop
    0xad, 0x25, 0x78,                         // echo: LDA LSR
    0x29, 0x01,                               // AND #1
    0xf0, 0xf9,                               // BEQ echo
    0xad, 0x20, 0x78,                         // LDA RBR
    0x20, 0x31, 0x80,                         // JSR putc
    0x4c, 0x21, 0x80,                         // JMP echo
    0x48,                                     // putc: PHA
    0xad, 0x25, 0x78,                         // wait: LDA LSR
    0x29, 0x20,                               // AND #$20
    0xf0, 0xf9,                               // BEQ wait
    0x68,                                     // PLA
    0x8d, 0x20, 0x78,                         // STA THR
    0x60,                                     // RTS
    0x4b, 0x69, 0x54, 0x00,                   // msg: "KiT",0
];

test('KIT1 preset: the machine prints over the 16550 and echoes input', () => {
    let out = '';
    const m = new M6502Machine(KIT1, {
        onSerial: (b) => { out += String.fromCharCode(b); },
    });
    m.loadRom(KIT_ROM);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.reset();
    for (let i = 0; i < 3000 && out.length < 3; i++) m.step();
    assert.equal(out, 'KiT');
    assert.equal(Math.round(m.chips.uart1.baud), 4808,
        'divisor 13 off the 1 MHz system clock — the KiT arithmetic');
    m.chips.uart1.rxPush(0x21);
    for (let i = 0; i < 3000 && out.length < 4; i++) m.step();
    assert.equal(out, 'KiT!', 'the DR poll loop echoes typed input');
    // The dual-port VRAM window behaves as plain RAM on the CPU side.
    m.cpu.write(0x7400, 0x77);
    assert.equal(m.mem[0x7400], 0x77);
});

// org $8000 on WILSON6502: blink via VIA2 at $5000 (the primer's second
// expansion slot), one char out the ACIA at $4400, then STP.
const WILSON_ROM = [
    0xa9, 0xff, 0x8d, 0x02, 0x50,             // LDA #$FF / STA via2 DDRB
    0xa9, 0x01, 0x8d, 0x00, 0x50,             // LDA #$01 / STA via2 PORTB
    0xa9, 0x57, 0x8d, 0x00, 0x44,             // LDA #'W' / STA acia1 data
    0xdb,                                     // STP
];

test('WILSON6502 preset: VIA at the $5000 slot and ACIA at $4400 both decode', () => {
    let out = '';
    const pins = [];
    const m = new M6502Machine(WILSON6502, {
        onSerial: (b) => { out += String.fromCharCode(b); },
        onPinChange: (pin, level) => pins.push([pin, level]),
    });
    m.loadRom(WILSON_ROM);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.reset();
    for (let i = 0; i < 100 && !m.cpu.stopped; i++) m.step();
    assert.equal(out, 'W');
    assert.ok(pins.some(([pin, level]) => pin === 'via2.PB0' && level === 1),
        'the second VIA slot drives its port pin');
    // The primer's canonical VIA1 slot still decodes too.
    m.cpu.write(0x6002, 0xff);
    assert.equal(m.chips.via1.read(2), 0xff);
});
