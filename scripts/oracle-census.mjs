#!/usr/bin/env node
/**
 * Which oracles are present, and therefore which claims are STANDING rather
 * than merely recorded.
 *
 * WHY THIS EXISTS, and it is the same defect as the one that produced the
 * 8086 CI gate, one level up. `npm test` reports "3369 pass, 42 skipped", and
 * in that number the three skips that mean "a CPU core's 646,000-vector
 * evidence did not run" are indistinguishable from the ones that mean "no
 * Playwright" or "no lcapy". A reader sees green. The fix for the 8086 was to
 * make its grind run; the fix for the rest is to make their ABSENCE legible,
 * because a suite nobody can obtain is a defensible gap and a suite nobody
 * NOTICED is not.
 *
 * So this prints, in one table, every external input that gates a check in
 * this repo: whether it is present, how it is detected, what it proves, and
 * how to get it. Nothing here runs a test. It answers only "what would have
 * been checked if you ran everything right now, and what would not".
 *
 *   node scripts/oracle-census.mjs                 # the table, exit 0
 *   node scripts/oracle-census.mjs --require 8086-vectors,z80-vectors
 *   node scripts/oracle-census.mjs --json
 *
 * `--require` is what makes this usable as a CI gate: a job that checks out a
 * suite asserts it actually got it, rather than discovering later that a
 * sparse pattern matched nothing and every dependent test skipped politely.
 *
 * TWO KINDS, kept apart because their absence means different things:
 *   ORACLE   an INDEPENDENT source of truth — hardware-generated vectors,
 *            a second implementation, a reference solver. Its absence means
 *            a claim rests on our own opinion.
 *   FIXTURE  data a check needs in order to run at all — a ROM, a firmware
 *            image, a tape. Its absence means the check did not happen; the
 *            claims it would have made are simply unmade.
 *
 * THE LIST MUST NOT DRIFT FROM THE TESTS, which is the failure mode a census
 * has: it would go on cheerfully reporting PRESENT for an env var nothing
 * reads any more. `test/oracle-census.test.mjs` requires every `gates` entry
 * to actually mention the detection key, so a renamed variable or a moved path
 * turns this file red instead of turning it into fiction.
 *
 * @module
 */
import { existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const HOME = homedir();

/**
 * Every external input that gates a check. `detect` is the key a reader can
 * grep for; `paths` are tried in order, after `env` if it is set.
 */
export const INPUTS = [
    {
        id: '8086-vectors', kind: 'oracle',
        what: 'SingleStepTests 8086 — 646,000 vectors from an Intel P80C86A-2. '
            + 'Grounds src/i8086.js and src/i8086-disasm.js on TEXT as well as state.',
        env: 'I8086_VECTORS',
        paths: [join(HOME, 'code', '8086-vectors', 'v1_binary'), join(HOME, 'code', '8086-vectors', 'v1')],
        gates: ['test/i8086.test.mjs', 'test/i8086-disasm.test.mjs', 'test/moo.test.mjs',
            'scripts/grind-i8086.mjs', 'scripts/grind-i8086-disasm.mjs'],
        obtain: 'git clone --depth 1 https://github.com/SingleStepTests/8086 ~/code/8086-vectors',
        ciAvailable: true,
        ci: 'yes — the `vectors` job checks out v1_binary and grinds all 646,000 per push',
    },
    {
        id: '8088-vectors', kind: 'oracle',
        what: 'SingleStepTests 8088 v2 — per-CYCLE bus traces: m-cycle type, T-state, '
            + 'and the queue F/S/E operations with the byte read. The ONLY thing that can '
            + 'grade timing and access ORDER; the 8086 suite compares final state and is '
            + 'blind to both (it could not see INT n reading its vector after pushing). '
            + 'Grounds src/i8088-biu.js and the cycle costs in src/i8086.js.',
        env: 'I8088_VECTORS',
        paths: [join(HOME, 'code', '8088-vectors', 'v2')],
        gates: ['scripts/grind-i8088-cycles.mjs'],
        obtain: "git clone --filter=blob:none --sparse --depth 1 "
            + "https://github.com/SingleStepTests/8088 ~/code/8088-vectors "
            + "&& cd ~/code/8088-vectors && git sparse-checkout set --no-cone '/v2/*.json.gz' "
            + '(2.0 GB whole; a sparse subset of opcode files is enough to move the score)',
        ciAvailable: false,
        ci: 'not yet — the grind is young and its scores are still moving',
    },
    {
        id: 'z80-vectors', kind: 'oracle',
        what: 'SingleStepTests z80 — 1,604 opcode files with full undocumented state '
            + '(X/Y flags, Q latch, R per-M1, WZ). Grounds src/z80.js.',
        env: 'Z80_VECTORS',
        paths: [join(HOME, 'code', 'z80-vectors', 'v1')],
        gates: ['test/z80-disasm.test.mjs', 'scripts/grind-z80.mjs'],
        obtain: 'git clone --depth 1 --filter=blob:none https://github.com/SingleStepTests/z80 ~/code/z80-vectors',
        ciAvailable: true,
        ci: 'yes — the `vectors-full` job, on a schedule rather than per push (1.6 GB unpacked)',
    },
    {
        id: '65c02-vectors', kind: 'oracle',
        what: 'SingleStepTests 65x02, WDC variant — ~10k vectors per opcode including '
            + 'cycle counts. Grounds src/w65c02.js.',
        env: 'VECTORS_DIR',
        paths: [join(HOME, 'code', '65x02-vectors', 'wdc65c02', 'v1')],
        gates: ['test/w65c02.test.mjs', 'test/w65c02-disasm.test.mjs', 'scripts/grind-w65c02.mjs'],
        obtain: 'git clone --depth 1 --filter=blob:none --sparse '
            + 'https://github.com/SingleStepTests/65x02 ~/code/65x02-vectors '
            + '&& cd ~/code/65x02-vectors && git sparse-checkout set wdc65c02/v1',
        ciAvailable: true,
        ci: 'yes — the `vectors-full` job, on a schedule rather than per push',
    },
    {
        id: 'lcapy', kind: 'oracle',
        what: 'An independent SYMBOLIC circuit solver. The only non-numerical check on mna.js.',
        env: 'LCAPY_PYTHON',
        paths: [join(HOME, '.local/pipx/venvs/lcapy/bin/python')],
        gates: ['test/lcapy-oracle.test.mjs'],
        obtain: 'pipx install lcapy',
        ciAvailable: false,
        ci: 'no',
    },
    {
        id: 'emu8051', kind: 'oracle',
        what: 'A second 8051 implementation (MIT sibling repo), built to WASM. '
            + 'Cross-checks the emu8051 adapter against a different upstream.',
        env: 'EMU8051_JS',
        // Two detection routes because the tests genuinely use two: the
        // brightness and debug gates read $EMU8051_JS, while the
        // idle-fastforward gate looks for a built emu8051.js beside the repo
        // or checked out inside it (the CI layout). Listing only one of them
        // made this row claim a variable none of its gates read — caught by
        // test/oracle-census.test.mjs, which is what that test is for.
        paths: [join(HOME, 'code', 'emu8051-stc'), '/mnt/volume1/code/emu8051-stc'],
        gates: ['test/emu8051-idle-fastforward.test.mjs', 'test/brightness-emu8051.test.js',
            'test/emu8051-debug.test.js'],
        obtain: 'git clone https://github.com/CrispStrobe/emu8051-stc and build its WASM',
        ciAvailable: true,
        ci: 'yes — checked out at a pinned ref by the `test` job',
    },
    {
        id: 'labwired-wasm', kind: 'oracle',
        what: 'The labwired engine as WASM — the differential oracle for the labwired bridge.',
        env: 'LABWIRED_WASM',
        paths: [],
        gates: ['test/labwired-adapter.test.mjs', 'test/labwired-roundtrip.test.mjs',
            'test/pad-drive-parity.test.mjs'],
        obtain: 'point LABWIRED_WASM at a wasm-bindgen NODEJS out-dir (the web target will not load under node)',
        ciAvailable: false,
        ci: 'no',
    },
    {
        id: 'labwired-cli', kind: 'oracle',
        what: 'The labwired binary — the STM32F030 differential oracle.',
        env: 'LABWIRED_CLI',
        paths: [],
        gates: ['test/labwired-oracle.test.mjs'],
        obtain: 'build labwired and point LABWIRED_CLI at it',
        ciAvailable: false,
        ci: 'no',
    },
    {
        id: 'v86', kind: 'oracle',
        what: 'v86 (BSD-2) run headless — a whole-program second opinion on the support chips. '
            + 'Established that our i8254 read-back is more complete than its. '
            + 'ABSENT ON THIS BOX as of 2026-09-04 (V86_ORACLE_DIR unset), which is why '
            + 'src/ne2000.js rests on the DP8390D datasheet and nothing else — tier 3, '
            + 'where the 8254 and 16550 are 2a. v86 HAS an NE2000; the diff is one '
            + 'download away and has simply never been run.',
        env: 'V86_ORACLE_DIR',
        paths: [],
        gates: ['scripts/oracle-v86.mjs'],
        obtain: 'download libv86.mjs + v86.wasm from a v86 release and point V86_ORACLE_DIR at them',
        ciAvailable: false,
        ci: 'no',
    },
    {
        id: 'elks-image', kind: 'fixture',
        what: 'An ELKS 1.44 MB boot floppy (fd1440-fat.img). The FIRST third-party '
            + 'OS this tier runs — not a program we assembled, not a service answered '
            + 'one call at a time, but a kernel that boots itself, probes the hardware '
            + 'and takes over the machine. Exercises interrupts, the timer and the FDC '
            + 'together in a way 525 textbook programs never will (E6.8.8).',
        env: 'ELKS_IMAGE',
        paths: ['/mnt/volume1/code/elks-images/fd1440-fat.img'],
        gates: ['test/i8086-elks-boot.test.mjs'],
        // GPL-2, SO IT IS RUN AND NEVER VENDORED. The licence regime permits a
        // GPL work as a black-box oracle or workload — execute it, compare
        // behaviour, never read its source into ours and never ship it in a
        // BSD-3 bundle. Same standing as the ehBASIC ROM: permanently
        // unavailable to CI for licence reasons rather than for effort.
        obtain: 'download fd1440-fat.img from github.com/ghaerr/elks/releases '
            + '(v0.9.1 verified) and point $ELKS_IMAGE at it',
        ciAvailable: false,
        ci: 'no — GPL-2, run as a workload but never vendored, so the OS acceptance '
            + 'test skips in CI and its claim is recorded rather than standing',
    },
    {
        id: 'amey-corpus', kind: 'fixture',
        what: 'The Amey-Thakur corpus — 525 real DOS assembly programs '
            + '(github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS). The single '
            + 'largest evidence that src/i8086-asm.js handles real-world MASM/NASM '
            + 'source rather than crafted tests: all 525 assemble now, 15 refused '
            + 'earlier the same day. 191 MB, unvendored.',
        paths: ['/tmp/amey/Source Code'],
        gates: ['test/i8086-asm.test.mjs', 'scripts/cov-i8086-opcodes.mjs'],
        obtain: 'git clone https://github.com/Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS '
            + 'and point the test CORPUS at its "Source Code" directory '
            + '(default /tmp/amey/Source Code)',
        ciAvailable: true,
        ci: 'yes — the `corpus` job (ci.yml:287) checks out Amey-Thakur/…, asserts '
            + 'all 525 are present (ci.yml:304), and assembles and runs each per push '
            + 'on VERDICT COUNTS rather than a text diff. The unit test reads a local '
            + '/tmp/amey copy and its corpus subtests skip without it, but the claim '
            + 'is standing via that job.',
    },
    {
        id: 'retro-corpus-8086', kind: 'fixture',
        what: 'Four real DOS assembly programs (Snake, typing-balloon, Maze Runner, '
            + 'retro-dos-graphics) that the NASM oracle assembles with both nasm and '
            + 'src/i8086-asm.js and compares BYTE FOR BYTE. Without it the nasm '
            + 'oracle still proves the assembler binary works, and proves nothing '
            + 'about our assembler.',
        env: 'RETRO_CORPUS_8086',
        paths: ['/mnt/volume1/code/retro-corpus-8086'],
        gates: ['test/oracle-nasm.test.mjs'],
        // FOUND BECAUSE THE CI STEP AT 0d9f984 WAS HALF A GATE. That step
        // installs nasm and asserts it arrived, which made the oracle
        // "standing" -- but the comparison also needs 191 MB at an ABSOLUTE
        // path outside the repository, which no runner has. The success
        // quantified over "the assembler binary is present"; the goal is "the
        // comparison ran". Same shape as everything else in VERIFICATION.md,
        // in the step built to enforce it.
        //
        // Also invisible to audit-clean-checkout, which archives HEAD and
        // cannot strip an absolute path -- the third fixture in that blind
        // spot after the ehBASIC ROM and the MS-DOS toolchain.
        obtain: 'clone the four upstream repositories into '
            + '/mnt/volume1/code/retro-corpus-8086; see test/oracle-nasm.test.mjs CORPORA',
        ciAvailable: false,
        ci: 'no — 191 MB of third-party game sources, not vendored. nasm itself IS '
            + 'installed in CI (0d9f984), so the liveness probe and the encoder '
            + 'comparisons run there; the corpus comparisons skip and say so.',
    },
    {
        id: 'ehbasic-rom', kind: 'fixture',
        what: 'mike42 ehBASIC ROM for the HB6502 preset. The only realistic 6502 '
            + 'PROGRAM workload in the tree — every other 6502 check is a unit test '
            + 'or a vector grind, so without it the w65c02 core is proven '
            + 'instruction-by-instruction and never as something that runs software.',
        // NO ENV VAR, DELIBERATELY. The first version of this row declared
        // EHBASIC_ROM and the census's own drift guard rejected it: the gated
        // file reads `process.argv[2]` or the literal default path and has never
        // read an env var. Inventing a detection key the code does not use is
        // exactly the fiction test/oracle-census.test.mjs exists to prevent.
        paths: ['/tmp/mike42-6502/rom/basic/basic.bin'],
        gates: ['test/hb6502-ehbasic-boot.mjs'],
        // WHY IT IS HERE RATHER THAN IN THE CI GLOB. The obvious fix, when this
        // was found reporting `ok 1` on an absent ROM, was to add the file to
        // the test glob so its skip shows up in CI. That is the wrong shelf:
        // this census exists BECAUSE a skip among forty-odd others is not
        // legible (see the header). Adding a forty-seventh would hide the fact
        // in the same pile the census was built to empty.
        //
        // AND THE ABSENCE IS PERMANENT BY LICENCE, not by effort. The ehBASIC
        // ROM is non-commercial; the surrounding hardware is CC-BY-4.0 but the
        // ROM is not redistributable here, so this can never become a standing
        // CI gate. Any w65c02 coverage number is therefore structurally thinner
        // than the 8086's, and must SAY so — otherwise it reads as "the 6502 is
        // less covered" when it means "the 6502's best program is unshippable".
        //
        // It also sat outside audit-clean-checkout's reach: that tool archives
        // HEAD to strip untracked REPOSITORY files, and cannot strip an
        // absolute /tmp path. A cross-repo dependency outside the repo tree is
        // invisible to the tool built for cross-repo dependencies.
        obtain: 'git clone https://github.com/mike42/6502-computer /tmp/mike42-6502 '
            + '&& cd /tmp/mike42-6502/rom/basic && make',
        ciAvailable: false,
        ci: 'no — non-commercial licence, and permanently so',
    },
    {
        id: 'zx-roms', kind: 'fixture',
        what: 'Spectrum 48K/128K ROMs. Without them the ZX tier boots nothing and '
            + 'its snapshot, tape and banking gates do not run.',
        env: 'ZX_ROM',
        paths: [],
        gates: ['test/zx-tape.test.mjs', 'test/zx-sna.test.mjs', 'test/zx-z80file.test.mjs',
            'test/zx128.test.mjs'],
        // NOT A GAP, AND SHOULD NOT BE CLOSED IN-TREE. Surveyed 2026-09-04:
        // the provenance note in scripts/spectrum-smoke.mjs is right and the
        // licence is the reason. Amstrad's 1999 permission (Cliff Lawson, on
        // Usenet) lets emulator authors redistribute the ROM images UNMODIFIED
        // with the copyright notices intact and forbids charging for the ROM
        // itself. Copyright stays with Amstrad; it is not an open licence and
        // does not fit a BSD-3 tree that vendors nothing.
        //
        // So the per-user $ZX_ROM fixture is the correct arrangement rather
        // than an unfinished one, and this line exists so the next person does
        // not "fix" it. The documented route is to REBUILD the ROM from
        // z00m128/zxs-rom's annotated disassembly with sjasmplus and md5-check
        // it, which produces the artefact without redistributing it.
        obtain: 'supply 48.ROM / 128.ROM locally, or rebuild from z00m128/zxs-rom '
            + 'with sjasmplus — never vendored; see the STECCY provenance note and '
            + 'the licence reasoning above',
        ciAvailable: false,
        ci: 'no — deliberately, the ROMs are not ours to ship',
    },
    {
        id: 'blinkenrocket-fw', kind: 'fixture',
        what: 'The reference Blinkenrocket firmware hex. Without it the sound-becomes-data '
            + 'modem loop is unproven end to end.',
        env: 'BLINKENROCKET_HEX',
        // TWO PATHS, because the clone on this fleet's boxes lives on the data
        // volume rather than under $HOME, and the entry looked in one place
        // only -- so a firmware that was checked out AND BUILT reported as
        // ABSENT, and its gate silently did not run. That is the census's own
        // failure mode happening to the census.
        paths: [join(HOME, 'code', 'blinkenrocket-firmware', 'build', 'main.hex'),
            '/mnt/volume1/code/blinkenrocket-firmware/build/main.hex'],
        gates: ['test/blinkenrocket-modem-e2e.test.mjs'],
        obtain: 'build blinkenrocket-firmware; see the REF WARNING below',
        // REF WARNING, and it is not a detail. This entry said "build at ref
        // 140e2931". THAT COMMIT COULD NOT BE FOUND: not in the local clone,
        // and not in CrispStrobe/, ChrisVeigl/ or blinkenrocket/ upstreams via
        // the GitHub commit API. The artefact actually present was built from
        // `813e265`.
        //
        // The path is widened so the gate RUNS, and the pin is left unresolved
        // rather than quietly re-pointed at 813e265: substituting a different
        // build for a named one is how a fixture stops meaning what its
        // reader thinks it means. Whoever wrote 140e2931 should say what it
        // was, or the pin should be replaced deliberately with a ref that
        // exists.
        ciAvailable: false,
        ci: 'no',
    },
    {
        id: 'smlrc', kind: 'oracle',
        what: 'SmallerC (smlrc) — a small INDEPENDENT C compiler. Its verbatim '
            + '`smlrc -seg16` output is the fixture test/fixtures/smallerc/acc.asm '
            + 'that the 186 assembler round-trips, so re-running smlrc proves the '
            + 'fixture still reflects the compiler rather than a snapshot of it. '
            + 'Independent tool, not our own opinion; it drives LEAVE, PUSH imm and '
            + 'three-operand IMUL.',
        env: 'SMLRC',
        paths: [],
        gates: ['test/i8086-asm-186.test.mjs'],
        obtain: 'gcc -w -o smlrc <SmallerC>/v0100/smlrc.c, then point $SMLRC at it',
        ciAvailable: false,
        ci: 'no — not vendored or built in CI; $SMLRC is a local build, so the 186 '
            + 'driver skips there',
    },
    {
        id: 'avr-compile-service', kind: 'service',
        what: 'An HTTP AVR-compile endpoint (avr-gcc behind a service) that '
            + 'test/avr-e2e.test.js POSTs to. A SERVICE, not a file: its presence is '
            + 'reachability, which this census deliberately does not probe — see '
            + 'resolve().',
        env: 'AVR_COMPILE_URL',
        paths: [],
        gates: ['test/avr-e2e.test.js'],
        obtain: 'run the avr-compile service and point $AVR_COMPILE_URL at it '
            + '(default http://localhost:8321/compile)',
        ciAvailable: false,
        ci: 'no — no avr-compile service in CI, so the e2e skips there',
    },
    {
        id: 'nasm', kind: 'oracle',
        what: 'NASM (BSD-2), an independent assembler. The differential oracle for the '
            + 'NASM side of src/i8086-asm.js — its own header says "the whole strength of '
            + 'the NASM side rests on this comparison". Byte-for-byte agreement with a real '
            + 'assembler, the strongest evidence tier there is. VERIFIED GREEN 2026-09-05 '
            + 'with NASM 2.16 (6/6), so the claim STANDS. Runs dark on a fresh developer '
            + 'box (nasm not installed → all three tests skip) until $NASM or PATH provides '
            + 'it, but CI installs it — see ci. Its absence had no census row, which is '
            + "exactly why the assembler's strongest claim could be merely recorded rather "
            + 'than standing and nobody could tell which.',
        env: 'NASM',
        paths: ['/usr/bin/nasm'],
        gates: ['test/oracle-nasm.test.mjs'],
        obtain: 'no root needed: apt-get download nasm && dpkg-deb -x nasm_*.deb DIR, then '
            + 'NASM=DIR/usr/bin/nasm; or apt-get install nasm',
        ciAvailable: true,
        ci: 'YES — standing since 0d9f984: ci.yml installs nasm (`apt-get install -y nasm`) '
            + 'AND then asserts it is present (`oracle-census.mjs --require nasm`), so a '
            + 'failed or skipped install fails the build at the install rather than passing '
            + 'green with six tests silently skipped. It was the one dark oracle absent by '
            + 'ACCIDENT not licence (unlike the ehBASIC ROM or the MASM binaries), which is '
            + 'why it was the one worth taking live — now the byte-for-byte assembler claim '
            + 'is re-verified on every push. Dark only on a fresh developer box until they '
            + 'install nasm.',
    },
    {
        id: 'masm', kind: 'oracle',
        what: 'MASM 1.10 + LINK + EXE2BIN (Microsoft, MIT-relicensed 1982 binaries), an '
            + 'independent assembler toolchain. The differential oracle for MASM '
            + 'compatibility in src/i8086-asm.js — that our .COM is byte-identical to '
            + "MASM's and that our ASSUME/segment-override and simplified-directive "
            + 'handling matches a real MASM. VERIFIED GREEN 2026-09-05 (10/10). Present on '
            + 'this box at /tmp/msdosbin.',
        env: 'MSDOS_BIN_DIR',
        // Present detection is the default dir /tmp/msdosbin; the parent-basename key
        // ('tmp') is a generic one, so scripts/oracle-masm.mjs — which defines
        // DEFAULT_MSDOS_DIR = '/tmp/msdosbin' — is listed alongside the test so the
        // census's own anti-drift check finds a gate that mentions the path, not only
        // the env var. Both files genuinely gate on this input.
        paths: ['/tmp/msdosbin'],
        gates: ['test/oracle-masm.test.mjs', 'scripts/oracle-masm.mjs'],
        obtain: 'fetch MASM.EXE, LINK.EXE, EXE2BIN.EXE (MIT-licensed MS 1982 binaries) into '
            + '/tmp/msdosbin, or point $MSDOS_BIN_DIR at them',
        ciAvailable: false,
        ci: 'no — the binaries live at an absolute /tmp path, the same blind spot as the '
            + 'ehBASIC ROM: audit-clean-checkout strips untracked REPO files by archiving '
            + 'HEAD and cannot reach /tmp, so their absence in a fresh checkout is invisible '
            + 'to it. Can only stand in CI if the job fetches them explicitly.',
    },
];

/** Resolve one input to {present, via}. `via` names WHAT was found, so a
 *  PRESENT line can be checked rather than trusted. */
export function resolve(input) {
    const fromEnv = input.env ? process.env[input.env] : null;
    // A SERVICE IS NOT A FILE, AND THE CENSUS DELIBERATELY DOES NOT PROBE IT.
    //
    // `existsSync` on "https://host/compile" is false, so without this the
    // census would print "set, but does not exist" about a service that may be
    // perfectly reachable -- not a missing feature, a WRONG SENTENCE.
    //
    // The fix is not to probe. A census that does network I/O is
    // non-deterministic and slow, and an ABSENT caused by a transient blip is
    // worse than an honest "not established": it is a flaky oracle-of-oracles,
    // and a red that fires for environmental reasons teaches everyone to skim
    // past that whole category. The load-sensitive digital-parity failures
    // taught that lesson the same day this was written.
    //
    // `present` therefore keeps EXACTLY the meaning it has for files -- "this
    // run established the input is here" -- which is simply never true for a
    // service. Same meaning, different reason for false, so no schema bump and
    // lite's pinned consumer is unaffected. `ciAvailable` carries the answer
    // that matters.
    if (input.kind === 'service') {
        return fromEnv
            ? { present: false, via: `$${input.env} set; reachability NOT probed `
                + '— a census that does network I/O is non-deterministic, so this '
                + 'run did not establish it' }
            : { present: false, via: `tried $${input.env}` };
    }
    if (fromEnv) {
        return existsSync(fromEnv)
            ? { present: true, via: `$${input.env}=${fromEnv}` }
            : { present: false, via: `$${input.env}=${fromEnv} (set, but does not exist)` };
    }
    for (const p of input.paths) {
        if (!existsSync(p)) continue;
        // A HIT UNDER THE SYSTEM TEMP DIR IS WEAKER EVIDENCE, AND SAYS SO.
        //
        // /tmp is shared, world-writable and cleared on reboot. "present"
        // there means "something exists at this path right now", not "the
        // input is installed" -- another process can create the same name, and
        // one already has: /tmp/bw-board on this box is a SYMLINK to the live
        // repository, made weeks ago by someone else, which let a deliberately
        // isolated reproduction reach straight back out to the host checkout
        // (lego-47, 2026-09-05).
        //
        // The census does not refuse these -- for masm, the amey corpus and the
        // ehBASIC ROM, /tmp genuinely is where they live, and refusing would
        // report absent about inputs that are present. It annotates instead, so
        // a reader can tell a stable location from a volatile one without
        // having to know which is which.
        const tmp = tmpdir();
        const volatile_ = p === tmp || p.startsWith(tmp.endsWith('/') ? tmp : tmp + '/');
        return {
            present: true,
            via: volatile_ ? `${p} (under ${tmp}: shared and cleared on reboot)` : p,
        };
    }
    const tried = [input.env ? `$${input.env}` : null, ...input.paths].filter(Boolean);
    return { present: false, via: `tried ${tried.join(', ') || '(no default path)'}` };
}

const argv = process.argv.slice(2);
const required = (argv.find((a) => a.startsWith('--require'))?.split('=')[1]
    ?? (argv.includes('--require') ? argv[argv.indexOf('--require') + 1] : ''))
    .split(',').map((s) => s.trim()).filter(Boolean);

const rows = INPUTS.map((i) => ({ ...i, ...resolve(i) }));

/**
 * `--snapshot <path>` writes the envelope brickwright-lite consumes, so that
 * lite's copy is a COPY plus a pin check rather than a second implementation
 * of this file's semantics.
 *
 * The envelope exists for one reason: a matrix cell needs DATED evidence.
 * "standing" alone rots the moment CI changes; "standing as of sha X" stays
 * checkable. So the sha is this repository's own HEAD at the moment of
 * writing, and a consumer can compare it against the bw-board pin it ships.
 *
 * `rows` is EXACTLY the `--json` output, not a reduction of it. A snapshot
 * that summarised would be a second set of semantics to keep in step, which is
 * the failure the whole arrangement is meant to avoid.
 */
function snapshot(rows) {
    let sha = 'unknown';
    try {
        sha = execFileSync('git', ['rev-parse', 'HEAD'],
            { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).trim();
    } catch { /* a tarball with no git is a legitimate way to run this */ }
    const d = new Date();
    const read = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        + `-${String(d.getDate()).padStart(2, '0')}`;
    return {
        // SCHEMA VERSION, AND IT IS NOT CEREMONY. brickwright-lite's T6 checks
        // bw-board out AT THE SHA ITS PIN NAMES and runs THAT tree's
        // generator, which is the right choice -- the snapshot then describes
        // the census as it stood for the tree lite ships.
        //
        // But it means old pins produce old shapes. `ciAvailable` did not
        // exist before be0e881; a snapshot from an earlier sha has no such
        // field, a consumer reads `undefined`, and `undefined` is falsy -- so
        // EVERY claim reads as "recorded", including the standing ones. That
        // is exactly the inversion fixed in 57874c4, reintroduced by TIME
        // rather than by choosing the wrong field, and nothing in the data
        // would say so.
        //
        // So the consumer's check is `schema >= 1`, not "does the field look
        // present". Bump this on any change to row shape or field meaning.
        schema: 1,
        source: { repo: 'https://github.com/CrispStrobe/bw-board', sha, read },
        rows,
    };
}

const jsonRows = (rs) => rs.map(
    ({ id, kind, present, via, gates, ci, ciAvailable, what }) =>
        ({ id, kind, present, ciAvailable, ci, via, gates, what }));

const snapAt = argv.indexOf('--snapshot');
if (snapAt >= 0) {
    const out = argv[snapAt + 1];
    if (!out || out.startsWith('--')) {
        console.error('--snapshot needs a path: --snapshot docs/generated/oracle-census.json');
        process.exit(2);
    }
    writeFileSync(out, JSON.stringify(snapshot(jsonRows(rows)), null, 2) + '\n');
    console.log(`wrote ${out} (${rows.length} rows)`);
} else if (argv.includes('--json')) {
    // `ci` AND `what` ARE EMITTED BECAUSE `present` ALONE INVERTS THE ANSWER
    // ANY CONSUMER ACTUALLY WANTS.
    //
    // `present` means "on the box running this command". A consumer asking
    // "is this claim STANDING?" means "does CI have it", and the two disagree
    // in both directions:
    //
    //   nasm               present=false, ci=yes  -> standing   (installed by ci.yml)
    //   retro-corpus-8086  present=true,  ci=no   -> recorded   (191 MB, unvendored)
    //   ehbasic-rom        present=true,  ci=no   -> recorded   (NC licence, permanent)
    //
    // Deriving standing-versus-recorded from `present` gets all three wrong.
    // Added when the language-device matrix lane was about to do exactly that,
    // in good faith, because `present` is the only field that looked relevant.
    // A field's NAME is not its meaning, and an exported shape is a contract.
    console.log(JSON.stringify(jsonRows(rows), null, 2));
} else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('INPUT', 20)}${pad('KIND', 9)}${pad('STATE', 9)}GATES  DETECTED VIA`);
    for (const r of rows) {
        console.log(`${pad(r.id, 20)}${pad(r.kind, 9)}${pad(r.present ? 'present' : 'ABSENT', 9)}`
            + `${pad(r.gates.length, 7)}${r.via}`);
    }
    const absent = rows.filter((r) => !r.present);
    const gatesLost = absent.reduce((n, r) => n + r.gates.length, 0);
    console.log(`\n${rows.length - absent.length}/${rows.length} present. `
        + `${absent.length} absent, gating ${gatesLost} file(s) that therefore did not run.`);
    for (const r of absent) console.log(`  ${r.id}: ${r.obtain}`);
}

// The point of the whole file: a required input that is missing is an ERROR,
// not a skip. Without this a job can check a suite out, match nothing, and
// have every dependent test skip politely while the job goes green.
const missing = required.filter((id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) { console.error(`--require names "${id}", which is not in the census`); process.exit(2); }
    return !r.present;
});
if (missing.length) {
    console.error(`\nFAILED: required input(s) absent: ${missing.join(', ')}`);
    process.exit(1);
}
