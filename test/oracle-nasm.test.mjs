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
import { readdirSync, statSync, existsSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { findNasm, nasmBuild, compareOne, sweep186Source } from '../scripts/oracle-nasm.mjs';

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
    // THE LIVENESS PROBE MUST NOT DEPEND ON THE CORPUS IT VOUCHES FOR.
    //
    // It used to assemble a file from CORPUS -- a 191 MB tree at an absolute
    // path outside this repository -- and assert `r.ok || r.err`. Since
    // 0d9f984 CI installs nasm but has no such tree, so that probe would have
    // FAILED there and taken the build red: `nasmBuild` runs with
    // `cwd: dirname(file)`, the directory does not exist, the spawn cannot
    // start, and both streams come back empty, so neither `ok` nor `err` is
    // truthy.
    //
    // (I first wrote this comment claiming the opposite -- that it would pass
    // falsely on nasm's "unable to open input file". Measured: stderr is
    // EMPTY, because the failure is the cwd rather than the input. The fix is
    // the same either way, but the reason in a comment has to be the true one.)
    //
    // So the probe now assembles a source it CARRIES and checks bytes it knows
    // the answer to. It is meaningful with the corpus absent, which is the
    // configuration CI actually runs, and it cannot be satisfied by an error
    // message. A probe that needs the thing it is probing for is not a probe.
    const dir = mkdtempSync(join(tmpdir(), 'nasm-live-'));
    try {
        const src = join(dir, 'live.asm');
        // NOP, INC AX, RET -- three encodings NASM cannot get wrong, and which
        // pin that we invoked a real assembler rather than something that
        // exits 0.
        writeFileSync(src, 'bits 16\nnop\ninc ax\nret\n');
        const r = nasmBuild(nasm, src, true);
        assert.ok(r.ok,
            `nasm failed on a three-instruction program, so the oracle is not `
            + `usable at all: ${r.err}`);
        assert.deepEqual(Array.from(r.bytes), [0x90, 0x40, 0xc3],
            'nasm assembled, but not to the bytes 8086 NOP/INC AX/RET must produce '
            + '-- the binary answering is not the binary we think it is');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
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

// ---------------------------------------------------------------------------
// The 80186 variant. `{variant: '80186'}` is checked for TEXT by round trip
// through the graded disassembler in test/i8086-asm-186.test.mjs; this is
// where it is checked for BYTES against the real assembler.
//
// Both sides move together: NASM is restricted to `cpu 186` rather than
// `cpu 8086`, because a 186 source under `cpu 8086` is refused by NASM and
// the diff would read as our failure, while an unrestricted NASM assembles
// for a 386 and the diff would be about a different chip.
// ---------------------------------------------------------------------------

test('every 186 form this module encodes is NASM 2.16 byte for byte', { skip }, () => {
    // GENERATED, NOT WRITTEN OUT, and that is the point. A round trip proves
    // the bytes read back as the right text; it cannot see the cases where
    // two encodings are both legal and only one is the one NASM picks. PUSH
    // 6A against 68 and IMUL 6B against 69 are exactly those cases, and the
    // sweep walks every immediate on the signed-byte boundary in both
    // spellings -- which is how `push 65535` was caught being sized as three
    // bytes when NASM makes it two, since FFFFh and -1 push the same word.
    const { source, count } = sweep186Source();
    const dir = mkdtempSync(join(tmpdir(), 'oracle-186-'));
    try {
        const f = join(dir, 'sweep186.asm');
        writeFileSync(f, source);
        const r = compareOne(nasm, f, null, '80186');
        assert.equal(r.verdict, 'MATCH', `${count} generated 186 forms: ${r.note}`);
        assert.ok(count > 2000, `and a real number of them (${count})`);
        console.log(`  nasm 186 sweep: ${count} forms, ${r.note}`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Maze Runner is byte-identical to NASM once PUSHA can be assembled', {
    skip: skip || (has(`${CORPUS}/Maze_Runner_Go/MazeRunnercode.asm`)
        ? false : 'the MIT NASM corpus is not present'),
}, () => {
    // The program whose `pusha` used to become a LABEL. It was the ONE file
    // in the four NASM corpora that this module could not match for a
    // reason that was ours rather than the repository's, and it is now
    // 6,088 bytes identical to NASM's own image.
    const f = `${CORPUS}/Maze_Runner_Go/MazeRunnercode.asm`;
    const as186 = compareOne(nasm, f, null, '80186');
    assert.equal(as186.verdict, 'MATCH', as186.note);
    assert.equal(as186.ours.length, 6088);

    // AND IT IS STILL NOT AN 8086 PROGRAM. Both assemblers say so, which is
    // what makes the variant a real distinction rather than a switch that
    // only relaxes ours.
    assert.equal(nasmBuild(nasm, f, true, null, '8086').ok, false,
        'NASM refuses it at CPU 8086');
    assert.equal(compareOne(nasm, f, null, '8086').verdict, 'NOT8086',
        'and so does this module, for the same instruction');
});

test("a C compiler's output is NASM's image too", { skip }, () => {
    // The chain the variant exists for: C -> SmallerC -> NASM assembly ->
    // this assembler. test/fixtures/smallerc/acc.asm is verbatim `smlrc
    // -seg16` output; test/i8086-asm-186.test.mjs assembles it and RUNS it
    // and checks the number. This asserts the other half -- that the image
    // is the one the real assembler would have written -- so that "it runs"
    // and "it is right" are two separate claims with two separate oracles.
    const startup = 'bits 16\norg 100h\nsection .text\n    call _main\n    mov ah, 4Ch\n    int 21h\n';
    const body = readFileSync(join('test', 'fixtures', 'smallerc', 'acc.asm'), 'utf8')
        .split('\n').slice(1).join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'oracle-smlrc-'));
    try {
        const f = join(dir, 'acc.asm');
        writeFileSync(f, startup + body);
        const r = compareOne(nasm, f, null, '80186');
        assert.equal(r.verdict, 'MATCH', r.note);
        assert.equal(r.ours.length, 171, 'a 171-byte .COM, both ways');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
