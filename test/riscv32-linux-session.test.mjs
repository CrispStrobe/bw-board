// The Linux-as-a-lesson layer without a kernel: media verification refuses by
// name, boot progress reads the right markers, and the `linux` adapter option
// plus the riscv32 DebugTarget carry console input to the 16550A and output
// back — driven through createDebugSession, the way an app's debugger drives
// it. A tiny S-mode stand-in plays the kernel (prints the markers a real boot
// prints, then echoes the UART), so every assertion here has a separating
// state. The real kernel runs in test/linux-riscv/lesson.mjs (linux-riscv.yml).

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assembleRiscv} from '../src/riscv-asm.js';
import {createDebugTarget} from '../src/debug-target-factory.js';
import {createDebugSession} from '../src/debug-session.js';
import {
    verifyLinuxMedia, linuxMediaSlots, createLinuxBootProgress, runRiscvLinuxBundle, LINUX_MACHINE_CONFIG
} from '../src/riscv32-linux-session.js';

const RAM = LINUX_MACHINE_CONFIG.ramBase;

// A "kernel": S-mode, satp = 0 (bare), so the UART is reachable at its physical
// address. Prints what a real boot prints, then echoes every received byte.
function fakeKernel({banner = 'Linux version 6.1.0-fake\nRun /init as init process\nBWB-LINUX-USERSPACE-UP\nbwb# '} = {}) {
    const src = `
        .text
_start: lui s0, 0x10000
        la a0, msg
puts:   lbu t0, 0(a0)
        beqz t0, echo
        sb t0, 0(s0)
        addi a0, a0, 1
        j puts
echo:   lbu t1, 5(s0)
        andi t1, t1, 1
        beqz t1, echo
        lbu t2, 0(s0)
        sb t2, 0(s0)
        j echo
        .data
msg:    .string ${JSON.stringify(banner)}
`;
    const asm = assembleRiscv(src, {textBase: RAM, dataBase: RAM + 0x1000});
    assert.ok(asm.ok, JSON.stringify(asm.errors || asm.error));
    const img = asm.image;
    const flat = new Uint8Array(0x2000);
    for (const {addr, bytes} of img.segments) flat.set(bytes, addr - RAM);
    return flat;
}
const sha = b => createHash('sha256').update(b).digest('hex');

test('linuxMediaSlots reads string and object slots and the top-level sha map', () => {
    const slots = linuxMediaSlots({slots: {kernel: 'Image', initrd: {url: 'https://x/y/initramfs.cpio', sha256: 'AB'}},
        sha256: {Image: 'cd'}});
    assert.deepEqual(slots, [
        {slot: 'kernel', file: 'Image', url: null, sha256: 'cd'},
        {slot: 'initrd', file: 'initramfs.cpio', url: 'https://x/y/initramfs.cpio', sha256: 'ab'}
    ]);
});

test('verifyLinuxMedia accepts matching bytes and refuses a mismatch BY NAME', async () => {
    const kernel = new Uint8Array([1, 2, 3]), initrd = new Uint8Array([4, 5]);
    const manifest = {slots: {kernel: 'Image', initrd: 'initramfs.cpio'},
        sha256: {Image: sha(kernel), 'initramfs.cpio': sha(initrd)}};
    const ok = await verifyLinuxMedia(manifest, {Image: kernel, 'initramfs.cpio': initrd});
    assert.equal(ok.kernel, kernel);
    assert.equal(ok.initrd, initrd);
    assert.deepEqual(ok.verified.map(v => v.slot), ['kernel', 'initrd']);

    const tampered = new Uint8Array([4, 6]);
    await assert.rejects(() => verifyLinuxMedia(manifest, {Image: kernel, 'initramfs.cpio': tampered}), e => {
        assert.equal(e.code, 'sha256-mismatch');
        assert.match(e.message, /Linux initrd \(initramfs\.cpio\)/, 'names the slot and the file');
        assert.ok(e.message.includes(sha(initrd)) && e.message.includes(sha(tampered)), 'states both hashes');
        return true;
    });
});

test('verifyLinuxMedia refuses unpinned and missing media', async () => {
    await assert.rejects(() => verifyLinuxMedia({slots: {kernel: 'Image'}}, {Image: new Uint8Array(1)}),
        e => e.code === 'unpinned-media' && /kernel \(Image\)/.test(e.message));
    await assert.rejects(() => verifyLinuxMedia({slots: {kernel: 'Image'}, sha256: {Image: 'aa'}}, {}),
        e => e.code === 'missing-media');
    await assert.rejects(() => verifyLinuxMedia({slots: {initrd: 'x'}}, {}),
        e => e.code === 'missing-media' && /no kernel slot/.test(e.message));
});

test('boot progress: instructions before the console, markers after, ready only at a prompt after userspace', () => {
    const p = createLinuxBootProgress({expectedInstructions: 1000});
    assert.deepEqual(p.state(500), {phase: 'starting', percent: 50, ready: false});
    const feed = s => { for (const ch of s) p.feed(ch.charCodeAt(0)); };
    feed('[    0.0] Linux version 6.1.188 (x)\r\n');
    assert.equal(p.state(900).phase, 'kernel');
    feed('# '); // a '#' before userspace is not the shell
    assert.equal(p.ready, false);
    feed('\r\n[    4.6] Run /init as init process\r\nBWB-LINUX-USERSPACE-UP\r\n');
    assert.equal(p.state(5000).phase, 'userspace');
    assert.equal(p.state(5000).percent, 99, 'capped below 100 until the prompt');
    feed('bwb# ');
    assert.deepEqual(p.state(5000), {phase: 'prompt', percent: 100, ready: true});
});

test('the linux adapter + DebugTarget: a debug session boots, reads progress, and echoes UART input', async () => {
    const kernel = fakeKernel();
    const {target, adapter} = await createDebugTarget('riscv32', {linux: {kernel}});
    assert.ok(target, 'riscv32 now has a DebugTarget (createDebugSession(null) throws)');
    assert.equal(adapter.mode, 'linux');
    assert.equal(target.capabilities().extensions.mode, 'linux');
    assert.equal(adapter.machine.ramBase, RAM);
    assert.equal(adapter.machine.memSize, 1 << 26);
    let out = '';
    adapter.onSerial(b => { out += String.fromCharCode(b); });
    const session = createDebugSession(target, {onChange() {}});
    session.start();                               // start() resets: for Linux that REBOOTS
    for (let i = 0; i < 50 && !target.linuxProgress().ready; i++) session.pump();
    assert.deepEqual(target.linuxProgress(), {phase: 'prompt', percent: 100, ready: true});
    assert.match(out, /BWB-LINUX-USERSPACE-UP\nbwb# $/);

    for (const ch of 'uname\r') assert.equal(target.sendSerial(ch.charCodeAt(0)), true);
    for (let i = 0; i < 20 && !out.endsWith('uname\r'); i++) session.pump();
    assert.ok(out.endsWith('bwb# uname\r'), `the typed bytes came back through the UART: ${JSON.stringify(out.slice(-20))}`);

    // Reset reboots: a fresh machine, the banner again, the listener kept.
    const before = adapter.machine;
    target.reset();
    assert.notEqual(adapter.machine, before, 'a Linux reset builds a fresh machine');
    assert.equal(target.linuxProgress().ready, false);
    out = '';
    session.start();
    for (let i = 0; i < 50 && !target.linuxProgress().ready; i++) session.pump();
    assert.match(out, /^Linux version/);
});

test('the DebugTarget pauses, steps one instruction, and stops at a code breakpoint', async () => {
    const {target} = await createDebugTarget('riscv32', {linux: {kernel: fakeKernel()}});
    const halts = [];
    target.onHalt(w => halts.push(w));
    target.run();
    assert.equal(target.regs().pc, RAM);
    target.halt();
    assert.equal(halts.at(-1).cause, 'pause');
    assert.equal(target.state(), 'halted');
    assert.equal(target.runFor(1000), 'halted', 'a halted target does not run');

    target.step('insn', 1);
    assert.equal(target.runFor(1000), 'halted');
    assert.equal(halts.at(-1).cause, 'step');
    assert.equal(target.regs().pc, RAM + 4, 'exactly one instruction (the lui)');
    assert.equal(target.regs().s0, 0x10000000);

    const bp = target.setBreakpoint({kind: 'code', addr: RAM + 8});
    target.run();
    assert.equal(target.runFor(1000), 'halted');
    assert.deepEqual([halts.at(-1).cause, halts.at(-1).bp, halts.at(-1).pc], ['breakpoint', bp, RAM + 8]);
    assert.deepEqual(target.step('over'), {unsupported: "step kind 'over' not supported on RISC-V (instruction steps only)"});
    assert.equal(target.readMem('mem', RAM, 4).length, 4);
    assert.deepEqual([...target.readMem('mem', RAM, 4)], [...fakeKernel().subarray(0, 4)],
        'physical reads at ramBase return the loaded kernel bytes');
    assert.deepEqual([...target.readMem('mem', 0, 2)], [0, 0], 'outside RAM reads as zero');
});

test('pacing: a busy frame stops at the wall allowance or the instruction cap, never runs away', async () => {
    let t = 0;
    const {target, adapter} = await createDebugTarget('riscv32',
        {linux: {kernel: fakeKernel(), now: () => (t += 4), wallMs: 10, maxInstructionsPerAdvance: 1_000_000}});
    target.run();
    const r0 = adapter.machine.cpu.retired;
    assert.equal(target.runFor(16_666_667), 'budget');
    const ran = adapter.machine.cpu.retired - r0;
    // now() advances 4 ms a call: deadline = 4 + 10, checked after each 5k chunk → 3 chunks.
    assert.equal(ran, 15_000, `ran ${ran}`);
    const {adapter: capped} = await createDebugTarget('riscv32',
        {linux: {kernel: fakeKernel(), now: () => 0, maxInstructionsPerAdvance: 100_000}});
    capped.advanceNs(16_666_667);
    assert.equal(capped.machine.cpu.retired, 100_000, 'the per-frame instruction cap holds when the wall clock does not move');
});

test('a program-image riscv32 target runs to exit through a debug session', async () => {
    // write(1, "HI\n", 3); exit(0) — the ecall ABI; the same program the target test uses.
    const asm = assembleRiscv(`
        .text
_start: li a0, 1
        la a1, s
        li a2, 3
        li a7, 64
        ecall
        li a0, 0
        li a7, 93
        ecall
        .data
s:      .ascii "HI\\n"
`, {textBase: 0, dataBase: 0x400});
    assert.ok(asm.ok, JSON.stringify(asm.errors || asm.error));
    const {target, adapter} = await createDebugTarget('riscv32', {image: asm.image});
    assert.equal(adapter.mode, 'program');
    assert.equal(target.linuxProgress(), null);
    let out = '';
    adapter.onSerial(b => { out += String.fromCharCode(b); });
    const halts = [];
    target.onHalt(w => halts.push(w));
    target.run();
    for (let i = 0; i < 10 && target.state() === 'running'; i++) target.runFor(100_000);
    assert.equal(out, 'HI\n');
    assert.equal(halts.at(-1).cause, 'exited');
    assert.equal(halts.at(-1).exitCode, 0);
    assert.equal(adapter.sendSerial(0x41), true, 'console input reaches the UART on a program machine too');
});

test('runRiscvLinuxBundle: verify, boot to the prompt, type the demo line, check expect', async () => {
    const kernel = fakeKernel();
    const manifest = {machine: 'riscv32', slots: {kernel: 'Image'}, sha256: {Image: sha(kernel)},
        interactive: {demo: {lines: ['echo hi'], expect: ['echo hi']}}, expect: ['Linux version']};
    // The echo "kernel" never prints a second prompt, so the command cannot
    // return — the runner must say so rather than hang or pass.
    const r = await runRiscvLinuxBundle(manifest, {Image: kernel}, {maxInstructions: 2_000_000});
    assert.equal(r.ok, false);
    assert.match(r.reason, /"echo hi" did not return to the prompt/);
    assert.ok(r.promptAt > 0, 'it did reach the prompt first');
    await assert.rejects(() => runRiscvLinuxBundle({...manifest, sha256: {Image: sha(new Uint8Array(3))}}, {Image: kernel}),
        /sha256 mismatch for Linux kernel \(Image\)/);
    await assert.rejects(() => runRiscvLinuxBundle({...manifest, machine: 'i8086'}, {Image: kernel}), /not 'i8086'/);
    const noCmd = await runRiscvLinuxBundle(manifest, {Image: kernel}, {commands: [], maxInstructions: 2_000_000});
    assert.equal(noCmd.ok, true, noCmd.reason);
});
