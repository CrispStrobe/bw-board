#!/usr/bin/env node
/**
 * Local-only milestone: boot mike42's ehBASIC ROM on the HB6502 preset.
 * The ROM binary is NC-licensed — NEVER vendor or commit it.
 * This script is committed but skips loudly if the ROM is absent.
 *
 * Usage:  node test/hb6502-ehbasic-boot.mjs [path-to-basic.bin]
 * Default ROM path: /tmp/mike42-6502/rom/basic/basic.bin
 */
import { readFileSync, existsSync } from 'node:fs';
import { M6502Machine, HB6502 } from '../src/m6502-machine.js';

const romPath = process.argv[2] || '/tmp/mike42-6502/rom/basic/basic.bin';
if (!existsSync(romPath)) {
    console.log(`SKIP: ROM not found at ${romPath}`);
    console.log('Build it from mike42/6502-computer (CC-BY-4.0 hardware, NC ehBASIC).');
    console.log('  git clone https://github.com/mike42/6502-computer /tmp/mike42-6502');
    console.log('  cd /tmp/mike42-6502/rom/basic && make');
    process.exit(0);
}

const rom = new Uint8Array(readFileSync(romPath));
if (rom.length !== 16384) {
    console.error(`ERROR: ROM is ${rom.length} bytes, expected 16384`);
    process.exit(1);
}

// Verify reset vector points into ROM range ($C000–$FFFF).
const resetVec = rom[0x3ffc] | (rom[0x3ffd] << 8);
console.log(`Reset vector: $${resetVec.toString(16).toUpperCase()}`);
if (resetVec < 0xc000) {
    console.error('ERROR: reset vector outside ROM range');
    process.exit(1);
}

const serial = [];
const m = new M6502Machine(HB6502, {
    onSerial: (byte, tMs) => serial.push({ ch: String.fromCharCode(byte), byte, tMs }),
});
m.loadRom(rom);
m.reset();

// Run until the signon prompt appears (polls ACIA for input).
// The signon loop sends chars then busy-waits on ACIAin — give it
// enough simulated time for the message to print.
console.log('--- booting (phase 1: signon) ---');
m.advanceToMs(500);

let transcript = serial.map((s) => s.ch).join('');
console.log(transcript);

if (!transcript.includes('[C]old/[W]arm')) {
    console.error('ERROR: signon prompt not seen');
    process.exit(1);
}

// Feed 'C' for cold start.
serial.length = 0;
m.chips.acia1.rxPush(0x43); // 'C'
console.log('--- sending C for cold start ---');
m.advanceToMs(m.tMs + 2000);

transcript = serial.map((s) => s.ch).join('');
console.log(transcript);

// ehBASIC cold start asks "Memory size ?" — send CR to auto-detect.
if (transcript.includes('Memory size')) {
    serial.length = 0;
    m.chips.acia1.rxPush(0x0d); // CR
    console.log('--- sending CR for auto-detect memory ---');
    m.advanceToMs(m.tMs + 5000);
    transcript = serial.map((s) => s.ch).join('');
    console.log(transcript);
}

if (transcript.includes('Ready') || transcript.includes('Bytes free') || transcript.includes('>')) {
    console.log('--- ehBASIC booted to prompt ---');
} else {
    console.log('--- cold start output captured (may need more time) ---');
}

// Try a trivial PRINT command if we got a prompt.
if (transcript.includes('>') || transcript.includes('Ready')) {
    serial.length = 0;
    const cmd = 'PRINT 2+3\r';
    for (const ch of cmd) m.chips.acia1.rxPush(ch.charCodeAt(0));
    m.advanceToMs(m.tMs + 2000);
    transcript = serial.map((s) => s.ch).join('');
    console.log('--- PRINT 2+3 ---');
    console.log(transcript);
}

console.log(`Total cycles: ${m.cycles}, tMs: ${m.tMs.toFixed(2)}`);
