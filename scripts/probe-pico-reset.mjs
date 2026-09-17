/**
 * ROADMAP R1: what does MicroPython's `machine.reset()` actually do here?
 *
 * R1's definition of done asks for a frozen-step probe that reproduces RED
 * before the fix and green after. This is it. It boots MicroPython, reaches the
 * REPL, calls `machine.reset()`, and reports what happens instead of a reboot.
 *
 * WHAT IT ESTABLISHES, and it is narrower and more useful than "it freezes":
 * the adapter's reset SEAM WORKS. `machine.reset()` reaches
 * `watchdog.onWatchdogTrigger`, which fires `onResetRequest` exactly once with a
 * named cause and the entry the program was booted at, and `takeResetRequest()`
 * returns it. The core then parks — deliberately; the adapter's comment says a
 * real reboot must replace the whole SoC and leaves that to its host. Nothing
 * constructs that replacement, so the machine stops there. The defect is a
 * MISSING CONSUMER, not a broken mechanism, and those need different fixes.
 *
 * THE IDLE CAP IS THE LOAD-BEARING PART OF THE RUN LOOP, and it is bounded by
 * ITERATIONS, not only by simulated time. A parked core advances the clock and
 * never the instruction counter, so a budget measured in steps can never be
 * exhausted — an uncapped loop spins for ever. That cost 15 minutes and a wrong
 * "blocked on box capacity" entry in the roadmap before it was understood. And
 * a cap denominated only in simulated nanoseconds is not enough either: with no
 * alarm pending each tick advances ~8 ns, so a 2-second cap needs ~250 million
 * iterations and still looks like a hang for tens of seconds. Bound both.
 *
 * FIRMWARE DISCIPLINE, as in probe-sf-unaligned.mjs: the path comes from
 * $BW_PICO_MICROPYTHON_UF2 or --uf2, the sha256 is checked and PRINTED on every
 * run, and a mismatch refuses. This probe never fetches — a reading must not
 * depend on the network, and "a file is present" is not "the build the last
 * reading used".
 *
 * Usage: BW_PICO_MICROPYTHON_UF2=<path> node scripts/probe-pico-reset.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { USBCDC } from 'rp2040js';
import { createRp2040jsAdapter } from '../src/rp2040js-adapter.js';

const KNOWN_SHA256 = 'e92c2a253d2d4830d56cd6aebae1bbc6c913f413122dabba3cc2de74b984bba9';
const KNOWN_NAME = 'RPI_PICO-20240222-v1.22.2.uf2';
const hex = n => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

const argv = process.argv;
const at = argv.indexOf('--uf2');
const uf2Path = at >= 0 && argv[at + 1] ? argv[at + 1] : process.env.BW_PICO_MICROPYTHON_UF2;
const anyFirmware = argv.includes('--any-firmware');

if (!uf2Path) {
    console.error(`no firmware. Set $BW_PICO_MICROPYTHON_UF2 or pass --uf2 PATH.

Expected ${KNOWN_NAME}, sha256 ${KNOWN_SHA256}
(MicroPython v1.22.2 for the Pico, the build R1's triage used. This probe never
fetches: it reads a file you already have, so a reading cannot depend on the
network.)`);
    process.exit(1);
}
if (!fs.existsSync(uf2Path)) {
    console.error(`no firmware at ${uf2Path} -- named rather than left as a stack trace.`);
    process.exit(1);
}
const uf2 = fs.readFileSync(uf2Path);
const digest = createHash('sha256').update(uf2).digest('hex');
if (digest !== KNOWN_SHA256 && !anyFirmware) {
    console.error(`firmware is NOT the build this probe's readings were taken against.
    expected ${KNOWN_SHA256}
    got      ${digest}
A different oracle makes every number below a measurement of something else.
Pass --any-firmware to proceed deliberately.`);
    process.exit(1);
}

const dv = new DataView(uf2.buffer, uf2.byteOffset, uf2.byteLength);
let base = null, image = new Uint8Array(0);
for (let i = 0; i < Math.floor(uf2.length / 512); i++) {
    const o = i * 512;
    if (dv.getUint32(o, true) !== 0x0a324655 || dv.getUint32(o + 4, true) !== 0x9e5d5157) {
        throw new Error(`UF2 block ${i} has bad magic`);
    }
    const addr = dv.getUint32(o + 12, true), size = dv.getUint32(o + 16, true);
    if (base === null) base = addr;
    const off = addr - base;
    if (off + size > image.length) { const g = new Uint8Array(off + size); g.set(image); image = g; }
    image.set(uf2.subarray(o + 32, o + 32 + size), off);
}

console.log(`firmware        ${path.basename(uf2Path)}  ${image.length} bytes at ${hex(base)}`);
console.log(`firmware sha256 ${digest}${digest === KNOWN_SHA256 ? '  (the expected build)' : '  *** NOT the expected build ***'}`);

let resetEvents = 0;
const adapter = createRp2040jsAdapter({
    onResetRequest: r => { resetEvents++; console.log(`  onResetRequest  ${JSON.stringify(r)}`); }
});
const { rp2040, core } = adapter;
adapter.bootFromFlash(image);      // the documented entry, so entryPC is not stale

const state = { steps: 0, usb: '', connected: false };
const cdc = new USBCDC(rp2040.usbCtrl);
cdc.onDeviceConnected = () => { state.connected = true; };
cdc.onSerialData = buf => { for (const b of buf) state.usb += String.fromCharCode(b); };

const clock = rp2040.clock, cycleNanos = 1e9 / adapter.clockHz;
/**
 * @param done  stop when this returns true
 * @param budget  instruction budget — CANNOT bound a parked core, see header
 * @param idleIters  iteration bound while parked; this is what actually stops it
 */
function run (done, budget, idleIters = 2_000_000) {
    const limit = state.steps + budget;
    let idle = 0;
    while (state.steps < limit) {
        if (done && done()) return 'done';
        if (core.waiting) {
            const toAlarm = clock.nanosToNextAlarm;
            clock.tick(toAlarm > 0 ? toAlarm : cycleNanos);
            if (++idle > idleIters) return 'IDLE-CAP (core parked, not executing)';
            continue;
        }
        idle = 0;
        try { core.executeInstruction(); } catch (e) { return `exception at ${hex(core.PC)}: ${e.message}`; }
        clock.tick(cycleNanos);
        state.steps++;
    }
    return 'budget';
}

console.log('');
console.log(`enumerate       ${run(() => state.connected, 10_000_000)} at ${state.steps}`);
run(null, 200_000);
for (const c of '\r\n') cdc.sendSerialByte(c.charCodeAt(0));
console.log(`REPL prompt     ${run(() => />>>/.test(state.usb), 10_000_000)} at ${state.steps}`);
const mark = state.usb.length;
for (const c of 'import machine\r') cdc.sendSerialByte(c.charCodeAt(0));
console.log(`import machine  ${run(() => state.usb.slice(mark).includes('>>>'), 5_000_000)} at ${state.steps}`);

// REPORT AN ABSOLUTE COUNT ALONGSIDE THE RELATIVE ONE, because a number
// labelled loosely becomes a wrong anchor later. Two readings of this defect
// quoted 388,155 and 119,993 instructions; both were correct and measured from
// different origins — the REPL prompt and `import machine` respectively, which
// end at the same absolute step. The relative figure below is measured from
// `import machine`; the absolute one needs no origin to be quoted against.
const beforeReset = state.usb.length, stepsAtReset = state.steps;
console.log('');
console.log('--- machine.reset() ---');
for (const c of 'machine.reset()\r') cdc.sendSerialByte(c.charCodeAt(0));
const why = run(() => state.usb.slice(beforeReset).includes('MicroPython'), 20_000_000);

const rebooted = state.usb.slice(beforeReset).includes('MicroPython');
console.log(`outcome         ${why}`);
console.log(`                ${state.steps - stepsAtReset} instructions from \`import machine\` to stop`);
console.log(`                ${state.steps} total instructions; the stop is at this absolute count`);
console.log(`onResetRequest  fired ${resetEvents} time(s)`);
console.log(`takeResetRequest ${JSON.stringify(adapter.takeResetRequest())}`);
console.log(`core.waiting    ${core.waiting}`);
console.log(`PC              ${hex(core.PC)}`);
console.log(`second banner   ${rebooted ? 'YES -- it rebooted' : 'no -- it did not reboot (R1)'}`);
console.log('');
console.log(rebooted
    ? 'R1 IS FIXED on this tree: the machine rebooted after machine.reset().'
    : 'R1 REPRODUCES: the seam fired and the core parked, because nothing built\n'
      + 'the replacement SoC. That is a missing consumer, not a broken mechanism.');
process.exit(rebooted ? 0 : 1);
