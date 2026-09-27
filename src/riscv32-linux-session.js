/**
 * Linux on the RV32 machine as something a host can RUN, not just boot:
 * verify the media by SHA-256, build the machine the kernel expects, report
 * boot progress, and drive the shell over the UART.
 *
 * riscv32-linux.js does the firmware hand-off (device tree, S-mode entry). This
 * module sits one layer above it and is what the debug adapter (`linux` option)
 * and the media-lab bundle runner share, so an app, a CLI and a test boot Linux
 * through one code path.
 *
 * NOTHING GPL LIVES HERE. The kernel (GPL-2.0), busybox (GPL-2.0) and glibc
 * (LGPL-2.1) are the caller's bytes — fetched from the media-lab origin and
 * checked against the manifest's sha256 before a single instruction runs. A
 * mismatch is refused BY NAME (which slot, which file, both hashes), never
 * booted "to see what happens".
 *
 * Browser-safe: Web Crypto for the hash, no Node imports.
 *
 * @module
 */
import {RiscV32Machine} from './riscv32-machine.js';
import {bootLinux} from './riscv32-linux.js';

/** The machine a stock rv32 Linux (Sv32, SBI, PLIC, 16550A) boots on: 64 MiB
 *  of RAM at the `virt` base, the UART on PLIC source 10 (the device tree
 *  riscv32-linux.js writes says so). */
export const LINUX_MACHINE_CONFIG = Object.freeze({memSize: 1 << 26, ramBase: 0x80000000, uartIrq: 10});

/** Nanoseconds per mtime tick: riscv32-linux.js declares a 10 MHz timebase. */
export const LINUX_NS_PER_TICK = 100;

/**
 * Where a boot is, read from what the kernel and init print. Instructions are
 * the only signal during the first ~75% of a boot — this kernel has no early
 * console, so nothing reaches the UART until the 8250 driver registers and the
 * log buffer is replayed — which is why `progress()` is instruction-based and
 * the phases only refine it.
 */
export const LINUX_BOOT_PHASES = Object.freeze([
    {id: 'kernel', re: /Linux version \S+/},
    {id: 'console', re: /console \[ttyS0\] enabled/},
    {id: 'init', re: /Run \/init as init process/},
    {id: 'userspace', re: /BWB-LINUX-USERSPACE-UP/},
]);

/** Instructions from reset to the shell prompt, measured on this kernel +
 *  initramfs (68.0M, test/linux-riscv/boot.mjs). Only a progress denominator:
 *  the prompt itself is what says a boot finished. */
export const LINUX_BOOT_INSTRUCTIONS = 68_000_000;

/** A shell prompt at the end of the output: busybox sh prints `<PS1>` and
 *  waits. The media's /etc/profile sets PS1="bwb# "; any `# ` or `$ ` ending
 *  the stream after userspace is up counts. */
export const LINUX_PROMPT = /[#$] $/;

/** Lower-case hex SHA-256 of `bytes` (Web Crypto: browsers and Node >= 18). */
export async function sha256Hex(bytes) {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) throw new Error('Web Crypto (crypto.subtle) is unavailable, so the Linux media cannot be verified');
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const digest = await subtle.digest('SHA-256', view.slice().buffer);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The media slots a Linux bundle declares: `kernel` (a RISC-V `Image`) and an
 * optional `initrd` (a newc cpio). A slot is `"file"` or `{file|url, sha256}`;
 * the manifest's top-level `sha256` map (`{file: hex}`) is the other place a
 * media-lab manifest states hashes.
 * @returns {{slot: string, file: string, sha256: string|null, url: string|null}[]}
 */
export function linuxMediaSlots(manifest) {
    const slots = (manifest && manifest.slots) || {};
    const hashes = (manifest && manifest.sha256) || {};
    const out = [];
    for (const slot of ['kernel', 'initrd']) {
        const v = slots[slot];
        if (v == null) continue;
        const file = typeof v === 'string' ? v : (v.file || (v.url ? String(v.url).split('/').pop() : null));
        const url = typeof v === 'object' && v.url ? v.url : null;
        const sha = (typeof v === 'object' && v.sha256) || hashes[file] || null;
        out.push({slot, file, url, sha256: sha ? String(sha).toLowerCase() : null});
    }
    return out;
}

/**
 * Check every declared slot's bytes against its sha256 BEFORE booting.
 * Refuses by name: a missing kernel, a slot with no declared hash, or a hash
 * mismatch each throw an Error whose `code` is `missing-media`,
 * `unpinned-media` or `sha256-mismatch` and whose message names the slot and
 * the file (and both hashes for a mismatch).
 *
 * @param {object} manifest a brickwright-media.json (machine 'riscv32', slots kernel/initrd)
 * @param {Record<string, Uint8Array>} files bytes by FILE name (or by slot name)
 * @returns {Promise<{kernel: Uint8Array, initrd?: Uint8Array, verified: object[]}>}
 */
export async function verifyLinuxMedia(manifest, files) {
    const slots = linuxMediaSlots(manifest);
    const refuse = (code, msg) => { const e = new Error(msg); e.code = code; throw e; };
    if (!slots.some(s => s.slot === 'kernel')) refuse('missing-media', 'the Linux manifest names no kernel slot');
    const bytes = {};
    const verified = [];
    for (const s of slots) {
        const b = files[s.file] || files[s.slot];
        if (!(b instanceof Uint8Array)) refuse('missing-media', `Linux ${s.slot} (${s.file}) was not supplied`);
        if (!s.sha256) refuse('unpinned-media', `Linux ${s.slot} (${s.file}) has no sha256 in the manifest — refusing to boot unpinned media`);
        const got = await sha256Hex(b);
        if (got !== s.sha256) {
            refuse('sha256-mismatch', `sha256 mismatch for Linux ${s.slot} (${s.file}): expected ${s.sha256}, got ${got} — refusing to boot`);
        }
        bytes[s.slot] = b;
        verified.push({slot: s.slot, file: s.file, sha256: got, size: b.length});
    }
    return {kernel: bytes.kernel, initrd: bytes.initrd, verified};
}

/**
 * Build the machine and hand off to the kernel. Synchronous: the bytes must
 * already be verified (verifyLinuxMedia) — this never hashes.
 *
 * @param {{kernel: Uint8Array, initrd?: Uint8Array, bootargs?: string, onSerial?: (b:number)=>void}} opts
 * @returns {{machine: RiscV32Machine, layout: object}}
 */
export function createRiscvLinuxMachine(opts) {
    if (!(opts && opts.kernel instanceof Uint8Array)) throw new Error('createRiscvLinuxMachine needs the kernel Image bytes');
    const machine = new RiscV32Machine({...LINUX_MACHINE_CONFIG}, {onSerial: opts.onSerial});
    const layout = bootLinux(machine, {kernel: opts.kernel, initrd: opts.initrd, bootargs: opts.bootargs});
    return {machine, layout};
}

/**
 * Boot progress from the serial stream and the retired-instruction count.
 * Feed it every byte; ask it `state(retired)` whenever the host repaints.
 */
export function createLinuxBootProgress({expectedInstructions = LINUX_BOOT_INSTRUCTIONS} = {}) {
    // Line-at-a-time: a phase marker is tested once per completed line and the
    // prompt once per space, so a whole boot log costs a few thousand short
    // regex tests rather than one per byte over the whole log.
    let line = '';
    const reached = new Set();
    let promptSeen = false;
    return {
        feed(byte) {
            const ch = String.fromCharCode(byte & 0xff);
            if (ch === '\n') {
                for (const p of LINUX_BOOT_PHASES) if (!reached.has(p.id) && p.re.test(line)) reached.add(p.id);
                line = '';
                return;
            }
            if (line.length < 512) line += ch;
            if (ch === ' ' && !promptSeen && reached.has('userspace') && LINUX_PROMPT.test(line)) promptSeen = true;
        },
        /** @returns {{phase: string, percent: number, ready: boolean}} */
        state(retired = 0) {
            const ready = promptSeen;
            let phase = 'starting';
            for (const p of LINUX_BOOT_PHASES) if (reached.has(p.id)) phase = p.id;
            if (ready) phase = 'prompt';
            const percent = ready ? 100 : Math.min(99, Math.floor(100 * Number(retired) / expectedInstructions));
            return {phase, percent, ready};
        },
        get ready() { return promptSeen; }
    };
}

/**
 * Run a media-lab Linux bundle headless: verify, boot to the prompt, type each
 * line of `manifest.interactive.demo.lines` (or `opts.commands`) and wait for
 * the next prompt, then check `manifest.expect` (+ the demo's `expect`).
 * `manifest.steps`, when a number, is the instruction budget. The CLI/test face of the same path the debug adapter drives.
 *
 * @param {object} manifest brickwright-media.json
 * @param {Record<string, Uint8Array>} files bytes by file name
 * @param {{commands?: string[], maxInstructions?: number, chunk?: number}} [opts]
 * @returns {Promise<{ok: boolean, output: string, reason?: string, instructions: number, verified: object[], promptAt?: number}>}
 */
export async function runRiscvLinuxBundle(manifest, files, opts = {}) {
    if (manifest && manifest.machine && manifest.machine !== 'riscv32') {
        throw new Error(`runRiscvLinuxBundle runs riscv32 bundles, not '${manifest.machine}'`);
    }
    const {kernel, initrd, verified} = await verifyLinuxMedia(manifest, files);
    let output = '';
    const progress = createLinuxBootProgress();
    const {machine} = createRiscvLinuxMachine({
        kernel, initrd, bootargs: manifest.bootargs,
        onSerial: b => { output += String.fromCharCode(b); progress.feed(b); }
    });
    const max = opts.maxInstructions ?? (Number.isFinite(manifest.steps) ? manifest.steps : 400_000_000);
    const chunk = opts.chunk ?? 1_000_000;
    const retired = () => machine.cpu.retired;
    const runUntil = cond => {
        while (!cond() && !machine.halted && retired() < max) machine.run(chunk);
        return cond();
    };
    if (!runUntil(() => progress.ready)) {
        return {ok: false, output, instructions: retired(), verified,
            reason: machine.halted ? 'the machine halted before a shell prompt' : 'no shell prompt within the instruction budget'};
    }
    const promptAt = retired();
    const demo = (manifest.interactive && manifest.interactive.demo) || {};
    const commands = opts.commands || (Array.isArray(demo.lines) ? demo.lines : []);
    for (const cmd of commands) {
        const mark = output.length;
        for (const ch of `${cmd}\n`) machine.uart.rxPush(ch.charCodeAt(0));
        const answered = () => {
            const tail = output.slice(mark);
            return tail.includes(cmd) && LINUX_PROMPT.test(tail) && tail.length > cmd.length + 2;
        };
        if (!runUntil(answered)) {
            return {ok: false, output, instructions: retired(), verified, promptAt,
                reason: `the command ${JSON.stringify(cmd)} did not return to the prompt`};
        }
    }
    const expect = [...(Array.isArray(manifest.expect) ? manifest.expect : []),
        ...(opts.commands ? [] : (Array.isArray(demo.expect) ? demo.expect : []))];
    const missing = expect.filter(s => !output.includes(s));
    if (missing.length) {
        return {ok: false, output, instructions: retired(), verified, promptAt,
            reason: `expected output missing: ${missing.map(s => JSON.stringify(s)).join(', ')}`};
    }
    return {ok: true, output, instructions: retired(), verified, promptAt};
}

export default runRiscvLinuxBundle;
