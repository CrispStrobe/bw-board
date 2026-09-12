/**
 * Who reads address 0x0000000b, and why does `2.5+1.0` return nothing?
 *
 * WHAT THIS ANSWERS. lego-ac's --eval reading at Lite 827892159 / bw-board
 * 1f809683e found `1+1` evaluating to 2 while `2.5+1.0` came back ECHOED --
 * the expression returned with a trailing space and no value. Not the wrong
 * answer, NO answer. Three RP2040 warnings clustered on that expression:
 *
 *     [RP2040] read from address b, which is not 32 bit aligned
 *
 * A wrong answer and no answer are different failures. The probe that took
 * that reading was written expecting the first, so it fell through to echoing
 * the raw reply. This one goes after the second.
 *
 * WHY 0xb IS WORSE THAN A MISALIGNED READ. rp2040js's readUint32 warns on the
 * misalignment and then serves it anyway (rp2040.js:179):
 *
 *     if (address < bootrom.length * 4) return bootrom[address / 4];
 *
 * For address 0xb that indexes a Uint32Array at 2.75, and a fractional index
 * into a typed array is `undefined` -- not 0, not a wrapped word. So the guest
 * register takes `undefined`, every arithmetic use of it becomes NaN, and the
 * failure surfaces far from the read. An expression that evaluates to nothing
 * is exactly the shape that produces.
 *
 * WHAT IT MEASURES rather than assumes: the PC of the instruction issuing the
 * read, the LR at that moment, and the tail of BL/BLX calls taken before it,
 * so the caller can be NAMED instead of guessed at. I had four plausible
 * stories for where a 0xb comes from and no way to choose between them; this
 * replaces all four with the address of the instruction.
 *
 * SCOPE, so this cannot be over-read: it drives THIS worktree's bootrom, not
 * the pinned one. The sha is printed. If the reads reproduce here, the defect
 * is not something the pin fixed or introduced.
 *
 * Usage: node scripts/probe-sf-unaligned.mjs [--expr "2.5+1.0"] [--uf2 PATH]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { USBCDC } from 'rp2040js';
import { createRp2040jsAdapter, FLASH_BASE, BOOT_SP } from '../src/rp2040js-adapter.js';
import buildBootrom from '../src/rp2040-bootrom.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const hex = n => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

function parseArgs (argv) {
    const a = { expr: '2.5+1.0', uf2: process.env.BW_KALUMA_UF2 };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--expr') a.expr = argv[++i];
        else if (argv[i] === '--uf2') a.uf2 = argv[++i];
        else if (argv[i] === '--rom-version') a.romVersion = Number(argv[++i]);
        else if (argv[i] === '--pin') a.pin = Number(argv[++i]);
        else if (argv[i] === '--input-high') a.inputHigh = true;
        else if (argv[i] === '--any-firmware') a.anyFirmware = true;
    }
    return a;
}

function parseUF2 (uf2) {
    const view = new DataView(uf2.buffer, uf2.byteOffset, uf2.byteLength);
    const nblocks = Math.floor(uf2.length / 512);
    let base = null;
    let image = new Uint8Array(0);
    for (let i = 0; i < nblocks; i++) {
        const o = i * 512;
        if (view.getUint32(o, true) !== 0x0a324655 || view.getUint32(o + 4, true) !== 0x9e5d5157) {
            throw new Error(`UF2 block ${i} has bad magic`);
        }
        const addr = view.getUint32(o + 12, true);
        const size = view.getUint32(o + 16, true);
        if (base === null) base = addr;
        const off = addr - base;
        if (off + size > image.length) {
            const grown = new Uint8Array(off + size);
            grown.set(image);
            image = grown;
        }
        image.set(uf2.subarray(o + 32, o + 32 + size), off);
    }
    return { blocks: nblocks, base, image };
}

// THE FIRMWARE IS AN ORACLE, AND AN ORACLE MUST NAME ITSELF.
//
// This defaulted to an absolute path on one box. A reading taken that way is a
// fact about that box: the file could be a different Kaluma build, or missing,
// and nothing printed would have said so. That is the ambient-binding species,
// and the emu8051 debug suite was silently red in CI for thirteen runs on
// exactly it -- passing locally against a sibling checkout sixteen commits
// ahead of the ref CI builds. A green there was a fact about the box too.
//
// So: the path comes from $BW_KALUMA_UF2 or --uf2, the refusal names what is
// missing, and the sha256 of what was actually loaded is CHECKED and PRINTED
// on every run. "A file is present" is not "the same build the last reading
// used", and only the digest can tell those apart.
const KNOWN_SHA256 = '74fde251f1de7153bc16488e15515e2d86e47652f66d86dc589e92b8f54e15ea';
const KNOWN_NAME = 'kaluma-rp2-pico-1.2.1.uf2';

const args = parseArgs(process.argv);
if (!args.uf2) {
    console.error(`no firmware. Set $BW_KALUMA_UF2 or pass --uf2 PATH.

Expected ${KNOWN_NAME}, sha256 ${KNOWN_SHA256}
(Kaluma 1.2.1, from the project's own release. This probe never fetches: it
reads a file you already have, so that a reading cannot depend on the network.)`);
    process.exit(1);
}
if (!fs.existsSync(args.uf2)) {
    console.error(`no firmware at ${args.uf2} -- named rather than left as a stack trace.`);
    process.exit(1);
}
const uf2 = fs.readFileSync(args.uf2);
const digest = createHash('sha256').update(uf2).digest('hex');
if (digest !== KNOWN_SHA256 && !args.anyFirmware) {
    console.error(`firmware is NOT the build this probe's readings were taken against.
    expected ${KNOWN_SHA256}
    got      ${digest}
A different oracle makes every number below a measurement of something else.
Pass --any-firmware to proceed deliberately.`);
    process.exit(1);
}
const { blocks, base, image } = parseUF2(uf2);

let sha = 'unknown';
try {
    sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(here, '..') }).toString().trim();
} catch { /* not a checkout; the reading still stands, it just cannot name itself */ }

console.log(`bootrom under test  ${sha}  (THIS worktree, not necessarily the pin)`);
console.log(`firmware            ${path.basename(args.uf2)}  ${blocks} blocks at ${hex(base)}`);
console.log(`firmware sha256     ${digest}${digest === KNOWN_SHA256 ? '  (the expected build)' : '  *** NOT the expected build ***'}`);
console.log(`expression          ${JSON.stringify(args.expr)}`);
console.log('');

const adapter = createRp2040jsAdapter();
const { rp2040, core } = adapter;

// --rom-version rewrites the §2.8.2 version byte and reloads. THE MUTATION IS
// VERIFIED, not assumed: a patch that silently failed to apply looks exactly
// like a hypothesis that was wrong, and the two must not be confusable.
if (args.romVersion !== undefined) {
    const patched = buildBootrom();
    // Byte 0x13, NOT 0x12. 'M','u',0x01 at 0x10..0x12 is the three-byte MAGIC;
    // the version is the separate byte after it. Patching 0x12 changes the
    // magic and leaves the version alone -- which is a mutation that applies
    // perfectly and tests nothing.
    const was = patched[0x13];
    patched[0x13] = args.romVersion & 0xff;
    rp2040.loadBootrom(new Uint32Array(patched.buffer));
    const readBack = rp2040.readUint32(0x10) >>> 0;
    const nowByte = (readBack >>> 24) & 0xff;
    console.log(`rom version byte    0x13: ${was} -> ${nowByte} (word at 0x10 reads ${hex(readBack)})`);
    if (nowByte !== (args.romVersion & 0xff)) throw new Error('the version patch did not take');
}
rp2040.flash.set(image, 0);
core.PC = FLASH_BASE;
core.SP = BOOT_SP;

const state = { steps: 0, idleNanos: 0, usb: '', usbConnected: false, blRing: [] };

// The BL ring gives the read a CALLER, which is the whole point: a PC alone
// says which instruction, not which routine asked for it.
const romCalls = new Map();
core.blTaken = () => {
    state.blRing.push({ from: (core.LR & ~1) - 4, to: core.PC, step: state.steps });
    if (state.blRing.length > 12) state.blRing.shift();
    // Every call whose target lands in the bootrom. This is the list of ROM
    // routines the guest actually reaches -- the thing a table of function
    // pointers exists to produce, and the thing no reading so far has shown.
    if ((core.PC >>> 0) < 0x4000) {
        const key = `${hex(core.PC)}<-${hex((core.LR & ~1) - 4)}`;
        romCalls.set(key, (romCalls.get(key) || 0) + 1);
    }
};

// Trap low reads. 0x100 is above every bootrom pointer the SDK dereferences
// (the §2.8.2 header at 0x10, the tables at 0x14/0x16/0x18) and far below any
// real code address, so anything landing here is a pointer that went wrong.
const lowReads = [];
const origRead = rp2040.readUint32.bind(rp2040);
rp2040.readUint32 = addr => {
    const a = addr >>> 0;
    const value = origRead(a);
    if (a < 0x100) {
        lowReads.push({
            addr: a,
            aligned: (a & 3) === 0,
            // Report what the EMULATOR actually handed back, undefined included.
            value: value === undefined ? 'undefined' : hex(value),
            pc: core.PC, lr: core.LR, step: state.steps,
            callers: state.blRing.slice(-4).map(r => `${hex(r.from)}->${hex(r.to)}`)
        });
    }
    return value;
};

const romEntries = new Map();
const nullJumps = [];
const lookups = new Map();
const asks = new Map();
let pendingLookup = null;
// Writes into the cached table. This separates "the initialiser never ran"
// from "it ran and wrote zeros" -- two different defects that present
// identically as a table full of zeros at the end of the run.
// TWO tables live in the same literal pool. 0x2002f808 is where the failing
// 2.5+1.0 dereferences; 0x2003163c is the one an earlier reading reported a
// non-null value from. Watching only one is how a reassuring number about the
// wrong structure gets read as evidence about the failing path.
const TABLES = [
    { name: 'A 0x2002f808', base: 0x2002f808 },
    { name: 'B 0x2003163c', base: 0x2003163c }
];
const tableWrites = [];
for (const w of ['writeUint32', 'writeUint16', 'writeUint8']) {
    const orig = rp2040[w].bind(rp2040);
    rp2040[w] = (addr, value, ...rest) => {
        const a = addr >>> 0;
        const t = TABLES.find(t => a >= t.base && a < t.base + 0x80);
        if (t) {
            tableWrites.push({ t: t.name, w, addr: a, value: hex(value >>> 0), pc: hex(core.PC), step: state.steps });
        }
        return orig(addr, value, ...rest);
    };
}

const cycleNanos = 1e9 / adapter.clockHz;
const clock = rp2040.clock;
function run (done, budget, idleCapNanos = 2e9) {
    const limit = state.steps + budget;
    while (state.steps < limit) {
        if (done && done()) return 'done';
        if (core.waiting) {
            const toAlarm = clock.nanosToNextAlarm;
            const dt = toAlarm > 0 ? toAlarm : cycleNanos;
            clock.tick(dt);
            state.idleNanos += dt;
            if (state.idleNanos > idleCapNanos) return 'idle';
            continue;
        }
        let cycles;
        // Every ENTRY into the bootrom, by whatever instruction. blTaken sees
        // bl and blx only; a `bx rN` or a `pop {pc}` with a wrong value is
        // exactly the shape a cached-garbage function pointer takes, and it
        // is invisible to that hook. Comparing PC either side of the step
        // catches all four.
        const pc0 = core.PC >>> 0;
        try { cycles = core.executeInstruction(); }
        catch (err) { return `exception at ${hex(core.PC)}: ${err && err.message}`; }
        const pc1 = core.PC >>> 0;
        if (pc1 === 0) {
            // A jump to zero is the defect itself. Freeze the whole register
            // file: the pointer came from one of these, and which one narrows
            // the call site from "somewhere in Kaluma" to one load.
            nullJumps.push({
                from: hex(pc0), lr: hex(core.LR),
                regs: [...core.registers.slice(0, 8)].map(hex),
                step: state.steps,
                callers: state.blRing.slice(-6).map(r => `${hex(r.from)}->${hex(r.to)}`)
            });
        }
        if (pc1 < 0x4000 && pc0 >= 0x4000) {
            const key = `${hex(pc1)} <- ${hex(pc0)}`;
            romEntries.set(key, (romEntries.get(key) || 0) + 1);
        }
        // rom_table_lookup(r0 = table, r1 = code). The code is two ASCII
        // characters packed little-endian, so print it as the datasheet does.
        // Capturing the ARGUMENT says which entry the guest wanted; capturing
        // the RESULT says whether this ROM had it. A missing entry returns 0,
        // and a 0 that the caller then calls is the defect under investigation.
        if (pc1 === 0x100 && pc0 >= 0x4000) {
            const code = core.registers[1] & 0xffff;
            const name = String.fromCharCode(code & 0xff, code >> 8);
            // Count the ASK unconditionally. Pairing an ask with its answer can
            // DROP one when a second lookup starts before the first returns,
            // and a dropped ask is indistinguishable from an ask never made --
            // which is the exact question here ("was 'DF' ever requested?").
            asks.set(name, (asks.get(name) || 0) + 1);
            pendingLookup = { name, table: core.registers[0] >>> 0, ret: (core.LR & ~1) >>> 0 };
        } else if (pendingLookup && pc1 === pendingLookup.ret) {
            const r = core.registers[0] >>> 0;
            const key = `${JSON.stringify(pendingLookup.name)} in table ${hex(pendingLookup.table)} -> ${hex(r)}${r === 0 ? '   <== NOT FOUND' : ''}`;
            lookups.set(key, (lookups.get(key) || 0) + 1);
            pendingLookup = null;
        }
        clock.tick(cycles * cycleNanos);
        state.steps++;
    }
    return done && done() ? 'done' : 'budget';
}

// --pin watches a GPIO. An API call that RETURNS proves the call returned; it
// says nothing about whether the pad moved. R3 recorded the first GPIO call
// hanging, so "it answered" is progress and not the claim worth making.
const pinEdges = [];
if (args.pin !== undefined) {
    rp2040.gpio[args.pin].addListener((state) => {
        pinEdges.push({ state, step: state === undefined ? -1 : stateSteps() });
    });
}
const stateSteps = () => state.steps;

const cdc = new USBCDC(rp2040.usbCtrl);
cdc.onDeviceConnected = () => { state.usbConnected = true; };
cdc.onSerialData = buf => { for (const b of buf) state.usb += String.fromCharCode(b); };

let outcome = run(() => state.usbConnected, 40_000_000);
console.log(`enumerate           ${outcome} at instruction ${state.steps}`);
run(null, 400_000);
for (const ch of '\r\n') cdc.sendSerialByte(ch.charCodeAt(0));
run(() => />/.test(state.usb), 20_000_000);
console.log(`prompt              ${/>/.test(state.usb) ? 'reached' : 'NOT reached'} at instruction ${state.steps}`);

// --input-high feeds the pad's INPUT register before the expression runs.
// Without a board attached, syncInputs() never runs and the input register
// keeps its power-on value, so digitalRead on a pin this harness is driving
// HIGH still reads 0. That is a property of the probe. This flag is how that
// is demonstrated rather than asserted: if the read follows the flag, the
// mechanism is the missing board and not the ROM.
if (args.inputHigh && args.pin !== undefined) rp2040.gpio[args.pin].setInputValue(true);

const beforeExpr = lowReads.length;
const usbBefore = state.usb.length;
for (const ch of args.expr + '\r') cdc.sendSerialByte(ch.charCodeAt(0));
run(null, 30_000_000);

const reply = state.usb.slice(usbBefore);
console.log('');
// THE ECHO IS NOT THE ANSWER, AND THE RAW REPLY CONTAINS BOTH. A Kaluma REPL
// echoes the typed expression before evaluating it, so the reply always opens
// with the expression's own text. Reporting that raw -- or slicing the first
// forty characters of it -- makes "echoed, then answered 3.5" and "echoed,
// then answered nothing" look alike, and a reader takes the echo for a result.
// That cost a morning: an echo with nothing after it was read as a novel
// third outcome, when it was a truncated view of one of the two known ones.
// So the two are separated here and the absence of an answer is stated in
// words rather than left for the reader to notice.
const clean = reply.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\u001b[78]/g, '');
const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const echoAt = lines.indexOf(args.expr);
const after = (echoAt >= 0 ? lines.slice(echoAt + 1) : lines).filter((l) => l !== '>' && l !== '');
console.log(`reply raw           ${JSON.stringify(reply)}`);
console.log(`  echo             ${echoAt >= 0 ? JSON.stringify(args.expr) : '(the expression was not echoed back)'}`);
console.log(`  ANSWER           ${after.length ? JSON.stringify(after[0]) : 'NONE -- the REPL echoed and produced no value'}`);
console.log('');
console.log(`low reads: ${lowReads.length} total, ${lowReads.length - beforeExpr} DURING the expression`);
if (lowReads.length === 0) {
    // A probe reporting "no reads" must be able to tell "none happened" from
    // "the trap never armed". The prompt line above is that witness.
    console.log('NONE SEEN. If the prompt was not reached, this is not evidence of absence.');
}
// Group by (address, pc): 452 reads of the same two pointers is one fact
// repeated, and the interesting rows would scroll off underneath it.
const groups = new Map();
for (const r of lowReads) {
    const key = `${hex(r.addr)}|${hex(r.pc)}|${r.aligned}|${r.value}`;
    if (!groups.has(key)) groups.set(key, { ...r, count: 0 });
    groups.get(key).count++;
}
console.log('');
console.log('by (address, issuing pc):');
for (const g of [...groups.values()].sort((a, b) => a.addr - b.addr || a.pc - b.pc)) {
    console.log(`  addr=${hex(g.addr)} ${g.aligned ? 'aligned  ' : 'UNALIGNED'} -> ${g.value}  pc=${hex(g.pc)}  x${g.count}`);
}

const unaligned = lowReads.filter(r => !r.aligned);
console.log('');
console.log(`UNALIGNED low reads: ${unaligned.length}`);
for (const r of unaligned.slice(0, 12)) {
    console.log(`  addr=${hex(r.addr)} -> ${r.value}  pc=${hex(r.pc)} lr=${hex(r.lr)} step=${r.step}`);
    console.log(`         callers ${r.callers.join('  ') || '(none)'}`);
}

console.log('');
console.log('calls INTO the bootrom (target <- call site):');
for (const [k, n] of [...romCalls.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}  x${n}`);
}

console.log('');
console.log('ENTRIES into the bootrom (arrival <- departure), any instruction:');
for (const [k, n] of [...romEntries.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}  x${n}`);
}

console.log('');
console.log('rom_table_lookup calls (what the guest asked for, what it got):');
for (const [k, n] of [...lookups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}  x${n}`);
}

console.log('');
console.log(`JUMPS TO ADDRESS ZERO: ${nullJumps.length}`);
for (const j of nullJumps) {
    console.log(`  from ${j.from}  lr=${j.lr}  step=${j.step}`);
    console.log(`    r0-r7 ${j.regs.join(' ')}`);
    console.log(`    callers ${j.callers.join('  ')}`);
}

console.log('');
console.log('every code ASKED for (counted at entry, never paired):');
console.log(`  ${[...asks.entries()].map(([k, n]) => `${JSON.stringify(k)}x${n}`).join('  ')}`);
console.log(`  'DF' (double-precision table) asked for: ${asks.has('DF') ? 'YES' : 'NEVER'}`);

// The RAM table both trampolines dereference.
console.log('');
console.log('Kaluma\'s cached ROM-function table at 0x2002f808:');
const SF_NAMES = ['fadd','fsub','fmul','fdiv','dep4','dep5','fsqrt','float2int','float2fix',
    'float2uint','float2ufix','int2float','fix2float','uint2float','ufix2float','fcos','fsin',
    'ftan','dep18','fexp','fln'];
for (let i = 0; i < 32; i++) {
    const w = rp2040.readUint32(0x2002f808 + i * 4) >>> 0;
    const note = i < 21 ? `  (if SF: ${SF_NAMES[i]})` : '';
    console.log(`  [${String(i).padStart(2)}] ${hex(w)}${w === 0 ? '   <== ZERO' : ''}${note}`);
}

console.log('');
for (const t of TABLES) {
    const mine = tableWrites.filter(x => x.t === t.name);
    const zero = mine.filter(x => x.value === '0x00000000').length;
    console.log(`table ${t.name}: ${mine.length} writes, ${zero} of them the crt0 .bss zero-fill`);
    if (mine.length === 0) {
        console.log('    NONE. Zero because nothing filled it -- the initialiser did not');
        console.log('    run, as distinct from running and writing zeros.');
    }
    for (const x of mine.filter(x => x.value !== '0x00000000').slice(0, 12)) {
        console.log(`    [${hex(x.addr)}] = ${x.value}  pc=${x.pc} step=${x.step}`);
    }
    const words = [];
    for (let i = 0; i < 26; i++) words.push(rp2040.readUint32(t.base + i * 4) >>> 0);
    console.log(`    final: ${words.filter(w => w !== 0).length}/26 non-zero`);
    console.log(`    ${words.slice(0, 8).map(hex).join(' ')}`);
}

if (args.pin !== undefined) {
    const pin = rp2040.gpio[args.pin];
    console.log('');
    console.log(`GPIO${args.pin}: ${pinEdges.length} transitions during the run`);
    for (const e of pinEdges.slice(0, 12)) console.log(`    -> ${e.state} at step ${e.step}`);
    console.log(`    final value=${pin.value} outputEnable=${pin.outputEnable}`);
    if (pinEdges.length === 0) {
        console.log('    NO TRANSITIONS. The call returning is not the pad moving;');
        console.log('    this is the half that would have been assumed.');
    }
}
