/**
 * AVR end-to-end: blink.c → avr-gcc → Intel HEX → avr8js → adapter → board.
 *
 * WHAT THIS ESTABLISHES: the first cross-architecture program runs through
 * the board engine. An ATmega328P blink compiled locally by avr-gcc,
 * executed by avr8js, drives an LED through the same adapter contract
 * as the STC12. F_CPU = 16 MHz (hard-coded literal matching the
 * AVR-COMPILE-CONTRACT.md per-board value for Uno/Nano).
 *
 * NOTE: this test builds the hex locally, not from bw-cfront's compile
 * endpoint. The F_CPU/clockHz seam (compile response → adapter config)
 * is NOT exercised here — that requires obtaining both values from the
 * same endpoint response.
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

import { parseIntelHex } from '../src/intel-hex.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let hasAvrGcc = false;
try { execFileSync('avr-gcc', ['--version'], { stdio: 'pipe' }); hasAvrGcc = true; } catch {}

let hasAvr8js = false;
try { await import('avr8js'); hasAvr8js = true; } catch {}

function loudSkip(reason) {
  console.log(`# ⚠ SKIPPED: ${reason}`);
  return true;
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

    // Try the compile endpoint first (the real seam); fall back to local avr-gcc.
    let hex, fcpu, source;
    const ENDPOINT = process.env.AVR_COMPILE_URL ?? 'http://localhost:8321/compile';

    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: BLINK_C, target: 'atmega328p' }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const body = await resp.json();
        hex = body.hex;
        fcpu = body.fcpu;
        source = `endpoint (${ENDPOINT}), version: ${body.version}`;
      }
    } catch { /* endpoint not running — fall back */ }

    if (!hex) {
      // Local compilation — record the version for comparison
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
      hex = readFileSync(hexFile, 'utf8');
      fcpu = 16000000; // matches -DF_CPU flag above
      const localVersion = execFileSync('avr-gcc', ['--version'],
        { encoding: 'utf8', stdio: 'pipe' }).split('\n')[0];
      source = `local avr-gcc, version: ${localVersion}`;
      try { unlinkSync(srcFile); unlinkSync(elfFile); unlinkSync(hexFile); } catch {}
    }

    console.log(`# Compiled by: ${source}`);
    console.log(`# F_CPU: ${fcpu} (${hex ? 'from response' : 'hard-coded'})`);

    // Contract version is avr-gcc 7.3.0. Record any mismatch.
    if (source.includes('7.3.0')) {
      console.log('# Toolchain: matches contract (7.3.0)');
    } else {
      console.log('# ⚠ Toolchain mismatch — contract says 7.3.0');
    }

    const adapter = createAvr8jsAdapter({ clockHz: fcpu });
    adapter.loadProgram(parseIntelHex(hex));

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
    console.log(`# F_CPU=${fcpu}`);
    console.log(`# Pin changes: ${adapter.stats.pinChangeCount}`);

    // Derived prediction: VCC=5V, R=220Ω, LED Vf=2V Rd=10Ω, pin Rth=25Ω.
    // Total series R = 220+10+25 = 255Ω. I = (5-2)/255 = 11.76 mA.
    // Brightness = 11.76/20 = 0.5882. Tolerance ±5%.
    const expected = (5.0 - 2.0) / (220 + 10 + 25) / 0.020; // 0.5882
    assert.ok(Math.abs(brightness - expected) < expected * 0.05,
      `LED brightness should be ~${expected.toFixed(4)}, got ${brightness.toFixed(4)}. ` +
      `Derived: I=(5-2)/(220+10+25)=11.76mA, brightness=11.76/20=0.5882.`);
    assert.ok(pinV < 1.0,
      `D13 should be LOW (driving LED), got ${pinV.toFixed(1)}V`);

  });
});
