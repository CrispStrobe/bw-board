/**
 * WHAT AN AVR PUBLISHES WHEN NOBODY IS DEBUGGING IT.
 *
 * `avr8js-debug.js` has published instruction retires for a long time, but only
 * from its own `execute()` loop — which runs when a debugger is DRIVING. An AVR
 * board simply running was silent: measured before the wiring, a full simulated
 * millisecond of `advanceNs` produced zero facts, while a z80 or 6502 doing the
 * same work published throughout.
 *
 * These drive `adapter.advanceNs` — the ordinary path, no debugger anywhere —
 * and assert what comes out. The claims are per-parameter on purpose: each of
 * the four things this core spells differently gets a case that reds if that
 * parameter is dropped, because "it publishes something" is satisfied by a
 * wiring that gets every one of them wrong.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';

/** ldi r24,K → 1110 KKKK dddd KKKK with d = r24-16 = 8. */
const ldi24 = k => 0xe000 | ((k & 0xf0) << 4) | (8 << 4) | (k & 0x0f);
/** out A,r24 → 1011 1AAr rrrr AAAA, r24 = 11000. */
const out24 = a => 0xb800 | ((a & 0x30) << 5) | (24 << 4) | (a & 0x0f);
/** sts addr,r24 → 1001 0011 rrrr 0000, then the 16-bit address. */
const STS = 0x9380 | (24 << 4);
/** lds r25,addr → 1001 0001 rrrr 0000, then the address. */
const LDS = 0x9100 | (25 << 4);

const SMCR_IO = 0x33;                 // atmega328p SMCR (data 0x53), SE = bit0
const SLEEP = 0x9588;
const RJMP_SELF = 0xcfff;

const run = (words, ns = 1_000_000, opts = {}) => {
  const adapter = createAvr8jsAdapter({ chip: 'atmega328p', program: Uint16Array.from(words), ...opts });
  const seen = [];
  const off = adapter.onDebugEvent(event => seen.push(event));
  adapter.advanceNs(ns);
  return { adapter, seen, off };
};

describe('an ordinary AVR run publishes', () => {
  it('an instruction retire per instruction, with BYTE program counters', () => {
    // pcOf. avr8js's `pc` counts WORDS; every AVR tool — avr-objdump, avr-nm,
    // the existing debug target — speaks bytes. A wiring that forwards the raw
    // pc publishes addresses that are half of every symbol in the map file, and
    // "it published something" would not notice.
    const { seen } = run([ldi24(1), ldi24(2), RJMP_SELF], 2_000);
    const retires = seen.filter(e => e.kind === 'instruction' && e.phase === 'retire');
    assert.ok(retires.length >= 3, `only ${retires.length} retires`);
    assert.equal(retires[0].pcBefore, 0);
    assert.equal(retires[1].pcBefore, 2, 'the second instruction is at BYTE 2, not word 1');
    assert.equal(retires[1].pcAfter, 4);
    // rjmp .-2 sits at byte 4 and stays there.
    assert.equal(retires[2].pcBefore, 4);
    assert.equal(retires[2].pcAfter, 4);
  });

  it('a memory access per data read and write, from readData/writeData', () => {
    // accessors. This core has no `read`/`write` whatsoever, so a wiring that
    // takes the module's defaults installs wrappers on two properties nobody
    // calls and silently publishes no accesses at all.
    const { seen, adapter } = run([ldi24(0x5a), STS, 0x0140, LDS, 0x0140, RJMP_SELF], 4_000);
    const accesses = seen.filter(e => e.kind === 'memory' && e.phase === 'access');
    const sram = accesses.filter(a => a.memory.address === 0x0140);
    assert.deepEqual(sram.map(a => a.memory.direction), ['write', 'read'],
      `saw ${accesses.length} accesses, ${sram.length} at 0x0140`);
    assert.equal(sram[0].memory.value, 0x5a);
    assert.equal(sram[1].memory.value, 0x5a);
    assert.equal(adapter.cpu.data[0x0140], 0x5a, 'the wrapper swallowed the write');
    assert.equal(adapter.cpu.read, undefined, 'invented a `read` this core does not have');
  });

  it('stamps every fact from the CPU cycle counter', () => {
    // clock. There is no `machine.cycles` here to default to — the module would
    // read `undefined` and stamp `BigInt(undefined)`, which throws.
    const { seen, adapter } = run([ldi24(1), RJMP_SELF], 2_000);
    const last = seen[seen.length - 1];
    assert.equal(typeof last.time.ticks, 'bigint');
    assert.ok(last.time.ticks > 0n && last.time.ticks <= BigInt(adapter.cpu.cycles),
      `stamp ${last.time.ticks} against counter ${adapter.cpu.cycles}`);
    assert.equal(last.time.domain, 'avr-cycles');
    assert.equal(last.time.hz, 16_000_000);
  });

  it('facts from the WAKE path too, not only from the plain loop', () => {
    // The bracket is injected at TWO call sites: the ordinary loop, and the
    // sleep-wake path, which consumes the SLEEP opcode itself before dispatching
    // the ISR (the wake's return address is the instruction AFTER sleep, so the
    // opcode has to be retired there and nowhere else). Dropping the bracket on
    // that site loses exactly one retire per wake — invisible to any assertion
    // that only counts facts.
    //
    // Timer0 free-running with its overflow interrupt enabled provides the wake.
    const TCCR0B_IO = 0x25, TIMSK0 = 0x6e, SEI = 0x9478;
    const SLEEP_AT_WORD = 8;
    const words = [
      ldi24(1), out24(TCCR0B_IO),       // clk/1
      ldi24(1), STS, TIMSK0,            // TOIE0
      SEI,
      ldi24(1), out24(SMCR_IO),         // SE
      SLEEP,                            // word 8 -> byte 16
      RJMP_SELF
    ];
    assert.equal(words[SLEEP_AT_WORD], SLEEP, 'the fixture moved; the byte address below is stale');

    const { seen, adapter } = run(words, 200_000);
    const atSleep = seen.filter(e => e.kind === 'instruction' && e.pcBefore === SLEEP_AT_WORD * 2);
    assert.equal(atSleep.length, 1,
      `the SLEEP opcode retired ${atSleep.length} times; the wake path consumes it exactly once`);
    assert.ok(adapter.stats.sleptCycles > 0, 'the fixture never actually slept');
  });

  it('and every slept cycle is claimed by exactly one fact', () => {
    // The accounting claim, stated where it can be checked against a number the
    // adapter keeps for its own reasons: `stats.sleptCycles`. A publish that
    // fires on the wrong path, or twice, or with the wrong count, diverges from
    // it — which no "an idle fact appeared" assertion can see.
    const { adapter, seen } = run([ldi24(1), out24(SMCR_IO), SLEEP, RJMP_SELF], 1_000_000);
    const claimed = seen
      .filter(e => e.kind === 'idle' || e.kind === 'clock')
      .reduce((n, e) => n + e.changes.cycles, 0);
    assert.ok(adapter.stats.sleptCycles > 0, 'the fixture never slept');
    assert.equal(claimed, adapter.stats.sleptCycles);
  });
});

describe('the instrument costs nothing until someone listens', () => {
  it('unsubscribing puts the core back the way it was', () => {
    const adapter = createAvr8jsAdapter({ chip: 'atmega328p',
      program: Uint16Array.from([RJMP_SELF]) });
    const before = adapter.cpu.readData;
    const off = adapter.onDebugEvent(() => {});
    assert.notEqual(adapter.cpu.readData, before, 'the wrapper never went on');
    off();
    assert.equal(adapter.cpu.readData, before, 'the wrapper never came off');
    assert.equal('step' in adapter.cpu, false, 'the restore invented a `step`');
  });

  it('an unobserved run still executes exactly the same program', () => {
    // The bracket is on the hot path of every AVR board in the product,
    // listener or not. It must be transparent.
    const words = [ldi24(0x5a), STS, 0x0140, LDS, 0x0140, RJMP_SELF];
    const quiet = createAvr8jsAdapter({ chip: 'atmega328p', program: Uint16Array.from(words) });
    quiet.advanceNs(4_000);
    const { adapter: watched } = run(words, 4_000);
    assert.equal(quiet.cpu.cycles, watched.cpu.cycles);
    assert.equal(quiet.cpu.pc, watched.cpu.pc);
    assert.equal(quiet.stats.instructions, watched.stats.instructions);
    assert.deepEqual([...quiet.cpu.data.slice(0x0100, 0x0200)],
      [...watched.cpu.data.slice(0x0100, 0x0200)]);
  });
});
