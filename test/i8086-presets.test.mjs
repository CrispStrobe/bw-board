// The two reference-build presets, named for their role/shape rather than
// their source: TIERA8088 (a published hobbyist 8088 writeup's chip list)
// and SDCARD8086 (a no-licence personal 8086 build's public chip roster —
// facts only, nothing copied). The tests prove each one boots, its chips
// answer on their ports, and its declared interrupt wiring (PIT->PIC for
// Tier A, USART->PIC for the SD-card build) actually connects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, TIERA8088, SDCARD8086, PCXT8086 } from '../src/i8086-machine.js';

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

test('TIERA8088: boots from the reset vector and exposes PPI/PIT/PIC on its ports', () => {
    const m = new I8086Machine(TIERA8088);
    const romReg = TIERA8088.regions.find((r) => r.kind === 'rom');
    assert.ok(romReg.start <= 0xffff0 && romReg.end >= 0xfffff, 'ROM covers the reset vector');

    m.loadRom(bootRom(TIERA8088, [0xeb, 0xfe]));   // jmp $  (IF stays clear)
    m.reset();
    m.step();                                        // the far jump
    assert.equal(m.cpu.cs, 0xf800);
    assert.ok(m.chips.ppi1 && m.chips.pit1 && m.chips.pic1, 'all three chips built');

    // PPI answers at 0x00, PIT control at 0x23, PIC command at 0x40.
    m._out(0x03, 0x80); m._out(0x00, 0x5a);
    assert.equal(m.chips.ppi1.read(0), 0x5a);
});

test('TIERA8088: the 8254 tick reaches the 8259 through the declared irq wiring', () => {
    const m = new I8086Machine(TIERA8088);
    m.loadRom(bootRom(TIERA8088, [0xeb, 0xfe]));    // spin, IF clear so the IRQ latches but is not taken
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

test('SDCARD8086: 256K RAM + 256K ROM, and the reset vector is in ROM', () => {
    const m = new I8086Machine(SDCARD8086);
    const ram = SDCARD8086.regions.find((r) => r.kind === 'ram');
    const rom = SDCARD8086.regions.find((r) => r.kind === 'rom');
    assert.equal(ram.end - ram.start + 1, 0x40000, '256K RAM');
    assert.equal(rom.end - rom.start + 1, 0x40000, '256K ROM');
    assert.ok(rom.start <= 0xffff0 && rom.end >= 0xfffff, 'ROM covers the reset vector');

    m.loadRom(bootRom(SDCARD8086, [0xeb, 0xfe]));
    m.reset();
    m.step();
    assert.equal(m.cpu.cs, 0xf800, 'booted');
});

test('PCXT8086: the XT map wires the speaker off 61h and answers CGA retrace at 3DAh', () => {
    const m = new I8086Machine(PCXT8086);
    const rom = PCXT8086.regions.find((r) => r.kind === 'rom');
    assert.ok(rom.start <= 0xffff0 && rom.end >= 0xfffff, 'BIOS ROM covers the reset vector');
    assert.ok(m.chips.pic1 && m.chips.pit1 && m.chips.ppi1 && m.chips.spk && m.chips.cga1, 'full XT chip set');

    // The speaker: program counter 2 for a tone, configure the PPI, sound it.
    m._out(0x63, 0x80);                        // 8255 all output
    m._out(0x43, 0xb6);                        // counter 2, mode 3
    m._out(0x42, 1193 & 0xff); m._out(0x42, (1193 >> 8) & 0xff);
    m._out(0x61, 0x03);                        // gate + data
    assert.deepEqual(m.audioTone(), { hz: 1000, on: true }, 'the XT speaker sounds ~1 kHz');

    // The CGA status port answers with a real frame at 3DAh.
    const s = m._in(0x3da);
    assert.equal(s & ~0x09, 0, 'only display-enable and vretrace bits are live');
});

test('PCXT8086: the full XT board — 64K BIOS ROM, the disk path, and it is the machine the BIOS runs on', () => {
    const m = new I8086Machine(PCXT8086);
    const rom = PCXT8086.regions.find((r) => r.kind === 'rom');
    assert.equal(rom.start, 0xf0000, '64K BIOS window at F0000 (not the 32K monitor window)');
    assert.equal(rom.end, 0xfffff);
    // The whole XT chip set is present, including the disk path.
    for (const name of ['pic1', 'pit1', 'ppi1', 'spk', 'dma1', 'fdc1', 'cga1']) {
        assert.ok(m.chips[name], `${name} is on the board`);
    }
    // The disk path is wired: the FDC drives a byte through the 8237 into RAM.
    m._out(0x0c, 0); m._out(0x0b, 0x46);          // ch2, write, single
    m._out(0x04, 0x00); m._out(0x04, 0x60);       // address 0x6000
    m._out(0x05, 0x00); m._out(0x05, 0x00);       // count 0 -> 1 byte
    m._out(0x81, 0x00); m._out(0x0a, 0x02);       // ch2 page 0, unmask ch2
    const r = m.chips.fdc1.hooks.onDmaRequest('write', 0x7c);
    assert.notEqual(r, false, 'the FDC->8237 pump moved the byte');
    assert.equal(m._read(0x6000), 0x7c, 'and it landed in RAM — the disk path is live on this board');
});

test('SDCARD8086: the 8251 transmits, and its receive IRQ reaches the PIC', () => {
    const out = [];
    const m = new I8086Machine(SDCARD8086, { onSerial: (b) => out.push(b) });
    m.loadRom(bootRom(SDCARD8086, [0xeb, 0xfe]));
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
