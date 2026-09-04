#!/usr/bin/env node
/**
 * The NASM differential oracle: our front end against the real assembler.
 *
 * The MASM side of this module is verified by round trip through a
 * vector-verified disassembler, and through `oracle-masm.mjs` against
 * Microsoft's own 1982 binaries. The NASM side gets something stronger and
 * cheaper: NASM itself is a live, freely-available program, so the check is
 * not "does this decode back to the same text" but "is this the SAME IMAGE,
 * byte for byte, that NASM would have written".
 *
 * NASM IS NOT VENDORED. Nothing here downloads it; if it is not on PATH (or
 * named by $NASM) every comparison SKIPS AND SAYS SO, because a silent skip
 * in a summary line reads exactly like a pass.
 *
 *   node scripts/oracle-nasm.mjs FILE.asm [more...]
 *   node scripts/oracle-nasm.mjs --dir /path/to/corpus      (every .asm under it)
 *
 * Each file is assembled BOTH WAYS from the same working directory, because
 * `%include` and `INCBIN` resolve relative to the source and a comparison
 * that fed the two tools different files would not be a comparison.
 *
 * A source that NASM ITSELF refuses is reported NASMREFUSED and is not
 * counted against this module -- three of the twenty-eight files in
 * retro-dos-graphics are include fragments that were never meant to
 * assemble alone, and calling those our failures would flatter nothing and
 * mislead everyone.
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { assemble } from '../src/i8086-asm.js';

/** @returns {string|null} the nasm to use, or null if there is none */
export function findNasm() {
    const named = process.env.NASM;
    if (named && existsSync(named)) return named;
    const r = spawnSync('nasm', ['-v'], { encoding: 'utf8' });
    return r.status === 0 ? 'nasm' : null;
}

/**
 * Assemble with the real NASM into a flat image.
 *
 * `--before "cpu 8086"` IS THE WHOLE COMPARISON. Left to itself NASM
 * assembles for the newest processor it knows, so an out-of-range `JE`
 * becomes the 80386's `0F 84 rel16` -- an encoding that on an 8086 decodes
 * as `POP CS` followed by two bytes of garbage. Told it is an 8086 it does
 * what this module does: `Jncc $+5 ; JMP near`, byte for byte the same three
 * leading bytes. Comparing against the un-restricted NASM would be comparing
 * an 8086 assembler against a 386 one and calling the difference our bug.
 *
 * @returns {{ok:boolean, bytes?:Uint8Array, err:string}}
 */
export function nasmBuild(nasmPath, file, restrict = true, root = null) {
    const dir = mkdtempSync(join(tmpdir(), 'nasm-oracle-'));
    const out = join(dir, 'out.bin');
    try {
        const args = restrict ? ['--before', 'cpu 8086'] : [];
        const r = spawnSync(nasmPath, [...args, '-f', 'bin', '-o', out, file],
            { cwd: root || dirname(resolve(file)), encoding: 'utf8' });
        if (r.status !== 0 || !existsSync(out)) return { ok: false, err: (r.stderr || r.stdout || '').trim() };
        return { ok: true, bytes: new Uint8Array(readFileSync(out)), err: '' };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** The two file hooks NASM has and this module does not: both resolve
 *  relative to the source, exactly as NASM's own do. */
export function fileHooks(file, root = null) {
    const base = root || dirname(resolve(file));
    return {
        readInclude: (p) => {
            const at = resolve(base, p);
            return existsSync(at) ? readFileSync(at, 'utf8') : undefined;
        },
        readBinary: (p) => {
            const at = resolve(base, p);
            return existsSync(at) ? new Uint8Array(readFileSync(at)) : undefined;
        },
    };
}

/**
 * @returns {{verdict:string, note:string, ours?:Uint8Array, theirs?:Uint8Array, at?:number}}
 */
export function compareOne(nasmPath, file, root = null) {
    const ref = nasmBuild(nasmPath, file, true, root);
    if (!ref.ok) {
        // A source NASM takes as a 386 and refuses as an 8086 is not a
        // failure of this module: it is a program that cannot run on the
        // machine, and saying which of the two it is matters.
        const loose = nasmBuild(nasmPath, file, false, root);
        return {
            verdict: loose.ok ? 'NOT8086' : 'NASMREFUSED',
            note: ref.err.split('\n')[0] || 'nasm refused it',
        };
    }
    let ours;
    try {
        const r = assemble(readFileSync(file, 'utf8'),
            { dialect: 'nasm', name: relative(process.cwd(), file), ...fileHooks(file, root) });
        ours = r.bytes;
    } catch (e) {
        return { verdict: 'REFUSED', note: e.message };
    }
    const n = Math.min(ours.length, ref.bytes.length);
    for (let i = 0; i < n; i++) {
        if (ours[i] !== ref.bytes[i]) {
            return {
                verdict: 'DIFFER', at: i, ours, theirs: ref.bytes,
                note: `first difference at ${i} (0${i.toString(16)}h): ours ${hex(ours, i)} `
                    + `theirs ${hex(ref.bytes, i)}`,
            };
        }
    }
    if (ours.length !== ref.bytes.length) {
        return {
            verdict: 'DIFFER', at: n, ours, theirs: ref.bytes,
            note: `agree for ${n} bytes then ours is ${ours.length} long and theirs ${ref.bytes.length}`,
        };
    }
    return { verdict: 'MATCH', note: `${ours.length} bytes`, ours, theirs: ref.bytes };
}

const hex = (a, i) => [...a.slice(i, i + 6)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

const walk = (p) => (statSync(p).isDirectory()
    ? readdirSync(p).flatMap((n) => walk(join(p, n)))
    : (extname(p).toLowerCase() === '.asm' ? [p] : []));

if (import.meta.url === `file://${process.argv[1]}`) {
    const argv = process.argv.slice(2);
    const nasmPath = findNasm();
    if (!nasmPath) {
        console.error('SKIPPED: no nasm on PATH and $NASM names none. '
            + 'This oracle compares against the real assembler and has nothing to compare to.');
        process.exit(3);
    }
    const files = [];
    // `%include 'engine/header.asm'` resolves against the directory NASM
    // was RUN from, not the one the source lives in, so a corpus whose
    // games sit in a subdirectory needs its root named.
    let root = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dir') files.push(...walk(argv[++i]).sort());
        else if (argv[i] === '--root') root = resolve(argv[++i]);
        else if (!argv[i].startsWith('--')) files.push(argv[i]);
    }
    const tally = {};
    for (const f of files) {
        const r = compareOne(nasmPath, f, root);
        tally[r.verdict] = (tally[r.verdict] || 0) + 1;
        const show = r.verdict !== 'MATCH' || argv.includes('--verbose');
        if (show) console.log(`${r.verdict.padEnd(12)} ${f}\n             ${r.note}`);
    }
    console.log(`\n${files.length} sources:`);
    for (const k of Object.keys(tally).sort()) console.log(`  ${String(tally[k]).padStart(4)}  ${k}`);
    process.exit(tally.DIFFER || tally.REFUSED ? 1 : 0);
}
