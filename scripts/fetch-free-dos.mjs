#!/usr/bin/env node
/**
 * fetch-free-dos.mjs — materialize the FREE, MIT-licensed MS-DOS 2.0 kernel so
 * the real-DOS boot path (build-dos-image.mjs, run-dos-toolchain-guest.mjs,
 * test/dos-boot-compiled-com.test.mjs) works without any proprietary media.
 *
 * WHY THIS EXISTS. Those paths were "gated on MSDOS_BIN_DIR" — they only run if
 * you point that env var at a directory holding MSDOS.SYS, COMMAND.COM and
 * SYSINIT.OBJ, and CI has none, so they skip. But those three files are NOT
 * proprietary: Microsoft open-sourced MS-DOS 2.0 under the MIT licence
 * (github.com/microsoft/MS-DOS, v2.0/bin), which permits redistribution. This
 * script fetches exactly those three, verifies each against its pinned SHA-256,
 * and drops them where the boot path looks — turning the gate from "licensed
 * binaries absent" into a one-command, license-clean setup.
 *
 * SCOPE, and it is a hard boundary. Only the three MIT kernel files are fetched.
 * The MASM/LINK/EXE2BIN toolchain (the MASM chain) has SEPARATE provenance and
 * is NOT free — it stays gated. FreeDOS is GPL: usable as a black-box oracle but
 * NOT bundleable into MIT bw-board / BSD-3 lite, so it is not fetched here. The
 * microsoft/MS-DOS repo also carries DR-DOS images (Digital Research's, not
 * Microsoft's) — a repo LICENSE covers what its uploader owned, so those are
 * never touched. A hash mismatch is refused loudly rather than trusted.
 *
 *   node scripts/fetch-free-dos.mjs [destDir]     # default: $MSDOS_BIN_DIR or ./.free-dos
 *
 * @module
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** The three MIT-licensed MS-DOS 2.0 kernel files, pinned by content SHA-256. */
export const FREE_DOS_FILES = Object.freeze({
    'MSDOS.SYS':   '1edf5190671ed4edcc9e6cc095e5094749c58f1833a2e26e40ba7d3389e276d1',
    'COMMAND.COM': '4cc71b3692b894eef9a7c8b3ac0fc63a71bdfa08175089562fdc4c7c5b038e8a',
    'SYSINIT.OBJ': '56d9d59d8cf6dbec648c3b391d3532bf4dffa8b615a096aca76312acbeecc7aa',
});
export const SOURCE_BASE = 'https://raw.githubusercontent.com/microsoft/MS-DOS/main/v2.0/bin';
export const LICENCE = 'MIT — Microsoft, github.com/microsoft/MS-DOS v2.0/bin (freely redistributable)';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/**
 * Fetch + verify the three MIT kernel files into `destDir`. Content already
 * present with the right hash is left alone. Returns a report; throws on an HTTP
 * error or a hash that is not the pinned MIT file.
 * @param {string} destDir
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function fetchFreeDos(destDir, { fetchImpl = globalThis.fetch, files = FREE_DOS_FILES } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch-free-dos: no fetch implementation available');
    mkdirSync(destDir, { recursive: true });
    const report = [];
    for (const [name, want] of Object.entries(files)) {
        const dest = join(destDir, name);
        if (existsSync(dest) && sha256(readFileSync(dest)) === want) { report.push({ name, status: 'present' }); continue; }
        const res = await fetchImpl(`${SOURCE_BASE}/${name}`);
        if (!res.ok) throw new Error(`fetch-free-dos: ${name} HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const got = sha256(bytes);
        if (got !== want) throw new Error(`fetch-free-dos: ${name} SHA-256 ${got} is not the pinned MIT MS-DOS 2.0 file (${want}) — refusing`);
        writeFileSync(dest, bytes);
        report.push({ name, status: 'fetched', bytes: bytes.length });
    }
    return { destDir, licence: LICENCE, files: report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const dest = process.argv[2] || process.env.MSDOS_BIN_DIR || join(process.cwd(), '.free-dos');
    fetchFreeDos(dest).then((r) => {
        for (const f of r.files) process.stdout.write(`  ${f.status.padEnd(8)} ${f.name}${f.bytes ? ` (${f.bytes} B)` : ''}\n`);
        process.stdout.write(`\nMIT MS-DOS 2.0 kernel ready in ${r.destDir}\n${r.licence}\n`
            + `Set MSDOS_BIN_DIR=${r.destDir} to enable the real-DOS boot path.\n`);
    }).catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
