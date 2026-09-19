// A drawn PS/2 keyboard auto-wires onto the 8086/286's 8255, the same way the
// 6502/z80 adapters bridge one onto a VIA. The adapter infers the wiring from
// the board's nets: data lines d0-d7 -> a PPI port, DATA AVAILABLE -> a PPI
// status bit. No explicit ps2On8255 call in the host — draw a keyboard, it works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createI8086Adapter } from '../src/i8086-adapter.js';
import { BLINK80286 } from '../src/i8086-machine.js';
import PS2Keyboard, { SCAN_CODES } from '../src/ps2.js';

// A minimal board carrying a `ps2` part wired to ppi1: d0-d7 -> PA0-PA7 (the PC
// 0x60 convention), da -> PC0 (a status bit a program polls).
function ps2Board(kbd) {
    const parts = [{ id: 'kbd1', kind: 'ps2' }, { id: 'ppi1', kind: 'ppi' }];
    const nets = [
        ...Array.from({ length: 8 }, (_, i) => ({ terminals: [{ part: 'kbd1', terminal: `d${i}` }, { part: 'ppi1', terminal: `PA${i}` }] })),
        { terminals: [{ part: 'kbd1', terminal: 'da' }, { part: 'ppi1', terminal: 'PC0' }] },
    ];
    return {
        parts, nets,
        partMap: new Map(parts.map((p) => [p.id, p])),
        getDeviceState: (id) => (id === 'kbd1' ? { _kbd: kbd } : null),
        readPin: () => 0, setPin() {}, advanceTo() {},
    };
}

test('attachBoard auto-wires a drawn PS/2 keyboard onto the 286 8255', () => {
    const kbd = new PS2Keyboard();
    const adapter = createI8086Adapter({ config: BLINK80286 });
    adapter.attachBoard(ps2Board(kbd));

    // The capture was attached as a machine device (so it is clocked each step).
    assert.ok(adapter.machine.devices && adapter.machine.devices.ps2_kbd1, 'a PS/2 capture device was auto-attached');

    // A keypress reaches port A (the 8255 stays input at power-on 9Bh, so read
    // returns the delivered byte).
    kbd.keyDown('a');
    const cap = adapter.machine.devices.ps2_kbd1;
    cap.advance(2000);
    const ppi = adapter.machine.chips.ppi1;
    assert.equal(ppi.read(0) & 0xff, SCAN_CODES.a, 'the scancode landed on port A');
    assert.equal(ppi.read(2) & 1, 1, 'DATA AVAILABLE strobe on PC0 after the frame');
});

test('syncInputs does not clobber the PS/2-owned pins (the capture owns port A)', () => {
    const kbd = new PS2Keyboard();
    const adapter = createI8086Adapter({ config: BLINK80286 });
    adapter.attachBoard(ps2Board(kbd));
    kbd.keyDown('a');
    adapter.machine.devices.ps2_kbd1.advance(2000);
    const ppi = adapter.machine.chips.ppi1;
    assert.equal(ppi.read(0) & 0xff, SCAN_CODES.a);

    // A board-input sync (board.readPin returns 0 for every pin) must NOT reset
    // port A — the PS/2 bridge owns those inputs, so the latched byte survives.
    adapter.syncInputs();
    assert.equal(ppi.read(0) & 0xff, SCAN_CODES.a, 'the latched scancode survived syncInputs');
});

test('no PS/2 part on the board means no bridge and no skipped pins', () => {
    const adapter = createI8086Adapter({ config: BLINK80286 });
    adapter.attachBoard({ parts: [{ id: 'ppi1', kind: 'ppi' }], nets: [], readPin: () => 0, setPin() {}, advanceTo() {} });
    assert.ok(!adapter.machine.devices || !Object.keys(adapter.machine.devices).some((k) => k.startsWith('ps2_')),
        'nothing to bridge, no ps2 device attached');
});
