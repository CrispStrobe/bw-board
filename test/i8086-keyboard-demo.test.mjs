// The keyboard example: the KBDDEMO8086 preset booting the keyboard-demo ROM,
// end to end through the real core, 8259 and 8255. This is the INPUT counterpart
// to the timer/display demos and the first thing in the tier to drive the PIC's
// IRQ1 path for real — machine.keyIn raises IRQ1 on the 8259 (not cpu.interrupt
// direct), the bare-metal INT 09h ISR reads 0x60, acknowledges via the port-B
// strobe, echoes, and EOIs. If the EOI or the ack were wrong, exactly one key
// would arrive and then silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, KBDDEMO8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'keyboard-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));

// set-1 make codes for the letters/space this test types.
const SC = { h: 0x23, i: 0x17, ' ': 0x39, t: 0x14, e: 0x12, r: 0x13, a: 0x1e, o: 0x18, l: 0x26 };

function boot() {
    const m = new I8086Machine(KBDDEMO8086);
    m.loadRom(demo);
    m.reset();
    for (let i = 0; i < 3000; i++) m.step();   // reach the idle HLT
    return m;
}
function type(m, text) {
    for (const ch of text) {
        assert.ok(SC[ch] !== undefined, `no scancode for ${JSON.stringify(ch)}`);
        m.keyIn(SC[ch]);
        for (let i = 0; i < 400; i++) m.step();
    }
}
function screen(m, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(m._read(0xb8000 + i * 2));
    return s;
}

test('typed keys echo to the screen — and MANY arrive, proving the EOI lets IRQ1 refire', () => {
    const m = boot();
    type(m, 'hi there');
    // Eight keys, not one: a missing EOI would leave IRQ1 in service and stop
    // after the first, a missing ack would hold the line and do the same.
    assert.equal(screen(m, 8), 'hi there', 'every keypress echoed, in order');
});

test('keyIn drives the real 8259 IRQ1 path — request latched, then acked and EOId', () => {
    const m = boot();
    m.keyIn(SC.a);
    assert.equal(m.chips.pic1.irr & 0x02, 0x02, 'IRQ1 request latched in the PIC IRR (not a direct cpu.interrupt)');
    for (let i = 0; i < 400; i++) m.step();
    assert.equal(m.chips.pic1.irr & 0x02, 0, 'after the ISR: IRR bit 1 cleared (acknowledged)');
    assert.equal(m.chips.pic1.isr & 0x02, 0, 'and ISR bit 1 cleared (the EOI dismissed it)');
    assert.equal(screen(m, 1), 'a', 'the key echoed');
});

test('the port-B bit-7 strobe deasserts IRQ1 on the rising edge', () => {
    const m = boot();
    m.keyIn(SC.h);
    assert.equal(m.chips.pic1.irr & 0x02, 0x02, 'IRQ1 asserted by the keypress');
    // Drive the ack strobe directly (bit 7 high) — the ISR does this, but prove
    // the machine-level behaviour: the rising edge alone drops the line.
    m._out(0x61, 0x80);
    assert.equal(m.chips.pic1.irr & 0x02, 0, 'bit 7 high cleared IRQ1');
});

test('break codes (bit 7 set) are ignored — key release does not print', () => {
    const m = boot();
    type(m, 'hi');
    m.keyIn(0x80 | SC.h);   // the RELEASE of H (F0-less set 1: make | 0x80)
    for (let i = 0; i < 400; i++) m.step();
    assert.equal(screen(m, 3), 'hi\x00', 'the release added nothing after "hi"');
});

test('the board is an XT keyboard bench — PIC + PPI + CGA, keyIn wired to the 8255', () => {
    const m = new I8086Machine(KBDDEMO8086);
    assert.deepEqual(Object.keys(m.chips).sort(), ['cga1', 'pic1', 'ppi1']);
    // keyIn found the 8255 and the PIC.
    assert.equal(m.keyIn(SC.a), true, 'keyIn latched the scancode and raised IRQ1');
    assert.equal(m._in(0x60), SC.a, 'the scancode is readable at port 0x60 (8255 port A)');
});
