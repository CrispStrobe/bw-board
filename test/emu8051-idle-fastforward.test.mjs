// PCON.IDL fast-forward: the 8051 half of the sleep-not-spin wave.
//
// emu8051's core.c always implemented idle correctly — with PCON.IDL set it
// stops executing opcodes, parks the PC, keeps the timers counting, and clears
// IDL when an enabled interrupt vectors. What it did not do is get FASTER,
// because the emulator still ground one oscillator clock at a time. Measured
// before the fix, idling was 1.37 sim/wall against 1.55 busy-spinning: slower
// than not sleeping at all.
//
// emu8051-stc `24177ae` jumps the clock when Timer 0 is provably the only
// thing that can happen next, and this adapter stops sub-slicing while the
// core is parked.
//
// THE PROOF HERE IS DETERMINISTIC — counted board advances, counted ISR
// entries, counted slept clocks. There is no wall-clock budget anywhere:
// bw-board's avr-sleep-fastforward test records why (three machines have shown
// timing budgets fire falsely under load), and a gate that goes red for the
// wrong reason gets ignored for the right ones.
//
// The firmware is hand-assembled Intel HEX rather than SDCC output, so this
// runs wherever the WASM does — no toolchain to be missing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';
import { BoardImpl } from '../src/board.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Beside the repo when developing; inside the workspace in CI, because
// actions/checkout refuses a path outside it.
const CANDIDATES = [
  join(HERE, '..', '..', 'emu8051-stc', 'build', 'emu8051.js'),
  join(HERE, '..', 'emu8051-stc', 'build', 'emu8051.js'),
];
const WASM = CANDIDATES.find(existsSync);
const haveWasm = !!WASM;

/** One Intel HEX data record. */
function rec(addr, bytes) {
  const b = [bytes.length, (addr >> 8) & 0xff, addr & 0xff, 0x00, ...bytes];
  const sum = (0x100 - (b.reduce((a, v) => a + v, 0) & 0xff)) & 0xff;
  return ':' + [...b, sum].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}

// 0x0000 SJMP 0x30            skip the vector table
// 0x000B INC 30h ; RETI       the Timer 0 ISR counts itself into IRAM
// 0x0030 ORL PCON,#01 ; SJMP  the shape sb3-creator's TASKS scheduler emits:
//                             sleep, wake on the tick, sleep again
const IDLE_HEX = [
  rec(0x0000, [0x80, 0x2E]),
  rec(0x000B, [0x05, 0x30, 0x32]),
  rec(0x0030, [0x43, 0x87, 0x01, 0x80, 0xFB]),
  ':00000001FF',
].join('\n');

// The same, with the sleep replaced by SJMP $ — today's firmware, which must
// be entirely unaffected.
const SPIN_HEX = [
  rec(0x0000, [0x80, 0x2E]),
  rec(0x000B, [0x05, 0x30, 0x32]),
  rec(0x0030, [0x80, 0xFE]),
  ':00000001FF',
].join('\n');

const SIM_NS = 100_000_000;          // 100 ms
const FOSC = 11_059_200;
// Timer 0 in mode 1 is 16-bit with no auto-reload, so after the first
// overflow it wraps and counts a full 65536 ticks: 5,925,925 ns in 1T.
const T0_PERIOD_NS = 65536 / (FOSC / 1e9);

async function boot(hex, mode) {
  const createEmu8051 = (await import(WASM)).default;
  const Module = await createEmu8051();
  const loadHex = Module.cwrap('emu_load_hex', 'number', ['string', 'number']);
  const adapter = createEmu8051Adapter(Module, { mode });
  const board = new BoardImpl();
  board.setNetlist([{ id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }], []);
  adapter.attachBoard(board);

  Module._emu_init(1);                 // stc12 mode; without it stc12_tick is bypassed
  Module._emu_set_part(0);             // STC12
  Module._emu_reset(1);
  loadHex(hex, hex.length);
  Module._emu_set_sfr(0x8E, Module._emu_get_sfr(0x8E) | 0x80);          // AUXR.T0x12 → 1T
  Module._emu_set_sfr(0x89, (Module._emu_get_sfr(0x89) & 0xF0) | 0x01); // TMOD: T0 mode 1
  const reload = 65536 - 11059;                                          // 1 ms first tick
  Module._emu_set_sfr(0x8A, reload & 0xff);
  Module._emu_set_sfr(0x8C, reload >> 8);
  Module._emu_set_sfr(0x88, Module._emu_get_sfr(0x88) | 0x10);          // TCON.TR0
  Module._emu_set_sfr(0xA8, Module._emu_get_sfr(0xA8) | 0x82);          // IE: EA | ET0
  return { Module, adapter };
}

const ticks = (Module) => Module._emu_get_iram(0x30);
const timeNs = (Module) =>
  (BigInt(Module._emu_get_time_ns_hi() >>> 0) << 32n) | BigInt(Module._emu_get_time_ns_lo() >>> 0);

describe('emu8051 PCON.IDL fast-forward', () => {
  it('SKIP NOTICE', { skip: haveWasm }, () => {
    assert.fail('emu8051-stc/build/emu8051.js not found. Looked in:\n  ' +
      CANDIDATES.join('\n  ') +
      '\nThis gate cannot run without the sibling, and a skip reads the same as ' +
      'a pass in the summary line — which is exactly how fifteen cross-repo ' +
      'tests once went quiet for weeks. CI checks the sibling out; locally, ' +
      'clone it beside this repo and run its `make -f Makefile.wasm`.');
  });

  it('a parked core sleeps its clocks instead of grinding them',
    { skip: !haveWasm }, async () => {
      const { Module, adapter } = await boot(IDLE_HEX, 'push');
      Module._emu_set_idle_fastforward(1);
      adapter.runNs(SIM_NS);

      const stats = adapter.getStats();
      assert.ok(stats.sleptClocks > 0, 'the fast-forward never fired');
      // 100 ms at 11.0592 MHz is 1,105,920 clocks; nearly all of them are slept.
      const total = SIM_NS * (FOSC / 1e9);
      assert.ok(stats.sleptClocks / total > 0.95,
        `only ${(100 * stats.sleptClocks / total).toFixed(1)} % of clocks slept`);

      // And the firmware still ran: the ISR count matches ARITHMETIC, not just
      // the other run. Two runs can agree on a wrong number.
      const expect = Math.floor(Number(timeNs(Module)) / T0_PERIOD_NS);
      assert.ok(Math.abs(ticks(Module) - expect) <= 1,
        `ISR fired ${ticks(Module)} times; arithmetic says about ${expect}`);
    });

  it('changes nothing but speed — same firmware, both ways, compared',
    { skip: !haveWasm }, async () => {
      const off = await boot(IDLE_HEX, 'push');
      off.Module._emu_set_idle_fastforward(0);
      off.adapter.runNs(SIM_NS);

      const on = await boot(IDLE_HEX, 'push');
      on.Module._emu_set_idle_fastforward(1);
      on.adapter.runNs(SIM_NS);

      assert.equal(off.adapter.getStats().sleptClocks, 0,
        'the off switch does not work — the differential proves nothing');
      assert.ok(on.adapter.getStats().sleptClocks > 0, 'the fast-forward never fired');

      assert.equal(ticks(off.Module), ticks(on.Module),
        'the two runs disagree on how many times the ISR ran');
      assert.equal(timeNs(off.Module), timeNs(on.Module),
        'the two runs disagree on elapsed simulated time');
      for (const sfr of [0x87, 0x88, 0x89, 0x8A, 0x8C, 0xA8, 0x90]) {
        assert.equal(off.Module._emu_get_sfr(sfr), on.Module._emu_get_sfr(sfr),
          `SFR 0x${sfr.toString(16)} differs between the two runs`);
      }
    });

  it('poll mode stops sub-slicing while parked — counted, not timed',
    { skip: !haveWasm }, async () => {
      // The deterministic stand-in for a wall-clock measurement. Poll mode
      // sliced every pollIntervalNs (1 us by default), so 100 ms of sim cost
      // 92,161 board advances however little the emulator was doing — it
      // capped the jump AND paid for the polling. A parked core cannot move a
      // pin, so the only advances that need to happen are one per wake.
      const { adapter } = await boot(IDLE_HEX, 'poll');
      adapter.runNs(SIM_NS);
      const stats = adapter.getStats();
      assert.equal(stats.mode, 'poll', 'this case is about poll mode specifically');
      assert.ok(stats.advanceToCount < 100,
        `poll mode made ${stats.advanceToCount} board advances for ${SIM_NS} ns of ` +
        'sim; parked, it should make about one per wake');
      assert.ok(stats.sleptClocks > 0, 'the fast-forward did not fire in poll mode');
    });

  it('firmware that does NOT sleep is untouched', { skip: !haveWasm }, async () => {
    // Every STC12 example today busy-spins. None of them may change behaviour,
    // and none of them may lose the fine polling cadence they rely on.
    const { Module, adapter } = await boot(SPIN_HEX, 'poll');
    Module._emu_set_idle_fastforward(1);
    adapter.runNs(1_000_000);          // 1 ms is enough; poll mode is slow here
    const stats = adapter.getStats();
    assert.equal(stats.sleptClocks, 0,
      'the fast-forward fired on firmware that never sets PCON.IDL');
    assert.ok(stats.advanceToCount > 100,
      `a running core must keep the fine poll cadence; got ${stats.advanceToCount} advances`);
  });

  it('an older WASM without the export is handled, not guessed', () => {
    // The adapter must not assume a build newer than the one it is given: a
    // missing _emu_core_is_idle means "never idle", which is exactly the
    // behaviour before this change.
    const bare = {
      _emu_init() {}, _emu_reset() {}, _emu_set_part() {}, _emu_set_fosc() {},
      _emu_get_sfr: () => 0xff, _emu_set_sfr() {}, _emu_advance_to_ns() {},
      _emu_get_time_ns_lo: () => 0, _emu_get_time_ns_hi: () => 0,
      _emu_get_pin_mode: () => 0, _emu_get_pin_drive: () => 1,
      _emu_set_pin_input() {}, _emu_set_adc_voltage() {}, _emu_get_iram: () => 0,
      _emu_set_vcc() {}, _emu_get_interrupt_active: () => 0,
    };
    const adapter = createEmu8051Adapter(bare, { mode: 'poll' });
    assert.equal(adapter.isCoreIdle(), false,
      'a build with no idle export must read as never-idle');
    assert.equal(adapter.getStats().sleptClocks, 0,
      'and must report zero slept clocks rather than NaN or undefined');
  });
});
