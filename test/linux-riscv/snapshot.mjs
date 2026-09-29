// The Linux lesson's post-boot snapshot, proved equivalent to a cold boot.
//
//   node test/linux-riscv/snapshot.mjs <Image> <initramfs.cpio> [pinned.snap.gz]
//
//  1. SAVE: boot to the prompt (makeLinuxSnapshot, 1000-instruction chunks)
//     and snapshot there — machine A, snapshot S.
//  2. DETERMINISM: a second cold boot run to the same instruction count in
//     ONE differently-sized run, saved, is byte-identical to S — so S does not
//     depend on how a host slices the run.
//  3. ROUND TRIP: S through gzip, openLinuxSnapshot (base check) and a
//     restore into a freshly booted machine C; C saved again equals S.
//  4. EQUIVALENCE: A (the cold-booted machine, run on) and C (the restored one)
//     are driven through the same commands at the same points — ls /,
//     echo, cat /proc/cpuinfo, uname -a — and their console output after the
//     prompt and their final whole-machine state are byte-identical.
//  5. THE APP PATH: createDebugTarget-shaped adapter with linux.snapshot opens
//     READY (progress at the prompt, boot log replayed to the listener) and
//     answers uname -a; timed — the snapshot-open time a learner waits.
//  6. PIN (optional third argument): a published snapshot equals S, raw.
//  7. REFUSALS: a snapshot for other media, and a truncated one, are refused
//     by name.
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRiscvLinuxMachine, makeLinuxSnapshot, openLinuxSnapshot} from '../../src/riscv32-linux-session.js';
import {saveRiscvSnapshot, readRiscvSnapshot, gunzipBytes} from '../../src/riscv32-snapshot.js';
import {createRiscV32Adapter} from '../../src/riscv32-adapter.js';

const [kernelPath, initrdPath, pinnedPath] = process.argv.slice(2);
if (!kernelPath || !initrdPath) { console.error('usage: node snapshot.mjs <Image> <initramfs.cpio> [pinned.snap.gz]'); process.exit(2); }
const kernel = new Uint8Array(readFileSync(kernelPath)), initrd = new Uint8Array(readFileSync(initrdPath));
const sha = b => createHash('sha256').update(b).digest('hex');
const failures = [];
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures.push(msg); };
const eq = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
const firstDiff = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : n; };

// 1. save
let t = performance.now();
const snap = await makeLinuxSnapshot({kernel, initrd});
const S = snap.raw;
const A = snap.machine;
let outA = snap.console;
A.hooks.onSerial = b => { outA += String.fromCharCode(b); };
console.log(`cold boot to the prompt: ${snap.instret} steps (${snap.retired} retired) in ${((performance.now() - t) / 1000).toFixed(2)} s; snapshot ${S.length} B raw, sha256 ${sha(S)}`);
const {header} = readRiscvSnapshot(S);
check(header.state.cpu.priv === 0 || header.state.cpu.priv === 1, `snapshot taken in U/S mode (priv ${header.state.cpu.priv}), satp=0x${(header.state.cpu.csr[header.state.cpu.csr.indexOf(0x180) + 1] >>> 0).toString(16)}`);
check(/bwb# $/.test(snap.console), 'the snapshot\'s console ends at the bwb# prompt');

// Re-save a machine exactly as makeLinuxSnapshot did (same base, info, console, meta).
const bootBase = () => createRiscvLinuxMachine({kernel, initrd}).machine.mem.slice();
const BASE = bootBase();
const resave = (m, console) => saveRiscvSnapshot(m, {base: BASE, baseInfo: snap.baseInfo, console, meta: header.meta});

// 2. determinism
t = performance.now();
let outB = '';
const {machine: B} = createRiscvLinuxMachine({kernel, initrd, onSerial: b => { outB += String.fromCharCode(b); }});
B.run(snap.instret - B.cpu.instret);
const SB = resave(B, outB);
check(B.cpu.instret === snap.instret && eq(SB, S), `a cold boot run to ${snap.instret} steps in ONE run saves byte-identical to S (${((performance.now() - t) / 1000).toFixed(2)} s)` +
    (eq(SB, S) ? '' : ` — first difference at byte ${firstDiff(SB, S)}`));

// 3. round trip through gzip and the base check
const gz = gzipSync(S, {level: 9});
t = performance.now();
const opened = await openLinuxSnapshot(gz, {kernel, initrd});
let outC = '';
const {machine: C} = createRiscvLinuxMachine({kernel, initrd, snapshot: opened, onSerial: b => { outC += String.fromCharCode(b); }});
const restoreMs = performance.now() - t;
const SC = resave(C, C.output);
check(eq(SC, S), `restored from ${gz.length} B of gzip in ${restoreMs.toFixed(0)} ms (gunzip + media sha256 + boot image + restore); saved again it equals S` +
    (eq(SC, S) ? '' : ` — first difference at byte ${firstDiff(SC, S)}`));
check(C.output === snap.console, 'the restored machine carries the boot log as its past output');

// 4. equivalence under commands
const COMMANDS = ['ls /', 'echo snapshot-equivalence $((6*7))', 'cat /proc/cpuinfo', 'uname -a'];
const drive = (m, getOut) => {
    const start = getOut().length;
    for (const cmd of COMMANDS) {
        const mark = getOut().length;
        for (const ch of `${cmd}\n`) m.uart.rxPush(ch.charCodeAt(0));
        let n = 0;
        while (n++ < 400) {
            m.run(250_000);
            const tail = getOut().slice(mark);
            if (tail.length > cmd.length + 2 && /bwb# $/.test(tail)) break;
        }
    }
    // A fixed tail of idle time, so timers and the idle skip are compared too.
    m.run(2_000_000);
    return getOut().slice(start);
};
t = performance.now();
const tailA = drive(A, () => outA);
const tailC = drive(C, () => outC);
check(tailA === tailC, `console output after the prompt is byte-identical (${tailA.length} B, ${((performance.now() - t) / 1000).toFixed(1)} s for both)` +
    (tailA === tailC ? '' : ` — first difference at char ${firstDiff(Buffer.from(tailA), Buffer.from(tailC))}`));
check(/snapshot-equivalence 42/.test(tailA) && /processor\s*: 0/.test(tailA) && /Linux \(none\) 6\.1\.188 .*riscv32 GNU\/Linux/.test(tailA) && /\bproc\b/.test(tailA),
    'the commands answered (ls /, echo, /proc/cpuinfo, uname -a)');
check(A.cpu.instret === C.cpu.instret, `same instruction count at the end: ${A.cpu.instret} vs ${C.cpu.instret}`);
const endA = resave(A, ''), endC = resave(C, '');
check(eq(endA, endC), 'final whole-machine state (hart, CSRs, TLB, devices, RAM) is byte-identical' +
    (eq(endA, endC) ? '' : ` — first difference at byte ${firstDiff(endA, endC)}`));

// 5. the app path
t = performance.now();
const adapter = createRiscV32Adapter({linux: {kernel, initrd, snapshot: await openLinuxSnapshot(gz, {kernel, initrd})}});
let seen = '';
adapter.onSerial(b => { seen += String.fromCharCode(b); });
const openMs = performance.now() - t;
check(adapter.linuxStart === 'snapshot' && adapter.linuxProgress().ready, `the adapter opens READY at the prompt in ${openMs.toFixed(0)} ms (${JSON.stringify(adapter.linuxProgress())})`);
check(seen === snap.console, `the boot log (${seen.length} B) is replayed to the serial listener`);
const mark = seen.length;
for (const ch of 'uname -a\r') adapter.sendSerial(ch.charCodeAt(0));
for (let f = 0; f < 600 && !/riscv32 GNU\/Linux[\s\S]*# $/.test(seen.slice(mark)); f++) adapter.advanceNs(16_666_667);
check(/Linux \(none\) 6\.1\.188 .*riscv32 GNU\/Linux/.test(seen.slice(mark)), 'uname -a answers through the adapter');
adapter.reset();
check(adapter.linuxProgress().ready && adapter.machine.cpu.instret === snap.instret, 'reset goes back to the snapshot (the prompt), not to the kernel entry');

// 6. pin
if (pinnedPath) {
    const pinned = await gunzipBytes(new Uint8Array(readFileSync(pinnedPath)));
    check(eq(pinned, S), `the published snapshot ${pinnedPath} equals this build's S (raw sha256 ${sha(pinned)})` +
        (eq(pinned, S) ? '' : ` — first difference at byte ${firstDiff(pinned, S)}; rebuild and republish it (scripts/riscv32-linux-snapshot.mjs)`));
}

// 7. refusals
let why = '';
const otherInitrd = initrd.slice(); otherInitrd[100] ^= 1;
try { await openLinuxSnapshot(gz, {kernel, initrd: otherInitrd}); } catch (e) { why = `${e.code}: ${e.message}`; }
check(/^snapshot-base-mismatch: .*initrdSha256/.test(why), `a snapshot of other media is refused by name — ${why.slice(0, 100)}`);
why = '';
try { await openLinuxSnapshot(S.subarray(0, S.length - 1), {kernel, initrd}); } catch (e) { why = `${e.code}: ${e.message}`; }
check(/^snapshot-truncated/.test(why), `a truncated snapshot is refused by name — ${why.slice(0, 100)}`);

console.log(failures.length ? `\n${failures.length} FAILED` : '\nPASS: the snapshot is the cold-booted machine.');
process.exit(failures.length ? 1 : 0);
