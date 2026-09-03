// The two reference-build presets. These are machine CONFIGS reproduced from
// public chip lists (slador.uk's 8088, GREENSHELLRAGE's 8086) — nothing of
// either original's ROM, code or schematic is here. The tests prove each one
// boots, its chips answer on their ports, and its declared interrupt wiring
// (PIT->PIC for Tier A, USART->PIC for the SD-card build) actually connects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, SLADOR8088, GREENSHELLRAGE8086 } from '../src/i8086-machine.js';

/**
 * Build a ROM image sized to a preset's ROM region, with the code at
 * physical F8000h and the reset far-jump at physical FFFF0h — wherever that
 * falls inside this particular ROM window.
 */
function bootRom(config, code, codeSeg = 0xf800) {
    const rom = config.regions.find((r) => r.kind === 'rom');
    const img = new Uint8Array(rom.end - rom.start + 1);
    img.set(code, (codeSeg << 4) - rom.start);
    img.set([0xea, 0x00, 0x00, codeSeg & 0xff, (codeSeg >> 8) & 0xff], 0xffff0 - rom.start);
    return img;
}

test('SLADOR8088: boots from the reset vector and exposes PPI/PIT/PIC on its ports', () => {
    const m = new I8086Machine(SLADOR8088);
    const romReg = SLADOR8088.regions.find((r) => r.kind === 'rom');
    assert.ok(romReg.start <= 0xffff0 && romReg.end >= 0xfffff, 'ROM covers the reset vector');

    m.loadRom(bootRom(SLADOR8088, [0xeb, 0xfe]));   // jmp $  (IF stays clear)
    m.reset();
    m.step();                                        // the far jump
    assert.equal(m.cpu.cs, 0xf800);
    assert.ok(m.chips.ppi1 && m.chips.pit1 && m.chips.pic1, 'all three chips built');

    // PPI answers at 0x00, PIT control at 0x23, PIC command at 0x40.
    m._out(0x03, 0x80); m._out(0x00, 0x5a);
    assert.equal(m.chips.ppi1.read(0), 0x5a);
});

test('SLADOR8088: the 8254 tick reaches the 8259 through the declared irq wiring', () => {
    const m = new I8086Machine(SLADOR8088);
    m.loadRom(bootRom(SLADOR8088, [0xeb, 0xfe]));    // spin, IF clear so the IRQ latches but is not taken
    m.reset();
    m.step();

    // PIC operational, IRQ0 unmasked.
    m._out(0x40, 0x13); m._out(0x41, 0x08); m._out(0x41, 0x01); m._out(0x41, 0xfe);
    // PIT counter 0, mode 0, count 20.
    m._out(0x23, 0x30); m._out(0x20, 20); m._out(0x20, 0);

    assert.equal(m.chips.pic1.intActive, false, 'no interrupt before the count elapses');
    for (let i = 0; i < 60; i++) m.step();
    assert.equal(m.chips.pic1.intActive, true, 'OUT0 -> IRQ0 asserted the PIC line');
});

test('GREENSHELLRAGE8086: 256K RAM + 256K ROM, and the reset vector is in ROM', () => {
    const m = new I8086Machine(GREENSHELLRAGE8086);
    const ram = GREENSHELLRAGE8086.regions.find((r) => r.kind === 'ram');
    const rom = GREENSHELLRAGE8086.regions.find((r) => r.kind === 'rom');
    assert.equal(ram.end - ram.start + 1, 0x40000, '256K RAM');
    assert.equal(rom.end - rom.start + 1, 0x40000, '256K ROM');
    assert.ok(rom.start <= 0xffff0 && rom.end >= 0xfffff, 'ROM covers the reset vector');

    m.loadRom(bootRom(GREENSHELLRAGE8086, [0xeb, 0xfe]));
    m.reset();
    m.step();
    assert.equal(m.cpu.cs, 0xf800, 'booted');
});

test('GREENSHELLRAGE8086: the 8251 transmits, and its receive IRQ reaches the PIC', () => {
    const out = [];
    const m = new I8086Machine(GREENSHELLRAGE8086, { onSerial: (b) => out.push(b) });
    m.loadRom(bootRom(GREENSHELLRAGE8086, [0xeb, 0xfe]));
    m.reset();
    m.step();

    // UART data at 0x00, control at 0x01. Init: mode 8N1, then enable TX+RX.
    m._out(0x01, 0x4e);
    m._out(0x01, 0x37);            // TxEN | DTR | RxEN | RTS
    m._out(0x00, 0x41);           // 'A'
    assert.deepEqual(out, [0x41], 'transmit reached the serial hook');

    // PIC operational, IRQ0 unmasked.
    m._out(0x40, 0x13); m._out(0x41, 0x08); m._out(0x41, 0x01); m._out(0x41, 0xfe);
    // A received byte raises RxRDY -> the 8251's IRQ -> PIC IRQ0.
    m.chips.uart1.rxPush(0x42);
    assert.ok(m.chips.uart1.rxRdy, 'byte waiting');
    assert.equal(m.chips.pic1.intActive, true, 'the USART receive interrupt reached the PIC');
});
