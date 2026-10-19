// SLEEP fast-forward: avr8js implements the SLEEP opcode as a NOP, so an
// idling firmware still ground the interpreter at full clock. The adapter
// now keeps silicon semantics — parked at SLEEP until a wake source pends
// an enabled interrupt, the waking ISR returning to the instruction AFTER
// sleep, a masked-interrupt clock event firing without waking — and jumps
// the clock instead of spinning.
//
// The proof is DETERMINISTIC (instructions executed vs cycles elapsed),
// not wall-clock: three machines have shown time budgets fire falsely
// under load, so no timing assertion appears here.
//
// The first cut consumed the SLEEP and fell through it at the slice end —
// blinkenrocket (real third-party tiny88 firmware that sleeps) went dark.
// Those tests cover the wake-path variety; this one pins the numbers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';

let hasAvrGcc = false;
try { execFileSync('avr-gcc', ['--version'], { stdio: 'pipe' }); hasAvrGcc = true; } catch { /* skip below */ }

// A 1 ms Timer0 CTC tick, and a main loop that sleeps in idle mode after
// every pass — the exact shape sb3-creator's AVR tasks flavor emits.
const SRC = `
#include <avr/io.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>
#include <stdint.h>
static volatile uint16_t tick;
ISR(TIMER0_COMPA_vect) { tick++; }
int main(void)
{
    DDRB |= _BV(5);
    TCCR0A = _BV(WGM01);
    OCR0A = (uint8_t)(16000000UL / 64 / 1000 - 1);
    TIMSK0 = _BV(OCIE0A);
    TCCR0B = _BV(CS01) | _BV(CS00);
    set_sleep_mode(SLEEP_MODE_IDLE);
    sleep_enable();
    sei();
    for (;;) {
        /* no division: a %-based pass costs ~500 soft-div instructions
         * and swamps the instruction budget this test asserts */
        if (tick >= 500) { tick = 0; PORTB ^= _BV(5); }
        sleep_cpu();
    }
}
`;

describe('AVR sleep fast-forward', { skip: hasAvrGcc ? false : 'avr-gcc not installed (CI installs it)' }, () => {
    const build = () => {
        const dir = mkdtempSync(join(tmpdir(), 'bw-avr-sleep-'));
        writeFileSync(join(dir, 'main.c'), SRC);
        execFileSync('avr-gcc', ['-mmcu=atmega328p', '-DF_CPU=16000000UL', '-Os',
            '-o', join(dir, 'main.elf'), join(dir, 'main.c')], { stdio: 'pipe' });
        execFileSync('avr-objcopy', ['-O', 'binary', join(dir, 'main.elf'), join(dir, 'main.bin')], { stdio: 'pipe' });
        const bin = readFileSync(join(dir, 'main.bin'));
        return new Uint16Array(bin.buffer, bin.byteOffset, Math.floor(bin.length / 2));
    };

    it('a sleeping firmware executes ~per-ms work, not per-cycle work', () => {
        const adapter = createAvr8jsAdapter({ program: build(), chip: 'atmega328p' });
        for (let i = 0; i < 40; i++) adapter.advanceNs(50_000_000); // 2 s sim
        const cycles = adapter.cpu.cycles;
        const { instructions, sleptCycles } = adapter.stats;
        // 2 s at 16 MHz = 32M cycles. A spinning loop executes on the order
        // of one instruction per 1.5 cycles; a sleeping one executes only
        // the ISR + one loop pass per millisecond (~tens of instructions).
        assert.ok(cycles >= 31_000_000, `2 s of sim advanced (${cycles} cycles)`);
        assert.ok(instructions < cycles / 100,
            `parked, not spinning: ${instructions} instructions over ${cycles} cycles`);
        assert.ok(sleptCycles > cycles * 0.9,
            `the clock jumped through sleep: ${sleptCycles} of ${cycles} cycles slept`);
    });

    it('the wake ISR returns past the sleep: the LED still blinks at 1 Hz', () => {
        const adapter = createAvr8jsAdapter({ program: build(), chip: 'atmega328p' });
        // Track PB5 (D13) through the port listener via a fake board.
        const edges = [];
        adapter.attachBoard({
            setPin: (name, mode, v) => { if (name === 'D13') edges.push([adapter.timeNs(), mode, v]); },
            advanceTo: () => {},
            readPin: () => 0,
        });
        for (let i = 0; i < 60; i++) adapter.advanceNs(50_000_000); // 3 s sim
        // a toggle every 500 ms — skip the boot edges (setup writes the
        // port before the first tick), then the grid must hold. Dedup
        // consecutive same-value edges.
        const toggles = [];
        for (const [t, , v] of edges) {
            if (Number(t) < 100e6) continue; // boot artifacts
            if (!toggles.length || toggles[toggles.length - 1][1] !== v) toggles.push([t, v]);
        }
        assert.ok(toggles.length >= 4, `LED toggles under sleep (${toggles.length} toggles)`);
        for (let i = 1; i < Math.min(toggles.length, 5); i++) {
            const gapMs = Number(toggles[i][0] - toggles[i - 1][0]) / 1e6;
            assert.ok(Math.abs(gapMs - 500) < 20,
                `toggle ${i} lands on the half-second grid (gap ${gapMs.toFixed(1)} ms)`);
        }
    });
});
