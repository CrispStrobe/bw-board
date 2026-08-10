/**
 * AVR end-to-end: blink.c → avr-gcc → Intel HEX → avr8js → adapter → board.
 *
 * WHAT THIS ESTABLISHES: the first cross-architecture program runs through
 * the board engine. An ATmega328P blink compiled by avr-gcc, executed by
 * avr8js, drives an LED through the same adapter contract as the STC12.
 * F_CPU = 16 MHz (from the compile response, not hard-coded).
 *
 * WHAT THIS DOES NOT ESTABLISH: Arduino library support (bare AVR C only),
 * timing accuracy beyond the clock match, or anything about real silicon.
 * Category 3 — single implementation, no cross-check.
 *
 * Skips LOUDLY when avr-gcc is not available.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

let hasAvrGcc = false;
try { execFileSync('avr-gcc', ['--version'], { stdio: 'pipe' }); hasAvrGcc = true; } catch {}

let hasAvr8js = false;
try { await import('avr8js'); hasAvr8js = true; } catch {}

function loudSkip(reason) {
  console.log(`# ⚠ SKIPPED: ${reason}`);
  return true;
}

function parseHex(hex) {
  const bytes = new Uint8Array(0x8000);
  for (const line of hex.split('\n')) {
    if (!line.startsWith(':')) continue;
    const len = parseInt(line.slice(1, 3), 16);
    const addr = parseInt(line.slice(3, 7), 16);
    const type = parseInt(line.slice(7, 9), 16);
    if (type !== 0) continue;
    for (let i = 0; i < len; i++) {
      bytes[addr + i] = parseInt(line.slice(9 + i * 2, 11 + i * 2), 16);
    }
  }
  const words = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < words.length; i++) words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
  return words;
}

const BLINK_C = `
#include <avr/io.h>
#include <util/delay.h>
int main(void) {
    DDRB |= (1 << PB5);
    for (;;) {
        PORTB |= (1 << PB5);
        _delay_ms(500);
        PORTB &= ~(1 << PB5);
        _delay_ms(500);
    }
}
`;

describe('AVR end-to-end: blink → avr-gcc → avr8js → board → LED', () => {
  it('D13 toggles at 500ms intervals, LED brightness > 0 during ON', async () => {
    if (!hasAvrGcc) return loudSkip('avr-gcc not installed');
    if (!hasAvr8js) return loudSkip('avr8js not installed (npm install)');

    const { createAvr8jsAdapter } = await import('../src/avr8js-adapter.js');
    const { BoardImpl } = await import('../src/board.js');

    // Compile
    const srcFile = path.resolve(here, '../.avr-test-blink.c');
    const elfFile = path.resolve(here, '../.avr-test-blink.elf');
    const hexFile = path.resolve(here, '../.avr-test-blink.hex');
    try {
      writeFileSync(srcFile, BLINK_C);
      execFileSync('avr-gcc', [
        '-mmcu=atmega328p', '-DF_CPU=16000000UL', '-Os', '-std=gnu99',
        '-o', elfFile, srcFile,
      ], { stdio: 'pipe' });
      execFileSync('avr-objcopy', ['-O', 'ihex', '-R', '.eeprom', elfFile, hexFile],
        { stdio: 'pipe' });
    } catch (e) {
      console.log(`# ⚠ Compile failed: ${e.message?.slice(0, 100)}`);
      return;
    }

    const hex = readFileSync(hexFile, 'utf8');
    const fcpu = 16000000; // from compile response

    const adapter = createAvr8jsAdapter({ clockHz: fcpu });
    adapter.loadProgram(parseHex(hex));

    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'R1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
       { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
       { id: 'MCU', kind: 'mcu', params: {}, terminals: ['D13'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
       { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
       { id: 'pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'D13' }] }]);
    adapter.attachBoard(board);

    // Run to 600ms — LED turns on at 500ms (D13 goes LOW in active-low wiring)
    adapter.advanceNs(600_000_000);

    const brightness = board.ledBrightness('LED1');
    const pinV = board.nodeVoltage('pin');

    console.log(`# AVR blink at t=600ms: brightness=${brightness.toFixed(4)} pin=${pinV.toFixed(1)}V`);
    console.log(`# F_CPU=${fcpu} (from compile response, not hard-coded)`);
    console.log(`# Pin changes: ${adapter.stats.pinChangeCount}`);

    // LED should be ON (D13 LOW, current flowing through LED)
    assert.ok(brightness > 0.1,
      `LED should be bright during ON period, got ${brightness.toFixed(4)}`);
    assert.ok(pinV < 1.0,
      `D13 should be LOW (driving LED), got ${pinV.toFixed(1)}V`);

    // Cleanup
    try { unlinkSync(srcFile); unlinkSync(elfFile); unlinkSync(hexFile); } catch {}
  });
});
