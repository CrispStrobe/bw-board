#!/usr/bin/env node
/**
 * Build the bw-board 8086 BIOS ROM from rom/bios.asm.
 *
 * There is no external assembler in this chain and there is not supposed to
 * be: src/i8086-asm.js is the tier's own MASM-subset assembler, verified by
 * round trip against a disassembler that is verified against 646,000
 * hardware vectors. So the ROM is assembled by the same tool the corpus is,
 * which means a change that breaks the assembler breaks the ROM's test too,
 * loudly, in the same run.
 *
 * WHY THIS SCRIPT EXISTS AT ALL rather than a one-line `assemble()` call in
 * the test: an image for the top of the address space has an INVARIANT that
 * assembling cannot check. The 8086 leaves reset with CS=FFFF and IP=0000
 * and fetches physical FFFF0h. If the image is not exactly 64K, or if the
 * bytes at offset FFF0h are not a far jump into this ROM's own segment, the
 * machine executes whatever is there -- usually 00h, `ADD [BX+SI],AL`, over
 * and over, in silence. A ROM builder that does not check the reset vector
 * hands you a file that looks fine and a machine that does nothing, and the
 * distance between those two facts is the whole debugging session.
 *
 * So: assemble, then verify, then write. Any failure exits non-zero with a
 * message that names the byte.
 *
 *   node scripts/build-bios.mjs [--out path] [--quiet]
 *
 * and `import { buildBios } from './build-bios.mjs'` returns the image
 * without touching the filesystem, which is what the test uses.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from '../src/i8086-asm.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** Where the ROM's source lives, and where the image goes by default. */
export const SOURCE_PATH = join(ROOT, 'rom', 'bios.asm');
export const DEFAULT_OUT = join(ROOT, 'rom', 'bios.bin');

/**
 * The ROM occupies the whole F000 segment: physical F0000h-FFFFFh. That is
 * not a size chosen for comfort -- the reset fetch is at FFFF0h, the image
 * has to reach it, and a BIOS addressed as F000:xxxx has to start at F0000h
 * for its own offsets to be its own segment's offsets.
 */
export const ROM_SEG = 0xf000;
export const ROM_BASE = ROM_SEG << 4;      // F0000h
export const ROM_SIZE = 0x10000;           // 64K
/** Offset of the reset vector inside the image: FFFF0h - F0000h. */
export const RESET_OFFSET = 0xfff0;
/** JMP FAR with an immediate segment:offset. The only opcode that can be here. */
const JMP_FAR = 0xea;

/** A build that failed its own invariants, as opposed to a source error. */
export class RomError extends Error {
    constructor(message) { super(`bios rom: ${message}`); this.name = 'RomError'; }
}

const hex = (n, w = 4) => n.toString(16).toUpperCase().padStart(w, '0') + 'h';

/**
 * Check everything about the image that assembling cannot.
 *
 * @param {Uint8Array} bytes
 * @param {Map<string, {value?: number}>} symbols
 */
export function verifyRom(bytes, symbols) {
    if (bytes.length !== ROM_SIZE) {
        throw new RomError(
            `the image is ${bytes.length} bytes and must be exactly ${ROM_SIZE} `
            + `(the F000 segment, F0000h-FFFFFh). The source pads to the reset `
            + `vector with ORG; if that ORG moved, this is what it broke.`);
    }

    const op = bytes[RESET_OFFSET];
    if (op !== JMP_FAR) {
        throw new RomError(
            `offset ${hex(RESET_OFFSET)} holds ${hex(op, 2)} where the reset vector's `
            + `far jump (${hex(JMP_FAR, 2)}) must be. The 8086 fetches its first `
            + `instruction from FFFF:0000 = physical FFFF0h and executes whatever `
            + `is there; ${hex(op, 2)} is not a jump, so the machine would run off `
            + `the top of memory instead of entering the BIOS.`);
    }

    const off = bytes[RESET_OFFSET + 1] | (bytes[RESET_OFFSET + 2] << 8);
    const seg = bytes[RESET_OFFSET + 3] | (bytes[RESET_OFFSET + 4] << 8);
    if (seg !== ROM_SEG) {
        throw new RomError(
            `the reset vector jumps to segment ${hex(seg)}, not ${hex(ROM_SEG)}. `
            + `Only F000 is this ROM; any other segment is RAM that has never `
            + `been written.`);
    }

    // The entry point has to be inside the image, and it has to be the POST
    // entry the source names. Checking only "inside the image" would pass a
    // vector aimed at the middle of a string.
    const post = symbols.get('post');
    if (!post || typeof post.value !== 'number') {
        throw new RomError('the source defines no `post` label, so there is no entry point to verify against');
    }
    if (off !== post.value) {
        throw new RomError(
            `the reset vector enters at ${hex(off)} but POST is at ${hex(post.value)}. `
            + `The far jump was hand-encoded (the assembler cannot emit a far jump `
            + `into a flat image); its offset word and the label have drifted apart.`);
    }

    // The first instruction of POST must be a CLI. Not a formality: POST sets
    // up the interrupt vector table, and taking an interrupt while the table
    // is half-written jumps through a vector that is one word new and one
    // word old.
    if (bytes[post.value] !== 0xfa) {
        throw new RomError(
            `POST at ${hex(post.value)} does not begin with CLI (FAh) but with `
            + `${hex(bytes[post.value], 2)}. Interrupts must be off until the vector `
            + `table and the stack exist.`);
    }
    return { entry: off, segment: seg };
}

/**
 * Assemble and verify. Returns the image and everything a caller might want
 * to assert against; touches no files but the source.
 *
 * @param {{ source?: string, sourcePath?: string }} [opts]
 */
export function buildBios(opts = {}) {
    const sourcePath = opts.sourcePath ?? SOURCE_PATH;
    const source = opts.source ?? readFileSync(sourcePath, 'utf8');

    // 'com' and not 'auto': a flat image at a chosen ORG is exactly what a
    // ROM is, and letting the format be inferred would produce an MZ header
    // the moment somebody added a .MODEL line.
    const r = assemble(source, { format: 'com' });

    if (r.org !== 0) {
        throw new RomError(
            `the image starts at ORG ${hex(r.org)} and must start at 0. A BIOS's `
            + `offsets ARE its segment's offsets: F000:0000 is the first byte.`);
    }
    const { entry, segment } = verifyRom(r.bytes, r.symbols);

    return {
        bytes: r.bytes,
        entry,
        segment,
        base: ROM_BASE,
        warnings: r.warnings,
        symbols: r.symbols,
        passes: r.passes,
        sourcePath,
    };
}

// ---------------------------------------------------------------------------

function main(argv) {
    let out = DEFAULT_OUT;
    let quiet = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--out') out = argv[++i];
        else if (argv[i] === '--quiet') quiet = true;
        else if (argv[i] === '--help' || argv[i] === '-h') {
            console.log('usage: node scripts/build-bios.mjs [--out path] [--quiet]');
            return 0;
        } else {
            console.error(`build-bios: unknown argument ${argv[i]}`);
            return 2;
        }
    }

    let rom;
    try {
        rom = buildBios();
    } catch (e) {
        // A source error and a broken invariant are both fatal and both get
        // named. Nothing is written: a half-valid ROM on disk outlives the
        // run that produced it.
        console.error(String(e.message ?? e));
        return 1;
    }

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, rom.bytes);

    if (!quiet) {
        const used = rom.bytes.reduce((n, b) => n + (b !== 0 ? 1 : 0), 0);
        console.log(`bw-board 8086 BIOS`);
        console.log(`  source     ${rom.sourcePath}`);
        console.log(`  image      ${out}`);
        console.log(`  size       ${rom.bytes.length} bytes at ${hex(ROM_BASE, 5)} (segment ${hex(ROM_SEG)})`);
        console.log(`  non-zero   ${used} bytes (${(used * 100 / rom.bytes.length).toFixed(1)}% of the segment)`);
        console.log(`  reset      FFFF:0000 -> ${hex(rom.segment)}:${hex(rom.entry)}  (jmp far, verified)`);
        console.log(`  passes     ${rom.passes}`);
        if (rom.warnings.length) {
            console.log(`  warnings   ${rom.warnings.length}`);
            for (const w of rom.warnings) console.log(`    line ${w.line}: ${w.message}`);
        }
    }
    return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    process.exit(main(process.argv.slice(2)));
}

export default buildBios;
