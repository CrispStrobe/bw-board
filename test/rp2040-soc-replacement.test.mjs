// A WATCHDOG RESET REPLACES THE SoC, AND FLASH IS WHAT SURVIVES IT.
//
// ROADMAP R1's remaining half. `machine.reset()` reaches the adapter's watchdog
// hook, which records a reset request and parks the core — rp2040js models the
// register and deliberately leaves the chip-reset ACTION to its host. Nothing
// consumed that request, so the machine stopped there. `replaceSoC()` is the
// consumer.
//
// WHAT THESE CASES ARE FOR, and it is the distinction the triage found the hard
// way. Clearing core state alone already produced a second MicroPython banner
// while peripheral and controller state survived, so `main.py` still did not
// run — a half-reset machine that boots is harder to diagnose than one that
// visibly stops. So it is not enough to assert "the new SoC runs". These assert
// that flash SURVIVES and that everything else DOES NOT, which is the property
// a power cycle actually has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRp2040jsAdapter, replaceSoC, FLASH_BASE } from '../src/rp2040js-adapter.js';

/** A two-instruction image that parks a recognisable value in r0. */
function imageWith (byte) {
    const img = new Uint8Array(8);
    const dv = new DataView(img.buffer);
    dv.setUint16(0, 0x2000 | byte, true);   // movs r0, #byte
    dv.setUint16(2, 0xe7fe, true);          // b .
    return img;
}

test('replaceSoC preserves flash — the program is still there afterwards', () => {
    const first = createRp2040jsAdapter();
    first.bootFromFlash(imageWith(0x5a));
    assert.equal(first.rp2040.readUint16(FLASH_BASE) & 0xff, 0x5a, 'the image did not land');

    const second = replaceSoC(first);
    assert.notEqual(second, first, 'replaceSoC must return a NEW SoC, not the same one');
    assert.notEqual(second.rp2040, first.rp2040, 'the RP2040 must be a different object');
    assert.equal(second.rp2040.readUint16(FLASH_BASE) & 0xff, 0x5a,
        'flash did not survive the replacement — the program is gone');

    // And it RUNS, so this is about a usable machine and not just bytes.
    second.core.executeInstruction();
    assert.equal(second.core.registers[0], 0x5a, 'the preserved program did not execute');
});

test('replaceSoC returns everything EXCEPT flash to power-on', () => {
    const first = createRp2040jsAdapter();
    first.bootFromFlash(imageWith(0x3c));
    // Dirty core and SRAM, the state a half-reset would wrongly carry over.
    first.core.registers[5] = 0xdeadbeef;
    first.rp2040.writeUint32(0x20001000, 0xfeedface);
    first.core.waiting = true;                 // what the watchdog hook leaves behind

    const second = replaceSoC(first);
    assert.equal(second.core.registers[5], 0, 'a core register survived the replacement');
    assert.equal(second.rp2040.readUint32(0x20001000) >>> 0, 0,
        'SRAM survived the replacement — this is the half-reset the triage warned about');
    assert.equal(second.core.waiting, false, 'the new SoC came up parked');
    assert.equal(second.core.SP >>> 0, 0x20042000, 'the boot SP was not installed');
    assert.equal(second.core.PC >>> 0, FLASH_BASE, 'the new SoC did not enter the image');
});

test('replaceSoC reuses the previous SoC\'s options, so a replacement cannot silently differ', () => {
    const first = createRp2040jsAdapter({clockHz: 48_000_000});
    first.bootFromFlash(imageWith(0x11));
    const second = replaceSoC(first);
    assert.equal(second.clockHz, 48_000_000,
        'the replacement came up at a different clock than the SoC it replaced');
    // An explicit override still wins, for a host that means it.
    assert.equal(replaceSoC(first, {clockHz: 125_000_000}).clockHz, 125_000_000);
});

test('MUTATION: without the flash copy the program is LOST, so the copy is what preserves it', () => {
    // replaceSoC's only job beyond constructing a SoC is carrying flash across.
    // A fresh adapter built the same way but WITHOUT that copy must lose the
    // program — otherwise flash survives for some other reason and the first
    // test is not testing what it claims.
    const first = createRp2040jsAdapter();
    first.bootFromFlash(imageWith(0x77));
    assert.equal(first.rp2040.readUint16(FLASH_BASE) & 0xff, 0x77);

    const withoutCopy = createRp2040jsAdapter(first.opts);   // no flash carried over
    assert.equal(withoutCopy.rp2040.readUint16(FLASH_BASE) >>> 0, 0xffff,
        'a fresh SoC came up with something other than erased flash — then the copy in '
        + 'replaceSoC is not what preserves the program, and the preservation test is vacuous');

    const withCopy = replaceSoC(first);
    assert.equal(withCopy.rp2040.readUint16(FLASH_BASE) & 0xff, 0x77);
});

test('a reset request is consumed exactly once, and replacement does not invent another', () => {
    const first = createRp2040jsAdapter();
    first.bootFromFlash(imageWith(0x22));
    // Fire the watchdog the way silicon does: TRIGGER into WATCHDOG.CTRL.
    first.rp2040.peripherals[0x40058].onWatchdogTrigger();
    const request = first.takeResetRequest();
    assert.equal(request && request.cause, 'watchdog', 'the watchdog request was not surfaced');
    assert.equal(first.takeResetRequest(), null, 'the request was served twice');

    const second = replaceSoC(first);
    assert.equal(second.takeResetRequest(), null,
        'the replacement SoC came up already holding a reset request');
});
