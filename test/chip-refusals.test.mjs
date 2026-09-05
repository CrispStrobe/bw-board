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
    assert.equal(found.symptom, null,
        'the 8255 carries no symptom yet, and null says so rather than inventing one');
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
