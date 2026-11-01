/**
 * Closed, supplier-owned board assemblies for the public LabWired factory.
 * A selector is an identity, not permission to supply another YAML machine.
 * Optional external nets still come from the actual Board, on the pad side
 * of the canonical internal display/touch assembly.
 */
import { LABWIRED_BOARDS, LABWIRED_CATALOG, LABWIRED_CATALOG_PIN } from './labwired-catalog.js';
import { ESP32_4848S040_LABWIRED_PINS } from './labwired-chips.js';
import { labwiredAdapterOptionsFor } from './labwired-bridge.js';
import { getDevice } from './devices.js';

export const ESP32_S040_BOARD_ID = 'esp32-4848s040';
export const ESP32_S040_PART_KIND = 'esp32_4848s040';
export const ESP32_S040_TERMINALS = Object.freeze([
  'gnd', 'gnd2', 'gpio40', 'gpio44', 'gpio2', 'gpio43', 'gpio1', '5v',
]);

const fail = message => { throw new Error(`ESP32-4848S040 profile: ${message}`); };

/** Resolve only the exact catalog board; callers cannot replace its devices. */
export function prepareLabwiredBoardProfile (opts) {
  if (opts.labwiredBoardId !== ESP32_S040_BOARD_ID) fail(`unknown labwiredBoardId '${String(opts.labwiredBoardId)}'`);
  const competing = ['chip', 'chipKind', 'labwiredBoard', 'boardVariant', 'softwareProfile',
    'chipYaml', 'systemYaml', 'pins', 'clockHz', 'firmwareAddress', 'extraSegments',
    'blobs', 'chipPath', 'arduinoEsp32', 'softdeviceS110', 'labAir', 'boardMatrix'];
  if (competing.some(key => opts[key] != null)) fail('a trusted board cannot be combined with competing configuration');
  const catalog = LABWIRED_BOARDS[ESP32_S040_BOARD_ID];
  const chip = LABWIRED_CATALOG.esp32s3;
  if (!catalog || catalog.chip !== chip.name ||
      catalog.displays.length !== 1 || catalog.displays[0].id !== 'display' ||
      catalog.displays[0].type !== 'st7701-rgb') {
    fail('the qualified supplier catalog must contain the exact S040 display/touch assembly');
  }
  if (opts.name != null && (typeof opts.name !== 'string' || !opts.name)) fail('name must be a non-empty string');
  const name = opts.name ?? ESP32_S040_BOARD_ID;
  const firmwareOnly = opts.board == null;
  if (opts.firmwareOnly != null && opts.firmwareOnly !== firmwareOnly) fail('firmwareOnly must agree with the actual board');

  let pins = {}, mcuId = null, connectedPins = [], refusals = [];
  let systemYaml = catalog.systemYaml.replace(/^name:.*$/m, `name: ${JSON.stringify(name)}`);
  if (firmwareOnly) {
    if (opts.mcuId != null) fail('mcuId requires the actual circuit board');
  } else {
    const board = opts.board;
    if (!Array.isArray(board.parts) || !Array.isArray(board.nets) ||
        ['setPin', 'readPin', 'advanceTo'].some(key => typeof board[key] !== 'function')) {
      fail('board must be the actual circuit with parts, nets and the pad/time interface');
    }
    if (opts.mcuId != null && (typeof opts.mcuId !== 'string' || !opts.mcuId)) fail('mcuId must be a non-empty part id');
    const candidates = board.parts.filter(part => opts.mcuId != null
      ? part.id === opts.mcuId : part.kind === ESP32_S040_PART_KIND);
    if (candidates.length !== 1 || candidates[0].kind !== ESP32_S040_PART_KIND) {
      fail('select exactly one actual esp32_4848s040 part; a generic mcu fallback is not this board');
    }
    const selected = candidates[0];
    if (!Array.isArray(selected.terminals) || selected.terminals.length !== ESP32_S040_TERMINALS.length ||
        new Set(selected.terminals).size !== ESP32_S040_TERMINALS.length ||
        selected.terminals.some(t => !ESP32_S040_TERMINALS.includes(t))) {
      fail('the selected part must expose exactly the physical eight-terminal H1 connector');
    }
    // Board's bare pin namespace is shared. Until it has a per-controller
    // voltage-qualified surface, refuse overlapping MCU pads rather than
    // broadcasting this firmware's H1 writes onto another board.
    const headers = new Set(Object.keys(ESP32_4848S040_LABWIRED_PINS));
    const overlapping = board.parts.find(part => part !== selected &&
      (part.kind === 'mcu' || getDevice(part.kind)?.gpioFollowsPinStates) &&
      part.terminals?.some(t => headers.has(String(t).toLowerCase())));
    if (overlapping) fail(`H1 pin namespace overlaps controller '${overlapping.id}'`);
    const derived = labwiredAdapterOptionsFor({ netlist: board, chipKind: ESP32_S040_PART_KIND,
      labwiredBoardId: ESP32_S040_BOARD_ID, mcuId: selected.id, name });
    systemYaml = derived.systemYaml;
    pins = derived.pins;
    mcuId = selected.id;
    refusals = derived.refusals;
    const physicalTerminals = new Map(board.parts.map(part => [part.id,
      new Set((part.terminals ?? []).map(terminal => String(terminal).toLowerCase()))]));
    connectedPins = Object.keys(pins).filter(pin => board.nets.some(net =>
      net.terminals.some(t => t.part === mcuId && String(t.terminal).toLowerCase() === pin) &&
      net.terminals.some(t => (t.part !== mcuId || String(t.terminal).toLowerCase() !== pin) &&
        physicalTerminals.get(t.part)?.has(String(t.terminal).toLowerCase()))));
  }
  const displays = Object.freeze(catalog.displays.map(d => Object.freeze({ id: d.id, type: d.type })));
  return {
    chipYaml: chip.chipYaml, clockHz: chip.clockHz, systemYaml, pins,
    firmwareOnly, connectedPins: Object.freeze(connectedPins),
    metadata: Object.freeze({ id: ESP32_S040_BOARD_ID, partKind: ESP32_S040_PART_KIND,
      sourceCommit: LABWIRED_CATALOG_PIN, mcuId, displays, refusals: Object.freeze(refusals) }),
  };
}

/**
 * The S040 host owns one explicit touch transaction, never H1 electrical
 * inputs. All rows are checked before the backend sees any of them.
 */
export function validateEsp32S040Inputs (rows) {
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.component !== 'touch' || !['x', 'y', 'pressed'].includes(row.channel) ||
        !Number.isInteger(row.value) || row.value < 0 || row.value > (row.channel === 'pressed' ? 1 : 479)) {
      fail('touch inputs need component touch, integer x/y 0..479 or pressed 0/1');
    }
    if (seen.has(row.channel)) fail('a touch transaction cannot repeat a channel');
    if (row.channel === 'pressed' && i !== rows.length - 1) fail('pressed must follow coordinates in a touch transaction');
    if (row.channel === 'pressed' && row.value === 1 && (!seen.has('x') || !seen.has('y'))) {
      fail('touch down requires x and y before pressed');
    }
    seen.add(row.channel);
  }
}

/**
 * Read exactly the S040 H1 configuration, including bank 1. GPIO OUT/ENABLE,
 * PINn, FUNCn_OUT_SEL and IO_MUX_GPIOn have side-effect-free reads in the
 * qualified supplier model. This is not a general MMIO snapshot API.
 */
export function readEsp32S040PadConfiguration (sim) {
  if (typeof sim.read_memory !== 'function') fail('engine needs GPIO configuration reads');
  const word = address => {
    const bytes = sim.read_memory(address, 4);
    if (!bytes || bytes.length !== 4 || Array.from(bytes).some(b => !Number.isInteger(b) || b < 0 || b > 255)) {
      fail('GPIO configuration read is incomplete');
    }
    return new DataView(Uint8Array.from(bytes).buffer).getUint32(0, true);
  };
  const gpio = 0x60004000;
  const out = [word(gpio + 0x04), word(gpio + 0x10)];
  const enable = [word(gpio + 0x20), word(gpio + 0x2c)];
  return Object.entries(ESP32_4848S040_LABWIRED_PINS).map(([name, { pin }]) => {
    const bank = Math.floor(pin / 32), bit = pin % 32;
    const control = word(gpio + 0x74 + 4 * pin);
    const mux = word(0x60009000 + 0x04 + 4 * pin);
    const matrix = word(gpio + 0x554 + 4 * pin);
    return { name, pin,
      enabled: ((enable[bank] >>> bit) & 1) === 1,
      outputHigh: ((out[bank] >>> bit) & 1) === 1,
      openDrain: (control & (1 << 2)) !== 0, // PAD_DRIVER, not INT_TYPE bit 7
      pullUp: (mux & (1 << 8)) !== 0, pullDown: (mux & (1 << 7)) !== 0,
      inputEnabled: (mux & (1 << 9)) !== 0, matrixOutput: matrix & 0x1ff,
      function: (mux >>> 12) & 7,
      gpioFunction: ((mux >>> 12) & 7) === 1 || (pin < 3 && ((mux >>> 12) & 7) === 0),
      outputInverted: (matrix & (1 << 9)) !== 0,
      outputEnableInverted: (matrix & (1 << 11)) !== 0,
      // OUT is included: release can change while the external wire stays low.
      signature: `${out[bank]}|${enable[bank]}|${control}|${mux}|${matrix}`,
    };
  });
}

/** Admit a self-addressed little-endian Xtensa executable, not an ARM UF2 wrapper. */
export function validateEsp32S040Elf (bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 52 ||
      bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46 ||
      bytes[4] !== 1 || bytes[5] !== 1 || bytes[6] !== 1) {
    fail('firmware needs an addressed ELF32 little-endian Xtensa executable or explicit merged flash');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(16, true) !== 2 || view.getUint16(18, true) !== 94 || view.getUint32(20, true) !== 1) {
    fail('ELF must be an EM_XTENSA executable (not another CPU or a relocatable object)');
  }
  const entry = view.getUint32(24, true), offset = view.getUint32(28, true);
  const stride = view.getUint16(42, true), count = view.getUint16(44, true);
  if (!count || stride !== 32 || offset < 52 || offset + count * stride > bytes.length) {
    fail('ELF program headers are absent or truncated');
  }
  let executableEntry = false;
  for (let i = 0; i < count; i++) {
    const at = offset + i * stride;
    if (view.getUint32(at, true) !== 1) continue;
    const fileOffset = view.getUint32(at + 4, true), address = view.getUint32(at + 8, true);
    const size = view.getUint32(at + 16, true), memorySize = view.getUint32(at + 20, true);
    if (size > memorySize || fileOffset + size > bytes.length || address + memorySize > 0x100000000) {
      fail('ELF load segment has invalid file or memory bounds');
    }
    if ((view.getUint32(at + 24, true) & 1) && entry >= address && entry < address + size) executableEntry = true;
  }
  if (!executableEntry) fail('ELF entry is not covered by executable load bytes');
}
