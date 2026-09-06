/**
 * EVERY CHIP LEDGER IS REACHABLE FROM THE MACHINE.
 *
 * The chips in this repository are careful about announcing what they do not
 * model — the 8255 and 8251 set `modeWarning`, the uPD765 returns IC=invalid
 * and names itself in `lastRefusal`, the SB DSP and YM3812 count unknown
 * commands, the 8237 records unmodelled command bits. On 2026-09-05 a grep
 * showed that NOTHING OUTSIDE EACH CHIP READ ANY OF IT. The machine layer
 * surfaced none of them.
 *
 * So the announcements were real, individually well-designed, and unreachable.
 * A driver programming memory-to-memory left a precise record in a field no
 * consumer ever asked for — which is the same silence it was meant to
 * replace, arrived at more expensively.
 *
 * This file is the consumer, and the second test is the part that matters: it
 * SCANS THE SOURCE for chips that keep a ledger and requires each to be
 * reachable through `chipRefusals()`. A chip added later with a private field
 * fails here rather than quietly joining the unread.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { I8237 } from '../src/i8237.js';
import { I8255 } from '../src/i8255.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const LEDGERS = ['modeWarning', 'lastRefusal', 'unsupported', 'unmodelled'];

test('a machine with nothing refused reports nothing', () => {
    const m = new I8086Machine(BREADBOARD8086);
    assert.deepEqual(m.chipRefusals(), [],
        'an empty ledger is not a finding — reporting one would make the list noise');
});

test('the source scan finds chips that keep a ledger', () => {
    // Species 1: if this scan finds nothing, the reachability test below sweeps
    // an empty set and passes for the worst possible reason.
    const files = readdirSync(SRC).filter((f) => f.endsWith('.js'));
    const withLedger = files.filter((f) => {
        const src = readFileSync(join(SRC, f), 'utf8');
        return LEDGERS.some((l) => new RegExp(`this\\.${l}\\s*=`).test(src));
    });
    assert.ok(withLedger.length >= 4,
        `only ${withLedger.length} chip(s) appear to keep a refusal ledger; the scan has ` +
        'probably stopped matching, and an empty scan makes the next test vacuous');
});

test('a refused 8237 command reaches the machine', () => {
    const m = new I8086Machine(BREADBOARD8086);
    const dma = new I8237();
    dma.write(0x08, 0x01);                         // memory-to-memory
    m.chips.dmaTest = dma;

    const found = m.chipRefusals().find((r) => r.part === 'dmaTest');
    assert.ok(found, 'the 8237 recorded a refusal and the machine did not see it');
    assert.match(found.feature, /memory-to-memory/, 'the feature arrives by name');
    assert.match(found.symptom, /moves nothing/,
        'AND THE PROGRAM-VISIBLE SYMPTOM arrives with it — "unmodelled" tells a learner ' +
        'nothing, "a block copy moves nothing" tells them what they are seeing');
});

test('a refused 8255 mode reaches the machine, by a different field', () => {
    const m = new I8086Machine(BREADBOARD8086);
    const ppi = new I8255();
    ppi.write(3, 0xa0);                            // a mode-1 control word
    assert.ok(ppi.modeWarning, 'precondition: the 8255 warned');
    m.chips.ppiTest = ppi;

    const found = m.chipRefusals().find((r) => r.part === 'ppiTest');
    assert.ok(found, 'modeWarning is a different shape from unmodelled and must also arrive');
    assert.match(found.feature, /mode 1/);
    // This assertion used to read `symptom === null`, with the comment "the
    // 8255 carries no symptom yet, and null says so rather than inventing
    // one". That was true and worth stating while it was true. The gap is
    // closed now, so the test asserts the thing rather than the gap -- and the
    // rule it was protecting is still gated, by the null-address test below.
    assert.match(found.symptom, /mode 0/,
        'a sentence-shaped ledger carries its symptom in a sibling too, or its '
        + 'rows stay thinner than every other chip s');
});

test('devices are collected too, not only chips', () => {
    const m = new I8086Machine(BREADBOARD8086);
    const dma = new I8237();
    dma.write(0x08, 0x40);                         // DREQ sense inversion
    m.devices = {...(m.devices || {}), dev: dma};

    const found = m.chipRefusals().find((r) => r.part === 'dev');
    assert.ok(found && found.kind === 'device',
        'a refusal in a device is as unreachable as one in a chip if only chips are walked');
});

test('a part whose report() throws does not break the read', () => {
    // A ledger that can take the machine down with it is worse than no ledger:
    // the read happens on a diagnostic path, often while something is already
    // wrong.
    const m = new I8086Machine(BREADBOARD8086);
    m.chips.bad = {report() { throw new Error('deliberate'); }, modeWarning: 'still reported'};
    const found = m.chipRefusals().find((r) => r.part === 'bad');
    assert.equal(found.feature, 'still reported');
});

test('a ledger with a refusal-shaped name is collected even if nobody listed it', () => {
    // This asserted the OPPOSITE until the collector stopped enumerating field
    // names. The gate below found two ledgers the list did not reach — the
    // 8259's `initWarning` and the board's `_refusedControls` — and adding
    // those two by name would have fixed the instances and left the class.
    // Deriving from the name means a chip that invents one is collected the
    // moment it exists.
    const m = new I8086Machine(BREADBOARD8086);
    m.chips.newChip = {refusedThings: new Map([['some feature', 1]])};
    const found = m.chipRefusals().find((r) => r.part === 'newChip');
    assert.ok(found, 'a field named for what it holds is reached without being listed');
    assert.equal(found.feature, 'some feature');
});

test('a ledger whose NAME does not say what it is remains unreachable, by design', () => {
    // The honest limit. Deriving from the name cannot reach a field called
    // `notes` or `x`, and pretending otherwise would be the false confidence
    // this whole exercise is about. The gate below is what catches those, by
    // scanning source rather than instances.
    const m = new I8086Machine(BREADBOARD8086);
    m.chips.opaque = {notes: new Map([['something', 1]])};
    assert.equal(m.chipRefusals().some((r) => r.part === 'opaque'), false,
        'stated so the limit is known rather than assumed away');
});

test('every chip source that keeps a ledger uses a name the collector reaches', () => {
    // Uses the collector's OWN pattern, not a copy: two lists that must agree
    // is exactly the shape that let two ledgers go unread.
    const files = readdirSync(SRC).filter((f) => f.endsWith('.js'));
    const orphaned = [];
    for (const f of files) {
        const src = readFileSync(join(SRC, f), 'utf8');
        const fields = [...src.matchAll(/this\.([A-Za-z_]\w*)\s*=\s*(?:new Map\(|null;)/g)]
            .map((mt) => mt[1]);
        for (const n of new Set(fields)) {
            const looksLikeLedger = /refus|unsupport|unmodel|warning|invalid/i.test(n);
            if (looksLikeLedger && !I8086Machine.LEDGER_FIELD.test(n)) orphaned.push(`${f}: this.${n}`);
        }
    }
    assert.deepEqual(orphaned, [],
        '\n  A chip keeps a refusal ledger the machine collector cannot reach:\n    ' +
        orphaned.join('\n    ') + '\n');
});

test('a refusal carries the address the program touched', () => {
    // lego-ac's ask, and the argument is the whole point: the debugger's line
    // wants to point at the instruction and the P-lane table wants to join to
    // the part's port map. A SYMPTOM SENTENCE CANNOT BE CLICKED.
    const m = new I8086Machine(BREADBOARD8086);
    const dma = new I8237();
    dma.write(0x08, 0x01);                         // command port
    m.chips.dma = dma;
    const ppi = new I8255();
    ppi.write(3, 0xa0);                            // control port
    m.chips.ppi = ppi;

    const d = m.chipRefusals().find((r) => r.part === 'dma');
    assert.equal(d.at, 0x08, 'the 8237 refusal points at the command port it arrived on');

    const p = m.chipRefusals().find((r) => r.part === 'ppi');
    assert.equal(p.at, 3,
        'and a STRING ledger reaches its address through the sibling `<field>At`, ' +
        'so a sentence-shaped warning is clickable too');
});

test('a refusal with no recorded address reports null, not a guess', () => {
    // A refusal without an address is still worth reporting. Inventing one
    // would make the debugger point somewhere the program never touched, which
    // is worse than pointing nowhere.
    const m = new I8086Machine(BREADBOARD8086);
    m.chips.noAddr = {unmodelled: new Map([['a feature', {count: 1, symptom: 'something'}]])};
    const row = m.chipRefusals().find((r) => r.part === 'noAddr');
    assert.equal(row.at, null);
    assert.equal(row.symptom, 'something', 'the rest of the row is unaffected');
});

// ---------------------------------------------------------------------------
// THE FINISHED VOCABULARY.
//
// The tests above proved every ledger was REACHABLE. These prove every row is
// the SAME SHAPE -- because a consumer that has to ask "does this part's row
// have a symptom?" before it can render one is reading a table that only looks
// like a table. lego-ac consumes these rows in two places (a debugger session
// line and lite's matrix P lane) and asked for exactly this.
// ---------------------------------------------------------------------------

/** One machine with every chip that can refuse, each made to refuse once. */
async function machineWithEveryRefusal() {
    const [{ default: I8251 }, { default: I8259 }, { default: YM3812 },
        { default: SBDSP }, { UPD765 }] = await Promise.all([
        import('../src/i8251.js'), import('../src/i8259.js'),
        import('../src/ym3812.js'), import('../src/sb-dsp.js'),
        import('../src/upd765.js'),
    ]);
    const m = new I8086Machine(BREADBOARD8086);
    const dma = new I8237(); dma.write(0x08, 0x01);      // memory-to-memory
    const ppi = new I8255(); ppi.write(3, 0xa0);         // group A mode 1
    const usart = new I8251(); usart.write(1, 0x00);     // synchronous mode
    const pic = new I8259(); pic.write(0, 0x11);         // ICW1, left mid-init
    const opl = new YM3812(); opl.write(0, 0xbd); opl.write(1, 0x20);  // rhythm
    const dsp = new SBDSP(); dsp.write(0xc, 0xf9);       // no such DSP command
    const fdc = new UPD765(); fdc.write(5, 0x1e);        // not an FDC opcode
    Object.assign(m.chips, { dma, ppi, usart, pic, opl, dsp, fdc });
    return m;
}

test('every chip that can refuse produces a row with a symptom and an address', async () => {
    const rows = (await machineWithEveryRefusal()).chipRefusals();
    const parts = new Set(rows.map((r) => r.part));
    for (const p of ['dma', 'ppi', 'usart', 'pic', 'opl', 'dsp', 'fdc']) {
        assert.ok(parts.has(p), `${p} refused and produced no row at all`);
    }
    for (const r of rows) {
        assert.equal(typeof r.symptom, 'string',
            `${r.part}/${r.feature}: a row without a symptom tells a learner WHAT `
            + 'they are seeing and nothing about what it does to their program');
        assert.ok(r.symptom.length > 20, `${r.part}: "${r.symptom}" is not a sentence`);
        assert.equal(typeof r.at, 'number',
            `${r.part}/${r.feature}: no address, so nothing to click`);
        assert.ok(Array.isArray(r.ats) && r.ats.length >= 1 && r.ats[0] === r.at,
            `${r.part}: at must be the first of ats, not a separate claim`);
    }
});

test('one refusal is one row, however many views of the ledger exist', async () => {
    // The first smoke of the finished vocabulary printed the OPL's rhythm-mode
    // refusal twice and the FDC's bad opcode twice: once through the chip's
    // own report(), once through the field that report was built from. The
    // count was right and the ROW COUNT was double, which is the same error
    // one level up.
    const rows = (await machineWithEveryRefusal()).chipRefusals();
    const keys = rows.map((r) => `${r.part} ${r.feature}`);
    assert.equal(new Set(keys).size, keys.length,
        `a refusal was collected twice: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`);
});

test('a ledger sibling is not itself collected as a ledger', async () => {
    // modeWarningSymptom contains "warning" and lastRefusalSymptom contains
    // "refus", so the name-derived scan collected each SENTENCE as a refusal
    // of its own -- a row whose feature was the symptom and whose symptom was
    // null. Derived collection is still right; it just has to know a companion
    // when it sees one.
    const rows = (await machineWithEveryRefusal()).chipRefusals();
    for (const r of rows) {
        assert.ok(!rows.some((o) => o !== r && o.symptom === r.feature),
            `"${r.feature.slice(0, 40)}" is another row's symptom, collected as a refusal`);
    }
    // ...but only when the base field exists, or a chip whose ledger is
    // genuinely named refusalAt would vanish.
    const m = new I8086Machine(BREADBOARD8086);
    m.chips.odd = { refusalAt: 'a ledger that happens to end in At' };
    assert.equal(m.chipRefusals().length, 1,
        'a lone <x>At with no <x> beside it is a ledger, not a sibling');
});

test('a feature refused at two addresses reports both, and keeps the count', async () => {
    // lego-ac: "a single at that silently drops the first address is exactly
    // the shape this week has been about" -- a true count printed beside a
    // location that quantifies over less than the count does.
    const { noteRefusal, AT_CAP } = await import('../src/chip-ledger.js');
    const m = new I8086Machine(BREADBOARD8086);
    const led = new Map();
    noteRefusal(led, 'a feature', { symptom: 'a sentence', at: 3 });
    noteRefusal(led, 'a feature', { at: 7 });
    noteRefusal(led, 'a feature', { at: 3 });            // seen again, not new
    m.chips.part = { unmodelled: led };

    const [row] = m.chipRefusals();
    assert.equal(row.count, 3, 'count is every refusal, not every distinct address');
    assert.deepEqual(row.ats, [3, 7], 'first-seen order, no duplicates');
    assert.equal(row.at, 3,
        'the anchor is the FIRST address, so a row does not move under a reader '
        + 'while the program runs');
    assert.equal(row.symptom, 'a sentence',
        'a later refusal carrying no symptom adds a count, it does not erase the '
        + 'explanation');
    assert.equal(row.atsMore, false);
    assert.ok(AT_CAP > 1);
});

test('the address set is capped, and says so rather than looking complete', async () => {
    // A program that walks every port would otherwise turn a diagnostic into
    // an unbounded list. Truncating is fine; truncating SILENTLY is the thing
    // this whole file is about.
    const { noteRefusal, AT_CAP } = await import('../src/chip-ledger.js');
    const led = new Map();
    for (let a = 0; a < AT_CAP + 5; a++) noteRefusal(led, 'walked', { at: a });
    const m = new I8086Machine(BREADBOARD8086);
    m.chips.part = { unmodelled: led };

    const [row] = m.chipRefusals();
    assert.equal(row.count, AT_CAP + 5, 'every refusal is still counted');
    assert.equal(row.ats.length, AT_CAP, 'the addresses are bounded');
    assert.equal(row.atsMore, true,
        'and the row admits the bound: a capped list that does not say it is '
        + 'capped reads as a complete one');
});

test('restoring a chip does not add refusals the program never made', async () => {
    // The YM3812 rebuilds its operator state by replaying all 256 registers
    // through _poke -- which also refuses. Before this, a save/restore added a
    // refusal for every unsupported bit that happened to be set, so count said
    // "asked N times" when the program asked once and was restored N-1 times.
    const { default: YM3812 } = await import('../src/ym3812.js');
    const y = new YM3812();
    y.write(0, 0xbd); y.write(1, 0x20);
    const before = y.report().unsupported.find((e) => e.what.startsWith('rhythm'));
    assert.equal(before.count, 1);

    const z = new YM3812();
    z.write(0, 0xbd); z.write(1, 0x20);
    z.setState(y.getState());
    const after = z.report().unsupported.find((e) => e.what.startsWith('rhythm'));
    assert.equal(after.count, 1,
        'a restore rebuilt audio state and inflated a diagnostic while doing it');
});

test('a refusal survives a checkpoint, or the row is thinner after a save', async () => {
    // Found by asking the obvious next question of the new gate: it proves
    // every chip that CAN refuse produces a full row. It says nothing about
    // the same machine after a save and restore -- and two chips were losing
    // the refusal there, in different ways.
    //
    // The 8251 cleared modeWarning in loadState, so a machine saved in
    // synchronous mode came back running as async with nothing saying so. The
    // 8259 had no way to carry the address, so a chip restored mid-init
    // reported the refusal with nowhere to point.
    //
    // Neither invents anything on restore. `mode`/`_sync` and the anchor are
    // in the checkpoint; the warning is derived from restored state.
    const [{ default: I8251 }, { default: I8259 }] = await Promise.all([
        import('../src/i8251.js'), import('../src/i8259.js'),
    ]);

    const usart = new I8251(); usart.write(1, 0x00);
    const pic = new I8259(); pic.write(0, 0x11);
    const before = new I8086Machine(BREADBOARD8086);
    Object.assign(before.chips, { usart, pic });
    const was = before.chipRefusals();

    const usart2 = new I8251(); usart2.loadState(usart.saveState());
    const pic2 = new I8259(); pic2.setState(pic.getState());
    const after = new I8086Machine(BREADBOARD8086);
    Object.assign(after.chips, { usart: usart2, pic: pic2 });

    assert.deepEqual(after.chipRefusals(), was,
        'the same machine, saved and restored, must report the same refusals: a '
        + 'checkpoint is not a place for a diagnostic to quietly get thinner');
});

test('an old checkpoint restores to null, not to a plausible address', async () => {
    // A checkpoint written before the anchor existed has no address in it.
    // null is the honest answer. Zero would be the 8259's command port -- an
    // address the saved program may never have touched, and indistinguishable
    // from one it did.
    const { default: I8259 } = await import('../src/i8259.js');
    const pic = new I8259(); pic.write(0, 0x11);
    const old = pic.getState();
    delete old.initWarningAt;

    const restored = new I8259(); restored.setState(old);
    assert.ok(restored.initWarning, 'the refusal itself still restores');
    assert.equal(restored.initWarningAt, null,
        'and its address is null rather than a guess that reads like a fact');
});

test('the row contract in CHIP-REFUSALS.md is the row the code produces', () => {
    // lego-ac's requirement for lite's two consumers was that they can be
    // "written against a document, not a message". A document that can drift
    // from the code is a message with extra steps, so the document is the
    // source of truth HERE: this test parses the contract line out of it and
    // requires the collector to produce exactly those fields, in that order.
    //
    // Add a field to a row and this goes red until the doc names it. Remove
    // one and it goes red until the doc stops promising it.
    const doc = readFileSync(join(SRC, '..', 'CHIP-REFUSALS.md'), 'utf8');
    const line = doc.match(/^\s*\{(part,[^}]*)\}\s*$/m);
    assert.ok(line, 'CHIP-REFUSALS.md no longer states a row contract at all');
    const documented = line[1].split(',').map((f) => f.trim());

    const m = new I8086Machine(BREADBOARD8086);
    const dma = new I8237();
    dma.write(0x08, 0x01);
    m.chips.dma = dma;

    assert.deepEqual(Object.keys(m.chipRefusals()[0]), documented,
        'the collector and the document disagree about the row -- whichever is '
        + 'right, a consumer reading the other one is being lied to');
});

test('the contract a downstream vendor can import says the same thing', async () => {
    // brickwright-lite-ea merged this ledger and had to RESTATE the row shape
    // in lite's own gate, because CHIP-REFUSALS.md is bw-board's and a vendor
    // does not take it. That is a second list that must agree with a first --
    // the shape this whole file exists to stop, arrived at by documenting the
    // contract only in prose.
    //
    // ROW_FIELDS is in chip-ledger.js, which IS vendored. This test binds the
    // three readers together: the document a human reads, the array a
    // downstream gate imports, and the row the collector actually builds. Any
    // two of them drifting is red here.
    const { ROW_FIELDS } = await import('../src/chip-ledger.js');
    const doc = readFileSync(join(SRC, '..', 'CHIP-REFUSALS.md'), 'utf8');
    const documented = doc.match(/^\s*\{(part,[^}]*)\}\s*$/m)[1]
        .split(',').map((f) => f.trim());

    assert.deepEqual([...ROW_FIELDS], documented,
        'the exported contract and the document disagree');

    const m = new I8086Machine(BREADBOARD8086);
    const dma = new I8237();
    dma.write(0x08, 0x01);
    m.chips.dma = dma;
    assert.deepEqual(Object.keys(m.chipRefusals()[0]), [...ROW_FIELDS],
        'the exported contract and the collector disagree');
});

test('a row says what its address is an address IN', async () => {
    // brickwright-lite-ea, building the first consumer: a panel line holding a
    // bare integer cannot tell "port 08h" from "register 08h", so it must
    // either say the weaker thing or keep a part-to-space table on the reading
    // side -- a second list that has to agree with these chips, which is what
    // ROW_FIELDS exists to stop.
    const { default: YM3812 } = await import('../src/ym3812.js');
    const m = new I8086Machine(BREADBOARD8086);
    const dma = new I8237(); dma.write(0x08, 0x01);
    const opl = new YM3812(); opl.write(0, 0xbd); opl.write(1, 0x20);
    Object.assign(m.chips, { dma, opl });

    const rows = m.chipRefusals();
    const d = rows.find((r) => r.part === 'dma');
    const o = rows.find((r) => r.part === 'opl');
    assert.equal(d.space, 'port', 'the 8237 refusal arrived on an I/O port');
    assert.equal(o.space, 'register',
        'and the OPL reports its REGISTER index -- the one exception, and the '
        + 'reason this field has to exist rather than be assumed');
    assert.equal(o.at, 0xbd, 'precondition: it really is the register, not the port');
});

test('space defaults to port, so a chip that says nothing is not guessed about', async () => {
    // The default is not a convenience: it is true of every chip but one. A
    // chip that records no space wrote to an I/O port, because that is what an
    // 8086-board chip does. The YM3812 overrides it where its exception is
    // already commented -- at the writing end, which knows, rather than at the
    // reading end, which does not.
    const { noteRefusal, SPACES } = await import('../src/chip-ledger.js');
    const led = new Map();
    noteRefusal(led, 'something', { at: 3 });
    const m = new I8086Machine(BREADBOARD8086);
    m.chips.quiet = { unmodelled: led };
    assert.equal(m.chipRefusals()[0].space, 'port');

    // And every space a row can carry is one the contract names.
    for (const r of m.chipRefusals()) {
        assert.ok(SPACES.includes(r.space), `"${r.space}" is not a declared space`);
    }
});

test('a ledger keeps the space it was first given', async () => {
    // Same rule as symptom: a later refusal that carries no space is adding a
    // count, not silently relabelling where the first one happened.
    const { noteRefusal } = await import('../src/chip-ledger.js');
    const led = new Map();
    noteRefusal(led, 'f', { at: 0xbd, space: 'register' });
    noteRefusal(led, 'f', { at: 0x08 });
    assert.equal(led.get('f').space, 'register');
    assert.equal(led.get('f').count, 2);
});

test('a string ledger can name its space too, in the sibling', async () => {
    // The sentence-shaped ledgers use <field>At and <field>Symptom; a space
    // rides the same convention rather than inventing a third.
    const m = new I8086Machine(BREADBOARD8086);
    m.chips.odd = {
        modeWarning: 'a sentence-shaped refusal',
        modeWarningAt: 7,
        modeWarningSpace: 'register',
    };
    const [row] = m.chipRefusals();
    assert.equal(row.space, 'register');
    assert.equal(row.at, 7);
});
