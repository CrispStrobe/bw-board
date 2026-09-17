// A RESET THAT BOOTS, AND AN ERASED DEVICE THAT STILL DOES NOT SLIDE.
//
// The reset vector used to point at `b .`. `core.reset()` therefore hung, and
// every caller assigned PC by hand afterwards — `resetToProgram()` and
// `bootFromFlash()` both do. That is a gap in the ROM, not in its callers.
//
// The handler now reads the first word of flash, spins if the device is erased,
// and otherwise sets the boot SP and enters the image at FLASH_BASE.
//
// WHY THE ERASED BRANCH IS NOT OPTIONAL, and why it gets a mutation of its own:
// an unconditional jump to flash on an erased part executes 0xffff, an
// undefined-instruction slide that rp2040js logs once per instruction. The
// adapter's own comment records that producing 298 MB of output. The branch is
// the difference between "reset does nothing" and "reset floods the host", and
// a test that only checked the happy path would not see it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import buildBootrom from '../src/rp2040-bootrom.js';

const FLASH_BASE = 0x10000000;

async function machine (romBytes) {
    const { RP2040 } = await import('rp2040js');
    const mcu = new RP2040();
    mcu.loadBootrom(new Uint32Array((romBytes ?? buildBootrom()).buffer));
    return mcu;                       // loadBootrom() resets, which fills flash 0xff
}

/** A two-instruction image that parks r0 at a value nothing else produces. */
function writeImage (mcu) {
    mcu.writeUint16(FLASH_BASE + 0, 0x20a5);        // movs r0, #0xa5
    mcu.writeUint16(FLASH_BASE + 2, 0xe7fe);        // b .
}

const resetVector = () => new DataView(buildBootrom().buffer).getUint32(0x04, true) & ~1;

test('a reset with an image in flash BOOTS it — no host PC assignment', async () => {
    const mcu = await machine();
    writeImage(mcu);
    mcu.core.reset();                               // the only thing the host does

    let reached = false;
    for (let i = 0; i < 200; i++) {
        if ((mcu.core.PC >>> 0) === FLASH_BASE) { reached = true; break; }
        mcu.core.executeInstruction();
    }
    assert.ok(reached, `reset never reached the flash image; PC stopped at 0x${(mcu.core.PC >>> 0).toString(16)}`);

    // Run the image's first instruction so this proves ENTRY, not just arrival.
    mcu.core.executeInstruction();
    assert.equal(mcu.core.registers[0], 0xa5, 'the image did not execute after entry');
    // And the boot stack pointer is the one the handler installs.
    assert.equal(mcu.core.SP >>> 0, 0x20042000, 'the boot SP was not installed');
});

test('an ERASED device spins instead of sliding through 0xffff', async () => {
    const mcu = await machine();                    // flash left at 0xff
    mcu.core.reset();
    for (let i = 0; i < 200; i++) mcu.core.executeInstruction();
    const pc = mcu.core.PC >>> 0;
    assert.ok(pc < 0x4000, `an erased device left the ROM and is executing at 0x${pc.toString(16)}`);
    assert.ok(pc >= resetVector(), 'PC is below the reset handler, which is not the spin');
});

test('MUTATION: without the erased check, an erased device slides out of the ROM', async () => {
    // Patch the `beq rst_erased` to a NOP so the handler falls through and
    // jumps to flash unconditionally. If the erased device still spins after
    // that, the check was never the thing keeping it there and the test above
    // proves nothing.
    const rom = buildBootrom();
    const view = new DataView(rom.buffer);
    const at = resetVector() + 8;                   // 5th halfword: the beq
    const was = view.getUint16(at, true);
    assert.equal(was & 0xff00, 0xd000, `expected a conditional branch at 0x${at.toString(16)}, found 0x${was.toString(16)}`);
    view.setUint16(at, 0x46c0, true);               // nop (mov r8, r8)

    const mcu = await machine(rom);
    mcu.core.reset();
    let left = false;
    for (let i = 0; i < 200; i++) {
        if ((mcu.core.PC >>> 0) >= FLASH_BASE) { left = true; break; }
        mcu.core.executeInstruction();
    }
    assert.ok(left,
        'with the erased check removed the device still stayed in the ROM — the check is not what '
        + 'stops the slide, so the erased-device test above is not testing what it claims');
});
