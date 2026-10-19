#!/usr/bin/env node
/**
 * A differential oracle for src/i8086-asm.js, using MICROSOFT'S OWN MASM.
 *
 * The Microsoft MS-DOS source release (MIT licence) ships the 1982 toolchain
 * as binaries: v2.0/bin/MASM.EXE is the Microsoft MACRO Assembler version
 * 1.10, and LINK.EXE and EXE2BIN.EXE are its linker and image converter.
 * Those are 8086 DOS programs, and Tier B of this stack runs 8086 DOS
 * programs. So the reference assembler is not a thing we shell out to -- it
 * runs INSIDE our emulator, on our virtual filesystem, and every judgement
 * call in i8086-asm.js can be put to the tool the corpus was written for.
 *
 * Measured on this machine: MASM 1.10 assembles a small program in about
 * 250,000 instructions and asks for ZERO unsupported DOS services. LINK 2.00
 * and EXE2BIN likewise. Three things had to be supplied that the loaders in
 * i8086-dos.js do not write, and all three are things real DOS writes into
 * the PSP before it transfers control:
 *
 *   - the command tail at PSP:0080h ("SOURCE,OBJECT,LISTING,CROSSREF;"),
 *     without which MASM sits at its "Source filename [.ASM]:" prompt;
 *   - the two parsed FCBs at PSP:005Ch and PSP:006Ch, which EXE2BIN reads
 *     instead of the tail;
 *   - the top-of-memory paragraph at PSP:0002h. Our loader zeroes the PSP,
 *     and LINK computes its arena as (PSP:0002 - PSP) and concludes it has
 *     none: "Not enough memory for linker."
 *
 * WHAT THIS ORACLE CAN SETTLE
 *
 *   - Instruction encoding. If MASM and we emit different bytes for the same
 *     line, one of us chose differently, and the listing names the line.
 *   - Whether a construct assembles AT ALL in the dialect the corpus claims
 *     to be written in. "MASM refuses this" is a fact, not an opinion.
 *   - Behaviour: both images run under the same Tier B DOS with the same
 *     keystrokes, and their stdout is compared. Equal output over a whole
 *     corpus is strong evidence that two assemblers agree.
 *
 * WHAT IT CANNOT SETTLE
 *
 *   - MASM 1.10 IS FROM 1982 AND PREDATES THE SIMPLIFIED SEGMENT DIRECTIVES.
 *     498 of the 525 corpus files use `.MODEL` / `.DATA` / `.CODE` /
 *     `.STACK` / `@DATA`, which arrived with MASM 5.0 in 1987. To reach them
 *     at all this script SHIMS those into the 1982 `SEGMENT`/`ENDS` form.
 *     The shim is mechanical and is printed on request, but a comparison
 *     that went through it is a comparison of the shimmed source, not of the
 *     original -- so a disagreement there must be read back through the shim
 *     before it is believed. Files needing no shim are marked, and those are
 *     the unimpeachable ones.
 *   - Absolute addresses and segment paragraphs. Two toolchains lay segments
 *     out where they like; a word that differs only by that is not a bug,
 *     and the classifier below says so rather than counting it.
 *   - Anything past the 8086. MASM 1.10 knows no 80186 instruction, so it
 *     cannot adjudicate `SHL AX, 4` except by refusing it -- which is itself
 *     the answer, and is reported as such.
 *   - Whether OUR extensions are good ideas. It can only say that MASM does
 *     not accept them.
 *
 * WHAT IT SETTLED, first run, 2026-09-03. Every line below is `--probes`
 * output, not an opinion. i8086-asm.js's header lists these as judgement
 * calls; here is what the tool the corpus names actually does.
 *
 *   CONFIRMED, byte for byte
 *     - The synthesised segment override. `MOV AX, CVAR` where CVAR is in
 *       CODE and DS is assumed to DATA assembles as `2E: A1 ...` in MASM
 *       1.10 -- the same CS prefix `autoOverride` emits, in the same place.
 *       That judgement call is now measured rather than argued.
 *     - `MOV [SI-1], 0DH` -- MASM REFUSES the sizeless form ("Operand must
 *       have size"), but the recovery encoding in its own listing is
 *       C6 44 FF 0D: a BYTE, exactly as i8086-asm.js chooses. Nothing that
 *       ever assembled anywhere expects a word from that line.
 *     - `DW 'AB'` is the word 4142h and `DW 'A'` is 0041h.
 *     - A bare data label is a memory operand: `MOV AX, VAL16` is A1.
 *     - Refusing `SEG x` when a .COM is demanded. MASM emits `B8 ---- R`,
 *       a segment fixup, and EXE2BIN then answers "File cannot be
 *       converted": a .COM really cannot carry it, so the refusal is right.
 *       (Left to itself i8086-asm.js emits an .EXE for that source; the
 *       documented MOV r16, CS substitution is for a source with no
 *       SEGMENT at all, which this probe is not.)
 *     - Encoding, everywhere else tested: immediate width, sign-extended
 *       forms, ModR/M, string prefixes, shifts by CL, AAM/AAD/XLAT, EQU
 *       arithmetic, DUP, LENGTH/SIZE/TYPE, HIGH as an operator, explicit
 *       overrides, backward jumps, LOOP and JCXZ -- all identical.
 *
 *   MASM REFUSES WHAT WE ACCEPT, which is the honest reading of "extension"
 *     - `DW "a long string"`: "Syntax error". Note what MASM's recovery
 *       lays down: four ZERO bytes. It drops the string. Our choice of
 *       laying it out as bytes loses nothing, but it is ours, not MASM's.
 *     - `LEA DX, SI`: "Illegal use of register". Its recovery byte is
 *       8D D6, a mod=11 LEA, which is meaningless -- so MASM does not read
 *       the operand as [SI] either. Our reading is an invention, defensible
 *       but with no support from here.
 *     - `SHL AX, 4`: "Improper operand type", recovery D1 E0 -- one shift,
 *       not four. Confirms the instruction is not an 8086 one.
 *     - A NEAR procedure left open at END: "Open procedures".
 *     - Code after `CODE ENDS`: "No or unreachable CS".
 *     - `HIGH EQU 5` and `LENGTH EQU 16`: "Operand was expected". MASM
 *       reserves the operator names; we let the symbol win.
 *
 *   WE ARE WRONG, BY MASM'S STANDARD, in two places
 *     - A reference to a segment NO assume reaches is a REFUSAL in MASM
 *       ("Can't reach with segment reg"), not the warning i8086-asm.js
 *       records. MASM will not emit an address it cannot prove reachable.
 *     - With NO `ASSUME DS:` at all, a code-segment variable still gets a
 *       CS override from MASM (`2E: A1 0100`). i8086-asm.js's rule -- "a
 *       MISSING assume synthesises nothing at all" -- is not MASM's. MASM
 *       reaches for whichever segment register IS assumed to the symbol's
 *       segment and errors if none is. In a .COM that difference is
 *       invisible (DS = CS at entry); in an .EXE that sets DS to @DATA it
 *       is a wrong load, silently.
 *
 * THE CORPUS, 525 Amey-Thakur programs, same day. 414 COMPARED.
 *
 *   410 agree behaviourally, 4 differ, 0 refused by us that MASM accepted,
 *   96 accepted by us that MASM 1.10 refused, 15 refused by both.
 *   Of 404 code segments byte-compared, 403 differ ONLY in benign classes;
 *   exactly ONE carries a computed-value difference.
 *
 *   The whole byte histogram: 2,961 equiv-encoding, 2,710 branch-shift,
 *   408 seg-reloc, 251 nop-pad, 8 operand-value -- and all 8 of those are
 *   the single file below. Note what is NOT in that list: not one segment
 *   override differs. The disassembler renders the segment of every memory
 *   operand, so a missing or spurious 2Eh would show as a different
 *   instruction, and across 404 programs none did.
 *
 *   THE ONE COMPUTED-VALUE DISAGREEMENT, and MASM loses it.
 *   Data Structures/binary_search_tree_in_array.asm writes
 *   `NOTHING EQU 0FFFFH` and then uses NOTHING as a value. MASM 1.10 lists
 *   the symbol as FFFF and then assembles every USE of it as ZERO --
 *   silently, no diagnostic. NOTHING is a MASM reserved word (the one in
 *   `ASSUME DS:NOTHING`), and 1.10 lets the keyword win over the user's own
 *   EQU without saying so. Renaming the symbol to anything else, including
 *   NOTHIN or NOTA, assembles correctly. The consequence is visible: MASM's
 *   binary loses the root of the tree and prints seven of the eight nodes
 *   it inserted. i8086-asm.js emits FFFFh and prints all eight. This is the
 *   same policy i8086-asm.js already documents for HIGH and LENGTH -- a
 *   defined symbol beats an operator of the same name -- and here it is the
 *   difference between a working program and a broken one.
 *
 *   THE OTHER THREE behavioural differences are not assembler differences.
 *   Two print an address of their own (a return address, a pointer left in
 *   AX) which is naturally different in two images laid out differently.
 *   The third, Data Structures/queue.asm, is worth stating because it looks
 *   damning and is not: MASM's build runs away printing memory. Its 79
 *   instructions and ours match one for one modulo pad and skew, and the
 *   two data segments are identical but for one `DB ?`. The program POPS
 *   MORE THAN IT PUSHES -- SP climbs from 0100h to 011Ch -- and LINK puts
 *   the stack immediately BELOW the data segment, so the runaway pops land
 *   in the queue. Our layout puts the stack last, where the same bug is
 *   invisible. Neither assembler is wrong; the program is.
 *
 * USAGE
 *
 *   node scripts/oracle-masm.mjs --probes            the judgement calls
 *   node scripts/oracle-masm.mjs "/path/to/corpus"   the whole corpus
 *   node scripts/oracle-masm.mjs --limit 40 --show-diffs dir
 *
 *   --msdos-dir <dir>  where MASM.EXE/LINK.EXE/EXE2BIN.EXE live
 *                      (default /tmp/msdosbin, names as downloaded)
 *   --keys <s>         keystrokes handed to BOTH runs; \r and \n expand
 *   --budget <n>       instruction budget for a compared program
 *   --show-diffs       print the disagreeing sites, with source lines
 *   --json             machine-readable summary on stdout
 *
 * The script FAILS (exit 1) if it compared nothing. A differential that
 * silently compares zero programs and prints "no differences" is worse than
 * no differential at all, so the count of programs actually compared is the
 * headline number and it is checked.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';
import { assemble } from '../src/i8086-asm.js';
import { disasmI8086 } from '../src/i8086-disasm.js';

// ---------------------------------------------------------------------------
// The 1982 toolchain
// ---------------------------------------------------------------------------

/** The three binaries, under every name they are plausibly saved as. The
 *  MS-DOS repository path is v2.0/bin/NAME, and the download convention used
 *  here flattens that to v2.0_bin_NAME. */
const TOOL_NAMES = {
    masm: ['v2.0_bin_MASM.EXE', 'MASM.EXE', 'masm.exe'],
    link: ['v2.0_bin_LINK.EXE', 'LINK.EXE', 'link.exe'],
    exe2bin: ['v2.0_bin_EXE2BIN.EXE', 'EXE2BIN.EXE', 'exe2bin.exe'],
};

export const DEFAULT_MSDOS_DIR = '/tmp/msdosbin';

/**
 * Find the toolchain, or say what is missing. Callers that must SKIP rather
 * than fail (the test) ask this first; it never throws.
 * @returns {{ok: boolean, dir: string, paths: object, missing: string[]}}
 */
export function findTools(dir = DEFAULT_MSDOS_DIR) {
    const paths = {}, missing = [];
    for (const [key, names] of Object.entries(TOOL_NAMES)) {
        const hit = names.map((n) => join(dir, n)).find((p) => existsSync(p));
        if (hit) paths[key] = hit; else missing.push(names[0]);
    }
    return { ok: missing.length === 0, dir, paths, missing };
}

const imageCache = new Map();
const toolImage = (path) => {
    if (!imageCache.has(path)) imageCache.set(path, new Uint8Array(readFileSync(path)));
    return imageCache.get(path);
};

const LOAD_PSP = 0x0800;
/** Top of conventional memory as a paragraph. LINK divides by this. */
const TOP_OF_MEMORY = 0xa000;

const encodeAscii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const decodeAscii = (b) => Array.from(b, (c) => String.fromCharCode(c)).join('');

/** Write one parsed FCB, the way DOS does before it starts a program. */
function writeFcb(machine, psp, off, spec) {
    const m = /^(?:([A-Za-z]):)?([^.]*)\.?(.*)$/.exec(spec || '') || [];
    const drive = m[1] ? (m[1].toUpperCase().charCodeAt(0) - 64) : 0;
    const name = (m[2] || '').toUpperCase().padEnd(8).slice(0, 8);
    const ext = (m[3] || '').toUpperCase().padEnd(3).slice(0, 3);
    const base = (psp << 4) + off;
    machine._write(base, drive);
    for (let i = 0; i < 8; i++) machine._write(base + 1 + i, name.charCodeAt(i));
    for (let i = 0; i < 3; i++) machine._write(base + 9 + i, ext.charCodeAt(i));
    for (let i = 12; i < 16; i++) machine._write(base + i, 0);
}

/**
 * Run one 1982 tool over a virtual filesystem.
 *
 * `files` is the SAME Map on the way in and out, so MASM's .OBJ is simply
 * there for LINK to open -- which is what a disk is.
 */
export function runTool(path, tail, files, fcbs = [], budget = 100_000_000) {
    const machine = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(machine, { files }).install();
    dos.loadExe(toolImage(path));
    const psp = LOAD_PSP;
    machine._write((psp << 4) + 2, TOP_OF_MEMORY & 0xff);
    machine._write((psp << 4) + 3, (TOP_OF_MEMORY >> 8) & 0xff);
    machine._write((psp << 4) + 0x80, tail.length);
    for (let i = 0; i < tail.length; i++) {
        machine._write((psp << 4) + 0x81 + i, tail.charCodeAt(i) & 0xff);
    }
    machine._write((psp << 4) + 0x81 + tail.length, 0x0d);
    writeFcb(machine, psp, 0x5c, fcbs[0]);
    writeFcb(machine, psp, 0x6c, fcbs[1]);
    const r = dos.run(budget);
    // LINK writes "A:T.EXE" -- it re-attaches the default drive letter to
    // the name it opens. Our filesystem keys on the literal string, so the
    // drive prefix has to come off or the next tool would not find the file.
    for (const key of [...files.keys()]) {
        if (/^[A-Za-z]:/.test(key)) { files.set(key.slice(2), files.get(key)); files.delete(key); }
    }
    return { ...r, out: dos.stdout, unsupported: dos.report().unsupported };
}

/**
 * MASM 1.10, then LINK 2.00, then EXE2BIN, over one source.
 *
 * @returns {{ok: boolean, stage?: string, com: Uint8Array|null,
 *            exe: Uint8Array|null, obj: Uint8Array|null, lst: string,
 *            severe: number, warnings: number, out: string}}
 */
export function masmBuild(source, tools, { budget = 100_000_000 } = {}) {
    const files = new Map();
    // MASM 1.10 wants CRLF. A source with bare LFs assembles to "?End of file
    // encountered on input file" -- an error about the wrong thing entirely.
    const crlf = source.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    files.set('T.ASM', encodeAscii(crlf.endsWith('\r\n') ? crlf : crlf + '\r\n'));

    const a = runTool(tools.masm, 'T,T,T,NUL;', files, ['T.ASM', 'T.OBJ'], budget);
    const lst = files.has('T.LST') ? decodeAscii(files.get('T.LST')) : '';
    // MASM's last line is "<warnings>\t<severe errors>". Severe is the one
    // that decides whether the .OBJ means anything.
    const tally = /(\d+)\s+(\d+)\s*$/.exec(a.out.trim());
    const warnings = tally ? Number(tally[1]) : -1;
    const severe = tally ? Number(tally[2]) : -1;
    const base = {
        lst, severe, warnings, out: a.out, steps: a.steps,
        errors: masmErrors(a.out), unsupported: a.unsupported,
    };
    if (severe !== 0 || !files.has('T.OBJ')) {
        return { ...base, ok: false, stage: 'masm', com: null, exe: null, obj: null };
    }
    const obj = files.get('T.OBJ');

    const l = runTool(tools.link, 'T,T,NUL,NUL;', files, ['T.OBJ', 'T.EXE'], budget);
    if (!files.has('T.EXE')) {
        return { ...base, ok: false, stage: 'link', out: l.out, com: null, exe: null, obj };
    }
    const exe = files.get('T.EXE');

    // EXE2BIN converts only a one-segment image with no relocations. A
    // .MODEL SMALL program HAS a relocation (MOV AX, @DATA), so "File cannot
    // be converted" here is the expected answer and not a failure.
    const e = runTool(tools.exe2bin, 'T.EXE T.COM', files, ['T.EXE', 'T.COM'], budget);
    return {
        ...base, ok: true, obj, exe,
        com: files.has('T.COM') ? files.get('T.COM') : null,
        linkOut: l.out, exe2binOut: e.out,
    };
}

/** MASM prints its errors interleaved with the offending line. Pull out just
 *  the diagnostics, with the spaced-out "E r r o r" banner collapsed. */
function masmErrors(out) {
    return out.split(/\r?\n/)
        // Most diagnostics arrive as the spaced-out "E r r o r ---" banner,
        // but a few whole-file complaints (an unclosed PROC, an unclosed
        // segment) are printed as a bare line, and a run that reports one of
        // those and nothing else would otherwise look like a silent refusal.
        .filter((l) => /E\s?r\s?r\s?o\s?r\s+---/.test(l) || /^\?/.test(l)
            || /^(Open (procedures|segments|conditionals)|Unclosed|Symbol not defined)/.test(l))
        .map((l) => l.replace(/E\s?r\s?r\s?o\s?r\s+---\s*/, '').replace(/\s+$/, '').trim());
}

// ---------------------------------------------------------------------------
// The simplified-directive shim
// ---------------------------------------------------------------------------

/**
 * Rewrite MASM 5 simplified segment directives into the 1982 form.
 *
 * This is the price of reaching 498 of the 525 corpus files with a 1982
 * assembler, and it is a real cost: the shim's own choices (segment names,
 * alignment, class, the ASSUME it writes) are part of what gets compared. It
 * is kept as small and as mechanical as possible for exactly that reason,
 * and it reports whether it did anything so the caller can separate the
 * files it touched from the ones it did not.
 *
 * `.STACK n` becomes a real stack segment because LINK warns without one and
 * because our own assembler builds one; `@DATA` becomes the data segment's
 * name, which in 1982 MASM is already a relocatable segment value.
 */
export function shimSimplified(source) {
    const out = [];
    const notes = [];
    let open = null, sawData = false, sawStack = false, model = null;
    const close = () => { if (open) { out.push(open + '    ENDS'); open = null; } };
    for (const raw of source.split(/\r?\n/)) {
        const line = raw.replace(/\t/g, '        ');
        const m = /^\s*\.([A-Za-z0-9_?]+)\s*(.*?)\s*$/.exec(line);
        const directive = m ? m[1].toUpperCase() : null;
        if (directive === 'MODEL') {
            model = (m[2] || '').replace(/;.*$/, '').trim().toUpperCase();
            notes.push('.MODEL ' + model + ' dropped');
            continue;
        }
        if (directive === 'STACK') {
            close();
            const n = /^([0-9][0-9A-Fa-f]*)([Hh])?/.exec(m[2] || '');
            const size = n ? parseInt(n[1], n[2] ? 16 : 10) : 1024;
            out.push('STACK   SEGMENT PARA STACK \'STACK\'');
            out.push('        DB      ' + size + ' DUP(?)');
            out.push('STACK   ENDS');
            notes.push('.STACK ' + size + ' -> a PARA STACK segment');
            sawStack = true;
            continue;
        }
        if (directive === 'DATA' || directive === 'DATA?' || directive === 'CONST') {
            close();
            open = '_DATA'; sawData = true;
            out.push('_DATA   SEGMENT WORD PUBLIC \'DATA\'');
            notes.push('.' + directive + ' -> _DATA SEGMENT');
            continue;
        }
        if (directive === 'CODE') {
            close();
            open = '_TEXT';
            out.push('_TEXT   SEGMENT WORD PUBLIC \'CODE\'');
            // MASM 1.10 REFUSES a label it cannot reach through an assumed
            // segment register -- "No or unreachable CS" -- so the ASSUME is
            // not decoration, it is what makes the segment assemble at all.
            out.push('        ASSUME  CS:_TEXT'
                + (sawData ? ',DS:_DATA' : '') + (sawStack ? ',SS:STACK' : ''));
            notes.push('.CODE -> _TEXT SEGMENT + ASSUME');
            continue;
        }
        if (/^\s*END\s*(;.*)?$/i.test(line) || /^\s*END\s+[A-Za-z_@$?]/.test(line)) {
            close();
            out.push(line);
            continue;
        }
        out.push(line.replace(/@data\b/gi, '_DATA').replace(/@code\b/gi, '_TEXT'));
    }
    close();
    return { source: out.join('\n') + '\n', notes, model, shimmed: notes.length > 0 };
}

// ---------------------------------------------------------------------------
// Reading the two toolchains' output back
// ---------------------------------------------------------------------------

/**
 * The size of each segment MASM emitted, from the .OBJ's SEGDEF records.
 *
 * The OBJ is read for SIZES ONLY, not for bytes: its LEDATA holds zeros
 * where a fixup goes, so the code image worth comparing is the LINKED one.
 */
export function omfSegments(buf) {
    const names = [''], segs = [];
    let p = 0;
    while (p + 3 <= buf.length) {
        const type = buf[p], len = buf[p + 1] | (buf[p + 2] << 8);
        let q = p + 3;
        const end = p + 3 + len - 1;
        const index = () => {
            const b = buf[q++];
            return b < 0x80 ? b : (((b & 0x7f) << 8) | buf[q++]);
        };
        if (type === 0x96) {                                  // LNAMES
            while (q < end) {
                const n = buf[q++];
                let s = '';
                for (let i = 0; i < n; i++) s += String.fromCharCode(buf[q++]);
                names.push(s);
            }
        } else if (type === 0x98) {                            // SEGDEF
            const acbp = buf[q++];
            if ((acbp >> 5) === 0) q += 3;                     // absolute segment
            const size = buf[q] | (buf[q + 1] << 8);
            q += 2;
            const nameIdx = index(), classIdx = index();
            segs.push({ name: names[nameIdx] || '?', cls: names[classIdx] || '?', size });
        }
        p += 3 + len;
    }
    return segs;
}

/**
 * The code segment of an MZ image, found through its own entry point.
 *
 * Which paragraph a linker put the code at is its business; the header says
 * where execution starts, and that IS the code segment. This is what lets
 * two images built by different toolchains be compared at all.
 */
export function codeOfExe(exe, size) {
    const u16 = (o) => exe[o] | (exe[o + 1] << 8);
    const base = (u16(0x08) + u16(0x16)) * 16 + u16(0x14);
    if (base < 0 || base + size > exe.length) return null;
    return exe.subarray(base, base + size);
}

/** The words an MZ header says the loader must bias. A difference at one of
 *  these is a segment paragraph, which is layout and not arithmetic. */
export function relocSet(exe) {
    const u16 = (o) => exe[o] | (exe[o + 1] << 8);
    const count = u16(0x06), table = u16(0x18), headerBase = u16(0x08) * 16;
    const codeBase = (u16(0x08) + u16(0x16)) * 16 + u16(0x14);
    const set = new Set();
    for (let i = 0; i < count; i++) {
        const off = u16(table + i * 4), seg = u16(table + i * 4 + 2);
        set.add(headerBase + seg * 16 + off - codeBase);
    }
    return set;
}

/**
 * Source lines, offsets and emitted bytes, from MASM's own listing. This is
 * what turns "byte 0x3A differs" into "line 61 differs", which is the only
 * form of that fact anyone can act on.
 */
export function parseListing(lst) {
    const rows = [];
    let seg = '';
    for (const raw of lst.split(/\r?\n/)) {
        // The listing is TAB-separated: line number, then "OFFSET  BYTES",
        // then padding columns, then the source text. Splitting on tabs is
        // the only reliable way to tell an operand from an object byte --
        // `MOV AL,BYTE1` contains hex digits too.
        const cols = raw.split('\t');
        if (cols.length < 2 || !/^\s*\d+\s*$/.test(cols[0])) continue;
        const m = /^\s*([0-9A-F]{4})\s*(.*?)\s*$/.exec(cols[1]);
        if (!m) continue;
        const text = (cols[cols.length - 1] || '').replace(/\s+$/, '');
        // Which segment a row belongs to matters: every segment starts at
        // offset zero, so a code offset and a data offset collide, and
        // attributing a code difference to a DB line is worse than saying
        // nothing.
        const opened = /^\s*(\S+)\s+SEGMENT\b/i.exec(text);
        const closed = /^\s*(\S+)\s+ENDS\b/i.exec(text);
        if (opened) seg = opened[1].toUpperCase();
        rows.push({ line: Number(cols[0].trim()), off: parseInt(m[1], 16), bytes: listingBytes(m[2]), text, seg });
        if (closed) seg = '';
    }
    return rows;
}

/**
 * The object bytes MASM printed for one line.
 *
 * MASM's listing prints a byte as two hex digits, a WORD as four (as a
 * value, so it has to be split back into little-endian order), a segment
 * override as "2E:", and marks a fixup with a trailing R or E. A `DUP`
 * appears as `0004[ 00 ]`, which is a count and not data -- a line
 * containing one is reported as having no comparable bytes at all rather
 * than being guessed at, because guessing there would invent object code.
 */
function listingBytes(text) {
    const out = [];
    for (const tok of text.split(/\s+/).filter(Boolean)) {
        if (/^[0-9A-F]{2}:$/.test(tok)) { out.push(parseInt(tok, 16)); continue; }
        if (/^[0-9A-F]{2}$/.test(tok)) { out.push(parseInt(tok, 16)); continue; }
        if (/^[0-9A-F]{4}$/.test(tok)) {
            const v = parseInt(tok, 16);
            out.push(v & 0xff, (v >> 8) & 0xff);
            continue;
        }
        if (tok === 'R' || tok === 'E' || tok === '=') continue;
        return [];                                  // DUP, or something else
    }
    return out;
}

// ---------------------------------------------------------------------------
// Classifying a byte difference
// ---------------------------------------------------------------------------

/**
 * Decode one code image into instructions with `disasmI8086`.
 *
 * The disassembler is the right yardstick here because it is the piece of
 * this stack that is ground against 646,000 hardware-generated vectors on
 * both text and length. Comparing what two assemblers MEAN, rather than what
 * they wrote, is the whole difference between a useful report and a page of
 * shifted addresses.
 */
export function decodeAll(bytes) {
    const read = (a) => (a >= 0 && a < bytes.length ? bytes[a] : 0);
    const list = [];
    let off = 0;
    while (off < bytes.length) {
        const d = disasmI8086(read, off, { ip: off });
        const len = Math.max(1, d.length);
        list.push({ off, len, text: d.text, bytes: bytes.subarray(off, off + len) });
        off += len;
    }
    return list;
}

/**
 * Two texts that mean the same effective address.
 *
 * MASM keeps a disp8 slot on `SYM[BX][SI]` even when SYM sits at offset zero
 * -- it reserved room for a fixup that turned out to be zero -- so it writes
 * mod=01 disp8=0 where we write mod=00. `[bx+si+0]` and `[bx+si]` are the
 * same byte of the same segment, so this is an encoding choice and the
 * comparison must not read it as an address that moved.
 */
const NORM = (t) => t.replace(/\+0h\]/g, ']');

/**
 * TEST and XCHG have no direction bit: the assembler alone decides which
 * operand goes in the ModR/M reg field. Both are symmetric -- TEST only sets
 * flags from an AND it discards, XCHG swaps -- so `test al, bl` and
 * `test bl, al` are the same instruction written two ways, and MASM happens
 * to pick the other one. Two corpus files turn on exactly this.
 */
const COMMUTATIVE = /^(test|xchg)$/;
function sameMeaning(x, y) {
    if (NORM(x) === NORM(y)) return true;
    const mx = /^(test|xchg) ([a-z]{2}), ([a-z]{2})$/.exec(NORM(x));
    const my = /^(test|xchg) ([a-z]{2}), ([a-z]{2})$/.exec(NORM(y));
    return !!(mx && my && mx[1] === my[1] && mx[2] === my[3] && mx[3] === my[2]
        && COMMUTATIVE.test(mx[1]));
}

const MNEMONIC = (t) => t.split(/\s+/).filter((w) => !/^(lock|rep|repe|repne)$/.test(w))[0] || t;
/** The same instruction with every literal blanked, so "call 1A9h" and
 *  "call 1A6h" compare equal and the DIFFERENCE is then classified. */
const SHAPE = (t) => t.replace(/-?\b[0-9A-F]+h\b/gi, '#');
const BRANCH = /^(jmp|call|loop|loope|loopne|loopz|loopnz|jcxz|j[a-z]+)$/;

/**
 * Walk two code images instruction by instruction and say WHAT KIND each
 * difference is.
 *
 * Byte-diffing an assembler against a linker fails for reasons that are not
 * bugs, so the answer that matters is the classification, not the count.
 * Each benign class below was established by probe, not assumed:
 *
 *   nop-pad        MASM 1.10 sizes a forward reference on its first pass and
 *                  PADS WITH NOP when the second pass finds a shorter form.
 *                  `JMP fwd` is `EB 02 90`; ours is `EB 01`. Both jump to
 *                  the same place, and ours is a byte shorter. This is the
 *                  root cause of nearly every other difference downstream.
 *   equiv-encoding identical disassembly, different bytes: `XOR AX,AX` as
 *                  33 C0 (MASM) or 31 C0 (ours). Free choice of encoder.
 *   branch-shift   a relative branch whose target, followed through each
 *                  image's own alignment, is the SAME instruction. The
 *                  displacement differs only because the pads moved it.
 *   seg-reloc      a word the MZ header lists as a relocation: the paragraph
 *                  of a segment, which each toolchain places where it likes.
 *   data-shift     a direct memory operand or immediate that differs, in a
 *                  program whose data segments are not the same size. That
 *                  is layout, and it is reported separately rather than
 *                  being counted as arithmetic.
 *
 * What is left is a LEAD, in two grades: `operand-value` (same instruction,
 * a different number in it) and `different-instruction` (not the same
 * instruction at all).
 */
export function classifyCode(masmBytes, ourBytes, opts = {}) {
    const { masmRelocs = new Set(), ourRelocs = new Set(), dataShift = false } = opts;
    const a = decodeAll(masmBytes), b = decodeAll(ourBytes);
    const events = [];
    const pairs = [];
    const map = new Map();                    // MASM offset -> our offset
    let i = 0, j = 0;

    while (i < a.length && j < b.length) {
        if (sameMeaning(a[i].text, b[j].text)) {
            if (!sameBytes(a[i].bytes, b[j].bytes)) {
                events.push({ kind: 'equiv-encoding', masmOff: a[i].off, ourOff: b[j].off, text: a[i].text });
            }
            map.set(a[i].off, b[j].off);
            i++; j++;
            continue;
        }
        // MASM's forward-reference pad. Only ever MASM's, and only when ours
        // is not also a NOP -- otherwise a real NOP in the source would be
        // eaten and the alignment would drift.
        if (a[i].text === 'nop' && b[j].text !== 'nop') {
            events.push({ kind: 'nop-pad', masmOff: a[i].off, ourOff: b[j].off });
            i++;
            continue;
        }
        if (SHAPE(NORM(a[i].text)) === SHAPE(NORM(b[j].text))) {
            pairs.push({ m: a[i], o: b[j] });
            map.set(a[i].off, b[j].off);
            i++; j++;
            continue;
        }
        // Out of step. Look a short way ahead for a place to pick the two
        // streams back up; a comparison that gives up at the first surprise
        // reports one difference where there are two.
        const re = resync(a, b, i, j);
        if (!re) {
            events.push({ kind: 'different-instruction', masmOff: a[i].off, ourOff: b[j].off,
                masmText: a[i].text, ourText: b[j].text });
            break;
        }
        events.push({ kind: 'different-instruction', masmOff: a[i].off, ourOff: b[j].off,
            masmText: a.slice(i, re.i).map((x) => x.text).join('; '),
            ourText: b.slice(j, re.j).map((x) => x.text).join('; ') });
        i = re.i; j = re.j;
    }
    if (i < a.length || j < b.length) {
        events.push({ kind: 'length', masmOff: a.length ? (a[Math.min(i, a.length - 1)] || {}).off : 0,
            ourOff: b.length ? (b[Math.min(j, b.length - 1)] || {}).off : 0,
            masmLeft: a.length - i, oursLeft: b.length - j });
    }

    // Second pass: now that the alignment is known, a branch can be judged
    // by WHERE IT LANDS rather than by the number in it.
    for (const { m, o } of pairs) {
        const mn = MNEMONIC(m.text);
        if (BRANCH.test(mn)) {
            const mt = targetOf(m.text), ot = targetOf(o.text);
            if (mt !== null && ot !== null && map.has(mt) && map.get(mt) === ot) {
                events.push({ kind: 'branch-shift', masmOff: m.off, ourOff: o.off, text: m.text });
                continue;
            }
        }
        if (isReloc(masmRelocs, m) && isReloc(ourRelocs, o)) {
            events.push({ kind: 'seg-reloc', masmOff: m.off, ourOff: o.off, text: m.text });
            continue;
        }
        if (dataShift) {
            events.push({ kind: 'data-shift', masmOff: m.off, ourOff: o.off,
                masmText: m.text, ourText: o.text });
            continue;
        }
        events.push({ kind: 'operand-value', masmOff: m.off, ourOff: o.off,
            masmText: m.text, ourText: o.text });
    }

    const histogram = {};
    for (const e of events) histogram[e.kind] = (histogram[e.kind] || 0) + 1;
    return { events, histogram, clean: events.length === 0 };
}

const sameBytes = (x, y) => x.length === y.length && x.every((v, k) => v === y[k]);

/** The absolute target a relative branch renders, or null. */
function targetOf(text) {
    const m = /\b([0-9A-F]+)h\b\s*$/i.exec(text);
    return m ? parseInt(m[1], 16) : null;
}

/** Does this instruction cover a word the MZ header says to relocate? */
function isReloc(set, ins) {
    for (let k = ins.off; k < ins.off + ins.len; k++) if (set.has(k)) return true;
    return false;
}

/** Find the nearest place, within a short window, where the two streams say
 *  the same thing again. */
function resync(a, b, i, j, window = 8) {
    for (let d = 1; d <= window; d++) {
        for (let x = 0; x <= d; x++) {
            const ii = i + x, jj = j + (d - x);
            if (ii < a.length && jj < b.length && sameMeaning(a[ii].text, b[jj].text)
                && a[ii].text !== 'nop') {
                return { i: ii, j: jj };
            }
        }
    }
    return null;
}

/** Which listing row owns a code offset -- so a `value` names a source line. */
export function lineAt(rows, off, seg = '_TEXT') {
    let best = null;
    for (const r of rows) {
        if (seg && r.seg !== seg) continue;
        if (r.bytes.length && r.off <= off && off < r.off + r.bytes.length) return r;
        if (r.off <= off) best = r;
    }
    return best;
}

// ---------------------------------------------------------------------------
// Running an image
// ---------------------------------------------------------------------------

/** The Amey corpus records its own expected output against this stream; both
 *  sides get exactly the same one, which is what makes the comparison fair. */
export const DEFAULT_KEYS = '5\r3\rAMEY\r' + 'A'.repeat(40) + '\r';

export function runImage(bytes, format, { keys = DEFAULT_KEYS, budget = 5_000_000 } = {}) {
    const machine = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(machine, { files: new Map() }).install();
    if (format === 'com') dos.loadCom(bytes); else dos.loadExe(bytes);
    machine._write((LOAD_PSP << 4) + 2, TOP_OF_MEMORY & 0xff);
    machine._write((LOAD_PSP << 4) + 3, (TOP_OF_MEMORY >> 8) & 0xff);
    if (keys) dos.type(keys);
    const r = dos.run(budget);
    const report = dos.report();
    return {
        ...r, out: dos.stdout, screen: dos.screenText(),
        keyRequests: report.keyRequests, unsupported: report.unsupported,
    };
}

// ---------------------------------------------------------------------------
// One program, both ways
// ---------------------------------------------------------------------------

/**
 * Assemble one source with both assemblers, run both images, compare.
 *
 * @returns {object} verdict, plus everything needed to explain it
 */
export function compareOne(source, tools, { keys = DEFAULT_KEYS, budget = 5_000_000, shim = true } = {}) {
    const sh = shim ? shimSimplified(source) : { source, notes: [], shimmed: false };
    const masm = masmBuild(sh.source, tools);

    let ours = null, ourError = null;
    try {
        ours = assemble(source);
    } catch (e) {
        ourError = e.message;
    }

    const result = {
        shimmed: sh.shimmed, shimNotes: sh.notes,
        masmOk: masm.ok, masmStage: masm.stage || null, masmErrors: masm.errors,
        masmWarnings: masm.warnings, ourOk: !!ours, ourError,
        ourWarnings: ours ? ours.warnings.map((w) => `${w.line}: ${w.message}`) : [],
    };

    if (!masm.ok && !ours) return { ...result, verdict: 'both-refused' };
    if (!masm.ok) return { ...result, verdict: 'ours-only' };
    if (!ours) return { ...result, verdict: 'masm-only' };

    // Behaviour. The MASM side runs its LINKed .EXE (or the EXE2BIN'd .COM
    // when the program really was one flat segment); ours runs whatever our
    // assembler chose to emit. Two different containers, same program.
    const masmRun = runImage(masm.exe, 'exe', { keys, budget });
    const ourRun = runImage(ours.bytes, ours.format, { keys, budget });
    const agree = masmRun.out === ourRun.out;

    // Bytes. Only the code segment: the data segment's contents are the same
    // question asked more loudly, and its POSITION is pure layout.
    let bytes = null;
    const masmCodeSize = (omfSegments(masm.obj).find((s) => s.cls === 'CODE') || {}).size;
    const ourCode = ours.segments.find((s) => /^_?TEXT$|CODE/i.test(s.name)) || ours.segments[0];
    if (masmCodeSize && ourCode && ours.format === 'exe') {
        const mb = codeOfExe(masm.exe, masmCodeSize);
        const ob = codeOfExe(ours.bytes, ourCode.size);
        if (mb && ob) {
            // If the two data segments are not the same size, every direct
            // memory operand is off by that much and none of them is a bug.
            const masmData = (omfSegments(masm.obj).find((x) => x.cls === 'DATA') || {}).size || 0;
            const ourData = (ours.segments.find((x) => /DATA/i.test(x.name)) || {}).size || 0;
            bytes = classifyCode(mb, ob, {
                masmRelocs: relocSet(masm.exe), ourRelocs: relocSet(ours.bytes),
                dataShift: masmData !== ourData,
            });
            bytes.dataShift = masmData !== ourData;
            bytes.masmDataSize = masmData;
            bytes.ourDataSize = ourData;
            bytes.masmSize = mb.length;
            bytes.ourSize = ob.length;
        }
    } else if (masm.com && ours.format === 'com') {
        // The clean case: two flat .COM images, directly comparable.
        bytes = classifyCode(masm.com, ours.bytes);
        bytes.masmSize = masm.com.length;
        bytes.ourSize = ours.bytes.length;
    }

    return {
        ...result,
        verdict: agree ? 'agree' : 'differ',
        masmOut: masmRun.out, ourOut: ourRun.out,
        masmTerminated: masmRun.terminated, ourTerminated: ourRun.terminated,
        masmSteps: masmRun.steps, ourSteps: ourRun.steps,
        keyRequests: Math.max(masmRun.keyRequests, ourRun.keyRequests),
        bytes, listing: masm.lst,
    };
}

// ---------------------------------------------------------------------------
// The judgement calls, put to MASM one at a time
// ---------------------------------------------------------------------------

/**
 * Each entry is a whole 1982-dialect program -- no shim, nothing between the
 * source and MASM -- built both ways and compared as flat .COM images. These
 * are the cases i8086-asm.js's header settles by argument; here they are
 * settled by measurement.
 */
export const PROBES = [
    ['DW with a string longer than a word',
        ['MSG     DW "Enter a number: ",0'],
        'i8086-asm.js lays it down as BYTES rather than losing or inventing one.'],
    ['DW with a two-character string', ['MSG     DW \'AB\''], 'Fits; should be the word 4142h.'],
    ['DW with a one-character string', ['MSG     DW \'A\''], 'Should be 0041h.'],
    ['sizeless memory against an immediate', ['        MOV [SI], 5'],
        'i8086-asm.js takes the width the immediate fits, i.e. a byte.'],
    ['sizeless memory against a character EQU', ['CRET    EQU 0DH', '        MOV [SI-1], CRET'],
        'The documented case: byte or word?'],
    ['sizeless memory against a character literal', ['        MOV [SI-1], \'A\''],
        'A literal carries its own width.'],
    ['LEA with a bare register source', ['        LEA DX, SI'],
        'i8086-asm.js reads it as LEA DX, [SI].'],
    ['shift by an immediate count', ['        SHL AX, 4'],
        'An 80186 instruction; i8086-asm.js expands it into four single shifts.'],
    ['a bare data label is a memory operand', ['        MOV AX, VAL16', 'VAL16   DW 1234H'], ''],
    ['a forward short jump', ['        JMP L2', '        NOP', 'L2:     NOP'], ''],
    ['a backward short jump', ['L1:     NOP', '        JMP L1'], ''],
    ['LOOP and JCXZ', ['        MOV CX,5', 'L1:     NOP', '        LOOP L1', '        JCXZ L1'], ''],
    ['explicit segment overrides', ['        MOV AX, ES:[BX]', '        MOV CS:[SI], AL'], ''],
    ['string instructions with prefixes',
        ['        REP MOVSB', '        REPNE SCASB', '        LODSW', '        STOSB', '        CMPSW'], ''],
    ['immediate arithmetic width choice',
        ['        ADD AX, 5', '        ADD BX, 5', '        ADD WORD PTR [SI], 5', '        OR AL, 1', '        TEST AX, 1'], ''],
    ['shifts by CL', ['        MOV CL,4', '        SHL AX,CL', '        ROR BL,CL', '        SAR DX,1'], ''],
    ['BCD and translate', ['        AAM', '        AAD', '        XLAT', '        INT 3'], ''],
    ['EQU, = and constant arithmetic',
        ['N       EQU 10', 'M       =  20', '        MOV AX,N', '        MOV BX,M', '        MOV CX,N*M+1'], ''],
    ['$ and OFFSET', ['        MOV AX,OFFSET MSG', '        MOV BX,LEN', 'MSG     DB \'hi\'', 'LEN     EQU $-MSG'], ''],
    ['DUP', ['        NOP', 'B1      DB 4 DUP(0)', 'B2      DB 3 DUP(?)'], ''],
];

/** Probes that are about whether MASM ACCEPTS a shape at all, so they are
 *  written as whole files rather than dropped into the standard wrapper. */
export const FILE_PROBES = [
    ['a NEAR procedure left open at END',
        ['CODE    SEGMENT', '        ASSUME CS:CODE', '        ORG 100H', 'START:',
            'MAIN    PROC NEAR', '        NOP', '        INT 20H', 'CODE    ENDS', '        END START'],
        'i8086-asm.js closes it.'],
    ['code after CODE ENDS',
        ['CODE    SEGMENT', '        ASSUME CS:CODE', '        ORG 100H', 'START:  CALL HELP',
            '        INT 20H', 'CODE    ENDS', 'HELP    PROC NEAR', '        NOP', '        RET',
            'HELP    ENDP', '        END START'],
        'i8086-asm.js reopens the last segment, with a warning.'],
    ['a label in a segment NO assume reaches',
        ['DATA    SEGMENT', 'V1      DW 1', 'DATA    ENDS', 'CODE    SEGMENT', '        ASSUME CS:CODE',
            '        ORG 100H', 'START:  MOV AX, V1', '        INT 20H', 'CODE    ENDS', '        END START'],
        'i8086-asm.js warns and emits no override.'],
    ['a code-segment label with NO ASSUME DS at all',
        ['CODE    SEGMENT', '        ASSUME CS:CODE', '        ORG 100H', 'CVAR    DW 5',
            'START:  MOV AX, CVAR', '        INT 20H', 'CODE    ENDS', '        END START'],
        'i8086-asm.js synthesises nothing when there is no ASSUME to read.'],
    ['a code-segment label while DS is assumed elsewhere',
        ['DATA    SEGMENT', 'V1      DW 1', 'DATA    ENDS', 'CODE    SEGMENT',
            '        ASSUME CS:CODE,DS:DATA', '        ORG 100H', 'CVAR    DW 5',
            'START:  MOV AX, CVAR', '        INT 20H', 'CODE    ENDS', '        END START'],
        'i8086-asm.js synthesises a CS override. Does MASM?'],
    ['SEG in a .COM image',
        ['CODE    SEGMENT', '        ASSUME CS:CODE', '        ORG 100H', 'START:  MOV AX, SEG VAL16',
            '        INT 20H', 'VAL16   DW 1234H', 'CODE    ENDS', '        END START'],
        'i8086-asm.js refuses when a .COM is DEMANDED, as --probes does; left to '
        + 'itself it would emit an .EXE for this source, or MOV AX, CS if the source '
        + 'had no SEGMENT at all.'],
];

const wrapProbe = (body) => [
    'CODE    SEGMENT',
    '        ASSUME CS:CODE,DS:CODE,ES:CODE,SS:CODE',
    '        ORG 100H',
    'START:',
    ...body,
    '        INT 20H',
    'CODE    ENDS',
    '        END START',
].join('\n') + '\n';

/**
 * The whole object image a listing describes, laid down at the offsets it
 * names. Gaps (an ORG, an uninitialised DUP) stay zero, which is what an
 * unwritten byte of a .COM is anyway.
 */
export function imageFromListing(lst) {
    const rows = parseListing(lst).filter((r) => r.bytes.length);
    if (!rows.length) return null;
    const lo = Math.min(...rows.map((r) => r.off));
    const hi = Math.max(...rows.map((r) => r.off + r.bytes.length));
    const image = new Uint8Array(hi - lo);
    for (const r of rows) image.set(r.bytes, r.off - lo);
    return image;
}

const hexOf = (b, cap = 48) => {
    if (!b) return '(none)';
    const shown = Array.from(b.subarray(0, cap), (x) => x.toString(16).padStart(2, '0')).join(' ');
    return b.length > cap ? shown + ' ... (' + b.length + ' bytes)' : shown;
};

export function runProbes(tools) {
    const rows = [];
    const one = (name, source, note) => {
        const masm = masmBuild(source, tools);
        let ours = null, ourError = null;
        try {
            ours = assemble(source, { format: 'com' });
        } catch (e) {
            ourError = e.message;
        }
        // EXE2BIN converts only an image that enters at offset 100h with no
        // relocations. When it cannot, MASM's own listing still holds the
        // object bytes, and those are what the probe is asking about.
        const listingImage = masm.lst ? imageFromListing(masm.lst) : null;
        const masmBytes = masm.ok ? (masm.com || listingImage) : null;
        const fromListing = !!(masm.ok && !masm.com && listingImage);
        const ourBytes = ours ? ours.bytes : null;
        const same = !!(masmBytes && ourBytes && masmBytes.length === ourBytes.length
            && masmBytes.every((v, i) => v === ourBytes[i]));
        // A refused line still shows what MASM would have laid down, in the
        // listing. That recovery encoding is not an endorsement, but when it
        // matches ours it says the two read the operand the same way.
        const recovery = (!masm.ok && masm.lst) ? imageFromListing(masm.lst) : null;
        rows.push({
            name, note, same,
            masmOk: masm.ok, masmErrors: masm.errors, masmBytes, ourBytes, ourError, fromListing,
            ourWarnings: ours ? ours.warnings.map((w) => w.message) : [],
            recovery: recovery && recovery.length ? Uint8Array.from(recovery) : null,
            exe2binOut: masm.exe2binOut ? masm.exe2binOut.trim() : '',
        });
    };
    for (const [name, body, note] of PROBES) one(name, wrapProbe(body), note);
    for (const [name, lines, note] of FILE_PROBES) one(name, lines.join('\n') + '\n', note);
    return rows;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function collectAsm(paths) {
    const out = [];
    const walk = (p) => {
        const st = statSync(p);
        if (st.isDirectory()) for (const e of readdirSync(p).sort()) walk(join(p, e));
        else if (extname(p).toLowerCase() === '.asm') out.push(p);
    };
    for (const p of paths) walk(p);
    return out;
}

function main(argv) {
    const flag = (n) => argv.includes(n);
    const value = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
    const tools = findTools(value('--msdos-dir', DEFAULT_MSDOS_DIR));
    if (!tools.ok) {
        console.error('the MS-DOS 2.0 toolchain is not in ' + tools.dir + ': missing '
            + tools.missing.join(', '));
        console.error('fetch each from https://raw.githubusercontent.com/microsoft/MS-DOS/main/v2.0/bin/');
        return 2;
    }

    if (flag('--probes')) {
        const rows = runProbes(tools.paths);
        console.log('MASM 1.10 vs src/i8086-asm.js -- the judgement calls, measured\n');
        let agree = 0, refused = 0;
        for (const r of rows) {
            const tag = r.same ? 'SAME  ' : (!r.masmOk ? 'MASM-N' : 'DIFF  ');
            console.log(tag + '  ' + r.name);
            if (r.note) console.log('        note: ' + r.note);
            if (r.masmOk) console.log('        masm: ' + hexOf(r.masmBytes)
                + (r.fromListing ? '   [from the listing: EXE2BIN could not convert]' : ''));
            else {
                console.log('        masm: REFUSED -- ' + (r.masmErrors.join('; ') || 'no diagnostic'));
                if (r.recovery) console.log('        masm recovery bytes: ' + hexOf(r.recovery));
            }
            console.log('        ours: ' + (r.ourError ? 'REFUSED -- ' + r.ourError : hexOf(r.ourBytes)));
            for (const w of r.ourWarnings) console.log('        ours warns: ' + w);
            console.log('');
            if (r.same) agree++;
            if (!r.masmOk) refused++;
        }
        console.log(`${rows.length} probes: ${agree} byte-identical, ${refused} refused by MASM 1.10.`);
        if (rows.length === 0) { console.error('no probes ran'); return 1; }
        return 0;
    }

    const dirs = argv.filter((a, i) => !a.startsWith('--')
        && argv[i - 1] !== '--msdos-dir' && argv[i - 1] !== '--keys'
        && argv[i - 1] !== '--budget' && argv[i - 1] !== '--limit');
    if (!dirs.length) {
        console.error('usage: node scripts/oracle-masm.mjs [--probes] <dir-of-asm-files>');
        return 2;
    }
    const keys = (value('--keys', DEFAULT_KEYS) || '').replace(/\\r/g, '\r').replace(/\\n/g, '\n');
    const budget = Number(value('--budget', 5_000_000));
    const limit = Number(value('--limit', Infinity));
    const showDiffs = flag('--show-diffs');

    let files = collectAsm(dirs);
    if (files.length > limit) files = files.slice(0, limit);
    const root = dirs[0];

    const verdicts = {};
    const byteHistogram = {};
    const leads = [];
    const differing = [];
    const masmRefusals = {};
    const masmRefusalExample = {};
    let compared = 0, cleanBytes = 0, bytesCompared = 0, equivalentBytes = 0;

    for (const file of files) {
        const source = readFileSync(file, 'latin1');
        let r;
        try {
            r = compareOne(source, tools.paths, { keys, budget });
        } catch (e) {
            r = { verdict: 'harness-threw', ourError: e.message, masmErrors: [] };
        }
        verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
        const name = relative(root, file) || file;
        if (r.verdict === 'agree' || r.verdict === 'differ') {
            compared++;
            if (r.bytes) {
                bytesCompared++;
                if (r.bytes.clean) cleanBytes++;
                for (const [k, n] of Object.entries(r.bytes.histogram)) {
                    byteHistogram[k] = (byteHistogram[k] || 0) + n;
                }
                // "Identical" is almost never reachable -- MASM's pad NOPs
                // see to that -- so the number that means "these two
                // assemblers agree about this program" is the one where
                // every difference fell into a benign class.
                const values = r.bytes.events.filter(
                    (e) => e.kind === 'operand-value' || e.kind === 'different-instruction' || e.kind === 'length');
                if (!values.length) equivalentBytes++;
                if (values.length) {
                    const rows = parseListing(r.listing);
                    leads.push({
                        file: name, verdict: r.verdict,
                        sites: values.slice(0, 4).map((e) => {
                            const row = lineAt(rows, e.masmOff, '_TEXT');
                            return {
                                kind: e.kind,
                                at: e.masmOff,
                                masm: e.masmText, ours: e.ourText,
                                line: row ? row.line : null, text: row ? row.text.trim() : '',
                            };
                        }),
                    });
                }
            }
        }
        if (!r.masmOk && r.masmErrors) {
            for (const e of r.masmErrors) {
                const key = e.replace(/^\d+:/, '').trim() || e;
                masmRefusals[key] = (masmRefusals[key] || 0) + 1;
                if (!masmRefusalExample[key]) masmRefusalExample[key] = name;
            }
        }
        if (r.verdict === 'differ') {
            differing.push({
                file: name, shimmed: r.shimmed, keyRequests: r.keyRequests,
                masmOut: (r.masmOut || '').slice(0, 400), ourOut: (r.ourOut || '').slice(0, 400),
                masmTerminated: r.masmTerminated, ourTerminated: r.ourTerminated,
            });
        }
        if (r.verdict === 'differ' && showDiffs) {
            console.log('DIFFER ' + name);
            console.log('   masm: ' + JSON.stringify((r.masmOut || '').slice(0, 200)));
            console.log('   ours: ' + JSON.stringify((r.ourOut || '').slice(0, 200)));
        }
    }

    const summary = {
        files: files.length,
        compared,
        verdicts,
        bytesCompared,
        codeSegmentsIdentical: cleanBytes,
        codeSegmentsEquivalent: equivalentBytes,
        byteDifferenceHistogram: byteHistogram,
        masmRefusalHistogram: masmRefusals,
        masmRefusalExamples: masmRefusalExample,
    };

    if (flag('--json')) {
        console.log(JSON.stringify({ ...summary, differing, leads }, null, 2));
    } else {
        console.log('\n--- MASM 1.10 differential oracle ---------------------------------');
        console.log('files found                 ' + files.length);
        console.log('PROGRAMS ACTUALLY COMPARED  ' + compared);
        console.log('  both assemblers accepted, behaviour AGREES   '
            + (verdicts.agree || 0));
        console.log('  both accepted, behaviour DIFFERS             '
            + (verdicts.differ || 0));
        console.log('  MASM accepted, ours refused                  '
            + (verdicts['masm-only'] || 0));
        console.log('  ours accepted, MASM 1.10 refused             '
            + (verdicts['ours-only'] || 0));
        console.log('  both refused                                 '
            + (verdicts['both-refused'] || 0));
        if (verdicts['harness-threw']) console.log('  harness threw                                ' + verdicts['harness-threw']);
        console.log('\ncode segments byte-compared   ' + bytesCompared);
        console.log('   byte-identical               ' + cleanBytes);
        console.log('   equivalent (every difference in a benign class)  ' + equivalentBytes);
        console.log('   carrying at least one lead   ' + (bytesCompared - equivalentBytes));
        console.log('difference classes (benign first):');
        for (const [k, n] of Object.entries(byteHistogram).sort((a, b) => b[1] - a[1])) {
            console.log('   ' + String(n).padStart(6) + '  ' + k);
        }
        console.log('\nwhy MASM 1.10 refused a file (top 12):');
        for (const [k, n] of Object.entries(masmRefusals).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
            console.log('   ' + String(n).padStart(4) + '  ' + k
                + '   e.g. ' + masmRefusalExample[k]);
        }
        console.log('\ncomputed-value differences -- the only class that is a lead:');
        if (!leads.length) console.log('   none');
        for (const l of leads.slice(0, 25)) {
            console.log('   ' + l.file + '  (' + l.verdict + ')');
            for (const s of l.sites) {
                console.log('      ' + s.kind + ' at code offset 0x' + s.at.toString(16)
                    + (s.line ? '  line ' + s.line + ': ' + s.text : '')
                    + (s.masm !== undefined ? '\n         masm: ' + s.masm + '\n         ours: ' + s.ours : ''));
            }
        }
        if (leads.length > 25) console.log('   ... and ' + (leads.length - 25) + ' more');
        if (differing.length) {
            console.log('\nprograms whose OUTPUT differs -- read these first:');
            for (const d of differing) {
                console.log('   ' + d.file + (d.keyRequests ? '  (asked for ' + d.keyRequests + ' keystrokes)' : ''));
                console.log('      masm: ' + JSON.stringify(d.masmOut.slice(0, 160)));
                console.log('      ours: ' + JSON.stringify(d.ourOut.slice(0, 160)));
            }
        }
    }

    // A differential that compares nothing must not look like a pass.
    if (compared === 0) {
        console.error('\nCOMPARED ZERO PROGRAMS -- nothing was measured, so nothing is proved.');
        return 1;
    }
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main(process.argv.slice(2)));
}
