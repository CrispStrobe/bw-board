import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDebugTarget } from '../src/debug-target-factory.js';
import { createLabwiredDebugTarget } from '../src/labwired-debug.js';
import { createLabwiredAdapter } from '../src/labwired-adapter.js';
import { LABWIRED_BOARDS, LABWIRED_CATALOG } from '../src/labwired-catalog.js';
import { ESP32_4848S040_LABWIRED_PINS } from '../src/labwired-chips.js';
import { buildLabwiredSystem, labwiredAdapterOptionsFor } from '../src/labwired-bridge.js';
import { ESP32_S040_BOARD_ID, ESP32_S040_PART_KIND, ESP32_S040_TERMINALS,
  readEsp32S040PadConfiguration, validateEsp32S040Inputs, validateEsp32S040Elf } from '../src/labwired-board-profile.js';
import { ESP32S3_FLASH_BOOT_KIND, ESP32S3_FLASH_BOOT_ROMS } from '../src/labwired-firmware-boot.js';
import { BoardImpl } from '../src/board.js';
import { registerBoardKinds } from '../src/devices/board-kinds.js';
import { getDevice } from '../src/devices.js';

registerBoardKinds();
const ELF = (() => {
  const bytes = new Uint8Array(87), v = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1]);
  v.setUint16(16, 2, true); v.setUint16(18, 94, true); v.setUint32(20, 1, true);
  v.setUint32(24, 0x40370000, true); v.setUint32(28, 52, true);
  v.setUint16(40, 52, true); v.setUint16(42, 32, true); v.setUint16(44, 1, true);
  v.setUint32(52, 1, true); v.setUint32(56, 84, true); v.setUint32(60, 0x40370000, true);
  v.setUint32(64, 0x40370000, true); v.setUint32(68, 3, true); v.setUint32(72, 3, true);
  v.setUint32(76, 5, true); v.setUint32(80, 4, true); bytes.set([6, 255, 255], 84); // Xtensa j .
  return bytes;
})();
const H1 = Object.keys(ESP32_4848S040_LABWIRED_PINS);
const GPIO = 0x60004000, MUX = 0x60009000;
const terminal = (part, terminal) => ({ part, terminal });
const part = (id = 'panel') => ({ id, kind: ESP32_S040_PART_KIND, params: {}, terminals: [...ESP32_S040_TERMINALS] });
function boardWith (pin = 'gpio40') {
  const board = new BoardImpl(5);
  board.setNetlist([part(), { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }], [
    { id: 'pad', terminals: [terminal('panel', pin), terminal('R', 'a')] },
    { id: 'ground', terminals: [terminal('panel', 'gnd'), terminal('panel', 'gnd2'), terminal('R', 'b')] },
    { id: 'supply', terminals: [terminal('panel', '5v')] },
  ]);
  return board;
}
function boardWithSecondPin () {
  const board = boardWith();
  board.setNetlist([...board.parts,
    {id:'R44', kind:'resistor', params:{ohms:1000}, terminals:['a','b']}], [
    ...board.nets.map(net => net.id === 'ground'
      ? {...net, terminals:[...net.terminals, terminal('R44','b')]} : net),
    {id:'second', terminals:[terminal('panel','gpio44'), terminal('R44','a')]},
  ]);
  return board;
}

/** Configuration double. These tests qualify JS admission, not a real engine. */
function engineDouble () {
  const calls = [], machines = [];
  const wasm = { WasmSimulator: { new_from_config: (systemYaml, chipYaml, firmware, blobs) => {
    calls.push({ systemYaml, chipYaml, firmware, blobs });
    const registers = new Map();
    for (const n of [1, 2, 40, 43, 44]) {
      registers.set(MUX + 4 + 4 * n, 0x1b00); // this double starts with explicit GPIO function 1
      registers.set(GPIO + 0x554 + 4 * n, 256);
    }
    const reg = address => registers.get(address) ?? 0;
    const bankBit = (offset0, offset1, pin) => ((reg(GPIO + (pin < 32 ? offset0 : offset1)) >>> (pin % 32)) & 1) !== 0;
    const external = new Map(), sets = [], reads = [];
    const sim = {
      registers, external, sets, reads, freed: false, now: 0,
      get_pc: () => 0x40370000, get_register_names: () => [], get_fault: () => null,
      read_memory(address, length) {
        reads.push([address, length]);
        const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, reg(address), true); return bytes;
      },
      pin_routing: refs => refs.map(ref => ({ ...ref, mode: !bankBit(0x20, 0x2c, ref.pin) ? 'input'
        : (reg(GPIO + 0x554 + 4 * ref.pin) & 0x1ff) === 256 ? 'output' : 'af' })),
      sample_logic_signals: refs => refs.map(ref => ({ ...ref, value: bankBit(0x20, 0x2c, ref.pin)
        ? bankBit(0x04, 0x10, ref.pin) : external.get(`gpio${ref.pin}`) ?? true })),
      watch_logic_signals: refs => sim.sample_logic_signals(refs),
      read_logic_edges: () => ({ cursor: 0, dropped: 0, nowCycle: sim.now, edges: [] }),
      set_board_io_input: (name, value) => external.set(name, value),
      set_gpio_external: (peripheral, pin, level) => {
        assert.equal(peripheral, 'gpio');
        if (level === null) external.delete(`gpio${pin}`);
        else external.set(`gpio${pin}`, level);
      },
      list_inputs: () => [
        ...['x', 'y', 'pressed'].map(key => ({ peripheral: 'touch', key, unit: key === 'pressed' ? 'bool' : 'px',
          min: 0, max: key === 'pressed' ? 1 : 479 })),
        { peripheral: 'gpio40', key: 'pressed', unit: 'bool', min: 0, max: 1 },
      ],
      set_inputs: rows => { sets.push(rows); },
      free: () => { sim.freed = true; },
      step_batch: steps => { sim.now += steps; },
    };
    machines.push(sim);
    return sim;
  } } };
  return { wasm, calls, machines };
}
const options = (e, extra = {}) => ({ wasm: e.wasm, firmware: ELF,
  labwiredBoardId: ESP32_S040_BOARD_ID, ...extra });
function structuralFlash () {
  const bytes = new Uint8Array(0x10030).fill(0xff), v = new DataView(bytes.buffer);
  for (const at of [0, 0x10000]) {
    bytes.fill(0, at, at + 48); bytes.set([0xe9, 1, 2, 0x20], at);
    v.setUint16(at + 12, 9, true); v.setUint32(at + 24, 0x40370000, true);
    v.setUint32(at + 28, 3, true); bytes.set([6, 255, 255], at + 32);
    bytes[at + 47] = 0xef ^ 6 ^ 255 ^ 255;
  }
  v.setUint16(0x8000, 0x50aa, true); bytes[0x8002] = 0; bytes[0x8003] = 0;
  v.setUint32(0x8004, 0x10000, true); v.setUint32(0x8008, 0x10000, true);
  return bytes;
}

describe('S040 H1 electrical model', () => {
  it('registers only H1 and separates the 5 V supply from 3.3 V GPIO', () => {
    const model = getDevice(ESP32_S040_PART_KIND);
    assert.deepEqual(model.terminals, ESP32_S040_TERMINALS);
    assert.equal(model.vcc, 3.3);
    assert.equal(model.gpioFollowsPinStates, true);
    assert.deepEqual([...model.automaticSupplyFallbackTerminals], ['5v']);
    const board = boardWith();
    assert.ok(Math.abs(board.nodeVoltage('supply') - 5) < 0.001);
    board.setPin('gpio40', 'pushpull', true);
    // Board's declared 25 ohm output, 1k load and 0.1 ohm ground source.
    const expected = 3.3 * (1000 + 0.1) / (1000 + 25 + 0.1);
    assert.ok(Math.abs(board.nodeVoltage('pad') - expected) < 0.001);
    assert.ok(board.nodeVoltage('pad') < 3.3, 'the 5 V board supply cannot become a GPIO level');
    assert.throws(() => board.setNetlist([{ ...part(), terminals: [...ESP32_S040_TERMINALS, 'gpio19'] }], []), /terminal|gpio19/i);
  });
  it('the ordinary circuit route cannot silently omit the trusted assembly', () => {
    const result = buildLabwiredSystem({ netlist: boardWith(), chipKind: ESP32_S040_PART_KIND });
    assert.equal(result.ok, false);
    assert.equal(result.refusals[0].code, 'trusted-board-required');
  });
});

describe('S040 pad register contract', () => {
  it('reads only the qualified registers and keeps bank 1 distinct from bank 0', () => {
    const e = engineDouble();
    const sim = e.wasm.WasmSimulator.new_from_config();
    sim.registers.set(GPIO + 0x04, (1 << 1) | (1 << 12));
    sim.registers.set(GPIO + 0x10, (1 << 8) | (1 << 11));
    sim.registers.set(GPIO + 0x20, 1 << 2);
    sim.registers.set(GPIO + 0x2c, (1 << 8) | (1 << 11));
    sim.registers.set(GPIO + 0x74 + 4 * 40, 1 << 2);
    sim.registers.set(GPIO + 0x74 + 4 * 43, 1 << 7); // INT_TYPE is not PAD_DRIVER
    sim.registers.set(MUX + 4 + 4 * 40, 1 << 9);
    sim.registers.set(MUX + 4 + 4 * 43, (1 << 9) | (1 << 7));
    const rows = readEsp32S040PadConfiguration(sim);
    const at = pin => rows.find(row => row.pin === pin);
    assert.deepEqual(rows.map(row => row.pin), [40, 44, 2, 43, 1]);
    assert.deepEqual([at(40).enabled, at(40).outputHigh, at(40).openDrain, at(40).pullUp], [true, true, true, false]);
    assert.deepEqual([at(43).enabled, at(43).outputHigh, at(43).openDrain, at(43).pullDown], [true, true, false, true]);
    assert.deepEqual([at(44).enabled, at(44).outputHigh, at(44).pullUp], [false, false, true]);
    assert.deepEqual([at(1).enabled, at(1).outputHigh, at(2).enabled], [false, true, true]);
    assert.deepEqual([at(40).function, at(40).gpioFunction, at(44).function, at(44).gpioFunction], [0, false, 1, true]);
    const expected = [GPIO + 4, GPIO + 0x10, GPIO + 0x20, GPIO + 0x2c,
      ...[40, 44, 2, 43, 1].flatMap(n => [GPIO + 0x74 + 4 * n, MUX + 4 + 4 * n, GPIO + 0x554 + 4 * n])];
    assert.deepEqual(sim.reads, expected.map(address => [address, 4]), 'no broad MMIO sweep or side-effect register');
  });
  it('refuses missing, partial and invalid reads and preserves engine failures', () => {
    assert.throws(() => readEsp32S040PadConfiguration({}), /configuration reads/);
    for (const bytes of [null, [0], [0, 0, 0, 256], [0, 0, 0, NaN]]) {
      assert.throws(() => readEsp32S040PadConfiguration({ read_memory: () => bytes }), /incomplete/);
    }
    assert.throws(() => readEsp32S040PadConfiguration({ read_memory() { throw Error('MMIO refused'); } }), /MMIO refused/);
  });
});

describe('S040 typed touch contract', () => {
  it('admits explicit ordered down, move and release transactions', () => {
    for (const rows of [
      [{ channel: 'x', value: 0 }, { channel: 'y', value: 479 }, { channel: 'pressed', value: 1 }],
      [{ channel: 'x', value: 479 }, { channel: 'y', value: 0 }],
      [{ channel: 'pressed', value: 0 }], [],
    ]) validateEsp32S040Inputs(rows.map(row => ({ component: 'touch', ...row })));
  });
  it('refuses aliasing, out-of-range/fractional values, duplicate channels and press-before-position', () => {
    for (const row of [
      { channel: 'x', value: 1 }, { component: 'gpio40', channel: 'pressed', value: 0 },
      { component: 'touch', channel: 'x', value: 480 }, { component: 'touch', channel: 'y', value: -1 },
      { component: 'touch', channel: 'x', value: 1.5 }, { component: 'touch', channel: 'pressed', value: 0.5 },
      { component: 'touch', channel: 'pressure', value: 1 },
    ]) assert.throws(() => validateEsp32S040Inputs([row]), /touch inputs/);
    const row = (channel, value) => ({ component: 'touch', channel, value });
    assert.throws(() => validateEsp32S040Inputs([row('x', 1), row('x', 2)]), /repeat/);
    assert.throws(() => validateEsp32S040Inputs([row('pressed', 1), row('x', 1)]), /follow/);
    assert.throws(() => validateEsp32S040Inputs([row('pressed', 1)]), /requires x and y/);
  });
});

describe('S040 addressed firmware admission', () => {
  it('accepts a complete Xtensa load image and rejects wrong architecture, entry and truncated segments', () => {
    validateEsp32S040Elf(ELF);
    for (const [offset, value, size, error] of [
      [18, 40, 2, /EM_XTENSA/], [16, 1, 2, /EM_XTENSA/],
      [24, 0x80000000, 4, /entry/], [28, 1000, 4, /program headers/],
      [56, 86, 4, /segment/], [68, 4, 4, /segment/], [76, 4, 4, /entry/],
    ]) {
      const bytes = Uint8Array.from(ELF), v = new DataView(bytes.buffer);
      if (size === 2) v.setUint16(offset, value, true); else v.setUint32(offset, value, true);
      assert.throws(() => validateEsp32S040Elf(bytes), error);
    }
  });
});

describe('S040 panel projection', () => {
  function fixture () {
    const state = { generation: 'first', display_on: true, sleeping: false,
      backlight_on: true, powered: true, frames_received: 0 };
    const bytes = new Uint8Array(480 * 480 * 2);
    bytes.set([0xf8, 0x00], 0); bytes.set([0x07, 0xe0], 479 * 2);
    bytes.set([0x00, 0x1f], 480 * 2); bytes.set([0xff, 0xff], (480 * 480 - 1) * 2);
    const output = { format: 'rgb565_be', width: 480, height: 480, bytes };
    let fullReads = 0;
    const sim = { get_pc: () => 0, get_display: (_id, withBytes) => {
      if (withBytes) fullReads++;
      return { ...output, bytes: withBytes ? output.bytes : undefined, meta: { ...state } };
    }, snapshot_save: () => '{}', snapshot_restore() {} };
    const target = createLabwiredDebugTarget({ displays: [{ id: 'display', type: 'st7701-rgb' }],
      adapter: { sim, firmwareOnly: true, clockHz: 240_000_000, timeNs: () => 0n, pump() {} } });
    return { state, output, target, fullReads: () => fullReads };
  }
  it('waits for actual firmware pixels and decodes independent corners and row stride', () => {
    const f = fixture();
    assert.equal(f.target.video(), null);
    assert.equal(f.fullReads(), 0);
    f.state.frames_received = 1;
    const frame = f.target.video();
    assert.deepEqual([frame.width, frame.height, frame.signal], [480, 480, true]);
    const pixel = n => Array.from(frame.rgba.subarray(4 * n, 4 * n + 4));
    assert.deepEqual(pixel(0), [255, 0, 0, 255]);
    assert.deepEqual(pixel(479), [0, 255, 0, 255]);
    assert.deepEqual(pixel(480), [0, 0, 255, 255]);
    assert.deepEqual(pixel(480 * 480 - 1), [255, 255, 255, 255]);
    assert.equal(f.target.video(), frame);
    assert.equal(f.fullReads(), 1);
  });
  it('power, sleep, display and backlight state invalidate a same-generation frame', () => {
    const f = fixture(); f.state.frames_received = 1;
    let previous = f.target.video();
    for (const [key, off] of [['powered', false], ['sleeping', true], ['display_on', false], ['backlight_on', false]]) {
      const before = f.state[key]; f.state[key] = off;
      const frame = f.target.video();
      assert.notEqual(frame, previous);
      assert.equal(frame.signal, false, key);
      assert.deepEqual(Object.keys(frame.panel).sort(), ['backlightOn', 'displayOn', 'framesReceived', 'powered', 'sleeping']);
      f.state[key] = before; previous = f.target.video();
      assert.equal(previous.signal, true);
    }
  });
  it('rejects missing state, wrong geometry/format and partial/invalid pixels', () => {
    for (const mutate of [
      f => { delete f.state.powered; }, f => { f.state.frames_received = -1; },
      f => { f.output.width = 479; }, f => { f.output.height = 481; },
      f => { f.output.format = 'rgb888'; }, f => { f.output.bytes = new Uint8Array(2); },
      f => { f.output.bytes = Array(480 * 480 * 2).fill(0); f.output.bytes[7] = 256; },
    ]) {
      const f = fixture(); f.state.frames_received = 1; mutate(f);
      assert.equal(f.target.video(), null);
    }
  });
  it('reset and restore discard pixels cached under a reused engine generation', () => {
    const f = fixture(); f.state.frames_received = 1;
    const first = f.target.video();
    f.output.bytes.set([0x07, 0xe0]);
    f.target.reset();
    const reset = f.target.video();
    assert.notEqual(reset, first);
    assert.deepEqual(Array.from(reset.rgba.subarray(0, 4)), [0, 255, 0, 255]);
    assert.ok(reset.frame > first.frame, 'host frame serial remains monotonic across an engine reset');
    f.output.bytes.set([0x00, 0x1f]);
    assert.equal(f.target.restoreSnapshot(0), undefined);
    assert.deepEqual(Array.from(f.target.video().rgba.subarray(0, 4)), [0, 0, 255, 255]);
  });
});

describe('ESP32-4848S040 trusted factory', () => {
  it('does not lose the trusted identity when low-level bridge options are copied', () => {
    const e = engineDouble(), board = boardWith();
    const derived = labwiredAdapterOptionsFor({netlist: board, chipKind: ESP32_S040_PART_KIND,
      labwiredBoardId: ESP32_S040_BOARD_ID, firmware: ELF});
    assert.equal(derived.labwiredBoardId, ESP32_S040_BOARD_ID);
    assert.throws(() => createLabwiredAdapter({wasm: e.wasm, ...derived, board}), /competing configuration/);
    assert.equal(e.calls.length, 0, 'derived YAML cannot silently select the generic electrical adapter');
  });
  it('selects the exact catalog assembly for firmware-only ELF and preserves reset copies', async () => {
    const e = engineDouble(), firmware = Uint8Array.from(ELF);
    const { adapter, target, refusals } = await createDebugTarget('labwired', options(e, { firmware }));
    assert.deepEqual(refusals, []);
    assert.equal(adapter.firmwareOnly, true);
    assert.deepEqual(adapter.pins, {});
    assert.equal(e.calls[0].chipYaml, LABWIRED_CATALOG.esp32s3.chipYaml);
    assert.equal(e.calls[0].systemYaml, LABWIRED_BOARDS[ESP32_S040_BOARD_ID].systemYaml);
    assert.deepEqual(adapter.labwiredBoard.displays, [{ id: 'display', type: 'st7701-rgb' }]);
    firmware.fill(0);
    target.reset();
    assert.equal(e.machines[0].freed, true);
    assert.deepEqual(e.calls[1].firmware, ELF);
  });
  it('binds only the actual connected H1 nets and retains internal panel/touch devices', async () => {
    const e = engineDouble(), board = boardWith('gpio40');
    const { adapter } = await createDebugTarget('labwired', options(e, { board, mcuId: 'panel' }));
    assert.equal(adapter.firmwareOnly, false);
    assert.equal(adapter.labwiredBoard.mcuId, 'panel');
    assert.deepEqual(Object.keys(adapter.pins), H1);
    const yaml = e.calls[0].systemYaml;
    assert.match(yaml, /type: "st7701-rgb"/); assert.match(yaml, /type: "gt911"/);
    assert.match(yaml, /board_io: \[\]/, 'no resident Button may apply a hidden input level at construction');
    assert.doesNotMatch(yaml, /kind: button|id: "gpio40"|id: "gpio44"/);
    assert.deepEqual([...e.machines[0].external.keys()], ['gpio40']);
  });
  it('composes explicit merged flash with the trusted assembly and keeps reset ROM/flash copies', async () => {
    const e = engineDouble(), firmware = structuralFlash();
    const firmwareBoot = { kind: ESP32S3_FLASH_BOOT_KIND, console: 'uart0',
      irom: new Uint8Array(ESP32S3_FLASH_BOOT_ROMS.irom.bytes).fill(11),
      drom: new Uint8Array(ESP32S3_FLASH_BOOT_ROMS.drom.bytes).fill(17) };
    const { adapter, target } = await createDebugTarget('labwired', options(e,
      { firmware, firmwareBoot, board: boardWith('gpio44') }));
    assert.equal(adapter.firmwareOnly, false);
    assert.equal(adapter.firmwareBoot.boardId, ESP32_S040_BOARD_ID);
    assert.deepEqual(adapter.firmwareBoot.appOffsets, [0x10000]);
    assert.match(adapter.systemYaml, /type: "st7701-rgb"/);
    assert.match(adapter.systemYaml, /type: "gt911"/);
    assert.match(adapter.systemYaml, /board_io: \[\]/);
    assert.match(adapter.systemYaml, /debug_uart: "uart0"/);
    assert.equal(e.calls[0].firmware.length, 0);
    const copies = Object.fromEntries(Object.entries(e.calls[0].blobs).map(([k, b]) => [k, Uint8Array.from(b)]));
    firmware.fill(0); firmwareBoot.irom.fill(0); firmwareBoot.drom.fill(0);
    target.reset();
    assert.equal(e.machines[0].freed, true);
    assert.deepEqual(e.calls[1].blobs, copies);
    assert.equal(e.calls[1].systemYaml, e.calls[0].systemYaml);
  });
  it('publishes direction/pull changes without a logic edge, at 3.3 V', async () => {
    const e = engineDouble(), board = boardWith('gpio40');
    const { adapter } = await createDebugTarget('labwired', options(e, { board }));
    const sim = adapter.sim;
    assert.equal(board.pinStates.get('gpio40').mode, 'input-pullup');
    sim.registers.set(GPIO + 0x2c, 1 << 8); sim.registers.set(GPIO + 0x10, 1 << 8);
    adapter.pump();
    assert.deepEqual({ mode: board.pinStates.get('gpio40').mode, high: board.pinStates.get('gpio40').driveHigh },
      { mode: 'pushpull', high: true });
    assert.ok(board.nodeVoltage('pad') > 3.2 && board.nodeVoltage('pad') < 3.3);
    sim.registers.set(GPIO + 0x2c, 0); sim.registers.set(MUX + 4 + 4 * 40, (1 << 12) | (1 << 9) | (1 << 7));
    adapter.pump();
    assert.equal(board.pinStates.get('gpio40').mode, 'input-pulldown');
    assert.equal(sim.external.get('gpio40'), false);
  });
  it('isolates reset bank-1 peripheral mux until GPIO is selected and clears a later output-only remux', async () => {
    const e = engineDouble(), create = e.wasm.WasmSimulator.new_from_config;
    e.wasm.WasmSimulator.new_from_config = (...args) => {
      const sim = create(...args);
      sim.registers.set(MUX + 4 + 4 * 40, 0xb00); // FUNC0=MTDO, not GPIO
      return sim;
    };
    const board = boardWith();
    const { adapter, target } = await createDebugTarget('labwired', options(e, { board }));
    const sim = adapter.sim;
    assert.equal(target.diagnostics().boardElectrical.state, 'pending');
    assert.equal(target.diagnostics().boardElectrical.pads[0].function, 0);
    assert.equal(board.pinStates.get('gpio40').mode, 'input');
    assert.equal(sim.external.has('gpio40'), false);
    sim.registers.set(GPIO + 0x2c, 1 << 8); sim.registers.set(GPIO + 0x10, 1 << 8);
    adapter.pump();
    assert.ok(board.nodeVoltage('pad') < 0.001, 'GPIO enable/latch cannot bypass peripheral mux');
    sim.registers.set(MUX + 4 + 4 * 40, 0x1b00); adapter.pump();
    assert.equal(target.diagnostics().boardElectrical.state, 'ready');
    assert.equal(board.pinStates.get('gpio40').mode, 'pushpull');
    assert.ok(board.nodeVoltage('pad') > 3.2);
    assert.equal(sim.external.has('gpio40'), false, 'an ordinary output receives no external hold');
    sim.registers.set(MUX + 4 + 4 * 40, 0xb00); adapter.pump();
    assert.equal(target.diagnostics().boardElectrical.state, 'pending');
    assert.equal(board.pinStates.get('gpio40').mode, 'input');
    assert.ok(board.nodeVoltage('pad') < 0.001, 'our former output is electrically isolated');
    target.reset();
    assert.equal(target.diagnostics().boardElectrical.state, 'pending');
  });
  it('releases an external hold on peripheral remux and target detachment', async () => {
    const e = engineDouble(), board = boardWith();
    const { adapter, target } = await createDebugTarget('labwired', options(e, { board }));
    const sim = adapter.sim;
    assert.equal(sim.external.has('gpio40'), true);
    sim.registers.set(MUX + 4 + 4 * 40, 0xb00);
    adapter.pump();
    assert.equal(target.diagnostics().boardElectrical.state, 'pending');
    assert.equal(board.pinStates.get('gpio40').mode, 'input');
    assert.equal(sim.external.has('gpio40'), false, 'remux actually releases the engine input, not just the Board output');
    assert.ok(board.nodeVoltage('pad') < 0.001);
    sim.registers.set(MUX + 4 + 4 * 40, 0x1b00); adapter.pump();
    assert.equal(target.diagnostics().boardElectrical.state, 'ready');
    assert.equal(sim.external.has('gpio40'), true);
    target.detach();
    assert.equal(sim.external.has('gpio40'), false);
    assert.equal(board.pinStates.get('gpio40').mode, 'input');
    assert.equal(target.runFor(1_000_000), 'idle');
  });
  it('halts before resume if an actual external-pad release fails', async () => {
    const e = engineDouble(), board = boardWith();
    const { adapter, target } = await createDebugTarget('labwired', options(e, { board }));
    const sim = adapter.sim;
    sim.set_gpio_external = () => { throw Error('pad release refused'); };
    sim.registers.set(MUX + 4 + 4 * 40, 0xb00);
    assert.throws(() => adapter.pump(), /release failed.*reset required/);
    assert.equal(target.diagnostics().boardElectrical.state, 'refused');
    assert.equal(board.pinStates.get('gpio40').mode, 'input');
    target.run(); assert.equal(target.runFor(1_000_000), 'halted');
    assert.equal(sim.now, 0, 'resume must not retire instructions with a stale external level');
    target.reset();
    assert.equal(target.diagnostics().boardElectrical.state, 'ready');
  });
  it('isolates previously seated outputs when a later construction-time input fails', async () => {
    const e = engineDouble(), create = e.wasm.WasmSimulator.new_from_config;
    e.wasm.WasmSimulator.new_from_config = (...args) => {
      const sim = create(...args);
      sim.registers.set(GPIO + 0x2c, 1 << 8); sim.registers.set(GPIO + 0x10, 1 << 8);
      const set = sim.set_gpio_external;
      sim.set_gpio_external = (peripheral, pin, level) => {
        if (pin === 44) throw Error('late input failed');
        return set(peripheral, pin, level);
      };
      return sim;
    };
    const board = boardWithSecondPin();
    await assert.rejects(createDebugTarget('labwired', options(e, { board })), /late input failed/);
    assert.equal(e.machines[0].freed, true);
    assert.equal(board.pinStates.get('gpio40').mode, 'input');
    assert.ok(board.nodeVoltage('pad') < 0.001, 'failed construction cannot leave a former output driven');
  });
  it('continues all releases and listener cleanup after one backend release fails', async () => {
    const e = engineDouble(), board = boardWithSecondPin();
    const { adapter, target } = await createDebugTarget('labwired', options(e, { board }));
    const sim = adapter.sim, set = sim.set_gpio_external, attempted = [];
    assert.deepEqual([...sim.external.keys()], ['gpio40', 'gpio44']);
    sim.set_gpio_external = (peripheral, pin, level) => {
      attempted.push([pin, level]);
      if (pin === 40 && level === null) throw Error('first release failed');
      return set(peripheral, pin, level);
    };
    let staleHalts = 0;
    target.onHalt(() => { staleHalts++; });
    assert.throws(() => target.destroy(), /first release failed/);
    assert.deepEqual(attempted, [[40, null], [44, null]]);
    assert.equal(sim.external.has('gpio44'), false);
    for (const pin of H1) assert.equal(board.pinStates.get(pin).mode, 'input');
    target.run(); target.halt();
    assert.equal(staleHalts, 0, 'destroy must clear listeners even when circuit release reports an error');
    assert.equal(target.runFor(1000), 'idle');
    sim.set_gpio_external = set;
    target.destroy(); // a later cleanup can retry the one failed hold
    assert.equal(sim.external.size, 0);
  });
  it('distinguishes singleton or invalid nets from an actual same-board ground wire', async () => {
    const e = engineDouble(), board = boardWith();
    board.setNetlist(board.parts, [...board.nets.map(net => net.id === 'ground'
      ? {...net, terminals:[...net.terminals, terminal('panel','gpio1')]} : net),
      {id:'singleton', terminals:[terminal('panel','gpio44')]},
      {id:'self', terminals:[terminal('panel','gpio43'), terminal('panel','gpio43')]},
      {id:'nonexistent', terminals:[terminal('panel','gpio2'), terminal('R','not-a-terminal')]},
    ]);
    const { adapter, target } = await createDebugTarget('labwired', options(e, { board }));
    assert.deepEqual([...adapter.sim.external.keys()], ['gpio40', 'gpio1']);
    assert.equal(adapter.sim.external.get('gpio1'), false);
    assert.deepEqual(target.diagnostics().boardElectrical.pads.map(row => row.name), ['gpio40', 'gpio1']);
    target.destroy();
  });
  it('keeps an externally low open-drain release distinct from a driven low latch', async () => {
    const e = engineDouble(), board = boardWith('gpio40');
    const { adapter } = await createDebugTarget('labwired', options(e, { board }));
    const sim = adapter.sim;
    sim.registers.set(GPIO + 0x2c, 1 << 8); sim.registers.set(GPIO + 0x10, 1 << 8);
    sim.registers.set(GPIO + 0x74 + 4 * 40, 1 << 2);
    sim.registers.set(MUX + 4 + 4 * 40, (1 << 12) | (1 << 9));
    // The real external 1k to ground keeps the released wire low.
    sim.sample_logic_signals = refs => refs.map(ref => ({ ...ref, value: false }));
    adapter.pump();
    assert.equal(board.pinStates.get('gpio40').mode, 'opendrain');
    assert.equal(board.pinStates.get('gpio40').driveHigh, true);
    assert.equal(sim.external.get('gpio40'), false);
    assert.ok(board.nodeVoltage('pad') < 0.001);
    sim.registers.set(GPIO + 0x10, 0); adapter.pump();
    assert.equal(board.pinStates.get('gpio40').driveHigh, false);
  });
  it('refuses alternate-function and unsupported pull combinations instead of inventing electrical drive', async () => {
    for (const [address, value, message] of [
      [GPIO + 0x554 + 4 * 40, 73, /alternate-function/],
      [GPIO + 0x554 + 4 * 40, 256 | (1 << 9), /inverted GPIO matrix/],
      [GPIO + 0x554 + 4 * 40, 256 | (1 << 11), /inverted GPIO matrix/],
      [MUX + 4 + 4 * 40, (1 << 12) | (1 << 8) | (1 << 7), /simultaneous/],
      [MUX + 4 + 4 * 40, (1 << 12) | (1 << 8), /disabled input-buffer/],
    ]) {
      const e = engineDouble();
      const board = boardWith();
      const { adapter, target } = await createDebugTarget('labwired', options(e, { board }));
      adapter.sim.registers.set(address, value);
      assert.throws(() => adapter.pump(), message);
      assert.equal(target.diagnostics().boardElectrical.state, 'refused');
      assert.equal(adapter.sim.external.has('gpio40'), false);
      assert.equal(board.pinStates.get('gpio40').mode, 'input');
    }
  });
  it('refuses a missing/aliased bank-1 surface before seating any pin and frees the failed machine', async () => {
    for (const mutate of [
      sim => { sim.pin_routing = () => null; },
      sim => { const prior = sim.pin_routing; sim.pin_routing = refs => prior(refs).map(row => ({ ...row, pin: row.pin % 32 })); },
      sim => { sim.watch_logic_signals = refs => refs.map(ref => ({ ...ref, value: null })); },
      sim => { sim.set_gpio_external = undefined; },
    ]) {
      const e = engineDouble(), create = e.wasm.WasmSimulator.new_from_config;
      e.wasm.WasmSimulator.new_from_config = (...args) => { const sim = create(...args); mutate(sim); return sim; };
      const board = boardWith();
      await assert.rejects(createDebugTarget('labwired', options(e, { board })), /H1 GPIO|external GPIO drive\/release/);
      assert.equal(board.pinStates.size, 0);
      assert.equal(e.machines[0].freed, true);
    }
  });
  it('refuses an analog source on H1 instead of coercing its voltage to a digital input', async () => {
    const e = engineDouble(), board = new BoardImpl(3.3);
    board.setNetlist([part(), {id: 'pot', kind: 'potentiometer', params: {ohms: 10000}, terminals: ['a', 'wiper', 'b']},
      {id: 'logic', kind: 'vcc', params: {volts: 3.3}, terminals: ['vcc']},
      {id: 'gnd', kind: 'gnd', params: {}, terminals: ['gnd']}], [
      {id: 'pad', terminals: [terminal('panel', 'gpio1'), terminal('pot', 'wiper')]},
      {id: 'high', terminals: [terminal('pot', 'a'), terminal('logic', 'vcc')]},
      {id: 'ground', terminals: [terminal('pot', 'b'), terminal('panel', 'gnd'), terminal('gnd', 'gnd')]},
    ]);
    await assert.rejects(createDebugTarget('labwired', options(e, { board })), /no ADC channel/);
    assert.equal(e.calls.length, 0);
  });
  it('touch discovery excludes circuit-owned GPIO inputs; invalid later rows are atomic', async () => {
    const e = engineDouble();
    const { adapter, target } = await createDebugTarget('labwired', options(e));
    assert.deepEqual(adapter.discoverInputs().map(row => [row.peripheral, row.key]),
      [['touch', 'x'], ['touch', 'y'], ['touch', 'pressed']]);
    const down = [{ component: 'touch', channel: 'x', value: 12 }, { component: 'touch', channel: 'y', value: 34 },
      { component: 'touch', channel: 'pressed', value: 1 }];
    adapter.setInputs(down); assert.equal(adapter.sim.sets.length, 1);
    assert.throws(() => adapter.setInputs([...down.slice(0, 2), { component: 'touch', channel: 'pressed', value: 2 }]), /touch inputs/);
    assert.equal(adapter.sim.sets.length, 1);
    target.reset();
    adapter.setInputs([{ component: 'touch', channel: 'pressed', value: 0 }]);
    assert.equal(e.machines[0].sets.length, 1); assert.equal(e.machines[1].sets.length, 1);
    target.detach();
    assert.equal(target.setInputs(down).code, 'detached');
    assert.equal(e.machines[1].sets.length, 1);
  });
  it('refuses competing definitions, raw bins, absent firmware and invalid selected parts before machine construction', async () => {
    const e = engineDouble();
    for (const competing of [{ chip: LABWIRED_CATALOG.esp32s3 }, { chipKind: ESP32_S040_PART_KIND },
      { labwiredBoard: {} }, { softwareProfile: {} }, { chipYaml: 'arch: arm' }, { systemYaml: 'name: arbitrary' },
      { pins: {} }, { clockHz: 1 }, { firmwareAddress: 0 }, { extraSegments: [] }, { blobs: {} },
      { boardVariant: 'other' }, { arduinoEsp32: true }]) {
      await assert.rejects(createDebugTarget('labwired', options(e, competing)), /competing configuration/);
    }
    await assert.rejects(createDebugTarget('labwired', options(e, { labwiredBoardId: 'esp32s3' })), /unknown labwiredBoardId/);
    await assert.rejects(createDebugTarget('labwired', options(e, { firmware: Uint8Array.of(1) })), /addressed ELF32/);
    const uf2 = new Uint8Array(512), uf2View = new DataView(uf2.buffer);
    uf2View.setUint32(0, 0x0a324655, true); uf2View.setUint32(4, 0x9e5d5157, true);
    await assert.rejects(createDebugTarget('labwired', options(e, { firmware: uf2 })), /UF2.*Cortex-M-only/);
    await assert.rejects(createDebugTarget('labwired', options(e, { firmware: undefined })), /firmware bytes/);
    await assert.rejects(createDebugTarget('labwired', options(e, { mcuId: 'panel' })), /actual circuit/);
    await assert.rejects(createDebugTarget('labwired', options(e, { board: {} })), /actual circuit/);
    for (const mutate of [
      board => { board.parts[0].kind = 'mcu'; }, board => { board.parts[0].terminals.push('gpio19'); },
      board => { board.parts.push(part('other')); },
    ]) {
      const board = boardWith(); mutate(board);
      await assert.rejects(createDebugTarget('labwired', options(e, { board })), /actual esp32_4848s040|physical eight-terminal/);
    }
    const two = boardWith(); two.parts.push(part('other'));
    await assert.rejects(createDebugTarget('labwired', options(e, { board: two, mcuId: 'panel' })), /overlaps/);
    await assert.rejects(createDebugTarget('labwired', options(e, { board: boardWith(), mcuId: 'R' })), /actual esp32_4848s040/);
    assert.equal(e.calls.length, 0);
  });
});
