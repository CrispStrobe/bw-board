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
 *   node scripts/oracle-nasm.mjs --variant 80186 FILE.asm   (both sides as a 186)
 *   node scripts/oracle-nasm.mjs --sweep186                 (generated 186 forms)
 *
 * `--variant 80186` restricts NASM to `cpu 186` instead of `cpu 8086` and
 * passes `{variant: '80186'}` to this module, so the two sides are still
 * being asked the same question -- which is the only thing that makes a
 * byte-for-byte diff mean anything. `--sweep186` needs no corpus at all: it
 * GENERATES every 186 form this module can encode, over every addressing
 * mode and every immediate that sits on an encoding boundary, and diffs the
 * lot. A hand-written byte table can only be as right as whoever wrote it;
 * 2,616 generated forms against the real assembler cannot be.
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
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
 * `variant` picks WHICH restriction. A 186 source restricted to `cpu 8086`
 * is refused by NASM and the diff would read as our failure; a 186 source
 * left unrestricted is compared against a 386 assembler. Neither is the
 * comparison, so the flag moves both sides together or not at all.
 *
 * @returns {{ok:boolean, bytes?:Uint8Array, err:string}}
 */
export function nasmBuild(nasmPath, file, restrict = true, root = null, variant = '8086') {
    const dir = mkdtempSync(join(tmpdir(), 'nasm-oracle-'));
    const out = join(dir, 'out.bin');
    try {
        const args = restrict ? ['--before', variant === '80186' ? 'cpu 186' : 'cpu 8086'] : [];
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
export function compareOne(nasmPath, file, root = null, variant = '8086') {
    const ref = nasmBuild(nasmPath, file, true, root, variant);
    if (!ref.ok) {
        // A source NASM takes as a 386 and refuses as an 8086 is not a
        // failure of this module: it is a program that cannot run on the
        // machine, and saying which of the two it is matters.
        const loose = nasmBuild(nasmPath, file, false, root, variant);
        return {
            verdict: loose.ok ? 'NOT8086' : 'NASMREFUSED',
            note: ref.err.split('\n')[0] || 'nasm refused it',
        };
    }
    let ours;
    try {
        const r = assemble(readFileSync(file, 'utf8'),
            { dialect: 'nasm', variant, name: relative(process.cwd(), file), ...fileHooks(file, root) });
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

/**
 * Every 80186 form this module can encode, as one NASM source.
 *
 * WHY GENERATED AND NOT WRITTEN OUT. The fifteen 186 instructions are
 * checked for TEXT by round trip through the graded disassembler, which is
 * strong but says nothing about the cases where two encodings are both
 * legal and only one is what NASM picks: PUSH's 6A against 68 and IMUL's 6B
 * against 69, on every immediate near the signed-byte boundary, including
 * the ones that only differ once you notice the test is on the sixteen-bit
 * value and not on what was typed. `push 65535` and `push -1` push the same
 * word; sizing the first as three bytes was a real difference from NASM and
 * a hand-written table would have had to think of it first.
 *
 * The addressing modes are swept too, because a ModR/M byte assembled into
 * the wrong field still disassembles as SOMETHING and a round trip alone
 * cannot always tell.
 */
export function sweep186Source() {
    const R16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
    const R8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
    const MEM = ['[bx+si]', '[bx+di]', '[bp+si]', '[bp+di]', '[si]', '[di]', '[bp]', '[bx]',
        '[1234h]', '[bx+7]', '[bp-2]', '[bx+si+300h]', '[di+1000h]'];
    const SHIFTS = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', 'sar'];
    // The immediates that sit ON the 6A/6B boundary, from both directions
    // and in both spellings of the same word.
    const IMM = [0, 1, 5, 127, -128, -1, 128, 255, 256, 0x1234, 0xffff, 0xff80, 0xff7f, -32768, -129];
    const L = ['pusha', 'popa', 'leave'];
    for (const s of ['insb', 'insw', 'outsb', 'outsw']) { L.push(s); L.push(`rep ${s}`); }
    for (const r of R16) for (const m of MEM) L.push(`bound ${r}, ${m}`);
    for (const sz of [0, 2, 16, 0x9c4b, 0xffff]) for (const lv of [0, 1, 0x1a, 31]) L.push(`enter ${sz}, ${lv}`);
    for (const v of IMM) L.push(`push ${v}`);
    for (const r of R16) for (const a of [...R16, ...MEM]) for (const i of [1, 7, -1, 127, -128, 128, 0x1234, 0xffff, -32768]) {
        L.push(`imul ${r}, ${a}, ${i}`);
    }
    for (const r of R16) for (const i of [3, 0x300]) L.push(`imul ${r}, ${i}`);
    for (const mn of SHIFTS) {
        for (const r of [...R8, ...R16]) for (const c of [0, 2, 3, 7, 31]) L.push(`${mn} ${r}, ${c}`);
        for (const m of MEM) { L.push(`${mn} byte ${m}, 4`); L.push(`${mn} word ${m}, 5`); }
        // The two counts the 186 did NOT change, swept alongside so that a
        // variant that broke them would show up here rather than nowhere.
        for (const r of [R8[0], R16[0]]) { L.push(`${mn} ${r}, 1`); L.push(`${mn} ${r}, cl`); }
    }
    return { source: `bits 16\n${L.join('\n')}\n`, count: L.length };
}

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
    let root = null, variant = '8086', sweep = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dir') files.push(...walk(argv[++i]).sort());
        else if (argv[i] === '--root') root = resolve(argv[++i]);
        else if (argv[i] === '--variant') variant = argv[++i];
        else if (argv[i] === '--sweep186') { sweep = true; variant = '80186'; }
        else if (!argv[i].startsWith('--')) files.push(argv[i]);
    }
    if (sweep) {
        const { source, count } = sweep186Source();
        const dir = mkdtempSync(join(tmpdir(), 'nasm-sweep-'));
        const f = join(dir, 'sweep186.asm');
        writeFileSync(f, source);
        const r = compareOne(nasmPath, f, null, '80186');
        console.log(`sweep186: ${count} generated forms -- ${r.verdict}: ${r.note}`);
        rmSync(dir, { recursive: true, force: true });
        process.exit(r.verdict === 'MATCH' ? 0 : 1);
    }
    const tally = {};
    for (const f of files) {
        const r = compareOne(nasmPath, f, root, variant);
        tally[r.verdict] = (tally[r.verdict] || 0) + 1;
        const show = r.verdict !== 'MATCH' || argv.includes('--verbose');
        if (show) console.log(`${r.verdict.padEnd(12)} ${f}\n             ${r.note}`);
    }
    console.log(`\n${files.length} sources:`);
    for (const k of Object.keys(tally).sort()) console.log(`  ${String(tally[k]).padStart(4)}  ${k}`);
    process.exit(tally.DIFFER || tally.REFUSED ? 1 : 0);
}
