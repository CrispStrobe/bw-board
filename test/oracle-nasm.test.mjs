/**
 * The NASM differential oracle, end to end.
 *
 * Every test here needs NASM itself, which is not vendored in this
 * repository. When it is absent the file SKIPS AND SAYS SO: a silent skip
 * reads exactly like a pass in a summary line, and the whole strength of the
 * NASM side of src/i8086-asm.js rests on this comparison.
 *
 *     apt-get download nasm && dpkg-deb -x nasm_*.deb /somewhere
 *     NASM=/somewhere/usr/bin/nasm node --test test/oracle-nasm.test.mjs
 *
 * WHAT IS ASSERTED, and what deliberately is not. Against MASM the interesting
 * claim is that the oracle still runs at all, because it runs inside our own
 * emulator. NASM runs natively, so the claim here is the strong one: the
 * IMAGE, byte for byte, over the four shipped corpora.
 *
 * The comparison is always made under `--before "cpu 8086"`. Left to itself
 * NASM assembles for the newest processor it knows and turns an out-of-range
 * `JE` into the 80386's `0F 84 rel16`, which on an 8086 decodes as POP CS
 * and two bytes of rubbish. Comparing against that would be comparing an
 * 8086 assembler against a 386 one and calling the difference our bug.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { findNasm, nasmBuild, compareOne } from '../scripts/oracle-nasm.mjs';

const nasm = findNasm();
const skip = nasm ? false
    : 'SKIPPED: no nasm on PATH and $NASM names none. This file compares against the real '
    + 'assembler and has nothing to compare to. `apt-get download nasm` and point $NASM at it.';
if (skip) console.log(skip);

const CORPUS = '/mnt/volume1/code/retro-corpus-8086';
const has = (p) => existsSync(p);

/**
 * The four repositories.
 *
 * `%include` and `INCBIN` resolve against the directory NASM was RUN from,
 * and retro-dos-graphics is not consistent about which that is: its
 * `games/*.asm` say `%include 'engine/header.asm'` and must be built from
 * the repository root, while its `primitiv/*.asm` say `incbin "moni"` and
 * must be built from their own directory. Both are how the author built
 * them; the oracle is told which rather than guessing, so that a failure
 * here is ours and not a path.
 */
const CORPORA = [
    { file: `${CORPUS}/Snake-Game-8086-Assembly/Snake.asm` },
    { file: `${CORPUS}/typing-balloon-game-asm/typing_balloon_game.asm` },
    { file: `${CORPUS}/Maze_Runner_Go/MazeRunnercode.asm` },
    { dir: `${CORPUS}/retro-dos-graphics`, rootFor: `${CORPUS}/retro-dos-graphics/games/` },
];

const walk = (p) => (statSync(p).isDirectory()
    ? readdirSync(p).flatMap((n) => walk(join(p, n)))
    : (extname(p).toLowerCase() === '.asm' ? [p] : []));

test('nasm itself answers, so an absent oracle cannot look like a passing one', { skip }, () => {
    const r = nasmBuild(nasm, `${CORPUS}/Snake-Game-8086-Assembly/Snake.asm`, false);
    assert.ok(r.ok || r.err, 'the oracle ran and said something');
});

test('the whole NASM corpus is byte-identical, or classified as not-8086', { skip }, (t) => {
    const files = CORPORA.flatMap((c) => (c.dir ? walk(c.dir).sort() : [c.file]))
        .filter((f) => has(f));
    if (!files.length) return t.skip(`SKIPPED: ${CORPUS} is not present`);
    const tally = {};
    const differ = [];
    for (const f of files) {
        const c = CORPORA.find((x) => x.rootFor && f.startsWith(x.rootFor));
        const root = c ? c.dir : null;
        const r = compareOne(nasm, f, root);
        tally[r.verdict] = (tally[r.verdict] || 0) + 1;
        if (r.verdict === 'DIFFER' || r.verdict === 'REFUSED') differ.push(`${f}: ${r.note}`);
    }
    // NOTHING MAY DIFFER AND NOTHING MAY BE REFUSED. The other three
    // verdicts are statements about the SOURCE and not about this module:
    // NASMREFUSED is a file NASM will not assemble either (the eight
    // retro-dos-graphics engine fragments are `%include` bodies, not
    // programs), and NOT8086 is a source NASM takes as a 386 and refuses as
    // an 8086 -- Snake.asm's `inc dword`, MazeRunnercode.asm's `pusha`, and
    // ega.asm's immediate-count `shr`, which this module expands rather
    // than refuses and therefore runs where NASM's own output would not.
    assert.deepEqual(differ, [], 'every image NASM will build for an 8086 is ours byte for byte');
    assert.ok(tally.MATCH >= 20, `a real number of programs were actually compared (${tally.MATCH})`);
    console.log(`  nasm differential: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}`);
});

test('the two dangerous silent readings are the ones NASM would have caught', { skip }, () => {
    // Both of these assembled cleanly before the differential existed, and
    // neither was visible in any output: `pusha` became a LABEL under NASM's
    // colon-optional rule, and `inc dword` became `inc byte`. They are
    // pinned here against NASM's own verdict so that a future loosening of
    // either rule fails against the real assembler and not just against our
    // own opinion of it.
    for (const body of ['pusha\n', 'inc dword [v]\n']) {
        const src = `bits 16\norg 100h\nstart:\n ${body}v dd 0\n`;
        const tmp = `${process.env.TMPDIR || '/tmp'}/oracle-nasm-probe.asm`;
        writeFileSync(tmp, src);
        const strict = nasmBuild(nasm, tmp, true);
        const loose = nasmBuild(nasm, tmp, false);
        assert.equal(strict.ok, false, `NASM refuses ${body.trim()} at CPU 8086`);
        assert.equal(loose.ok, true, 'and accepts it for a later machine');
        assert.match(strict.err, /no instruction for this cpu level|parser/);
    }
});
