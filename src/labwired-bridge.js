/**
 * OUR netlist → THEIR system manifest: the board-manifest bridge, in the one
 * direction that keeps "one board, one truth".
 *
 * STM32-PATH.md Phase 4 left two pieces open after the wasm spike. The first,
 * the boundary-A adapter, landed in `labwired-adapter.js`; it carries a
 * deliberate SLICE of the second — one `board_io` input binding per header
 * pin, generated so `set_board_io_input` has something to resolve. This file is
 * the rest, and it starts by settling the direction, because the phrase the
 * plan used ("how their board manifests map onto our circuit model") points the
 * wrong way for the law this repo runs on.
 *
 * THE DIRECTION, AND WHY IT IS NOT THE OTHER ONE
 * ---------------------------------------------
 * The designer draws a circuit. That circuit is solved by `board.js` — an MNA
 * solver with 211 registered device models, current ratings and DRC. The law
 * every regression here has violated is ONE BOARD, ONE TRUTH: the runner's
 * board must be the designer's board. So the manifest is DERIVED from the
 * netlist, never the reverse; importing a labwired board manifest INTO our
 * circuit model would create a second drawing of the same bench that nothing
 * keeps in step.
 *
 * The consequence is the rule that decides every mapping below:
 *
 *     THE PAD IS THE BOUNDARY.
 *
 * labwired executes the firmware and owns everything on the silicon side of the
 * pad — registers, peripherals, the pad's direction and drive. Our board owns
 * everything on the other side: the resistor, the LED's I-V curve, the divider,
 * the shift register, the rail. So the manifest this file emits is a PROJECTION
 * of the netlist onto that boundary, not a translation of the circuit. It
 * declares which pads exist, which of them the board can drive, and what each
 * one is wired to — and it deliberately declines to declare `external_devices`
 * for parts our board already models, because a second model of one LED is
 * exactly the disagreement the law exists to prevent.
 *
 * That is also why an unrecognised part on an MCU net is NOT a refusal. A
 * 74HC595 hanging off PA0 needs nothing from labwired: the pad is bridged, and
 * the shift register is our board's business. What IS a refusal is a pad whose
 * behaviour the bridge cannot honestly carry — see REFUSALS below.
 *
 * WHAT THE MANIFEST CAN EXPRESS (measured against labwired-core @ 41119903c)
 * -------------------------------------------------------------------------
 * `SystemManifest` (crates/config/src/lib.rs) has 14 fields. Of those, exactly
 * two describe board wiring: `board_io` (a `BoardIoBinding` list) and
 * `external_devices`. A binding is
 * `{id, kind, peripheral, pin, signal, active_high, i2c_address?, device_type?,
 * channel?}` with `kind` drawn from SEVEN values — `led`, `button`,
 * `adc_input`, `pwm_output`, `i2c_device`, `spi_device`, `uart_device` — and
 * `signal` from `input` | `output`.
 *
 * Only ONE of those combinations changes the simulation: `kind: button` with
 * `signal: input` materialises a bus-resident contact whose level the engine
 * applies through the owning GPIO's `set_gpio_input`, and that contact is what
 * `set_board_io_input` resolves against. Every other combination is
 * observational — `read_board_io_state` reads `read_gpio_output` for `led` and
 * `pwm_output`, `get_board_io_analog_states` reads the ADC's `dr` for
 * `adc_input`, and the bus kinds return typed state instead. So an output
 * binding cannot contradict our board even in principle; it only gives the pad
 * a name that `get_board_io_states` reports under. We use our OWN part id for
 * that name, so a consumer joins labwired's answer straight onto the netlist.
 *
 * REFUSALS
 * --------
 * A refusal is a pad or a board the bridge will not pretend to have carried.
 * The ledger is a value, not a log line, and `refusalsFor()` is what a census
 * test asserts is empty for a shipped configuration. The codes:
 *
 *   chip-unmapped      the MCU kind has no heavy-tier chip descriptor
 *   mcu-absent         no controller part in the netlist
 *   mcu-ambiguous      more than one, and the heavy tier runs a single core
 *   pin-unmapped       a controller terminal carrying a real connection is not
 *                      in the chip's header map, so nothing could reach it
 *   analog-injection-unavailable
 *                      the pad's level is a VOLTAGE our board solves, and the
 *                      wasm boundary has no per-channel way to hand that
 *                      voltage to the ADC — see the note on that code below
 *
 * @module
 */

import { LABWIRED_CHIPS } from './labwired-chips.js';

/**
 * Series elements the classifier walks THROUGH to find what a pad is really
 * wired to.
 *
 * Almost every gallery bench puts a resistor between the pad and the part that
 * matters: `pa0 → R.a`, `R.b → LED.anode`. Stopping at the resistor would
 * classify 160 of the corpus's MCU attachments as "a resistor", which is true
 * and useless. Only two-terminal conductors belong here — a walk through a
 * transistor or an IC would cross a control boundary and start guessing.
 */
const SERIES = new Set(['resistor', 'fuse', 'inductor']);

/** Supply parts. Present on the MCU's own vcc/gnd terminals, and not signals. */
const RAIL = new Set(['vcc', 'gnd', 'battery', 'battery_9v', 'battery_aa',
  'battery_coin', 'solar_cell', 'lm7805', 'lm7809', 'lm7812', 'ams1117_33',
  'ams1117_50', 'ld1117v33', 'vreg']);

/**
 * Parts whose output is a LEVEL our board solves, not a logic state.
 *
 * A pad wired to one of these is an analog input: the number that matters is a
 * voltage somewhere between the rails, and reporting it as a boolean would be a
 * lie about the bench rather than a loss of precision.
 */
const ANALOG_SOURCE = new Set(['potentiometer', 'ldr', 'ntc', 'thermistor',
  'photodiode', 'phototransistor', 'tmp36', 'joystick', 'soil_moisture',
  'force_sensor', 'flex_sensor', 'hall_analog', 'ambient_light', 'flame_sensor',
  'analog_meter', 'voltmeter', 'ammeter', 'adxl335', 'memsic2125', 'msgeq7']);

/** Passive contacts: the thing `kind: button` was invented for. */
const CONTACT = new Set(['button', 'switch', 'slide_switch', 'dip_switch',
  'dip_switch_spst', 'dip_switch_dpst', 'reed_switch', 'tilt_sensor',
  'touch_ttp223', 'keypad_4x4', '74c922', 'photo_interrupter', 'ir_reflect',
  'vibration_motor', 'pir', 'hall_digital']);

/**
 * Loads and indicators a pad DRIVES. `kind: led` covers all of them: labwired
 * reads every output binding through the same `read_gpio_output` call, so the
 * kind is a label, and `led` is the label the engine's own vocabulary offers
 * for "a pad drives something".
 */
const INDICATOR = new Set(['led', 'rgb_led', 'led_7color', 'bargraph',
  'ledbank8', 'sevenseg8', 'seven_segment', 'matrix8x8', 'matrix16x8',
  'matrix9x9', 'piezo', 'buzzer', 'relay', 'relay_dpdt', 'dc_motor',
  'dc_motor_encoder', 'gearmotor', 'servo', 'solenoid', 'stepper',
  'light_bulb', 'optocoupler', 'tip120', 'darlington_driver', 'h_bridge',
  'npn', 'pnp', 'nmos', 'pmos', 'neopixel', 'logic_probe', 'heartbeat']);

/** Terminal names that are supply pins on a controller part, not I/O. */
const SUPPLY_TERMINALS = new Set(['vcc', 'vcc2', 'gnd', 'gnd2', 'avcc', 'aref',
  'vdd', 'vdda', 'vss', 'vssa']);

/**
 * Normalise a netlist-ish input to `{ parts, nets }`.
 *
 * Accepts a plain netlist, a `BoardImpl` (which carries both under the same
 * names), or `{ netlist }`. Anything else is a programming error, not a
 * refusal — a refusal is about a BENCH the bridge cannot carry, and this is
 * about a caller that passed the wrong object.
 *
 * @param {object} input
 * @returns {{parts: Array, nets: Array}}
 */
function asNetlist (input) {
  const n = input && input.netlist ? input.netlist : input;
  if (!n || !Array.isArray(n.parts) || !Array.isArray(n.nets)) {
    throw new TypeError('labwired-bridge: expected a netlist ({parts, nets}) or a board');
  }
  return { parts: n.parts, nets: n.nets };
}

/**
 * Every part reachable from `netId` without leaving the series-element family.
 *
 * Returns the FUNCTIONAL leaves — the parts that are neither the controller nor
 * a series conductor — each with the terminal it joins on and how many hops
 * away it sat. Bounded at three hops: two covers `pad → R → LED`, three covers
 * the pull-up ladders (`pad → R → button`, plus the second resistor to the
 * rail), and beyond that a walk stops being a wiring fact and starts being a
 * guess about someone's schematic.
 *
 * @param {{parts: Array, nets: Array}} nl
 * @param {string} startNetId
 * @param {string} mcuId
 * @returns {Array<{part: string, kind: string, terminal: string, hops: number}>}
 */
function reachableLeaves (nl, startNetId, mcuId) {
  const kindOf = new Map(nl.parts.map((p) => [p.id, p.kind]));
  const netsOfPart = new Map();       // "part.terminal" → netId
  const netById = new Map(nl.nets.map((n) => [n.id, n]));
  for (const net of nl.nets) {
    for (const t of net.terminals || []) netsOfPart.set(`${t.part}.${t.terminal}`, net.id);
  }

  const out = [];
  const seenNet = new Set([startNetId]);
  let frontier = [{ id: startNetId, hops: 0 }];
  while (frontier.length) {
    const next = [];
    for (const { id, hops } of frontier) {
      const net = netById.get(id);
      if (!net) continue;
      for (const t of net.terminals || []) {
        if (t.part === mcuId) continue;
        const kind = kindOf.get(t.part);
        if (kind === undefined) continue;
        if (SERIES.has(kind) && hops < 3) {
          // Walk out of the other end of the two-terminal element.
          for (const other of ['a', 'b']) {
            if (other === t.terminal) continue;
            const nid = netsOfPart.get(`${t.part}.${other}`);
            if (nid && !seenNet.has(nid)) { seenNet.add(nid); next.push({ id: nid, hops: hops + 1 }); }
          }
          continue;
        }
        out.push({ part: t.part, kind, terminal: t.terminal, hops });
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Decide what one pad IS, from the parts reachable from it.
 *
 * Order matters and is deliberate: analog beats contact beats indicator. A
 * bench that wires a pot wiper AND an indicator to the same pad is telling us
 * the pad reads a voltage; a bench with a button and a pull-up resistor to the
 * rail is telling us the pad reads a contact. `digital` is the honest default
 * for everything else INCLUDING parts this table has never heard of, because
 * the pad is the boundary — a shift register, an ultrasonic module or a part
 * that does not exist yet all need the same thing from labwired (a drivable,
 * observable pad) and all get their behaviour from our board.
 *
 * @param {Array<{kind: string}>} leaves
 * @returns {'analog'|'contact'|'indicator'|'digital'|'rail'|'floating'}
 */
export function classifyAttachment (leaves) {
  if (!leaves.length) return 'floating';
  const kinds = leaves.map((l) => l.kind);
  if (kinds.some((k) => ANALOG_SOURCE.has(k))) return 'analog';
  if (kinds.some((k) => CONTACT.has(k))) return 'contact';
  if (kinds.some((k) => INDICATOR.has(k))) return 'indicator';
  if (kinds.every((k) => RAIL.has(k))) return 'rail';
  return 'digital';
}

/** The `board_io` YAML for one binding. */
function bindingYaml (b) {
  const rows = [
    `- id: ${JSON.stringify(b.id)}`,
    `  kind: ${b.kind}`,
    `  peripheral: ${JSON.stringify(b.peripheral)}`,
    `  pin: ${b.pin}`,
    `  signal: ${b.signal}`,
    `  active_high: ${b.activeHigh ? 'true' : 'false'}`,
  ];
  return rows.join('\n');
}

/**
 * Build the labwired system manifest for a designer's netlist.
 *
 * @param {object} opts
 * @param {object} opts.netlist   `{parts, nets}` or a `BoardImpl`
 * @param {string} [opts.chipKind] our board-part kind (default `stm32f030`)
 * @param {string} [opts.mcuId]   which part is the controller, when ambiguous
 * @param {string} [opts.name]    manifest name
 * @param {string} [opts.chipPath] value for the manifest's `chip:` key
 * @returns {{
 *   ok: boolean, systemYaml: string|null, chipYaml: string|null,
 *   pins: object, clockHz: number|null, name: string,
 *   bindings: Array, attachments: Array, refusals: Array, mcuId: string|null
 * }}
 */
export function buildLabwiredSystem (opts = {}) {
  const chipKind = opts.chipKind ?? 'stm32f030';
  const name = opts.name ?? `bw-${chipKind}`;
  const refusals = [];
  const fail = (extra = {}) => ({
    ok: false, systemYaml: null, chipYaml: null, pins: {}, clockHz: null,
    name, bindings: [], attachments: [], refusals, mcuId: null, ...extra,
  });

  const chip = LABWIRED_CHIPS[chipKind];
  if (!chip) {
    refusals.push({
      code: 'chip-unmapped', subject: chipKind,
      reason: `no labwired chip descriptor for board kind '${chipKind}'. `
        + `The heavy tier ships ${Object.keys(LABWIRED_CHIPS).join(', ')}; `
        + 'everything else stays on the light tier.',
    });
    return fail();
  }

  const nl = asNetlist(opts.netlist ?? opts.board ?? opts);

  // ── which part is the controller ────────────────────────────────────────
  // bw-circuit-ui's canonical loader rewrites every controller kind to `mcu`
  // before the netlist reaches the engine, so this matches BOTH spellings:
  // the generic one a loaded bench carries, and the specific one a netlist
  // built directly against the device registry carries.
  const isMcu = (p) => p.kind === 'mcu' || (chip.boardKinds || []).includes(p.kind);
  const candidates = opts.mcuId
    ? nl.parts.filter((p) => p.id === opts.mcuId)
    : nl.parts.filter(isMcu);
  if (candidates.length === 0) {
    refusals.push({
      code: 'mcu-absent', subject: opts.mcuId ?? chipKind,
      reason: opts.mcuId
        ? `no part '${opts.mcuId}' in this netlist`
        : 'no controller part in this netlist — nothing to bind a pad to',
    });
    return fail();
  }
  if (candidates.length > 1) {
    refusals.push({
      code: 'mcu-ambiguous', subject: candidates.map((p) => p.id).join(', '),
      reason: `${candidates.length} controller parts; the heavy tier runs one core `
        + 'per manifest. Pass mcuId to say which.',
    });
    return fail();
  }
  const mcu = candidates[0];

  // ── index the MCU's terminals onto nets ─────────────────────────────────
  /** @type {Map<string, object>} lowercase terminal → net */
  const netOfTerminal = new Map();
  for (const net of nl.nets) {
    for (const t of net.terminals || []) {
      if (t.part === mcu.id) netOfTerminal.set(String(t.terminal).toLowerCase(), net);
    }
  }

  const bindings = [];
  const attachments = [];
  const headerNames = Object.keys(chip.pins);
  const headerLower = new Map(headerNames.map((n) => [n.toLowerCase(), n]));

  for (const header of headerNames) {
    const def = chip.pins[header];
    const net = netOfTerminal.get(header.toLowerCase());
    const leaves = net ? reachableLeaves(nl, net.id, mcu.id) : [];
    const role = classifyAttachment(leaves);
    attachments.push({
      pin: header, role, net: net ? net.id : null,
      parts: leaves.map((l) => ({ id: l.part, kind: l.kind, terminal: l.terminal })),
    });

    // ONE input binding per header pin, unconditionally. This is the slice the
    // adapter already generated and it stays: a pad's direction is a RUNTIME
    // property — firmware reconfigures MODER whenever it likes — so a binding
    // emitted only for pads that look like inputs today would make the pad
    // undrivable the moment the firmware changed its mind, silently, because
    // `set_board_io_input` resolves ids and nothing else. The id is the header
    // name because that is what `labwired-adapter.js` passes.
    const injection = {
      id: header, kind: 'button', peripheral: def.peripheral, pin: def.pin,
      signal: 'input', activeHigh: true, role, why: 'pad injection channel',
    };
    bindings.push(injection);

    if (role === 'indicator' || role === 'digital') {
      // Observational only (`read_gpio_output`), named with OUR part id so a
      // consumer joins `get_board_io_states` straight onto the netlist.
      const lead = leaves.find((l) => INDICATOR.has(l.kind)) ?? leaves[0];
      if (lead) {
        bindings.push({
          id: lead.part, kind: 'led', peripheral: def.peripheral, pin: def.pin,
          signal: 'output', activeHigh: true, role,
          why: `${lead.kind} reachable from ${header}`,
        });
      }
    }

    if (role === 'contact') {
      // The injection binding above already IS the contact; recording the part
      // makes the manifest self-describing without a second binding on the
      // same pad (two `signal: input` bindings would attach two Buttons to one
      // pad, and the second would overwrite the first's level every service).
      injection.why = `${leaves.find((l) => CONTACT.has(l.kind)).kind} on ${header}`;
    }

    if (role === 'analog') {
      const channel = (chip.adcChannels || {})[header];
      if (channel === undefined) {
        refusals.push({
          code: 'pin-unmapped', subject: header,
          reason: `${header} is wired to an analog source `
            + `(${leaves.filter((l) => ANALOG_SOURCE.has(l.kind)).map((l) => l.kind).join(', ')}) `
            + 'but has no ADC channel on this chip.',
        });
      } else {
        bindings.push({
          id: `${header}.adc`, kind: 'adc_input', peripheral: chip.adcPeripheral,
          pin: def.pin, signal: 'input', activeHigh: true, role,
          why: `ADC_IN${channel} — ${leaves.filter((l) => ANALOG_SOURCE.has(l.kind)).map((l) => l.kind).join(', ')}`,
        });
        // THE ONE THING THE MANIFEST CANNOT CARRY. Our board solves the wiper
        // voltage; labwired's wasm boundary offers `set_adc_value(peripheral,
        // value)`, which pokes the ADC's `dr` and sets EOC — it names no
        // channel, so on a bench with two analog pads whichever conversion runs
        // next takes the last value written, whatever channel it selected. And
        // the poke does not survive a conversion: `Adc::advance_conversion`
        // rewrites `dr` from the SELECTED channel's injected value, and for a
        // channel with nothing injected it writes an incrementing counter
        // ("visual feedback"). The core has the right primitive already —
        // `Adc::set_channel_input(channel, millivolts)`, reached from the bus
        // by `seed_adc_channel` — it is simply not exported through
        // `crates/wasm`. Until it is, an analog pad is named here and refused
        // as an injection target rather than quietly reported as a boolean.
        refusals.push({
          code: 'analog-injection-unavailable', subject: header,
          reason: `${header} carries ADC_IN${channel}; the board solves its voltage, but `
            + 'labwired\'s wasm surface has no per-channel analog input '
            + '(`set_adc_value` pokes the data register and the conversion engine '
            + 'overwrites it). See LABWIRED-BRIDGE.md.',
        });
      }
    }
  }

  // ── controller terminals that carry a connection but have no header entry ─
  for (const [terminal, net] of netOfTerminal) {
    if (headerLower.has(terminal)) continue;
    if (SUPPLY_TERMINALS.has(terminal)) continue;
    const leaves = reachableLeaves(nl, net.id, mcu.id);
    const signal = leaves.filter((l) => !RAIL.has(l.kind));
    if (!signal.length) continue;                 // wired to a rail only
    refusals.push({
      code: 'pin-unmapped', subject: terminal,
      reason: `${mcu.id}.${terminal} is wired to `
        + `${signal.map((l) => `${l.kind}(${l.part})`).join(', ')} but is not in the `
        + `${chipKind} header map, so nothing on the heavy tier could reach it.`,
    });
  }

  const yaml = [
    `name: ${JSON.stringify(name)}`,
    `chip: ${JSON.stringify(opts.chipPath ?? './chip.yaml')}`,
    `cpu_hz: ${chip.clockHz}`,
    bindings.length ? `board_io:\n${bindings.map(bindingYaml).join('\n')}` : 'board_io: []',
    // No `external_devices`. The parts beyond the pad are our board's, and a
    // second model of one LED is the disagreement one-board-one-truth exists to
    // prevent. See the module header.
    '',
  ].join('\n');

  return {
    ok: true,
    systemYaml: yaml,
    chipYaml: chip.chipYaml,
    pins: chip.pins,
    clockHz: chip.clockHz,
    name,
    bindings,
    attachments,
    refusals,
    mcuId: mcu.id,
  };
}

/**
 * The refusal ledger alone — what a census test asserts is empty.
 *
 * @param {object} opts same shape as `buildLabwiredSystem`
 * @returns {Array<{code: string, subject: string, reason: string}>}
 */
export function refusalsFor (opts) {
  return buildLabwiredSystem(opts).refusals;
}

/**
 * Everything `createLabwiredAdapter` needs, from a netlist.
 *
 * Throws on a refused board rather than returning a half-manifest: a caller
 * that asked for an adapter wants one that runs, and the reasons are on the
 * error so nothing is lost.
 *
 * @param {object} opts same shape as `buildLabwiredSystem`, plus `firmware`
 * @returns {object} adapter options
 */
export function labwiredAdapterOptionsFor (opts = {}) {
  const built = buildLabwiredSystem(opts);
  const blocking = built.refusals.filter((r) => r.code !== 'analog-injection-unavailable');
  if (!built.ok || blocking.length) {
    const err = new Error('labwired-bridge: this board cannot be carried to the heavy tier:\n'
      + built.refusals.map((r) => `  - [${r.code}] ${r.subject}: ${r.reason}`).join('\n'));
    err.refusals = built.refusals;
    throw err;
  }
  return {
    chipYaml: built.chipYaml,
    systemYaml: built.systemYaml,
    pins: built.pins,
    clockHz: built.clockHz,
    name: built.name,
    firmware: opts.firmware,
    refusals: built.refusals,
  };
}

export default buildLabwiredSystem;
