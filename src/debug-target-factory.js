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
 *   'serial'    — live hardware over serial
 *
 * @module
 */

import { createEmu8051Adapter } from './emu8051-adapter.js';
import { createSerialDebugTarget } from './serial-debug.js';
import { createAvr8jsAdapter } from './avr8js-adapter.js';
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
  if (kind === 'avr8js') {
    return createAvr8jsTarget(opts);
  }
  if (kind === 'serial') {
    return createSerialTarget(opts);
  }
  throw new Error(
    `Unknown debug target kind: '${kind}'. Use 'emulator', 'avr8js', or 'serial'.`
  );
}

// ─── Emulator target (8051 / STC12) ─────────────────────────────────────

async function createEmulatorTarget(opts) {
  const {
    wasm, board, hex, symbols,
    fosc = 11059200, vcc = 5.0,
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
  const adapter = createEmu8051Adapter(wasm, { fosc, vcc, mode: 'poll' });

  // 2. Attach board
  adapter.attachBoard(board);

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

async function createAvr8jsTarget(opts) {
  const {
    board, hex, symbols,
    clockHz = 16_000_000, vcc = 5.0,
  } = opts;

  if (!board) throw new Error('avr8js target requires opts.board');

  // avr8js has no destructive init — order is flexible, but we follow the
  // same adapter-first, board-second, program-third pattern for consistency.

  // 1. Adapter
  const adapter = createAvr8jsAdapter({ clockHz, vcc });

  // 2. Attach board
  adapter.attachBoard(board);

  // 3. Load hex → parse to word-addressed Uint16Array → load into flash
  if (hex) {
    const words = parseIntelHex(hex);
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
      kind: 'serial',
      label: 'Live board (USB)',
      description: 'Real hardware over serial. Block stepping and yield breakpoints only.',
    },
  ];
}
