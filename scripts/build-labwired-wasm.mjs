#!/usr/bin/env node
/**
 * Build the labwired-wasm artifact the boundary-A adapter runs on.
 *
 * Upstream ships per-platform CLI binaries and nothing on npm, so there is no
 * published wasm to depend on: whoever wants labwired in a browser has to
 * produce it. This makes that one command, and pins the two things that make
 * it fail in ways the error message does not explain.
 *
 *   node scripts/build-labwired-wasm.mjs [--ref <sha>] [--out <dir>] [--keep]
 *
 * Output (in --out, default ./build/labwired-wasm):
 *   labwired_wasm.js       wasm-bindgen glue, `--target nodejs`
 *   labwired_wasm_bg.wasm  the module
 *   BUILD-INFO.json        ref, sizes (raw / stripped / brotli), sha256s
 *
 * TWO PINS THAT ARE NOT OPTIONAL
 * ------------------------------
 * 1. The wasm-bindgen CLI version must EXACTLY match the `wasm-bindgen` crate
 *    version in the built artifact — not the version in Cargo.toml, the one
 *    Cargo.lock resolved. Mismatch fails with "schema version" and no hint as
 *    to which side to move. This script reads the resolved version out of the
 *    lockfile and installs that CLI into a scratch --root, so the caller's
 *    global wasm-bindgen is never touched and the build is reproducible on a
 *    machine that has a different one.
 * 2. The build must come from a PINNED ref of the fork, for the same reason
 *    every other vendored thing here is pinned.
 *
 * SIZES, MEASURED RATHER THAN QUOTED
 * ----------------------------------
 * The raw artifact is large because the workspace sets `debug = true`;
 * wasm-bindgen drops the custom sections. BUILD-INFO.json records raw,
 * post-bindgen and brotli sizes so a distribution decision (commit the
 * artifact? publish a release asset? not ship it yet?) is made against numbers
 * from this machine rather than a number someone remembers.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

const REPO = 'https://github.com/CrispStrobe/labwired-core.git';
/** The fork's main, synced to upstream 2026-08-26 (merged w1ne#1068). */
const PIN = '41119903c';

const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? dflt : process.argv[i + 1];
};
const ref = arg('ref', PIN);
const outDir = resolve(arg('out', join(process.cwd(), 'build', 'labwired-wasm')));
const keep = process.argv.includes('--keep');

const run = (cmd, args, opts = {}) =>
    execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const capture = (cmd, args, opts = {}) =>
    execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();

const work = join(tmpdir(), `labwired-wasm-${process.pid}`);
const src = join(work, 'src');
const target = join(work, 'target');
const cliRoot = join(work, 'wb');

console.log(`labwired-wasm: building ${ref}`);
mkdirSync(work, { recursive: true });
try {
    // 1. the pinned source. Shallow, but a sha needs the full history to be
    //    fetchable by --branch, so clone the branch and check the sha out.
    run('git', ['clone', '--quiet', '--depth', '50', '--branch', 'main', REPO, src]);
    run('git', ['checkout', '--quiet', ref], { cwd: src });
    const head = capture('git', ['rev-parse', 'HEAD'], { cwd: src });
    console.log(`  source at ${head}`);

    // 2. the wasm itself
    run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'labwired-wasm'],
        { cwd: src, env: { ...process.env, CARGO_TARGET_DIR: target } });
    const rawPath = join(target, 'wasm32-unknown-unknown', 'release', 'labwired_wasm.wasm');
    const rawSize = statSync(rawPath).size;
    console.log(`  raw artifact ${(rawSize / 1048576).toFixed(1)} MB`);

    // 3. the MATCHING bindgen CLI, resolved from the lockfile. See the header:
    //    Cargo.toml says "0.2.92", the lock resolves something newer, and the
    //    CLI must match what was actually linked.
    const lock = readFileSync(join(src, 'Cargo.lock'), 'utf8');
    const m = lock.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/);
    if (!m) throw new Error('could not find the resolved wasm-bindgen version in Cargo.lock');
    const wbVersion = m[1];
    console.log(`  wasm-bindgen resolved to ${wbVersion}; installing that CLI`);
    run('cargo', ['install', 'wasm-bindgen-cli', '--version', wbVersion, '--root', cliRoot, '--quiet'],
        { env: { ...process.env, CARGO_TARGET_DIR: join(work, 'wb-target') } });

    // 4. bindings
    mkdirSync(outDir, { recursive: true });
    run(join(cliRoot, 'bin', 'wasm-bindgen'), ['--target', 'nodejs', '--out-dir', outDir, rawPath]);

    // 5. what actually came out
    const info = { ref: head, wasmBindgen: wbVersion, builtAt: new Date().toISOString(), files: {} };
    info.rawBytes = rawSize;
    for (const name of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
        const buf = readFileSync(join(outDir, name));
        info.files[name] = {
            bytes: buf.length,
            brotliBytes: brotliCompressSync(buf, {
                params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
            }).length,
            sha256: createHash('sha256').update(buf).digest('hex'),
        };
    }
    writeFileSync(join(outDir, 'BUILD-INFO.json'), `${JSON.stringify(info, null, 2)}\n`);

    console.log(`\nlabwired-wasm: wrote ${outDir}`);
    for (const [name, f] of Object.entries(info.files)) {
        console.log(`  ${name.padEnd(22)} ${(f.bytes / 1048576).toFixed(2)} MB` +
            `  brotli ${(f.brotliBytes / 1048576).toFixed(2)} MB  sha256 ${f.sha256.slice(0, 16)}…`);
    }
    const totalBr = Object.values(info.files).reduce((n, f) => n + f.brotliBytes, 0);
    console.log(`  served (brotli, both files) ${(totalBr / 1048576).toFixed(2)} MB`);
} finally {
    if (keep) console.log(`\n(kept the work tree at ${work})`);
    else rmSync(work, { recursive: true, force: true });
}
