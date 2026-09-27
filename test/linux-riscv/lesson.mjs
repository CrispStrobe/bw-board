// The Linux LESSON path, end to end on the real kernel: the exact calls an app
// makes (lite's debug-runner), not the bare machine loop boot.mjs uses.
//
//   node test/linux-riscv/lesson.mjs <Image> <initramfs.cpio>
//
//  1. verifyLinuxMedia against the pinned SHA-256s (the media-lab manifest's
//     values) — and a one-byte-tampered initramfs is refused BY NAME;
//  2. createDebugTarget('riscv32', {linux}) + createDebugSession, pumped one
//     60 Hz frame at a time (the adapter's pacing: <= 10 ms of wall per frame)
//     until the boot progress says the prompt is up;
//  3. `uname -a` typed byte by byte through target.sendSerial (the UART FIFO),
//     and "Linux" read back from the serial console;
//  4. runRiscvLinuxBundle over a media-lab-shaped manifest, headless.
// Prints frames and wall time to the prompt — the number the app's user waits.

import {readFileSync} from 'node:fs';
// The factory's riscv32 branch, inlined: debug-target-factory.js statically
// imports every engine (avr8js…), and this workflow installs no node_modules.
import {createRiscV32Adapter} from '../../src/riscv32-adapter.js';
import {createRiscV32DebugTarget} from '../../src/riscv32-debug.js';
const createDebugTarget = async (_kind, opts) => {
    const adapter = createRiscV32Adapter(opts);
    return {target: createRiscV32DebugTarget(adapter), adapter};
};
import {createDebugSession} from '../../src/debug-session.js';
import {verifyLinuxMedia, runRiscvLinuxBundle} from '../../src/riscv32-linux-session.js';

const [kernelPath, initrdPath] = process.argv.slice(2);
if (!kernelPath || !initrdPath) { console.error('usage: node lesson.mjs <Image> <initramfs.cpio>'); process.exit(2); }

// The pins: rv32emu-prebuilt 2026.09.23-19f5a79 Image, and build.sh's initramfs
// (byte-reproducible by mkcpio.py). brickwright-media-lab projects/riscv32-linux
// pins the same two hashes.
const MANIFEST = {
    title: 'Linux on RISC-V', machine: 'riscv32',
    slots: {kernel: 'Image', initrd: 'initramfs.cpio'},
    sha256: {
        Image: '9130ceb4be18d10560cf49ac495d7f2d5dde23c33972d7a522c077cc523de1a9',
        'initramfs.cpio': 'd71915baaae4f35e32679a338885697194e4ecd7f31cbc9c69b82cd86b8edcd5'
    },
    expect: ['Linux version 6.1.188', 'BWB-LINUX-USERSPACE-UP'],
    interactive: {shellPrompt: 'bwb# ', demo: {lines: ['uname -a'], expect: ['riscv32 GNU/Linux']}}
};
const files = {Image: new Uint8Array(readFileSync(kernelPath)), 'initramfs.cpio': new Uint8Array(readFileSync(initrdPath))};
const failures = [];
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures.push(msg); };

// 1. verification, both ways.
const {kernel, initrd} = await verifyLinuxMedia(MANIFEST, files);
check(kernel.length > 4_000_000 && initrd.length > 2_000_000, 'the pinned kernel and initramfs verify');
const tampered = files['initramfs.cpio'].slice(); tampered[1000] ^= 1;
let refusal = '';
try { await verifyLinuxMedia(MANIFEST, {...files, 'initramfs.cpio': tampered}); } catch (e) { refusal = `${e.code}: ${e.message}`; }
check(/^sha256-mismatch: sha256 mismatch for Linux initrd \(initramfs\.cpio\)/.test(refusal), `a one-bit change is refused by name — ${refusal.slice(0, 90)}`);

// 2. the app's path: target + session, one frame at a time.
const {target, adapter} = await createDebugTarget('riscv32', {linux: {kernel, initrd}});
let out = '';
adapter.onSerial(b => { out += String.fromCharCode(b); });
const session = createDebugSession(target, {onChange() {}});
session.start();
const t0 = Date.now();
let frames = 0, lastPct = -1;
while (!target.linuxProgress().ready && frames < 20_000) {
    session.pump(); frames++;
    const p = target.linuxProgress();
    if (p.percent >= lastPct + 10) { lastPct = p.percent; console.log(`  frame ${frames}: ${p.phase} ${p.percent}% (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
}
const bootWall = (Date.now() - t0) / 1000;
check(target.linuxProgress().ready, `the shell prompt came up — ${frames} frames, ${bootWall.toFixed(2)} s wall, ${adapter.machine.cpu.retired} instructions`);

// 3. type into the console, read the answer.
const mark = out.length;
for (const ch of 'uname -a\r') target.sendSerial(ch.charCodeAt(0));
let f2 = 0;
while (!/Linux \S+ 6\.1\.188[\s\S]*# $/.test(out.slice(mark)) && f2 < 2000) { session.pump(); f2++; }
check(/Linux \(none\) 6\.1\.188 .*riscv32 GNU\/Linux/.test(out.slice(mark)), `uname -a answered over the UART in ${f2} frames: ${JSON.stringify(out.slice(mark).split('\n')[1] || '').slice(0, 90)}`);

// Idle costs little: 60 frames (one second) at the prompt run few instructions.
const r0 = adapter.machine.cpu.retired, w0 = Date.now();
for (let i = 0; i < 60; i++) session.pump();
const idleInstr = adapter.machine.cpu.retired - r0;
check(idleInstr < 5_000_000, `an idle second at the prompt ran ${idleInstr} instructions in ${Date.now() - w0} ms`);

// 4. the headless bundle runner over the same manifest.
const r = await runRiscvLinuxBundle(MANIFEST, files);
check(r.ok, `runRiscvLinuxBundle: ${r.ok ? 'prompt at ' + r.promptAt + ' instructions, demo answered' : r.reason}`);

console.log(`\nlesson boot: ${bootWall.toFixed(2)} s wall to the prompt in ${frames} frames`);
if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1); }
console.log('PASS: the Linux lesson path boots, answers, and refuses tampered media.');
