// ATtiny85 Timer/Counter1 PWM through the adapter: single-slope, so the
// period is (OCR1C + 1) timer clocks (2586Q section 12.2.2).
//
// avr8js 0.21.0 counted it up and down: this program's PB1 ran at a 2040 us
// period instead of 1024 us (measured 2026-10-06, sb3-creator
// test/chain-attiny-adc-pwm). The fix lives in the CrispStrobe/avr8js fork
// this package depends on.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';

let hasAvrGcc = false;
try { execFileSync('avr-gcc', ['--version'], { stdio: 'pipe' }); hasAvrGcc = true; } catch { /* skip below */ }
const skipAvr = hasAvrGcc ? false : 'avr-gcc not installed (CI installs it)';

function build(src) {
    const dir = mkdtempSync(join(tmpdir(), 'bw-t1pwm-'));
    writeFileSync(join(dir, 'main.c'), src);
    execFileSync('avr-gcc', ['-mmcu=attiny85', '-DF_CPU=8000000UL', '-Os',
        '-o', join(dir, 'main.elf'), join(dir, 'main.c')], { stdio: 'pipe' });
    execFileSync('avr-objcopy', ['-O', 'binary', join(dir, 'main.elf'), join(dir, 'main.bin')], { stdio: 'pipe' });
    const bin = readFileSync(join(dir, 'main.bin'));
    const padded = new Uint8Array(bin.length + (bin.length & 1));
    padded.set(bin);
    return new Uint16Array(padded.buffer, 0, padded.length / 2);
}

// 8 MHz / 32 / 256 = 977 Hz: PB1 high for OCR1A = 64 of every 256 counts,
// PB4 (OC1B, via GTCCR) for 192.
const PWM = `
#include <avr/io.h>
int main(void) {
    DDRB = (1 << 1) | (1 << 4);
    OCR1C = 255;
    OCR1A = 64;
    OCR1B = 192;
    GTCCR = (1 << PWM1B) | (1 << COM1B1);
    TCCR1 = (1 << PWM1A) | (1 << COM1A1) | (1 << CS12) | (1 << CS11);
    for (;;) ;
}
`;

describe('ATtiny85 Timer 1 PWM', { skip: skipAvr }, () => {
    it('runs at f_TCK1 / (OCR1C + 1) with the asked-for duty on PB1 and PB4', () => {
        const a = createAvr8jsAdapter({ program: build(PWM), chip: 'attiny85' });
        const edges = { pb1: [], pb4: [] };
        a.attachBoard({
            temperatureC: 25, advanceTo() {}, readPin: () => 1, readAnalog: () => 0,
            setPin(name, mode, high) {
                const k = String(name).toLowerCase();
                if (!edges[k]) return;
                const list = edges[k];
                if (!list.length || list[list.length - 1].high !== !!high) list.push({ c: a.cpu.cycles, high: !!high });
            },
        });
        a.advanceNs(20_000_000);
        for (const [pin, highCounts] of [['pb1', 64], ['pb4', 192]]) {
            const rises = edges[pin].filter((e) => e.high).map((e) => e.c).slice(2);
            assert.ok(rises.length > 10, `${pin}: ${rises.length} rising edges`);
            const periods = new Set(rises.slice(1).map((c, i) => c - rises[i]));
            // 256 counts of 32 cycles each.
            assert.deepEqual([...periods], [8192], `${pin} period in cycles`);
            const e = edges[pin];
            const i = e.findIndex((x) => x.c === rises[0]);
            assert.equal(e[i + 1].c - e[i].c, highCounts * 32, `${pin} high time in cycles`);
        }
    });
});
