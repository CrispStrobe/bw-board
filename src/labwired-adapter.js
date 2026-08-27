/**
 * labwired-wasm → boundary A: the HEAVY tier's adapter.
 *
 * STM32-PATH.md Phase 4 decided two tiers permanently. The light tier is the
 * hand-rolled `CortexM0Machine` (M0-class, peripherals capped at what our
 * codegen emits). Everything beyond — foreign binaries, F103/F4, RISC-V,
 * Xtensa/ESP32 — goes through labwired. The wasm spike passed on 2026-08-25
 * (builds for wasm32 unchanged, 2.12 MB brotli); what it named as remaining
 * was "the wasm-bindgen API surface → boundary-A adapter mapping, and their
 * board-manifest → our-netlist bridge". This file is the first of those, and
 * it carries enough of the second to be usable.
 *
 * THE IMPEDANCE MISMATCH, STATED
 * ------------------------------
 * Every other adapter here wraps an emulator with a pin-shaped API: a
 * callback fires per pad edge, and a setter forces a pad low or high.
 * labwired has neither, by design — it is BOARD-centric. So the mapping is:
 *
 *   OUT  `watch_logic_signals(refs)` arms a capture set and RETURNS the
 *        current level of every ref, which is exactly contract pillar 1
 *        (attach seats all pins) for free. `read_logic_edges(cursor)` then
 *        yields `{ch, cycle, value}` transitions, oldest first.
 *   MODE `pin_routing(refs)` answers input/output/af/analog from the same
 *        register truth the engine reads — so `board.setPin`'s mode argument
 *        is the chip's own answer, not a guess from the pin name.
 *   IN   `set_board_io_input(id, active)` writes the GPIO IDR bit — but only
 *        for a binding declared in the system manifest. That is the coupling,
 *        and it is why this adapter GENERATES the manifest (below).
 *   TIME edges carry an engine CYCLE, not nanoseconds. The board wants ns.
 *
 * WHY THE MANIFEST IS GENERATED HERE
 * ----------------------------------
 * `set_board_io_input` resolves its `id` against `board_io` in the system
 * YAML, so a pin with no binding cannot be driven from the board at all —
 * contract pillar 2 (input readback) would be unimplementable for it. Rather
 * than ask every caller to hand-write one binding per header pin, the adapter
 * emits `board_io` itself: one `signal: input` entry per pin it exposes,
 * `active_high: true`, id = the header name. That is a deliberate slice of
 * the "board-manifest → netlist" bridge: enough for boundary A, and no more.
 * A caller that already has a manifest passes `systemYaml` and keeps it.
 *
 * TWO THINGS THAT COST A DAY, WRITTEN DOWN SO THEY DO NOT AGAIN
 * -------------------------------------------------------------
 * 1. `serde-wasm-bindgen` returns JS `Map`s, not plain objects — see `plain()`.
 * 2. The chip manifest MUST give every V2-layout STM32 GPIO port
 *    `config: { profile: stm32v2 }`. `type: stm32_gpioport` routes to
 *    labwired's STM32**F1** map (CRL @0x00, ODR @0x0C, BSRR @0x10); an F0/F4/F7
 *    is MODER @0x00, ODR @0x14, BSRR @0x18. Without it every output write lands
 *    on a different register, the pads never move, and NOTHING errors — the
 *    firmware runs and the UART talks while every pad reads low forever.
 *    Upstream's own onboarding configs (stm32f0/f072/f4/f746/h743) share this
 *    shape, so a manifest copied from them needs the profile added.
 *
 * @module
 */

/**
 * serde-wasm-bindgen hands back JS `Map`s, not plain objects.
 *
 * This is the single most expensive detail in the whole mapping, because it
 * fails SILENTLY: `batch.cursor` on a Map is `undefined`, `row.value` is
 * `undefined`, and `JSON.stringify` of the result prints `{}` — so an adapter
 * written against the documented field names appears to work, seats every pin
 * low, and reports that the firmware never moved. (It had: `step_batch`
 * returned its full cycle count and the PC advanced. Only the readback was
 * blind.) Everything crossing the boundary goes through here.
 *
 * @param {*} v value from a wasm-bindgen accessor
 * @returns {*} the same shape with every Map turned into a plain object
 */
export function plain (v) {
  if (v instanceof Map) {
    const out = {};
    for (const [k, val] of v.entries()) out[k] = plain(val);
    return out;
  }
  if (Array.isArray(v)) return v.map(plain);
  return v;
}

import { toLoadableElf } from './bin-to-elf.js';

/** ns per second, as a bigint numerator for cycle→ns without float drift. */
const NS_PER_S = 1_000_000_000n;

/**
 * Build a system manifest whose board_io makes every exposed pin drivable.
 *
 * @param {string} name manifest name
 * @param {string} chipPath value for the manifest's `chip:` key
 * @param {Record<string,{peripheral:string,pin:number}>} pins header map
 * @returns {string} YAML
 */
export function generateSystemYaml (name, chipPath, pins) {
  const rows = Object.entries(pins).map(([id, def]) =>
    `- id: "${id}"\n  kind: button\n  peripheral: "${def.peripheral}"\n` +
    `  pin: ${def.pin}\n  signal: input\n  active_high: true`);
  return [
    `name: "${name}"`,
    `chip: "${chipPath}"`,
    // One input binding per header pin — see the module header. `kind: button`
    // is the engine's plain digital contact; nothing about it implies a UI.
    rows.length ? `board_io:\n${rows.join('\n')}` : 'board_io: []',
    ''
  ].join('\n');
}

/**
 * @param {object} opts
 * @param {object} opts.wasm            the instantiated labwired-wasm module
 * @param {string} opts.chipYaml        chip descriptor YAML
 * @param {Uint8Array} opts.firmware    ELF, or a raw flash image (wrapped for you)
 * @param {Record<string,{peripheral:string,pin:number}>} opts.pins header map
 * @param {number} [opts.clockHz]       engine cycle rate, for cycle→ns
 * @param {string} [opts.systemYaml]    override the generated manifest
 * @param {string} [opts.name]
 * @returns {object} boundary-A adapter
 */
export function createLabwiredAdapter (opts) {
  const { wasm, chipYaml, pins } = opts;
  // Accept a raw flash image as readily as an ELF. labwired's ARM path ends in
  // `load_elf_bytes` and takes nothing else, while everything lite compiles is
  // a raw image — so without this the heavy tier could only run firmware built
  // by a toolchain lite does not have. See bin-to-elf.js for what is lost
  // (symbols; there were none in a .bin to lose).
  const firmware = opts.firmware ? toLoadableElf(opts.firmware) : opts.firmware;
  if (!wasm || !wasm.WasmSimulator) throw new Error('labwired-adapter: opts.wasm must expose WasmSimulator');
  if (!chipYaml) throw new Error('labwired-adapter: opts.chipYaml is required');
  if (!pins || Object.keys(pins).length === 0) throw new Error('labwired-adapter: opts.pins is required');

  const clockHz = opts.clockHz ?? 48_000_000;
  const clockHzBig = BigInt(clockHz);
  const names = Object.keys(pins);
  // Channel index IS the ref's position (documented by watch_logic_signals),
  // so this array is the ch→name table for every edge record.
  const refs = names.map((n) => ({ kind: 'gpio', peripheral: pins[n].peripheral, pin: pins[n].pin }));

  const systemYaml = opts.systemYaml
    ?? generateSystemYaml(opts.name ?? 'bw-labwired', opts.chipPath ?? './chip.yaml', pins);

  const build = () => wasm.WasmSimulator.new_from_config(systemYaml, chipYaml, firmware, undefined);
  let sim = build();

  let board = null;
  let serialListener = null;
  let inInputSync = false;
  let cursor = 0;
  let cycleNow = 0n;
  const stats = { pinChangeCount: 0, advanceToCount: 0, edgesDropped: 0 };

  /** Last (mode, high) published per pin — the board sees edges, not repeats. */
  const published = new Map();
  /** Last routing mode per pin, refreshed with the edges. */
  const routing = new Map();

  const cycleToNs = (cycle) => (BigInt(Math.round(cycle)) * NS_PER_S) / clockHzBig;
  const timeNs = () => (cycleNow * NS_PER_S) / clockHzBig;

  /** labwired's routing vocabulary → the board's Thevenin mode names. */
  const modeOf = (name) => {
    const r = routing.get(name);
    // `af` drives the pad from a peripheral, which is still a driven output as
    // far as the circuit is concerned. `unknown` is reported by families that
    // cannot say; treating it as an input is the safe default — it makes the
    // board solve the node instead of asserting a level we do not know.
    if (r === 'output' || r === 'af') return 'pushpull';
    if (r === 'analog') return 'analog';
    return 'input';
  };

  function refreshRouting () {
    if (!sim.pin_routing) return;
    const rows = plain(sim.pin_routing(refs));
    if (!Array.isArray(rows)) return;
    rows.forEach((row, i) => {
      if (row && typeof row.mode === 'string') routing.set(names[i], row.mode);
    });
  }

  const publish = (name, high, atNs) => {
    if (!board) return;
    const mode = modeOf(name);
    const prev = published.get(name);
    if (prev && prev.mode === mode && prev.high === high) return;
    published.set(name, { mode, high });
    if (board.advanceTo) board.advanceTo(atNs);      // time first, edge second
    board.setPin(name, mode, high);
    stats.pinChangeCount++;
    if (!inInputSync) syncInputs();
  };

  function drainEdges () {
    const batch = plain(sim.read_logic_edges(cursor));
    if (!batch) return;
    cursor = batch.cursor ?? cursor;
    if (batch.dropped) stats.edgesDropped = batch.dropped;
    if (typeof batch.nowCycle === 'number') cycleNow = BigInt(Math.round(batch.nowCycle));
    const edges = batch.edges ?? [];
    if (edges.length) refreshRouting();
    for (const e of edges) {
      const name = names[e.ch];
      if (name === undefined) continue;             // never fall through to ch 0
      publish(name, !!e.value, cycleToNs(e.cycle));
    }
  }

  /**
   * Hand the firmware's UART bytes to the listener.
   *
   * labwired's serial is PULL (`drain_uart_output` returns what has
   * accumulated) while every other adapter here PUSHES a byte at a time. The
   * difference is real but it is not the caller's problem: a host that had to
   * poll one adapter and subscribe to the others would grow a branch per
   * engine, which is the thing boundary A exists to prevent. So this is called
   * wherever the engine has just run, and `onSerial` behaves the same
   * everywhere.
   */
  function drainSerial () {
    if (!serialListener || !sim.drain_uart_output) return;
    let out;
    try {
      out = sim.drain_uart_output();
    } catch (e) {
      return;                       // a UART-less machine is not an error
    }
    if (out && out.length) for (const b of out) serialListener(b);
  }

  function syncInputs () {
    if (!board || !board.readPin) return;
    inInputSync = true;
    try {
      for (const name of names) {
        // Only pads the firmware is NOT driving take a level from the board.
        if (modeOf(name) !== 'input') continue;
        try {
          sim.set_board_io_input(name, board.readPin(name) === 1);
        } catch (e) {
          // A pin with no binding (caller-supplied manifest) is not fatal:
          // it simply cannot be driven. Silence here would be worse than a
          // slow read, so record it once per pin.
          if (!syncInputs.warned) syncInputs.warned = new Set();
          if (!syncInputs.warned.has(name)) {
            syncInputs.warned.add(name);
            stats.unbindablePins = (stats.unbindablePins ?? 0) + 1;
          }
        }
      }
    } finally {
      inInputSync = false;
    }
  }

  const adapter = {
    sim,
    clockHz,
    systemYaml,
    pins,

    attachBoard (b) {
      board = b;
      published.clear();
      cursor = 0;
      // Arming the watch RETURNS every ref's current level — pillar 1 (seat
      // all pins) and the ch table in one call, before any edge exists.
      const seated = plain(sim.watch_logic_signals(refs));
      refreshRouting();
      const atNs = timeNs();
      if (Array.isArray(seated)) {
        seated.forEach((row, i) => {
          const name = names[i];
          const mode = modeOf(name);
          // `value: null` means the engine cannot say (unknown pad). Seat it
          // low rather than skipping: an unseated pin is the bug pillar 1
          // exists to catch, and the board must have a level for every pin.
          const high = row && row.value === true;
          published.set(name, { mode, high });
          if (board.advanceTo) board.advanceTo(atNs);
          board.setPin(name, mode, high);
          stats.pinChangeCount++;
        });
      }
      syncInputs();
    },

    syncInputs,

    advanceNs (deltaNs) {
      syncInputs();
      const cycles = Number((BigInt(deltaNs) * clockHzBig) / NS_PER_S);
      if (cycles > 0) sim.step_batch(cycles);
      drainEdges();
      drainSerial();
      if (board && board.advanceTo) {
        board.advanceTo(timeNs());
        stats.advanceToCount++;
      }
    },

    timeNs,

    resetToProgram () {
      sim = build();
      adapter.sim = sim;
      published.clear();
      routing.clear();
      cursor = 0;
      cycleNow = 0n;
      if (board) adapter.attachBoard(board);
    },

    onSerial (cb) { serialListener = cb; },

    feedSerial (byte) {
      sim.feed_uart_input(Uint8Array.from([byte & 0xff]));
    },

    /**
     * Publish whatever the engine has produced since the last look, without
     * advancing it.
     *
     * A debug loop steps the simulator itself (one instruction at a time, to
     * compare the PC against breakpoints), so it never goes through
     * `advanceNs` — but the board still has to see the edges those steps
     * caused, and still has to be advanced to the new time. This is that,
     * factored out so a debug target does not have to reach into the
     * adapter's internals or call `advanceNs(0)` and rely on the special case.
     */
    pump () {
      syncInputs();
      drainEdges();
      drainSerial();
      if (board && board.advanceTo) {
        board.advanceTo(timeNs());
        stats.advanceToCount++;
      }
    },

    /**
     * Drain UART bytes explicitly. `advanceNs` and `pump` already do this, so
     * a normal consumer never needs it; it is here for a host that steps the
     * engine by some other route and still wants the console.
     */
    pumpSerial: () => drainSerial(),

    stats,
  };

  return adapter;
}

export default createLabwiredAdapter;
