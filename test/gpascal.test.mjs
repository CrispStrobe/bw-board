// G-Pascal (MIT, vendored) on the composable 6502 — the bit-bang serial
// acceptance. The machine has NO ACIA: serial is 4800-baud 8N1 banged on
// the VIA (PA1 out; PA0 in with the start bit's falling edge on CB2),
// which exercises the T1 free-run interrupt path per transmitted bit and
// the CB2 edge-IRQ + cycle-counted receive loop per received bit — the
// deepest timing workout any ROM has given this VIA model.
//
// What the assertions pin down:
//  - the banner arrives DECODED through hooks.onSerial (the machine's
//    own bit-bang TX sampler, not a test-side decoder),
//  - a typed character round-trips: serialIn('H') is received by the
//    firmware's CB2 interrupt path and answered with the help text.
//
// Timing fact worth keeping: the banner appears ~0.3 s into machine time
// with inputs.b = 0 (LCD reads not-busy). With floating-high inB it is
// 2.5 s — every LCD write burns the driver's 255-retry busy timeout.
// The GPASCAL preset encodes the fast shape; this test would catch a
// regression to the slow one via its time budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M6502Machine, GPASCAL } from '../src/m6502-machine.js';

const ROM = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
    '..', 'vendor', 'gpascal', 'gpascal.bin'));

function bootedMachine(received) {
    const m = new M6502Machine(GPASCAL, {
        onSerial(byte) { received.push(byte); },
    });
    m.loadRom(ROM, 0x8000);
    m.cpu.pc = m.mem[0xfffc] | (m.mem[0xfffd] << 8);
    return m;
}

const text = (bytes) => bytes.map((b) => String.fromCharCode(b)).join('');

test('G-Pascal boots and sends its banner over bit-banged serial', () => {
    const rx = [];
    const m = bootedMachine(rx);
    m.advanceToMs(800);
    const banner = text(rx);
    assert.match(banner, /G-Pascal compiler, version/,
        `banner not decoded; got: ${JSON.stringify(banner.slice(0, 80))}`);
    assert.match(banner, /Nick Gammon/);
    assert.match(banner, /Type H for help/);
});

test('a typed H round-trips through CB2 + the cycle-counted receive loop', () => {
    const rx = [];
    const m = bootedMachine(rx);
    m.advanceToMs(800);           // banner done, shell at its prompt
    rx.length = 0;
    m.serialIn('H'.charCodeAt(0));
    // GETLN discards CR and ends the line on NL ($0A) — Gammon's
    // documented terminal convention ("configure your terminal to send
    // linefeeds"). A CR-only sender waits at the prompt forever, which
    // is exactly what this test did until the listing said why.
    m.serialIn(0x0a);
    m.advanceToMs(2500);
    const reply = text(rx);
    // The help output names the shell's commands; any of the stable ones
    // proves the receive path decoded our byte and the shell answered.
    assert.ok(/[Hh]elp|List|Compile|Editor|Assemble/.test(reply),
        `no help text; got: ${JSON.stringify(reply.slice(0, 120))}`);
});
