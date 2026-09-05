#!/usr/bin/env node
/**
 * GW-BASIC-on-the-bench probe (ROADMAP N6): does Microsoft's MIT-released
 * GW-BASIC (github.com/microsoft/GW-BASIC, 1983 8088 MASM source) assemble
 * through src/i8086-asm.js, so the 8086 column could carry a NATIVE BASIC cell
 * beside the 6502's MS BASIC ROM and the Z80's BBC BASIC?
 *
 * Same shape as the 525-program corpus harness: run each source through
 * assemble(), tally accepted / refused BY NAMED CONSTRUCT. The source is NOT
 * vendored — MIT permits it, but 40 files of someone else's assembler have no
 * business in this tree for an investigation. Point GW_BASIC_DIR at a clone:
 *
 *   git clone --depth 1 https://github.com/microsoft/GW-BASIC /tmp/GW-BASIC
 *   GW_BASIC_DIR=/tmp/GW-BASIC node scripts/gw-basic-assemble-probe.mjs
 *
 * Two preprocessing steps the real MASM does and this probe must too, or the
 * tally reports artefacts instead of GW-BASIC's constructs:
 *   - STRIP AT ^Z. DOS text files end in 0x1A; MASM stops there. Inlining an
 *     included file whole drops that EOF byte mid-stream, and the assembler
 *     then refuses the ^Z as an unknown mnemonic — a property of the probe,
 *     not of GW-BASIC. (This bit once; the line the refusal named was "".)
 *   - RESOLVE INCLUDE. Every source INCLUDEs BINTRP.H on line 8; without
 *     inlining it the tally is 34x "unsupported directive INCLUDE" and nothing
 *     is learned about what lies past it.
 *
 * The findings are written up in docs/GW-BASIC-ON-THE-BENCH.md; this script is
 * how they are reproduced.
 */
import { assemble } from '../src/i8086-asm.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.GW_BASIC_DIR || '/tmp/GW-BASIC';
if (!existsSync(dir)) {
    console.log(`SKIP: no GW-BASIC clone at ${dir}. This probe reads an external MIT source, `
        + 'never vendored. Clone it and set GW_BASIC_DIR:\n'
        + '  git clone --depth 1 https://github.com/microsoft/GW-BASIC /tmp/GW-BASIC');
    process.exit(0);
}

const missing = new Set();

/** Read a source file the way MASM sees it: latin1 bytes, CRLF folded, and
 *  truncated at the first ^Z (0x1A) DOS end-of-file marker. */
function readSource(name) {
    const path = join(dir, name);
    if (!existsSync(path)) { missing.add(name); return ''; }
    const text = readFileSync(path, 'latin1').replace(/\r\n/g, '\n');
    const eof = text.indexOf('\x1a');
    return eof >= 0 ? text.slice(0, eof) : text;
}

/** Inline INCLUDE directives, recursively, ^Z-stripped, cycle-guarded. */
function flatten(name, seen = new Set()) {
    if (seen.has(name)) return '';
    seen.add(name);
    return readSource(name).split('\n').map((line) => {
        const m = line.match(/^\s*INCLUDE\s+(\S+)/i);
        return m ? flatten(m[1].trim(), seen) : line;
    }).join('\n');
}

const files = readdirSync(dir).filter((f) => /\.asm$/i.test(f)).sort();
let accepted = 0;
const byConstruct = {};
const example = {};

for (const f of files) {
    try {
        assemble(flatten(f), { dialect: 'masm' });
        accepted += 1;
        console.log(`  ACCEPT  ${f}`);
    } catch (e) {
        const what = e.what || 'error';
        byConstruct[what] = (byConstruct[what] || 0) + 1;
        if (!example[what]) example[what] = `${f}:${e.line ?? '?'}  ${(e.message || '').replace(/^8086 asm[^:]*:\s*/, '')}`;
    }
}

const refused = files.length - accepted;
console.log(`\n${files.length} GW-BASIC sources: ${accepted} accepted, ${refused} refused `
    + '(first refusal per file, INCLUDE resolved, ^Z stripped).');
if (missing.size) console.log(`missing includes (OEM stubs not in the release): ${[...missing].join(', ')}`);
console.log('refusals by construct:');
for (const [what, n] of Object.entries(byConstruct).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  [${what}]  e.g. ${example[what]}`);
}
process.exit(0);
