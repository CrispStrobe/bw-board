#!/usr/bin/env node
/**
 * Build the Linux lesson's post-boot snapshot: boot the pinned kernel +
 * initramfs to the shell prompt on RiscV32Machine and save the whole machine
 * there (src/riscv32-snapshot.js, RAM as a delta against the boot image).
 *
 *   node scripts/riscv32-linux-snapshot.mjs <Image> <initramfs.cpio> <out.snap.gz> [--expect-raw SHA] [--expect-gz SHA]
 *
 * Reproducible: the machine is deterministic, the run stops at the first
 * 1000-instruction boundary with the prompt up, the encoding has no
 * timestamps, and gzip is zlib level 9 with no name/mtime. The raw (content)
 * sha256 is the reproducibility contract — it depends only on the media and
 * this code; the gzip sha256 additionally on the zlib build, which is why CI
 * (Node 22) is the one that publishes it. --expect-* exit 1 on a difference.
 *
 * The snapshot holds kernel and BusyBox memory, so it is GPL-derived like the
 * media: it is published beside them in brickwright-media-lab, never here.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {makeLinuxSnapshot} from '../src/riscv32-linux-session.js';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const expectRaw = opt('--expect-raw'), expectGz = opt('--expect-gz');
const [kernelPath, initrdPath, outPath] = args;
if (!outPath) {
    console.error('usage: node scripts/riscv32-linux-snapshot.mjs <Image> <initramfs.cpio> <out.snap.gz> [--expect-raw SHA] [--expect-gz SHA]');
    process.exit(2);
}
const sha = b => createHash('sha256').update(b).digest('hex');
const kernel = new Uint8Array(readFileSync(kernelPath)), initrd = new Uint8Array(readFileSync(initrdPath));
const t0 = performance.now();
const snap = await makeLinuxSnapshot({kernel, initrd});
const bootS = (performance.now() - t0) / 1000;
const gz = gzipSync(snap.raw, {level: 9});
writeFileSync(outPath, gz);
const rawSha = sha(snap.raw), gzSha = sha(gz);
const literal = JSON.parse(new TextDecoder().decode(snap.raw.subarray(12, 12 + new DataView(snap.raw.buffer).getUint32(8, true)))).literal;
console.log(JSON.stringify({
    file: outPath, gzBytes: gz.length, gzSha256: gzSha, rawBytes: snap.raw.length, rawSha256: rawSha,
    literalPages: literal, instret: snap.instret, retired: snap.retired, base: snap.baseInfo,
    node: process.version, zlib: process.versions.zlib, bootSeconds: Number(bootS.toFixed(2))
}, null, 2));
let bad = false;
if (expectRaw && expectRaw !== rawSha) { console.error(`raw sha256 ${rawSha} != expected ${expectRaw}`); bad = true; }
if (expectGz && expectGz !== gzSha) { console.error(`gzip sha256 ${gzSha} != expected ${expectGz}`); bad = true; }
process.exit(bad ? 1 : 0);
