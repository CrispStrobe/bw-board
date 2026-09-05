/**
 * bootFromFlash: the adapter entry point that boots a flat FLASH image the way
 * silicon does — enter stage 2 at FLASH_BASE with the boot stack — instead of
 * loadProgram's drop-into-SRAM-and-jump. This is what lets lite run a real Pico
 * image (MicroPython) in the simulator without the hand-rolled boot the probe
 * used to do inline (set rp2040.flash, PC = 0x10000000 by hand).
 *
 * The full contract — "boot stage 2 first, VTOR ends up at 0x20000000" — is a
 * property of a REAL image that relocates its own vector table, and is proven
 * end to end by lite's scripts/probe-pico-micropython.mjs (MicroPython actually
 * relocates; os.statvfs('/') then reports a live filesystem). That oracle needs
 * a 650 KB firmware fetch and is lite's to run. What THIS unit test proves is
 * the adapter's half: bootFromFlash places the image in flash and starts
 * EXECUTING from flash base — the one thing loadProgram (SRAM entry) does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRp2040jsAdapter, FLASH_BASE, BOOT_SP, RAM_START } from '../src/rp2040js-adapter.js';

let SKIP = false;
try { await import('rp2040js'); } catch { SKIP = 'rp2040js not installed'; }

test('bootFromFlash enters and executes stage 2 from flash base, not SRAM', { skip: SKIP }, () => {
    const mcu = createRp2040jsAdapter();

    // A two-instruction stage-2 stub at flash base. No literal pool and no VTOR
    // write — deliberately minimal, because the point here is only that
    // execution STARTS in flash and runs. movs r0,#0x20 ; lsls r0,r0,#24 leaves
    // r0 = 0x20 << 24 = RAM_START, an answer that could only be computed by the
    // stub actually running from 0x10000000.
    const MOVS_R0_0x20 = 0x2020;    // movs r0, #0x20
    const LSLS_R0_R0_24 = 0x0600;   // lsls r0, r0, #24
    const image = new Uint8Array([
        MOVS_R0_0x20 & 0xff, (MOVS_R0_0x20 >> 8) & 0xff,
        LSLS_R0_R0_24 & 0xff, (LSLS_R0_R0_24 >> 8) & 0xff,
    ]);

    mcu.bootFromFlash(image);
    assert.equal(mcu.core.PC >>> 0, FLASH_BASE, 'PC enters at flash base, not SRAM');
    assert.equal(mcu.core.SP >>> 0, BOOT_SP, 'SP is the boot stack pointer, not the SRAM top');
    assert.equal(mcu.rp2040.readUint16(FLASH_BASE), MOVS_R0_0x20, 'the image landed in flash');

    mcu.rp2040.step();   // movs r0, #0x20
    mcu.rp2040.step();   // lsls r0, r0, #24
    assert.equal(mcu.core.registers[0] >>> 0, RAM_START,
        'the stub ran from flash: r0 = 0x20 << 24 = 0x20000000');
});

test('bootFromFlash and loadProgram enter at different bases — the whole point', { skip: SKIP }, () => {
    const inSram = createRp2040jsAdapter();
    inSram.loadProgram(new Uint16Array([0x2020]));           // drop into SRAM
    assert.equal(inSram.core.PC >>> 0, RAM_START, 'loadProgram enters in SRAM');

    const inFlash = createRp2040jsAdapter();
    inFlash.bootFromFlash(new Uint8Array([0x20, 0x20]));     // place in flash
    assert.equal(inFlash.core.PC >>> 0, FLASH_BASE, 'bootFromFlash enters in flash');
});
