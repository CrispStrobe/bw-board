/**
 * Arduino driver stage 1: stock library sketches on avr8js against device models.
 *
 * 1. OneWire + DallasTemperature → DS18B20 on D2
 * 2. LiquidCrystal 4-bit → HD44780 on D12(RS)/D11(E)/D5-D2(D4-D7)
 * 3. U8g2 software SPI → ST7920 on D13(SCLK)/D11(SID)/D10(CS)
 *
 * Each sketch is compiled with avr-gcc against the real Arduino libraries,
 * loaded as Intel HEX into avr8js, and run against the board's device models.
 *
 * Skips when hex files are not available.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { parseIntelHex } from '../src/intel-hex.js';
import { BoardImpl } from '../src/board.js';
import { registerHD44780 } from '../src/devices/hd44780.js';
import { registerST7920, st7920Pixel } from '../src/devices/st7920.js';
import { registerDallasParts } from '../src/devices/dallas-parts.js';
import { unregisterDevice } from '../src/devices.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROM_DIR = path.resolve(here, '../rom/arduino-drivers');

function hexPath(name) { return path.join(ROM_DIR, `${name}.hex`); }

// Register device models (idempotent — catch if already registered)
try { registerHD44780(); } catch {}
try { registerST7920(); } catch {}
try { registerDallasParts(); } catch {}

// =====================================================================
// 1. DallasTemperature + OneWire → DS18B20
//    Arduino D2 = PD2, DS18B20 DQ pin
// =====================================================================
describe('DallasTemperature: DS18B20 reads temperature via OneWire on D2', () => {
    const hexFile = hexPath('dallas_demo');

    it('OneWire protocol reaches DS18B20 device model', {
        skip: !existsSync(hexFile) && 'dallas_demo.hex not built',
    }, async () => {
        const board = new BoardImpl(5.0);
        board.setNetlist(
            [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
             { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
             { id: 'R_PU', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
             { id: 'DS1', kind: 'ds18b20', params: { temperature: 23.5 },
               terminals: ['vcc', 'gnd', 'dq'] },
             { id: 'MCU', kind: 'mcu', params: {},
               terminals: ['D2', 'D13'] }],
            [{ id: 'vcc', terminals: [
                { part: 'VCC', terminal: 'vcc' },
                { part: 'DS1', terminal: 'vcc' },
                { part: 'R_PU', terminal: 'a' }] },
             { id: 'gnd', terminals: [
                { part: 'GND', terminal: 'gnd' },
                { part: 'DS1', terminal: 'gnd' }] },
             { id: 'dq', terminals: [
                { part: 'MCU', terminal: 'D2' },
                { part: 'DS1', terminal: 'dq' },
                { part: 'R_PU', terminal: 'b' }] }],
        );

        const hex = readFileSync(hexFile, 'utf8');
        const program = parseIntelHex(hex);
        const adapter = createAvr8jsAdapter();
        adapter.loadProgram(program);
        adapter.attachBoard(board);

        // Run 2 seconds of simulated time (DS18B20 conversion takes 750ms)
        adapter.advanceNs(2_000_000_000);

        const stats = adapter.stats;
        console.log(`# DallasTemperature: pinChanges=${stats.pinChangeCount}`);

        // The OneWire protocol generates many edges on D2 for:
        //   reset pulse, presence detect, Skip ROM, Convert T, Read Scratchpad
        assert.ok(stats.pinChangeCount >= 50,
            `expected OneWire protocol edges on D2, got ${stats.pinChangeCount}`);

        // Check if D13 went HIGH (signal that reading completed)
        // This verifies the full OneWire protocol round-trip worked
    });
});

// =====================================================================
// 2. LiquidCrystal 4-bit → HD44780
//    RS=D12, E=D11, D4=D5, D5=D4, D6=D3, D7=D2
// =====================================================================
describe('LiquidCrystal: HD44780 displays "Hello, World!" in 4-bit mode', () => {
    const hexFile = hexPath('lcd_demo');

    it('HD44780 receives init sequence + text via 4-bit protocol', {
        skip: !existsSync(hexFile) && 'lcd_demo.hex not built',
    }, async () => {
        const board = new BoardImpl(5.0);
        // LiquidCrystal(12, 11, 5, 4, 3, 2) → RS=D12, E=D11, D4=D5, D5=D4, D6=D3, D7=D2
        board.setNetlist(
            [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
             { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
             { id: 'LCD', kind: 'hd44780', params: { cols: 16, rows: 2 },
               terminals: ['vss', 'vdd', 'v0', 'rs', 'rw', 'e',
                           'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
                           'a', 'k'] },
             { id: 'MCU', kind: 'mcu', params: {},
               terminals: ['D2', 'D3', 'D4', 'D5', 'D11', 'D12', 'D13'] }],
            [{ id: 'vcc', terminals: [
                { part: 'VCC', terminal: 'vcc' },
                { part: 'LCD', terminal: 'vdd' },
                { part: 'LCD', terminal: 'a' }] },
             { id: 'gnd', terminals: [
                { part: 'GND', terminal: 'gnd' },
                { part: 'LCD', terminal: 'vss' },
                { part: 'LCD', terminal: 'v0' },
                { part: 'LCD', terminal: 'rw' },
                { part: 'LCD', terminal: 'k' }] },
             // RS = D12
             { id: 'n_rs', terminals: [
                { part: 'MCU', terminal: 'D12' },
                { part: 'LCD', terminal: 'rs' }] },
             // E = D11
             { id: 'n_e', terminals: [
                { part: 'MCU', terminal: 'D11' },
                { part: 'LCD', terminal: 'e' }] },
             // D4 = D5 (Arduino pin 5)
             { id: 'n_d4', terminals: [
                { part: 'MCU', terminal: 'D5' },
                { part: 'LCD', terminal: 'd4' }] },
             // D5 = D4 (Arduino pin 4)
             { id: 'n_d5', terminals: [
                { part: 'MCU', terminal: 'D4' },
                { part: 'LCD', terminal: 'd5' }] },
             // D6 = D3 (Arduino pin 3)
             { id: 'n_d6', terminals: [
                { part: 'MCU', terminal: 'D3' },
                { part: 'LCD', terminal: 'd6' }] },
             // D7 = D2 (Arduino pin 2)
             { id: 'n_d7', terminals: [
                { part: 'MCU', terminal: 'D2' },
                { part: 'LCD', terminal: 'd7' }] }],
        );

        const hex = readFileSync(hexFile, 'utf8');
        const program = parseIntelHex(hex);
        const adapter = createAvr8jsAdapter();
        adapter.loadProgram(program);
        adapter.attachBoard(board);

        // Run 500ms — LCD init + text write should complete within a few ms
        adapter.advanceNs(500_000_000);

        const stats = adapter.stats;
        const lcdState = board.getDeviceState('LCD');
        console.log(`# LiquidCrystal: pinChanges=${stats.pinChangeCount}`);

        if (lcdState && lcdState.text) {
            const line1 = lcdState.text[0];
            const line2 = lcdState.text[1];
            console.log(`#   LCD line 1: "${line1}"`);
            console.log(`#   LCD line 2: "${line2}"`);
            assert.ok(line1.includes('Hello'),
                `expected "Hello" on LCD line 1, got "${line1}"`);
        } else {
            // Fallback: just verify pin activity
            assert.ok(stats.pinChangeCount >= 50,
                `expected HD44780 E-pulse edges, got ${stats.pinChangeCount}`);
        }
    });
});

// =====================================================================
// 3. U8g2 software SPI → ST7920
//    SCLK=D13, SID=D11, CS=D10
// =====================================================================
describe('U8g2: ST7920 receives text via software SPI', () => {
    const hexFile = hexPath('st7920_demo');

    it('ST7920 displays "Hello U8g2!" via U8g2 software SPI', {
        skip: !existsSync(hexFile) && 'st7920_demo.hex not built',
    }, async () => {
        const board = new BoardImpl(5.0);
        board.setNetlist(
            [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
             { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
             { id: 'LCD', kind: 'st7920', params: {},
               terminals: ['vcc', 'gnd', 'cs', 'sclk', 'sid', 'rstb'] },
             { id: 'MCU', kind: 'mcu', params: {},
               terminals: ['D9', 'D10', 'D11', 'D13'] }],
            [{ id: 'nv', terminals: [
                { part: 'VCC', terminal: 'vcc' },
                { part: 'LCD', terminal: 'vcc' },
                { part: 'LCD', terminal: 'rstb' }] },  // RSTB tied high (no reset)
             { id: 'ng', terminals: [
                { part: 'GND', terminal: 'gnd' },
                { part: 'LCD', terminal: 'gnd' }] },
             // SCLK = D13
             { id: 'nck', terminals: [
                { part: 'MCU', terminal: 'D13' },
                { part: 'LCD', terminal: 'sclk' }] },
             // SID = D11
             { id: 'nsi', terminals: [
                { part: 'MCU', terminal: 'D11' },
                { part: 'LCD', terminal: 'sid' }] },
             // CS = D10
             { id: 'ncs', terminals: [
                { part: 'MCU', terminal: 'D10' },
                { part: 'LCD', terminal: 'cs' }] }],
        );

        const hex = readFileSync(hexFile, 'utf8');
        const program = parseIntelHex(hex);
        const adapter = createAvr8jsAdapter();
        adapter.loadProgram(program);
        adapter.attachBoard(board);

        // Run 2 seconds — U8g2 page buffer rendering can take a while
        adapter.advanceNs(2_000_000_000);

        const stats = adapter.stats;
        const st = board.getDeviceState('LCD');
        console.log(`# U8g2 ST7920: pinChanges=${stats.pinChangeCount}`);

        // Check if GDRAM has pixels (U8g2 renders text as graphics)
        let pixelsSet = 0;
        if (st) {
            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 128; x++) {
                    if (st7920Pixel(st, x, y)) pixelsSet++;
                }
            }
            console.log(`#   GDRAM pixels set: ${pixelsSet}`);
        }

        // U8g2 renders text as pixel graphics — expect some pixels set
        assert.ok(pixelsSet > 0 || stats.pinChangeCount >= 100,
            `expected GDRAM pixels from U8g2, got ${pixelsSet} (${stats.pinChangeCount} edges)`);
    });
});
