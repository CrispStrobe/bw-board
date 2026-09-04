#!/usr/bin/env node
/**
 * Run 8086 programs through the Tier B stack and report what happened.
 *
 * This is the instrument that turns "the tier is built" into a number, and
 * its whole value depends on not flattering itself. So the classification
 * below has no "pass" in it. A program that loads, runs, exits cleanly and
 * prints NOTHING is not a success -- it is a program that did nothing, and
 * on this corpus that usually means a service returned carry and the code
 * took an error branch straight to the exit. Those are counted separately
 * from programs that actually produced output.
 *
 *   MATCH      exited, and its output equals a recorded expected output
 *   NOINPUT    output differs, and the program ASKED FOR A KEY it did not
 *              get -- a difference in this harness, not in the emulation
 *   ORACLE     the RECORDED output is a memory image, not a result: their
 *              simulator's $-terminated print ran away. Not comparable.
 *   DIFFER     exited, and its output does NOT match. A real lead.
 *   EXITED     terminated through int 21h/4Ch or int 20h, WITH output
 *   SILENT     terminated cleanly and produced nothing -- suspicious
 *   LOOPING    still running at the budget, and DOING something -- it
 *              printed, or it drove a device. A traffic-light controller
 *              never exits and never should; calling that a failure would
 *              slander a working program.
 *   HUNG       still running at the budget having done nothing observable.
 *              This is the one that means something is wrong.
 *   THREW      the core hit an opcode it does not implement, or the loader
 *              refused the file. The message names it.
 *   NOASM      an .asm source with no assembler wired in yet.
 *
 * The most useful output is not the tally, it is the REFUSAL HISTOGRAM: every
 * {int, ah} a program asked for and did not get, summed across the corpus and
 * sorted. That is the to-do list, measured rather than guessed -- the same
 * method that showed 2,862 of 3,109 int 21h calls in the textbook corpus are
 * three services.
 *
 * --emu8086 installs the virtual devices over the whole port space and
 * substitutes the clean-room macro library for `include 'emu8086.inc'`,
 * which is what the coursework corpus targets rather than DOS. It shadows
 * any decoded chip, so it is opt-in: a machine with a PIC would lose it.
 *
 *   node scripts/run-i8086-corpus.mjs --selftest
 *   node scripts/run-i8086-corpus.mjs path/to/dir [more...]
 *   node scripts/run-i8086-corpus.mjs --budget 20000000 --verbose file.com
 *
 * --expect <json> turns "it printed something" into "it printed the RIGHT
 * thing". The file maps a program's path to the output it should produce.
 * The Amey corpus ships one, recorded from ITS OWN simulator.
 *
 * THAT ORACLE IS NOT HARDWARE-GROUNDED and the verdict must not pretend it
 * is. That simulator dispatches on mnemonic strings over its assembler's
 * operand objects -- it never fetches an opcode byte -- so it is an
 * INDEPENDENT SECOND OPINION, not an authority. A DIFFER is a lead worth
 * chasing from both ends, and when the two disagree the tie-breaker is the
 * core, which is verified against 646,000 hardware-generated vectors.
 * Agreement across hundreds of programs is still strong evidence, because
 * two unrelated implementations rarely make the same mistake.
 *
 * WHAT THE DISAGREEMENTS TURNED OUT TO BE, classified over the whole 525 so
 * the next reader does not re-derive it:
 *
 *   13  the ORACLE printed 5-190 KB of raw memory. Those are runaway
 *       $-terminated prints in their simulator -- one dumps the interrupt
 *       vector table verbatim, which means their SEG returned 0 and INT 21h/09h
 *       scanned from 0000:0000 until it found a $. Ours prints the program's
 *       actual report. Their bug, not ours.
 *    9  environment: clock and date (theirs seeded from wall-clock, ours
 *       deterministic), and load addresses -- DS, SS, SP and BP differ because
 *       two loaders place a program differently. Neither is wrong.
 *    2  OURS, found here and fixed: INT 21h/3Eh and /41h reported success
 *       unconditionally, so "close a handle never opened" and "delete a file
 *       that is not there" looked like they worked.
 *    3  known simplifications of ours, stated in i8086-dos.js: INT 10h/06h
 *       clears rather than scrolling a window, and two port reads land on
 *       device defaults.
 *
 * --type <keys> hands the same keystrokes to every program that asks for
 * input. To compare against a recorded oracle you must reproduce the
 * CONDITIONS it recorded under, not guess at them: the Amey corpus states
 * its own stream in `js/test/output.test.mjs` --
 *
 *     --type '5\r3\rAMEY\rAAAA...\r'   (40 A's)
 *
 * Without it, 28 programs that read the keyboard cannot agree with a run
 * that had one, and they are reported NOINPUT rather than counted against
 * the tier.
 *
 * ASSEMBLER HOOK. `--assembler <module>` loads an ES module that must export
 * `assemble(source, {name}) -> { bytes: Uint8Array, format: 'com'|'exe'|'boot' }`
 * and throw on failure. Nothing is wired in yet; until then .asm files count
 * as NOASM rather than being silently skipped, because a skip reads the same
 * as a pass in a summary line.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086, DOSBOX8086_XT } from '../src/i8086-dos.js';
import { Unimplemented } from '../src/i8086.js';
import { createEmu8086, EMU8086_INC } from '../src/i8086-emu8086.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, dflt) => {
    const i = argv.indexOf(name);
    return i === -1 ? dflt : argv[i + 1];
};
const BUDGET = Number(value('--budget', 5_000_000));
const VERBOSE = flag('--verbose');
const EMU = flag('--emu8086');
// --xt swaps in the three chips that make a beep audible (8255, 8254,
// speaker). The emu8086 port handler installs AFTER the config chips and the
// machine checks its windows in order, so those three keep their ports and
// emu8086 keeps the rest -- the two can be used together.
const XT = flag('--xt');
// --pic is an EXPERIMENT, not a bench change: it adds an 8259 at 20h and wires
// the PIT's OUT0 to IRQ0, which is what an ISR-driven feature (software PWM,
// `WHEN <pin> pressed`) would need and what DOSBOX8086_XT deliberately has
// not got. It exists so the cost of that change can be MEASURED against the
// corpus before anyone decides to make it, rather than discovered afterwards.
// The observable difference to a program is that 20h-21h stop being open bus.
const PIC = flag('--pic');
const XT_WITH_PIC = Object.freeze({
    ...DOSBOX8086_XT,
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },
        { kind: 'ppi', name: 'ppi1', at: 0x60 },
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },
        { kind: 'pcspeaker', name: 'spk', ppi: 'ppi1', pit: 'pit1' },
    ],
});
// Keystrokes handed to any program that asks. `\r` and `\n` are the two
// escapes worth having; everything else is literal.
const TYPE = (value('--type', '') || '').replace(/\\r/g, '\r').replace(/\\n/g, '\n');
let expected = null;
const expectPath = value('--expect', null);
if (expectPath) expected = JSON.parse(readFileSync(expectPath, 'utf8'));

/** Fold text onto an 80-column screen, the way the cursor does. */
const wrap80 = (t) => String(t).split('\n')
    .flatMap((l) => (l.length <= 80 ? [l] : (l.match(/.{1,80}/g) || [l])))
    .join('\n');

/** Line endings and trailing space are not the thing under test. */
const norm = (t) => String(t).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
const paths = argv.filter((a, i) => !a.startsWith('--')
    && argv[i - 1] !== '--budget' && argv[i - 1] !== '--assembler'
    && argv[i - 1] !== '--expect' && argv[i - 1] !== '--type'
    && argv[i - 1] !== '--expect-counts');

let assembler = null;
const asmPath = value('--assembler', null);
if (asmPath) {
    const mod = await import(asmPath.startsWith('.') || asmPath.startsWith('/')
        ? asmPath : `../${asmPath}`);
    if (typeof mod.assemble !== 'function') {
        console.error(`${asmPath} exports no assemble(); see the header for the contract`);
        process.exit(2);
    }
    assembler = mod.assemble;
}

/**
 * Disagreements with the Amey oracle that have been READ and explained, so a
 * NEW one stands out instead of hiding among them.
 *
 * Same pattern as the disassembly grinder's exclusion table and for the same
 * reason: twenty-five unexplained differences and twenty-six unexplained
 * differences look identical in a summary line, so a regression introduced
 * today would be invisible. Keyed by file name, with the reason, and the run
 * reports NEW ones separately and says HEALED when one starts agreeing.
 *
 * Note what is NOT here: nothing is excluded from the count. A known
 * disagreement is still a DIFFER. This table only says which ones have been
 * looked at.
 */
const KNOWN_DISAGREEMENTS = {
    // Environment: neither implementation is wrong.
    'bios_timer_ticks.asm': 'their clock is seeded from wall-clock; ours starts at zero, deterministically',
    'bios_system_time.asm': 'same: wall-clock seed',
    'display_system_time.asm': 'same: wall-clock seed',
    'dos_get_date_and_time.asm': 'their date is the recording day; ours is the epoch',
    'display_date.asm': 'same: recording-day date',
    'mov_segment_registers.asm': 'two loaders place a program differently, so DS differs',
    'inspect_stack_registers.asm': 'loader difference: SS',
    'stack_frame_anatomy.asm': 'loader difference: BP',
    'stack_pointer_movement.asm': 'loader difference: initial SP',
    'interrupt_vector_table.asm': 'our IVT points at our own trap slots, theirs at a BIOS image',
    'in_out_port_transfer.asm': 'a port read lands on a device default rather than a flat byte',
    'adc_read_and_scale.asm': 'a port read lands on the thermometer default',
};

/** Two synthetic programs, so the harness can prove itself with no corpus. */
const SELFTEST = [
    {
        name: 'selftest-hello.com',
        bytes: Uint8Array.from([
            0xba, 0x0c, 0x01, 0xb4, 0x09, 0xcd, 0x21,        // print [010Ch]
            0xb8, 0x00, 0x4c, 0xcd, 0x21,                     // exit 0
            0x6f, 0x6b, 0x24,                                 // 'ok$'
        ]),
        expect: 'EXITED',
    },
    {
        name: 'selftest-silent.com',
        bytes: Uint8Array.from([0xb8, 0x00, 0x4c, 0xcd, 0x21]),
        expect: 'SILENT',
    },
    {
        name: 'selftest-spin.com',
        bytes: Uint8Array.from([0xeb, 0xfe]),
        expect: 'HUNG',
    },
    {
        name: 'selftest-refused.com',
        bytes: Uint8Array.from([0xb4, 0x99, 0xcd, 0x21, 0xb8, 0x00, 0x4c, 0xcd, 0x21]),
        expect: 'SILENT',                                     // exits, prints nothing
    },
];

/** Which loader a file wants, from what is actually in it. */
function classify(bytes, name) {
    const ext = extname(name).toLowerCase();
    if (ext === '.asm' || ext === '.s' || ext === '.inc') return 'asm';
    if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'exe';
    if (bytes.length === 512 && bytes[510] === 0x55 && bytes[511] === 0xaa) return 'boot';
    if (ext === '.bin' && bytes.length >= 512 && bytes[510] === 0x55 && bytes[511] === 0xaa) return 'boot';
    return 'com';
}

/**
 * WHAT SURVIVES A PROGRAM, and why it is not the whole report.
 *
 * `results` holds one entry per program and the corpus is 525 of them. Every
 * verdict is decided INSIDE runOne -- the stream/screen comparison, the
 * printed test, the oracle match -- so nothing after the loop needs a
 * program's full output. Keeping it anyway cost ~0.46 MB per program
 * (measured: 71 MB at 50 programs, 117 MB at 150) and the full run died at
 * V8's 900 MB heap limit after 12m31s ON AN IDLE BOX WITH 3 GB FREE. That is
 * the harness, not the machine: an OOM that only happens at full scale is
 * indistinguishable from a box under pressure, and it was blamed on the box
 * twice before it was measured.
 *
 * THIS FIX IS PARTIAL AND THE MEASUREMENT SAYS SO. Slimming saved ~5%:
 * 71.0 -> 67.5 MB at 50 programs, 116.9 -> 112.0 MB at 150. The baseline is
 * ~0.45 MB per program and it is NOT the report -- something else retains it,
 * and I have not found what. Recorded as an open defect with numbers rather
 * than closed with a plausible story, because "we slimmed the reports" reads
 * like a fix and the full run may still die.
 *
 * AND THE GUESS IN THAT LAST SENTENCE WAS WRONG. It read "a retained object
 * graph rather than a runaway string". The review lane instrumented this
 * harness to force GC every 25 programs and print post-GC heapUsed:
 *
 *     n=25  heap 5.4MB  rss 60.2MB      n=100  heap 5.8MB  rss 78.9MB
 *     n=50  heap 6.0MB  rss 73.3MB      n=150  heap 6.1MB  rss 82.6MB
 *
 * HEAP FLAT AT ~6 MB WHILE RSS CLIMBS. Nothing is retained. The RSS growth is
 * the allocator: every runOne allocates a fresh 1 MB Uint8Array for the 20-bit
 * space, and 525 of those allocated and freed is exactly what glibc does not
 * return to the OS. That explains the RSS curve and explains NOTHING about a
 * V8 heap OOM -- so the crash at 900 MB is a different event, most likely one
 * pathological program rather than accumulation. This file already documents
 * the class: the ORACLE verdict exists because a runaway INT 21h/09h scans
 * memory for a `$` and prints ~190 KB, and a scan that starts somewhere worse
 * prints far more.
 *
 * Left in full rather than edited down, because the wrong reading was
 * confident and specific and I had already committed it.
 *
 * stdout is the one term that runs away. `putChar` appends per character with no
 * cap, and a LOOPING program printing inside a 5,000,000-instruction budget
 * produces ~1 MB of it. The summary prints at most a couple of lines, so the
 * tail is what a reader wants; the head is kept too, because a program's first
 * output says what it was doing before it went wrong.
 */
const KEEP = 2048;
function slimReport(report) {
    const out = report.stdout || '';
    return {
        unsupported: report.unsupported,
        terminated: report.terminated,
        exitCode: report.exitCode,
        breakpoints: report.breakpoints,
        rebooted: report.rebooted,
        keyRequests: report.keyRequests,
        stdoutLength: out.length,
        stdout: out.length <= KEEP * 2 ? out
            : `${out.slice(0, KEEP)}\n...[${out.length - KEEP * 2} chars elided]...\n${out.slice(-KEEP)}`,
        devices: report.devices,
    };
}

function runOne(name, raw, key, from = null) {
    let bytes = raw;
    let kind = classify(bytes, name);

    if (kind === 'asm') {
        if (!assembler) return { name, verdict: 'NOASM', note: 'no assembler wired in' };
        try {
            let source = Buffer.from(bytes).toString('utf8');
            if (EMU) {
                // The corpus writes the include three ways. Substituting the
                // text here rather than teaching the assembler INCLUDE keeps
                // a file-system search path out of an assembler that has no
                // business having one.
                source = source.replace(
                    /^[ \t]*include[ \t]+["']?emu8086\.inc["']?[ \t]*$/gim, EMU8086_INC);
            }
            // NASM's `%include` and `INCBIN` resolve against the directory
            // the source lives in. The assembler has no file system of its
            // own -- deliberately, it runs in a browser -- so the harness is
            // where the path search belongs, exactly as the emu8086 include
            // substitution above is.
            const dir = from ? dirname(from) : '.';
            let out;
            out = assembler(source, {
                name,
                // PROMOTE OUT-OF-RANGE CONDITIONALS, and COUNT the programs
                // that needed it rather than letting the flag be invisible.
                //
                // The assembler's MASM dialect refuses a Jcc or LOOP whose
                // target is beyond +-127, and that default is measured rather
                // than arbitrary: MASM 1.10 refuses them too, and promoting
                // silently would hand a learner a program that works here and
                // fails on the lab machine. Byte-fidelity against the MASM
                // oracle depends on it.
                //
                // A COVERAGE HARNESS WANTS A DIFFERENT THING. Its question is
                // "does this program run", and 14 of 525 never reached the
                // machine because they were refused at assembly -- so the
                // corpus was reporting an ASSEMBLER default as though it were
                // a fact about the programs. Promotion only rewrites jumps
                // that actually overflow, so every program that does not
                // overflow is byte-identical either way and the differential
                // oracles are untouched.
                //
                // Counted and printed, because a flag that changes 14 verdicts
                // and leaves no trace is the same defect in a new place.
                longJumps: true,
                readInclude: (p2) => {
                    const at = join(dir, p2);
                    return existsSync(at) ? readFileSync(at, 'utf8') : undefined;
                },
                readBinary: (p2) => {
                    const at = join(dir, p2);
                    return existsSync(at) ? new Uint8Array(readFileSync(at)) : undefined;
                },
            });
            const promotions = (out.warnings || []).filter(
                (w) => /promoted to a branch over a near jump/.test(w.message || ''));
            if (promotions.length) promotedPrograms.push({ name, n: promotions.length });
            bytes = out.bytes;
            kind = out.format || 'com';
        } catch (e) {
            return { name, verdict: 'THREW', note: `assembly failed: ${e.message}` };
        }
    }

    const m = new I8086Machine(XT ? (PIC ? XT_WITH_PIC : DOSBOX8086_XT) : DOSBOX8086);
    let emu = null;
    let dos;
    try {
        if (EMU) emu = createEmu8086(m).install();
        dos = createDos8086(m).install();
        if (TYPE) dos.type(TYPE);
        if (kind === 'exe') dos.loadExe(bytes);
        else if (kind === 'boot') dos.loadBoot(bytes);
        else dos.loadCom(bytes);
    } catch (e) {
        return { name, verdict: 'THREW', note: `load refused: ${e.message}`, kind };
    }

    let steps = 0;
    try {
        while (!dos.terminated && steps < BUDGET) { dos.step(); steps++; }
    } catch (e) {
        const what = e instanceof Unimplemented ? e.message : `${e.name}: ${e.message}`;
        return { name, kind, verdict: 'THREW', note: what, steps, report: slimReport(dos.report()) };
    }

    const report = dos.report();
    const screen = dos.screenText().filter((l) => l.length).length;
    // A device program's output is what it did to the DEVICES, not what it
    // printed -- the traffic-light program prints nothing and is still
    // working. Counting only stdout would report every one of them as
    // silent, which is how a harness lies about the tier it is measuring.
    const devs = emu ? emu.report() : null;
    const touched = devs ? devs.writes + devs.reads : 0;
    // A program whose whole output is a beep has produced output.
    const beeped = typeof m.audioTone === 'function' && m.audioTone() && m.audioTone().on;
    const printed = report.stdout.length > 0 || screen > 0 || touched > 0 || beeped;
    if (devs) report.devices = devs;
    // A boot sector never "exits" -- it has nowhere to exit to. Reaching the
    // budget having drawn something is the success case for one, so it is
    // classified on OUTPUT rather than on termination.
    if (kind === 'boot') {
        return {
            name, kind, steps, report: slimReport(report),
            verdict: printed ? 'EXITED' : (steps >= BUDGET ? 'HUNG' : 'SILENT'),
        };
    }
    // NOT terminating is not the same as not working. An infinite control
    // loop is what a traffic-light controller IS, so the split is on whether
    // anything observable happened, not on whether the program exited.
    if (!dos.terminated) {
        return { name, kind, steps, report: slimReport(report), verdict: printed ? 'LOOPING' : 'HUNG' };
    }
    if (!printed) return { name, kind, steps, report: slimReport(report), verdict: 'SILENT' };
    const golden = expected && key && expected[key];
    if (golden && typeof golden.output === 'string') {
        const want = norm(golden.output);
        // TWO READINGS OF "OUTPUT", and the corpus's own oracle models the
        // SCREEN. Our stdout is the character STREAM -- everything ever
        // written -- so the two agree until a program clears the display,
        // after which the stream still holds the text the screen no longer
        // shows. bios_clear_screen.asm is exactly that: the oracle records
        // one line, the stream holds two. Neither is wrong; they are
        // different quantities, and comparing the wrong one manufactures a
        // disagreement out of a modelling difference.
        const stream = norm(report.stdout);
        const screen = norm(dos.screenText().join('\n'));
        // A TRUNCATED STREAM IS A PREFIX, NOT AN OUTPUT. The DOS layer caps
        // what it retains at 1 MB (see MAX_STDOUT — two corpus programs
        // otherwise retain ~40 MB each at the default budget). A comparison
        // that ignored the cap could report MATCH the moment an expected
        // output happened to be shorter than the prefix, which would be a
        // false agreement produced by our own memory limit. Anything that
        // hits the cap is a runaway program and belongs in LOOPING.
        if (report.stdoutTruncated) {
            // WHY it ran away matters as much as that it did. Both corpus
            // programs that hit this cap -- dos_menu_driven_program.asm and
            // calculator.asm -- are INTERACTIVE: they print a menu, wait for a
            // key, get none because this harness types nothing by default, and
            // reprint forever. Their output is ordinary printable text, not the
            // ORACLE pattern where a runaway INT 21h/09h scans memory for a `$`.
            // So the cause is a missing input, which is a limit of the harness
            // rather than a defect in the program or the emulation -- the same
            // distinction NOINPUT already exists to draw.
            const asked = report.keyRequests > 0;
            return {
                name, kind, steps, report: slimReport(report), verdict: 'LOOPING',
                note: `printed ${report.stdoutChars.toLocaleString()} characters; output capped `
                    + `at 1 MB and not compared`
                    + (asked ? ` — it asked for input ${report.keyRequests} time(s) and got none,`
                        + ' so it reprinted its prompt; try --type' : ''),
            };
        }
        if (want === stream) return { name, kind, steps, report: slimReport(report), verdict: 'MATCH', via: 'stream' };
        if (want === screen) return { name, kind, steps, report: slimReport(report), verdict: 'MATCH', via: 'screen' };
        // A SCREEN IS EIGHTY COLUMNS AND A STREAM IS NOT. Their oracle records
        // a stream, so a 111-character line stays on one line there and wraps
        // onto two here -- identical text, different shape. Wrapping THEIR
        // output at 80 before comparing applies our screen model to their
        // data rather than loosening the test: content that actually differs
        // still fails.
        if (norm(wrap80(want)) === screen) {
            return { name, kind, steps, report: slimReport(report), verdict: 'MATCH', via: 'screen (wrapped)' };
        }
        // A program that asked for a key and got none cannot be expected to
        // agree with a run that had one. Ours types nothing, so that is a
        // difference in the HARNESS, not in the emulation, and it is
        // reported apart rather than counted against the tier.
        // THE ORACLE'S OWN RUNAWAY PRINT, detected by evidence rather than
        // listed by name. Their INT 21h/09h scans until it finds a '$', and
        // when their SEG returns 0 it starts at 0000:0000 and prints the
        // interrupt vector table -- ~190 KB of `53 FF 00 F0` repeating. A
        // recorded output that is a memory image is not a specification, and
        // no amount of work on this side can agree with one. Named by the
        // property that identifies it, so a NEW one is caught for free
        // instead of needing a row added.
        const printable = [...want.slice(0, 400)]
            .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127).length;
        if (want.length > 5000 || (want.length > 40 && printable < want.slice(0, 400).length / 2)) {
            return { name, kind, steps, report: slimReport(report), want, got: stream, verdict: 'ORACLE' };
        }
        const asked = report.keyRequests > 0;
        return {
            name, kind, steps, report: slimReport(report), want, got: stream,
            verdict: asked ? 'NOINPUT' : 'DIFFER',
            known: KNOWN_DISAGREEMENTS[name],
        };
    }
    return { name, kind, steps, report: slimReport(report), verdict: 'EXITED' };
}

function collect(p) {
    const st = statSync(p);
    if (!st.isDirectory()) return [p];
    const out = [];
    for (const e of readdirSync(p, { withFileTypes: true })) {
        const full = join(p, e.name);
        if (e.isDirectory()) out.push(...collect(full));
        else if (/\.(com|exe|bin|asm|s)$/i.test(e.name)) out.push(full);
    }
    return out;
}

// ---- run ------------------------------------------------------------------
/** Programs whose out-of-range conditionals had to be promoted, with how
 *  many. Reported in the summary because `longJumps: true` changes 14
 *  verdicts, and a flag that changes verdicts and leaves no trace is the
 *  same defect this harness exists to find. Each promotion also carries the
 *  assembler's own warning: "this program will no longer assemble under
 *  MASM", which is the fact a reader needs. */
const promotedPrograms = [];

const results = [];
if (flag('--selftest')) {
    for (const t of SELFTEST) {
        const r = runOne(t.name, t.bytes);
        r.expected = t.expect;
        results.push(r);
    }
} else {
    if (!paths.length) {
        console.error('give a file or directory, or --selftest. See the header.');
        process.exit(2);
    }
    for (const p of paths) {
        if (!existsSync(p)) { console.error(`no such path: ${p}`); process.exit(2); }
        for (const f of collect(p)) {
            // The expected-output file keys on the path below its own root,
            // so the key is whatever follows the directory we were given.
            const key = f.startsWith(p) ? f.slice(p.length).replace(/^[/\\]/, '') : basename(f);
            results.push(runOne(basename(f), new Uint8Array(readFileSync(f)), key, f));
        }
    }
}

const tally = {};
const refusals = new Map();
for (const r of results) {
    tally[r.verdict] = (tally[r.verdict] || 0) + 1;
    for (const u of r.report?.unsupported || []) {
        const k = `int ${u.int.toString(16).padStart(2, '0')}h AH=${u.ah.toString(16).padStart(2, '0')}h`;
        refusals.set(k, (refusals.get(k) || 0) + u.count);
    }
    for (const u of r.report?.devices?.unclaimed || []) {
        const k = `port ${u.port} (no device claims it)`;
        refusals.set(k, (refusals.get(k) || 0) + u.count);
    }
    if (r.verdict === 'DIFFER' && (VERBOSE || tally.DIFFER <= 8)) {
        const w = r.want.split('\n'), g = r.got.split('\n');
        const at = w.findIndex((l, i) => l !== g[i]);
        console.log(`DIFFER ${r.name}  first difference on line ${at + 1}:`);
        console.log(`   want ${JSON.stringify(w[at])}`);
        console.log(`   got  ${JSON.stringify(g[at])}`);
    }
    if (VERBOSE || r.verdict === 'THREW') {
        const d = r.report?.devices;
        console.log(`${r.verdict.padEnd(6)} ${r.name}${r.note ? ` -- ${r.note}` : ''}`
            + (r.report?.stdout ? `  out: ${JSON.stringify(r.report.stdout.slice(0, 60))}` : '')
            + (d && (d.reads + d.writes) ? `  devices: ${d.writes}w/${d.reads}r`
                + (d.traffic.word ? ` traffic=${d.traffic.groups.map((g) => g.lamps).join(',')}` : '')
                + (d.led.value !== undefined && d.led.value !== 0 ? ` led=${d.led.value}` : '') : ''));
    }
}

console.log(`\n${results.length} programs:`);
for (const k of ['MATCH', 'NOINPUT', 'ORACLE', 'DIFFER', 'EXITED', 'LOOPING', 'SILENT', 'HUNG', 'THREW', 'NOASM']) {
    if (tally[k]) console.log(`  ${String(tally[k]).padStart(5)}  ${k}`);
}
if (refusals.size) {
    console.log('\nrefused services, most wanted first -- this is the to-do list:');
    for (const [k, n] of [...refusals].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`  ${String(n).padStart(5)}  ${k}`);
    }
}

const differs = results.filter((r) => r.verdict === 'DIFFER');
const fresh = differs.filter((r) => !r.known);
const healed = results.filter((r) => r.verdict === 'MATCH' && KNOWN_DISAGREEMENTS[r.name]);
if (differs.length) {
    console.log(`\n${differs.length - fresh.length} of ${differs.length} disagreements are known and explained.`);
    if (fresh.length) {
        console.log('NEW disagreements -- these are the ones to look at:');
        for (const r of fresh) console.log(`  ${r.name}`);
    }
}
for (const r of healed) {
    console.log(`HEALED -- ${r.name} now agrees; drop its row: ${KNOWN_DISAGREEMENTS[r.name]}`);
}

if (promotedPrograms.length) {
    const total = promotedPrograms.reduce((a, p) => a + p.n, 0);
    console.log(`\n${promotedPrograms.length} program(s) needed OUT-OF-RANGE CONDITIONALS PROMOTED `
        + `(${total} jump${total === 1 ? '' : 's'}), and would be refused without --longJumps:`);
    for (const p2 of promotedPrograms.sort((a, b) => b.n - a.n)) {
        console.log(`  ${p2.name} (${p2.n})`);
    }
    console.log('  These no longer assemble under real MASM. That is the cost of running them.');
}

let exit = 0;

// ---- the CI gate ----------------------------------------------------------
//
// `--expect-counts MATCH=467,HUNG=0,...` fails unless the verdict distribution
// is exactly what is named. This is what makes the corpus a GATE rather than a
// report, and the counts are the right thing to assert: a text diff over 525
// programs is 525 ways to be flaky, while a count that moves is a signal with
// one cause to find.
//
// TWO THINGS THE COUNTS DEPEND ON, and a job that pins one and not the other
// will chase a phantom regression:
//
//   the CORPUS COMMIT -- new programs change the distribution, and
//   the --type INPUT STREAM -- without it six interactive programs block
//     before printing anything and land in HUNG rather than LOOPING.
//
// Measured either side of the output cap, unchanged: 498 EXITED, 6 LOOPING,
// 6 HUNG, 15 THREW without --type. A memory fix that quietly moved a verdict
// would be worse than the OOM it fixed, so that equality is the reason this
// gate can be trusted at all.
//
// Only the named verdicts are checked. Naming none is not a gate.
const expectCounts = value('--expect-counts', null);
if (expectCounts) {
    const got = {};
    for (const r of results) got[r.verdict] = (got[r.verdict] || 0) + 1;
    const want = Object.fromEntries(expectCounts.split(',').filter(Boolean).map((kv) => {
        const [k, v] = kv.split('=');
        return [k.trim().toUpperCase(), Number(v)];
    }));
    const wrong = [];
    for (const [k, n] of Object.entries(want)) {
        if ((got[k] || 0) !== n) wrong.push(`${k}: want ${n}, got ${got[k] || 0}`);
    }
    console.log(`
expected distribution over ${results.length} programs:`);
    for (const [k, n] of Object.entries(want)) {
        console.log(`  ${k.padEnd(8)} want ${String(n).padStart(4)}  got ${String(got[k] || 0).padStart(4)}`
            + ((got[k] || 0) === n ? '' : '   <-- MOVED'));
    }
    if (wrong.length) {
        console.error('VERDICT DISTRIBUTION MOVED. Either the emulator changed, the corpus '
            + 'commit changed, or --type changed. Check the last two BEFORE assuming the first.');
        exit = 1;
    } else {
        console.log('distribution matches.');
    }
}

if (flag('--selftest')) {
    const wrong = results.filter((r) => r.verdict !== r.expected);
    for (const r of wrong) console.log(`SELFTEST MISMATCH ${r.name}: want ${r.expected}, got ${r.verdict}`);
    // A harness that cannot tell a working program from a silent one, or a
    // hang from an exit, would report a green corpus made of nothing.
    console.log(wrong.length ? `\nselftest FAILED (${wrong.length})` : '\nselftest ok');
    exit = wrong.length ? 1 : 0;
}
process.exit(exit);
