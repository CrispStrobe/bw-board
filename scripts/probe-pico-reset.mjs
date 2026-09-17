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
 * SINCE 2026-09-17 IT ALSO CONSUMES THE REQUEST. `replaceSoC()` builds a fresh
 * SoC carrying the preserved flash, and this probe does the HOST half the
 * adapter cannot: re-attaching a USBCDC to the new `usbCtrl`. If a second
 * MicroPython banner then appears, R1 is fixed and the exit status is 0.
 * `--no-replace` skips the replacement to reproduce the original parked
 * behaviour, which is what the RED half of the DoD wants.
 *
 * Usage: BW_PICO_MICROPYTHON_UF2=<path> node scripts/probe-pico-reset.mjs
 *        [--no-replace]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { USBCDC } from 'rp2040js';
import { createRp2040jsAdapter, replaceSoC } from '../src/rp2040js-adapter.js';

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
const noReplace = argv.includes('--no-replace');
const onResetRequest = r => { resetEvents++; console.log(`  onResetRequest  ${JSON.stringify(r)}`); };

// The machine is REBINDABLE, because replacing the SoC replaces every object
// below. A loop that closed over the first `core` would keep driving the
// discarded one and report a reboot that never happened.
let adapter = createRp2040jsAdapter({ onResetRequest });
let core = adapter.core;
let clock = adapter.rp2040.clock;
const cycleNanos = 1e9 / adapter.clockHz;
adapter.bootFromFlash(image);      // the documented entry, so entryPC is not stale

const state = { steps: 0, usb: '', connected: false };
let cdc;
/** The host half: a new SoC has a new usbCtrl, so the CDC must be re-attached. */
function bindHost () {
    state.connected = false;
    cdc = new USBCDC(adapter.rp2040.usbCtrl);
    cdc.onDeviceConnected = () => { state.connected = true; };
    cdc.onSerialData = buf => { for (const b of buf) state.usb += String.fromCharCode(b); };
}
bindHost();

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

// REPORT AN ABSOLUTE COUNT ALONGSIDE ANY RELATIVE ONE: two readings of this
// defect quoted 388,155 and 119,993 instructions and both were correct,
// measured from the REPL prompt and from `import machine`. The absolute figure
// needs no origin to be quoted against.
const stepsAtReset = state.steps;
console.log('');
console.log('--- machine.reset() ---');
for (const c of 'machine.reset()\r') cdc.sendSerialByte(c.charCodeAt(0));
const parked = run(() => resetEvents > 0 && core.waiting, 20_000_000);
console.log(`park            ${parked}`);
console.log(`                ${state.steps - stepsAtReset} instructions from \`import machine\`; ${state.steps} absolute`);
console.log(`onResetRequest  fired ${resetEvents} time(s)`);

let rebooted = false;
if (resetEvents === 0) {
    console.log('no reset request was ever surfaced — the watchdog seam did not fire');
} else if (noReplace) {
    console.log('--no-replace: leaving the SoC parked, which is R1 unfixed');
} else {
    const request = adapter.takeResetRequest();
    console.log(`takeResetRequest ${JSON.stringify(request)}`);
    console.log('');
    console.log('--- replaceSoC() + host rebind ---');
    adapter = replaceSoC(adapter);
    core = adapter.core;
    clock = adapter.rp2040.clock;
    bindHost();                                   // the half the adapter cannot do
    const before = state.usb.length;
    const why = run(() => state.connected, 20_000_000);
    console.log(`re-enumerate    ${why} at ${state.steps}`);

    // PROVE LIFE THE SAME WAY THE FIRST BOOT DID: knock, and wait for the
    // prompt. NOT by waiting for the banner.
    //
    // MicroPython writes its banner the instant the REPL starts, and
    // mp_hal_stdout_tx_strn DROPS every byte until CDC reports DTR — so on a
    // machine that enumerates later the banner is simply gone, and a probe
    // waiting for it reads a healthy boot as a hang. Lite's own
    // probe-pico-micropython.mjs carries that warning in its comments, and
    // this probe walked into it anyway on the first attempt: it reported
    // "second banner not seen" about a SoC that had already re-enumerated USB.
    // The first boot above never trusted the banner either; using a weaker
    // instrument for the second reading than the first is how that slipped
    // past.
    for (const c of '\r\n') cdc.sendSerialByte(c.charCodeAt(0));
    const prompt = run(() => />>>/.test(state.usb.slice(before)), 20_000_000);
    rebooted = />>>/.test(state.usb.slice(before));
    console.log(`second prompt   ${prompt} -> ${rebooted ? 'REACHED' : 'not reached'}`);
    const banner = state.usb.slice(before).includes('MicroPython');
    console.log(`banner          ${banner ? 'seen' : 'not seen (expected: dropped before DTR)'}`);
    if (rebooted) console.log(`                ${JSON.stringify(state.usb.slice(before).trim().slice(-60))}`);
}

console.log('');
console.log(rebooted
    ? 'R1 IS FIXED on this tree: machine.reset() replaced the SoC and MicroPython\n'
      + 'came back to a live REPL prompt on the new machine.'
    : 'R1 NOT FIXED here: the replacement did not reach a prompt. What the seam and\n'
      + 'the re-enumeration did is printed above; read those before concluding.');
process.exit(rebooted ? 0 : 1);
