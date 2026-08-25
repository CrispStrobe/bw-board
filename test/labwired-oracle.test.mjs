// The labwired differential oracle: the SAME gcc-built F0 ELF runs on
// bw-board's hand-rolled CortexM0Machine+F0 board AND on labwired-core's
// stm32f0 model (MIT — the fleet's adopted stm32 oracle), and the two
// executions are compared at the observable surface. Differences are
// FINDINGS to record, not failures to hide.
//
// Surface: labwired's `test` mode — uart.log carries the byte stream,
// and the uart_contains assertion doubles as the sim-side proof that
// TIM3 ticked, the NVIC vectored, WFI woke, and the USART transmitted
// (the H/L phases only print on the millisecond grid).
//
// THE FLEET BUILDS THE FORK (owner ruling 2026-08-25): the canonical
// oracle binary comes from CrispStrobe/labwired-core, default branch
// bw/mmio-write-observers (= upstream 3b9c704 + our observer fix,
// pinned at 5b7461d; upstream PR w1ne/labwired-core#1067 carries the
// same patch). Build: cargo build --release -p labwired-cli, then
// LABWIRED_CLI=<target>/release/labwired.
//
// FINDING the fork fixes (upstream 3b9c704): `--vcd` recorded pc and
// nothing else — SystemBus::write_u32's peripheral branch never called
// on_memory_write, AND Machine.observers never reached bus.observers.
// The second test below uses the fork's MMIO-carrying VCD for a
// pin-edge timeline comparison and SKIPS itself against an unpatched
// upstream binary.
//
// Gated on TWO env inputs so CI without the oracle skips loudly:
//   LABWIRED_CLI = path to the built labwired binary
//   (arm-none-eabi-gcc on PATH, same as the other F0 tests)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { CortexM0Machine } from '../src/cortex-m0-machine.js';
import { attachStm32F0 } from '../src/stm32f0-board.js';

const here = dirname(fileURLToPath(import.meta.url));
const LABWIRED = process.env.LABWIRED_CLI || '';
let hasGcc = false;
try { execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'pipe' }); hasGcc = true; } catch { /* skip */ }
const skip = !LABWIRED ? 'set LABWIRED_CLI to the labwired binary'
    : !existsSync(LABWIRED) ? `LABWIRED_CLI does not exist: ${LABWIRED}`
        : !hasGcc ? 'arm-none-eabi-gcc not installed' : false;

// Blink PA0 on the TIM3 millisecond grid and say so on the UART — the
// exact register vocabulary sb3-creator emits (RM0360). 100 ms half
// period; every phase flip prints H or L, so the UART stream IS the
// pin-edge sequence, on both simulators, clock-independently.
const FIRMWARE = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define RCC_AHBENR   BW_MMIO(0x40021014u)
#define RCC_APB1ENR  BW_MMIO(0x4002101cu)
#define RCC_APB2ENR  BW_MMIO(0x40021018u)
#define GPIOA_MODER  BW_MMIO(0x48000000u)
#define GPIOA_BSRR   BW_MMIO(0x48000018u)
#define TIM3_CR1     BW_MMIO(0x40000400u)
#define TIM3_DIER    BW_MMIO(0x4000040cu)
#define TIM3_SR      BW_MMIO(0x40000410u)
#define TIM3_PSC     BW_MMIO(0x40000428u)
#define TIM3_ARR     BW_MMIO(0x4000042cu)
#define USART1_CR1   BW_MMIO(0x40013800u)
#define USART1_ISR   BW_MMIO(0x4001381cu)
#define USART1_TDR   BW_MMIO(0x40013828u)
#define NVIC_ISER    BW_MMIO(0xe000e100u)
static volatile uint32_t bw_ms;
void tim3_irq(void) { TIM3_SR = 0; bw_ms++; }
static void putc1(char c) { while (!(USART1_ISR & (1u << 7))) ; USART1_TDR = (uint32_t)c; }
int main(void)
{
    RCC_AHBENR = (1u << 17); RCC_APB1ENR = (1u << 1); RCC_APB2ENR = (1u << 14);
    GPIOA_MODER = 1u;
    TIM3_PSC = 47u; TIM3_ARR = 999u; TIM3_DIER = 1u; TIM3_CR1 = 1u;
    NVIC_ISER = (1u << 16);
    USART1_CR1 = (1u << 3) | 1u;   /* TE + UE */
    putc1('B'); putc1('W'); putc1('\\n');
    uint32_t last = 0, phase = 0;
    for (;;) {
        if (bw_ms != last && (bw_ms % 100u) == 0u) {
            last = bw_ms;
            phase ^= 1u;
            if (phase) { GPIOA_BSRR = 1u; putc1('H'); }
            else { GPIOA_BSRR = (1u << 16); putc1('L'); }
        }
        __asm__ volatile ("wfi");
    }
}
__attribute__((section(".vectors"), used))
const void *vectors[48] = {
    (void *)0x20001000, (void *)main, [16 + 16] = (void *)tim3_irq
};
`;

const LD = `ENTRY(main)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 16K
         RAM  (rwx): ORIGIN = 0x20000000, LENGTH = 4K }
SECTIONS { .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) } > FLASH
           .bss  : { *(.bss*) *(COMMON) } > RAM }
`;

function build (phaseMs = 100) {
    const dir = mkdtempSync(join(tmpdir(), 'bw-lw-oracle-'));
    writeFileSync(join(dir, 'main.c'), FIRMWARE.replace('% 100u', `% ${phaseMs}u`));
    writeFileSync(join(dir, 'link.ld'), LD);
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0', '-mthumb', '-Os', '-ffreestanding',
        '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'), join(dir, 'main.c'), '-lgcc'], { stdio: 'pipe' });
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', join(dir, 'fw.elf'), join(dir, 'fw.bin')], { stdio: 'pipe' });
    return dir;
}

/** Side A: our machine. Returns { edges, serial }. */
function runOurs (bin, ns) {
    const m = new CortexM0Machine({ clockHz: 48_000_000, sramBytes: 4096 });
    const edges = [];
    let serial = '';
    attachStm32F0(m, {
        onPinChange: (pin, mode, high) => {
            if (pin === 'PA0' && mode === 'pushpull') {
                const prev = edges[edges.length - 1];
                if (!prev || prev.high !== high) edges.push({ high, tNs: Number(m.timeNs()) });
            }
        },
        onSerialByte: (b) => { serial += String.fromCharCode(b); },
    });
    m.loadFirmware(bin);
    m.advanceNs(ns);
    return { edges, serial, machine: m };
}

/** Side B: labwired test mode. Returns { result, uart, stdout }. */
function runLabwired (dir) {
    const outDir = join(dir, 'lw-out');
    mkdirSync(outDir, { recursive: true });
    const script = join(dir, 'oracle.yaml');
    writeFileSync(script, [
        'schema_version: "1.0"',
        'inputs:',
        `  firmware: "${join(dir, 'fw.elf')}"`,
        `  system: "${join(here, 'fixtures', 'labwired', 'f0-system.yaml')}"`,
        'limits:',
        '  max_steps: 40000000',
        '  stop_when_assertions_pass: true',
        '  stop_when_assertions_pass_min_steps: 1000',
        'assertions:',
        // Six phases = 600 ms simulated: proves TIM3 ticks on the grid,
        // the NVIC vectors, WFI wakes, and the USART transmits.
        '  - uart_contains: "BW\\nHLHLHL"',
        '',
    ].join('\n'));
    let stdout = '';
    try {
        stdout = execFileSync(LABWIRED, ['test', '--script', script, '--output-dir', outDir],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
    } catch (e) {
        stdout = String(e.stdout || '') + String(e.stderr || '');
    }
    const readIf = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
    const resultRaw = readIf(join(outDir, 'result.json'));
    return {
        result: resultRaw ? JSON.parse(resultRaw) : null,
        uart: readIf(join(outDir, 'uart.log')),
        stdout,
    };
}

describe('labwired differential oracle: STM32F030', { skip }, () => {
    it('the same ELF blinks and speaks identically on both simulators', () => {
        const dir = build();
        const bin = readFileSync(join(dir, 'fw.bin'));

        // ── side A: ours (1 s simulated = 10 phase flips) ──────────────
        const ours = runOurs(bin, 1_000_000_000);
        assert.ok(ours.edges.length >= 8, `our PA0 toggles (${ours.edges.length} edges)`);
        assert.match(ours.serial, /^BW\nHLHLHL/, `our UART carries the banner and phases (${JSON.stringify(ours.serial.slice(0, 12))})`);
        const rises = ours.edges.filter((e) => e.high);
        for (let i = 1; i < rises.length; i++) {
            const p = rises[i].tNs - rises[i - 1].tNs;
            assert.ok(Math.abs(p - 200_000_000) < 2_000_000,
                `our blink period is the asked-for 200 ms (${p} ns)`);
        }

        // ── side B: labwired ───────────────────────────────────────────
        const lw = runLabwired(dir);
        assert.ok(lw.result, `labwired wrote result.json (stdout: ${lw.stdout.slice(0, 400)})`);
        const passed = lw.result.status === 'pass';
        assert.ok(passed,
            `labwired's own assertion (BW banner + 6 tick phases) passed — ` +
            `TIM3/NVIC/WFI/USART agree that far (result: ${JSON.stringify(lw.result).slice(0, 300)})`);

        // ── the streams agree byte-for-byte as far as both ran ─────────
        assert.ok(lw.uart !== null, 'uart.log exists');
        const lwSerial = lw.uart;
        assert.match(lwSerial, /^BW\n/, `labwired's UART starts with the banner (${JSON.stringify(lwSerial.slice(0, 12))})`);
        const n = Math.min(lwSerial.length, ours.serial.length);
        assert.equal(lwSerial.slice(0, n), ours.serial.slice(0, n),
            'the UART byte streams agree byte-for-byte');

        // ── the ledger: cycle ratio, printed not asserted ──────────────
        const phases = (lwSerial.match(/[HL]/g) || []).length;
        const cycles = lw.result.cycles ?? lw.result.total_cycles ?? null;
        const perPhase = cycles && phases ? (cycles / phases) : null;
        console.log(`labwired-oracle LEDGER: ours 4.8e6 cycles/phase @48 MHz; ` +
            `labwired ${phases} phases, ${cycles} cycles` +
            (perPhase ? ` = ${(perPhase / 1e6).toFixed(2)}M cycles/phase` : '') +
            `; result keys: ${lw.result ? Object.keys(lw.result).join(',') : '-'}`);
    });

    it('pin-edge timeline: the BSRR write sequence agrees (forked VCD)', () => {
        // 5 ms phases: --vcd costs ~100x (a pc record per step), so the
        // blink is shrunk until six phases fit in ~1.5M steps.
        const dir = build(5);
        const bin = readFileSync(join(dir, 'fw.bin'));
        const ours = runOurs(bin, 50_000_000);

        // run mode with --vcd; bounded steps (the fix makes MMIO visible)
        const vcdPath = join(dir, 'trace.vcd');
        try {
            execFileSync(LABWIRED, [
                '--firmware', join(dir, 'fw.elf'),
                '--system', join(here, 'fixtures', 'labwired', 'f0-system.yaml'),
                '--vcd', vcdPath, '--max-steps', '2500000',
            ], { stdio: 'pipe', timeout: 600_000 });
        } catch { /* step exhaustion still writes the trace */ }
        assert.ok(existsSync(vcdPath), 'VCD written');

        // Parse: one value-change group per bus byte-event — collect
        // (t, addr, byte) where we=1, then reassemble BSRR word writes
        // from their 4 LE byte events (same timestamp, addr..addr+3).
        // VCD prints CHANGES only: `we` stays 1 across the four LE byte
        // events of one word store (no step in between), so triggering
        // on we-lines alone records just the first byte and every CLEAR
        // edge vanished — the timeline test's own first catch was of its
        // parser, not of either simulator. Record on any addr/data
        // change while we==1.
        const byId = new Map();
        let t = 0; const cur = {}; const events = [];
        for (const raw of readFileSync(vcdPath, 'utf8').split('\n')) {
            const line = raw.trim();
            let m;
            if ((m = line.match(/^\$var\s+\S+\s+\d+\s+(\S+)\s+(\S+)/))) byId.set(m[1], m[2]);
            else if ((m = line.match(/^#(\d+)$/))) t = Number(m[1]);
            else if ((m = line.match(/^([01])(\S+)$/)) || (m = line.match(/^b([01]+)\s+(\S+)$/))) {
                const role = byId.get(m[2]);
                if (!role) continue;
                cur[role] = parseInt(m[1], 2) >>> 0;
                if (cur.we === 1 && cur.addr !== undefined && (role === 'addr' || role === 'data' || role === 'we')) {
                    events.push({ t, addr: cur.addr, byte: cur.data ?? 0 });
                }
            }
        }
        const GPIOA_BSRR_ADDR = 0x48000018;
        const low = events.filter((e) => e.addr === GPIOA_BSRR_ADDR);      // byte 0
        const b2 = events.filter((e) => e.addr === GPIOA_BSRR_ADDR + 2);   // byte 2 (BR0)
        if (low.length === 0) {
            // Upstream binary without the fork's observer fix — the first
            // test already covered UART equivalence; say why this skips.
            console.log('pin-edge timeline SKIPPED: this labwired binary does not ' +
                'trace MMIO writes (use the bw/mmio-write-observers fork)');
            return;
        }
        // Reassemble edges: at each BSRR word write, set if byte0 bit0,
        // clear if byte2 bit0 (0x00010000 >> 16).
        const times = new Map();
        for (const e of low) { if (e.byte & 1) times.set(e.t, true); }
        for (const e of b2) { if (e.byte & 1) times.set(e.t, false); }
        const lwEdges = [...times.entries()].sort((a, b) => a[0] - b[0])
            .map(([tt, high]) => ({ t: tt, high }));
        assert.ok(lwEdges.length >= 6, `labwired shows PA0 edges (${lwEdges.length})`);

        // Sequence agreement, write-for-write. Our side publishes the
        // MODER seat (pushpull, low) BEFORE the first BSRR store — a
        // mode publish, not a drive edge — while the VCD extraction is
        // BSRR-only; align both at their first RISING edge.
        const trim = (arr, key) => arr.slice(arr.findIndex((e) => e[key]));
        const lwT = trim(lwEdges, 'high');
        const ourT = trim(ours.edges, 'high');
        const lwSeq = lwT.map((e) => (e.high ? 'H' : 'L')).join('');
        const ourSeq = ourT.map((e) => (e.high ? 'H' : 'L')).join('');
        const n = Math.min(lwSeq.length, ourSeq.length);
        assert.equal(lwSeq.slice(0, n), ourSeq.slice(0, n),
            `edge directions agree in order (lw=${lwSeq.slice(0, 24)} ours=${ourSeq.slice(0, 24)}; ` +
            `lw ${lwEdges.length} edges at t=[${lwEdges.slice(0, 6).map((e) => e.t).join(',')}], ` +
            `ours ${ours.edges.length} at tNs=[${ours.edges.slice(0, 6).map((e) => e.tNs).join(',')}])`);

        // Interval self-consistency + cross-sim RATIO consistency: every
        // half-period equals the first one within 2% on BOTH sims — the
        // clock-independent statement of "the blink is even".
        const ivals = (edges, key) => {
            const out = [];
            for (let i = 1; i < edges.length; i++) out.push(edges[i][key] - edges[i - 1][key]);
            return out;
        };
        for (const [name, list] of [['labwired', ivals(lwT, 't')], ['ours', ivals(ourT, 'tNs')]]) {
            const first = list[0];
            for (const d of list) {
                assert.ok(Math.abs(d - first) / first < 0.02,
                    `${name} half-periods are even (${d} vs ${first})`);
            }
        }
        // The cross-simulator statement: their VCD timebase is CPU
        // cycles, ours is ns at 48 MHz — the RATIO of a half-period must
        // be 48 cycles/µs within 1% (measured exact on first landing:
        // 240,0xx ticks vs 5,000,xxx ns).
        const ratio = ivals(lwT, 't')[0] / (ivals(ourT, 'tNs')[0] / 1000);
        assert.ok(Math.abs(ratio - 48) / 48 < 0.01,
            `the timebases agree at 48 cycles/us (${ratio.toFixed(3)})`);
        console.log(`pin-edge LEDGER: labwired ${lwT.length} edges @ ` +
            `${ivals(lwT, 't')[0]} cycles/half-period; ours ${ourT.length} @ ` +
            `${ivals(ourT, 'tNs')[0]} ns; ratio ${ratio.toFixed(3)} cycles/us`);
    });
});
