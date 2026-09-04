/**
 * Debug target factory — one construction path for three target kinds.
 *
 * The host should not need to know that one target has a destructive init
 * (emu_init re-callocs code memory) or that another needs a baud rate.
 * This factory owns each one's setup ordering and returns something the
 * front end can treat identically — branching on capabilities(), never
 * on which target it is.
 *
 * What the factory UNIFIES: construction and setup ordering.
 * What it does NOT unify: capabilities. The targets are not equally
 * capable, and §1 says an interface hiding that "produces a front end
 * that lies to the user the moment it is pointed at real hardware."
 *
 * Target kinds:
 *   'emulator'  — STC12 / 8051 via emu8051 WASM
 *   'avr8js'    — ATmega328P via avr8js (pure TS, no WASM)
 *   'rp2040js'  — Raspberry Pi Pico via rp2040js (pure TS). Listed in
 *                 getTargetKinds() since 2026-08-13: the hosted rp2040
 *                 compile route exists, so the picker entry stopped
 *                 being a lie
 *   'labwired'  — the HEAVY tier: any chip labwired models (F103/F4/F7/H7,
 *                 RISC-V, Xtensa), via labwired-wasm. Needs opts.wasm, the
 *                 same way 'emulator' does, because a 20 MB engine is the
 *                 host's to load and cache — not this module's to bundle.
 *                 Deliberately NOT in getTargetKinds() yet: no host can
 *                 supply that module today, and a picker entry for something
 *                 nobody can select is the lie this file's header warns about
 *                 (it is why 'rp2040js' waited for its compile route).
 *   'serial'    — live hardware over serial
 *
 * @module
 */

import { createEmu8051Adapter } from './emu8051-adapter.js';
import { createSerialDebugTarget } from './serial-debug.js';
import { createAvr8jsAdapter } from './avr8js-adapter.js';
import { createLabwiredAdapter } from './labwired-adapter.js';
import { createLabwiredDebugTarget } from './labwired-debug.js';
import { labwiredAdapterOptionsFor } from './labwired-bridge.js';
import { parseIntelHex } from './intel-hex.js';

/**
 * Create a DebugTarget of the specified kind.
 *
 * @param {'emulator' | 'avr8js' | 'serial'} kind
 * @param {object} opts
 *
 * For 'emulator':
 * @param {object} opts.wasm — the loaded emu8051 WASM module
 * @param {object} opts.board — the BoardImpl instance
 * @param {string} [opts.hex] — Intel HEX to load
 * @param {object} [opts.symbols] — stc_symtab.py JSON output
 * @param {number} [opts.fosc] — oscillator frequency (default 11059200)
 * @param {number} [opts.vcc] — supply voltage (default 5.0)
 *
 * For 'avr8js':
 * @param {object} opts.board — the BoardImpl instance
 * @param {string} [opts.hex] — Intel HEX to load
 * @param {object} [opts.symbols] — symbol table (avr-nm JSON, same shape)
 * @param {number} [opts.clockHz] — CPU clock (default 16 MHz)
 * @param {number} [opts.vcc] — supply voltage (default 5.0)
 *
 * For 'serial':
 * @param {object} opts.transport — serial transport adapter
 *   { write(data), onData(cb), onClose(cb) }
 * @param {number} [opts.timeoutMs] — command timeout (default 2000)
 *
 * @returns {Promise<{ target: object, adapter?: object }>}
 *   target: the DebugTarget
 *   adapter: the boundary-A adapter (emulator/avr8js only)
 */
export async function createDebugTarget(kind, opts) {
  if (kind === 'emulator') {
    return createEmulatorTarget(opts);
  }
  if (kind === 'avr8js' || kind === 'atmega2560' || kind === 'attiny85' || kind === 'attiny88') {
    return createAvr8jsTarget(kind, opts);
  }
  if (kind === 'z80') {
    return createZ80Target(opts);
  }
  if (kind === 'eater6502') {
    return createEater6502Target(opts);
  }
  if (kind === 'i8086') {
    return createI8086Target(opts);
  }
  if (kind === 'rp2040js') {
    return createRp2040jsTarget(opts);
  }
  if (kind === 'stm32f0') {
    return createStm32F0Target(opts);
  }
  if (kind === 'labwired') {
    return createLabwiredTarget(opts);
  }
  if (kind === 'serial') {
    return createSerialTarget(opts);
  }
  throw new Error(
    `Unknown debug target kind: '${kind}'. Use 'emulator', 'avr8js', 'atmega2560', 'attiny85', 'attiny88', 'eater6502', 'i8086', 'z80', 'rp2040js', 'stm32f0', 'labwired', or 'serial'.`
  );
}

// ─── labwired target (the heavy tier) ───────────────────────────────────

/**
 * @param {object} opts
 * @param {object} opts.wasm      instantiated labwired-wasm module
 * @param {object} opts.board     BoardImpl — ALSO the default source of the
 *   chip descriptor, the header map and the manifest (see below)
 * @param {Uint8Array} opts.firmware  ELF, or a raw flash image
 * @param {string} [opts.chipKind] our board-part kind, default `stm32f030`
 * @param {string} [opts.chipYaml]  chip descriptor, if not derived from the board
 * @param {Record<string,{peripheral:string,pin:number}>} [opts.pins] header map
 * @param {number} [opts.clockHz]
 * @param {string} [opts.systemYaml] override the generated manifest
 */
async function createLabwiredTarget(opts) {
  const { wasm, board, firmware, name } = opts;
  if (!wasm) throw new Error("labwired target requires opts.wasm (the labwired-wasm module)");
  if (!board) throw new Error('labwired target requires opts.board');
  if (!firmware) throw new Error('labwired target requires opts.firmware (an ELF)');

  // THE BOARD IS THE NETLIST, so it is where the manifest comes from unless the
  // caller insists otherwise. Requiring a host to hand over `chipYaml` and
  // `pins` alongside the board invited exactly the divergence one-board-one-
  // truth forbids: two descriptions of the same bench, and nothing checking
  // that the pin map matches what the designer actually drew. `refusals` rides
  // out on the result so a host can SAY why something on the bench will not
  // move, instead of showing a dead knob.
  let { chipYaml, pins, clockHz, systemYaml } = opts;
  let refusals = [];
  if (!chipYaml || !pins) {
    const derived = labwiredAdapterOptionsFor({
      netlist: board, chipKind: opts.chipKind ?? 'stm32f030', mcuId: opts.mcuId, name,
    });
    chipYaml = chipYaml ?? derived.chipYaml;
    pins = pins ?? derived.pins;
    clockHz = clockHz ?? derived.clockHz;
    systemYaml = systemYaml ?? derived.systemYaml;
    refusals = derived.refusals;
  }

  // Ordering, as everywhere in this factory: adapter, then board, then target.
  // attachBoard is what arms the engine's logic capture AND seats every pin, so
  // a target built before it would read a board nothing has published to.
  const adapter = createLabwiredAdapter({ wasm, chipYaml, firmware, pins, clockHz, systemYaml, name });
  adapter.attachBoard(board);
  const target = createLabwiredDebugTarget({ adapter });
  return { target, adapter, refusals };
}

// ─── Emulator target (8051 / STC12) ─────────────────────────────────────

async function createEmulatorTarget(opts) {
  const {
    wasm, board, hex, symbols,
    fosc = 11059200, vcc = 5.0, part,
  } = opts;

  if (!wasm) throw new Error('emulator target requires opts.wasm');
  if (!board) throw new Error('emulator target requires opts.board');

  // ─── ORDERING IS CRITICAL ──────────────────────────────────────────
  // emu_init re-callocs code memory. If the adapter is created after
  // loading the hex, the image is wiped and the CPU NOP-sleds to
  // whatever address a breakpoint sits at. The host sees a working
  // debugger pointing at the wrong block.
  //
  // Correct order:
  //   1. Create adapter (calls emu_init internally)
  //   2. Attach board
  //   3. Load hex (into the memory emu_init allocated)
  //   4. Create debug target (reads the loaded image)

  // 1. Adapter
  const adapter = createEmu8051Adapter(wasm, { fosc, vcc, part, mode: 'poll' });

  // 2. Attach board
  adapter.attachBoard(board ?? { advanceTo() {}, setPin() {}, readPin() { return 0; } });

  // 3. Load hex
  if (hex) {
    adapter.loadHex(hex);

    // Sanity: the reset vector should not be 0x0000 (empty memory)
    const resetHi = wasm._emu_get_code(0);
    const resetLo = wasm._emu_get_code(1);
    const resetAddr = (resetHi === 0x02) ? (wasm._emu_get_code(1) << 8 | wasm._emu_get_code(2)) : 0;
    if (resetHi === 0 && resetLo === 0) {
      console.warn(
        'Warning: reset vector is 0x0000 after loading hex. ' +
        'The image may not have loaded correctly.'
      );
    }
  }

  // 4. Debug target — import dynamically to avoid circular deps
  const { createEmu8051DebugTarget } = await import('./emu8051-debug.js');
  const target = createEmu8051DebugTarget(wasm, { symbols });

  return { target, adapter };
}

// ─── AVR target (ATmega328P via avr8js) ─────────────────────────────────

async function createAvr8jsTarget(kind, opts) {
  const {
    board, hex, symbols,
    clockHz, vcc,
  } = opts;

  if (!board) throw new Error('avr8js target requires opts.board');

  // Map factory kind to chip name: 'avr8js' → 'atmega328p' (default)
  const chip = kind === 'atmega2560' ? 'atmega2560'
    : kind === 'attiny85' ? 'attiny85'
      : kind === 'attiny88' ? 'attiny88' : 'atmega328p';

  // avr8js has no destructive init — order is flexible, but we follow the
  // same adapter-first, board-second, program-third pattern for consistency.

  // 1. Adapter (chip param selects pin map, ports, timers, etc.)
  const adapterOpts = { chip };
  if (clockHz != null) adapterOpts.clockHz = clockHz;
  if (vcc != null) adapterOpts.vcc = vcc;
  const adapter = createAvr8jsAdapter(adapterOpts);

  // 2. Attach board
  adapter.attachBoard(board);

  // 3. Load hex → parse to word-addressed Uint16Array → load into flash
  if (hex) {
    // Sized to the CHIP's flash, not the parser's ATmega328P default: a
    // 16384-word parse on an ATtiny's 4096-word progMem throws RangeError
    // "offset is out of bounds" at set() — the pendant's first crash once
    // the attach dispatch routed it here (2026-08-16) — and the 2560
    // needs it BIGGER. Neither direction can stay implicit.
    const words = parseIntelHex(hex, adapter.chip.flashWords * 2);
    adapter.loadProgram(words);

    // Sanity: AVR reset vector is at word 0. A JMP instruction starts with
    // 0x940C or 0x940E; an RJMP with 0xCxxx. All-zeros means empty flash.
    if (words[0] === 0) {
      console.warn(
        'Warning: flash word 0 is 0x0000 after loading hex. ' +
        'The image may not have loaded correctly.'
      );
    }
  }

  // 4. Debug target — the coordinator is writing createAvr8jsDebugTarget.
  //    Dynamic import so this file does not fail when the module does not
  //    exist yet. The factory returns { adapter } without a target in that
  //    case — the caller can still run the simulation, just not debug it.
  let target = null;
  try {
    const mod = await import('./avr8js-debug.js');
    if (mod.createAvr8jsDebugTarget) {
      target = mod.createAvr8jsDebugTarget(adapter, { symbols });
    }
  } catch {
    // avr8js-debug.js does not exist yet — adapter-only mode
  }

  return { target, adapter };
}

// ─── 6502 breadboard computer (Eater-style) ─────────────────────────────

async function createZ80Target(opts) {
  const { board, rom, config, pc, cpm } = opts;
  // The Z80 bench has no GPIO boundary — board is optional; when
  // present it only receives time sync (the serial console is the
  // observable surface, via adapter.onSerial / sendSerial).
  const { createZ80Adapter } = await import('./z80-adapter.js');
  const adapter = createZ80Adapter({ config, rom, romAt: opts.romAt, pc, cpm });
  if (board) adapter.attachBoard(board);
  else adapter.attachBoard({ advanceTo() {} });

  let target = null;
  try {
    const mod = await import('./z80-debug.js');
    if (mod.createZ80DebugTarget) {
      target = mod.createZ80DebugTarget({ machine: adapter.machine });
    }
  } catch { /* adapter-only mode */ }
  return { target, adapter };
}

/**
 * The 8086 breadboard. Like the z80 and 6502 targets, a board is optional:
 * a machine whose only observable surface is the serial console has no pins
 * to publish, so a time-sync stub suffices. The 8255's pins are the reason
 * to pass a real one.
 */
async function createI8086Target(opts) {
  const { board, rom, config } = opts;
  const { createI8086Adapter } = await import('./i8086-adapter.js');
  const adapter = createI8086Adapter({ config, rom, romAt: opts.romAt });
  // setPin() is NOT optional in this stub, and its absence was a real trap.
  // The adapter's onPinChange hook calls board.setPin() on the first 8255
  // output edge, and POST triggers one the moment it writes the PPI control
  // word -- so `createDebugTarget('i8086', {rom})` with no board threw
  // `board.setPin is not a function` before the machine executed anything.
  // A caller who just wants a machine has no reason to know that a null board
  // needs two methods rather than one.
  adapter.attachBoard(board ?? { advanceTo() {}, setPin() {} });

  let target = null;
  try {
    const mod = await import('./i8086-debug.js');
    if (mod.createI8086DebugTarget) {
      target = mod.createI8086DebugTarget({ machine: adapter.machine });
    }
  } catch { /* adapter-only mode */ }
  return { target, adapter };
}

/** py65mon-shaped config: RAM low, the $F000 MMIO console window
 *  carved out of high ROM — what Tali Forth 2 (public domain) and the
 *  whole py65 ecosystem target. */
const PY65MON = Object.freeze({
  clockHz: 1_000_000,
  regions: [
    { kind: 'ram', start: 0x0000, end: 0x7fff },
    { kind: 'rom', start: 0x8000, end: 0xefff },
    { kind: 'rom', start: 0xf008, end: 0xffff },
  ],
  chips: [{ kind: 'console', name: 'con1', at: 0xf000 }],
});

async function createEater6502Target(opts) {
  const { board, rom, symbols, config } = opts;

  // A board is required for pin-level runs; the py65mon console-only
  // shape (Tali Forth etc.), the gpascal serial-console shape, and the
  // wired-extractor path (opts.config from extract6502Machine — a bus
  // machine with no pin boundary) have no pins to publish, so a
  // time-sync stub suffices — same stance as the z80 target. A bare
  // ROM boot (opts.rom on the default Eater map) rides the same stub.
  if (!board && !opts.py65mon && !opts.gpascal && !config && !rom) {
    throw new Error('eater6502 target requires opts.board');
  }

  const { createM6502Adapter } = await import('./m6502-adapter.js');
  const adapterOpts = {};
  if (opts.py65mon) adapterOpts.config = PY65MON;
  // Gammon's G-Pascal board: VIA at $7FF0, bit-banged 4800-baud serial.
  // The ROM (MIT) is vendored at vendor/gpascal/gpascal.bin; callers in
  // environments with fetch/fs pass it via opts.rom like every ROM.
  if (opts.gpascal) {
    const { GPASCAL } = await import('./m6502-machine.js');
    adapterOpts.config = GPASCAL;
  }
  // Custom machine config — the wired-extractor path: the designer
  // circuit's bus wiring becomes {regions, chips} via extract6502Machine,
  // and the SAME machine the default preset builds grows video chips,
  // extra VIAs, whatever the wiring says. Default stays EATER6502.
  if (config) adapterOpts.config = config;
  if (rom) adapterOpts.rom = rom instanceof Uint8Array ? rom : new Uint8Array(rom);
  const adapter = createM6502Adapter(adapterOpts);
  if (rom) {
    // Set reset vector if the ROM image includes it at its natural position
    // ($FFFC/$FFFD relative to the ROM base). The adapter's loadRom + reset
    // in attachBoard handles this.
  }
  // Board-less machines still need attachBoard (it performs the reset
  // through $FFFC); the stub absorbs pin traffic the way the z80
  // target's stub absorbs time sync. setPin matters: a VIA in the
  // extracted config publishes pin edges even when nothing listens.
  adapter.attachBoard(board || { advanceTo() {}, setPin() {} });

  let target = null;
  try {
    const mod = await import('./m6502-debug.js');
    if (mod.createM6502DebugTarget) {
      target = mod.createM6502DebugTarget(adapter, { symbols });
    }
  } catch {
    // m6502-debug.js not available — adapter-only mode
  }

  return { target, adapter };
}

// ─── Pico target (RP2040 via rp2040js) ──────────────────────────────────

async function createRp2040jsTarget(opts) {
  const {
    board, program, symbols,
    clockHz = 125_000_000, vcc = 3.3,
  } = opts;

  if (!board) throw new Error('rp2040js target requires opts.board');

  // Same adapter-first, board-second, program-third pattern. The program
  // is Thumb halfwords into SRAM (the no-bootrom path) — hex/UF2-to-flash
  // arrives with the Pico compile route, whichever one the roadmap picks.
  const { createRp2040jsAdapter } = await import('./rp2040js-adapter.js');
  const adapter = createRp2040jsAdapter({ clockHz, vcc });
  adapter.attachBoard(board);
  if (program) adapter.loadProgram(program);

  // Debug target: the coordinator writes createRp2040jsDebugTarget next.
  // Until then the factory returns { adapter } without a target — the
  // caller can run the simulation, just not debug it.
  let target = null;
  try {
    const mod = await import('./rp2040js-debug.js');
    if (mod.createRp2040jsDebugTarget) {
      target = mod.createRp2040jsDebugTarget(adapter, { symbols });
    }
  } catch {
    // rp2040js-debug.js does not exist yet — adapter-only mode
  }

  return { target, adapter };
}

// ─── STM32F030 target (hand-rolled light tier) ──────────────────────────

async function createStm32F0Target(opts) {
  const {
    board, program, symbols,
    clockHz = 48_000_000,
  } = opts;

  if (!board) throw new Error('stm32f0 target requires opts.board');

  // The F0 image is a REAL flash image (vectors first, word 0 = SP,
  // word 1 = reset) — raw bytes, not the Pico's SRAM halfword trick.
  const { createStm32F0Adapter } = await import('./stm32-adapter.js');
  const adapter = createStm32F0Adapter({ clockHz, program });
  adapter.attachBoard(board);

  // The debug target is the rp2040js one, unchanged: the adapter's
  // facade (bus + sram + clock) is the whole surface it consumes.
  const { createRp2040jsDebugTarget } = await import('./rp2040js-debug.js');
  const target = createRp2040jsDebugTarget(adapter, { symbols });

  return { target, adapter };
}

// ─── Serial target ───────────────────────────────────────────────────────

async function createSerialTarget(opts) {
  const { transport, timeoutMs } = opts;

  if (!transport) throw new Error('serial target requires opts.transport');

  const target = createSerialDebugTarget(transport, { timeoutMs });

  // Connect and discover capabilities
  try {
    await target.connect();
  } catch (e) {
    // Connection may fail — the target starts detached and the caller
    // can retry. Do not throw from the factory.
    console.warn(`Serial target connect failed: ${e.message}`);
  }

  return { target };
}

/**
 * The known target kinds — for the target picker UI.
 * @returns {Array<{kind: string, label: string, description: string}>}
 */
/**
 * The labwired kind's menu entry, kept OUT of getTargetKinds() on purpose.
 *
 * Its engine is a 20 MB artifact fetched at deploy time and loaded on demand,
 * so unlike every other kind here it can be genuinely absent. A host that has
 * probed for it (lite's lib/labwired-engine.js) appends this; a host that has
 * not must not offer it. That is the same rule that kept 'rp2040js' out of the
 * list until its compile route existed: a picker entry nobody can select is a
 * lie the front end tells for us.
 */
export const LABWIRED_KIND = {
  kind: 'labwired',
  label: 'Simulated (labwired — full fidelity)',
  description: 'The heavy tier: F103/F4/F7, RISC-V and Xtensa, via the labwired engine. '
    + 'Downloaded on first use.',
};

export function getTargetKinds() {
  return [
    {
      kind: 'emulator',
      label: 'Simulated (STC12 / 8051)',
      description: 'Full instruction-level 8051 emulation. All debug features available.',
    },
    {
      kind: 'avr8js',
      label: 'Simulated (ATmega328P)',
      description: 'AVR instruction-level emulation. Arduino Nano/Uno programs.',
    },
    {
      kind: 'atmega2560',
      label: 'Simulated (ATmega2560)',
      description: 'AVR instruction-level emulation. Arduino Mega programs.',
    },
    {
      kind: 'attiny85',
      label: 'Simulated (ATtiny85)',
      description: 'AVR instruction-level emulation. ATtiny85/Digispark programs.',
    },
    {
      kind: 'z80',
      label: 'Simulated (Z80)',
      description: 'Composable Z80 machine — Searle bench, CP/M, ZX Spectrum configs.',
    },
    {
      // MISSING SINCE THE KIND SHIPPED, and the failure was not "no entry" --
      // a <select> whose value matches no option renders the FIRST option, so
      // the picker read "Simulated (STC12 / 8051)" while running 8086 code.
      // A host cannot tell that from a user who chose 8051.
      kind: 'i8086',
      label: 'Simulated (8086 / 8088)',
      description: 'Composable 8086 machine — breadboard, XT board with CGA and floppy, or DOS programs.',
    },
    {
      kind: 'attiny88',
      label: 'Simulated (ATtiny88)',
      description: 'AVR instruction-level emulation. ATtiny88 (blinkenrocket-class boards).',
    },
    {
      kind: 'eater6502',
      label: 'Simulated (6502 breadboard)',
      description: '6502 instruction-level emulation. VIA/ACIA-based breadboard computers.',
    },
    {
      kind: 'rp2040js',
      label: 'Simulated (RP2040)',
      description: 'ARM Cortex-M0+ emulation. Raspberry Pi Pico programs.',
    },
    {
      kind: 'stm32f0',
      label: 'Simulated (STM32F030)',
      description: 'ARM Cortex-M0 emulation. STM32F030 (16K flash / 4K SRAM) programs.',
    },
    {
      kind: 'serial',
      label: 'Live board (USB)',
      description: 'Real hardware over serial. Block stepping and yield breakpoints only.',
    },
  ];
}
