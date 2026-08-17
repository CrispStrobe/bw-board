/**
 * Boundary C — infer a default netlist from project.stc.pins.
 *
 * Each declared pin gets a default wiring based on its direction and
 * active-low flag. The user can then redraw any of it.
 *
 * The reverse check is the teaching feature: warn when the code drives
 * a pin with nothing attached, or when something is wired that the code
 * never references.
 *
 * @module
 */

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./types.js').Net} Net */

/**
 * A pin declaration from the project.
 * @typedef {object} StcPin
 * @property {string} name
 * @property {number} port
 * @property {number} bit
 * @property {'output' | 'input' | 'analog'} direction
 * @property {boolean} activeLow
 */

/**
 * A port declaration (whole-port I/O).
 * @typedef {object} StcPort
 * @property {string} name
 * @property {number} port
 * @property {string} sfr - e.g. "P0"
 * @property {number} width - typically 8
 * @property {'output' | 'input'} direction
 * @property {boolean} activeLow
 */

/**
 * @typedef {object} StcProject
 * @property {string} [device]
 * @property {number} [clock]
 * @property {StcPin[]} pins
 * @property {StcPort[]} [ports]
 */

/**
 * Infer a default netlist from the project's pin declarations.
 *
 * @param {StcProject} stc
 * @returns {{ parts: Part[], nets: Net[], notes: string[] }}
 */
/**
 * The terminal name a declared pin joins the board under. 8051 pins carry
 * port/bit; Arduino and Pico pins carry `where` (D13, GP15) — the header
 * name IS the terminal (the board's pin join is case-blind, so the
 * spelling only affects display). This lived as a downstream patch in the
 * app's vendored copy until 2026-08-13; a re-vendor silently destroyed it
 * once, which is why it moved upstream — and to MODULE scope, because
 * checkWiring needs it too.
 * @param {StcPin} p
 */
const pinName = (p) => p.where ? String(p.where) : `P${p.port}.${p.bit}`;

export function inferNetlist(stc, opts) {
  /** @type {Part[]} */
  const parts = [];
  /** @type {Net[]} */
  const nets = [];
  /** @type {string[]} */
  const notes = [];

  // Always add VCC, GND, and the MCU
  parts.push({ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] });
  parts.push({ id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] });

  // Collect MCU terminals from declared pins (header names — see pinName).
  const mcuTerminals = stc.pins.map(pinName);
  parts.push({ id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerminals });

  // VCC and GND nets (shared by multiple parts)
  const vccNet = { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] };
  const gndNet = { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] };

  // Pins that belong to a synthesized STRUCTURE get no generic LED/button:
  //  - I2C/SPI bus pins carry a display, not an LED per line (the Pico
  //    calculator bench hung LEDs on sda/scl — owner screenshot, 2026-08-17),
  //  - rowN/colN pin families are a matrix KEYPAD: buttons sit BETWEEN a row
  //    and a column, not from each column to ground. A generic bench made
  //    the calculator untypable.
  const lname = (p) => String(p.name).toLowerCase();
  const nameSet = new Set(stc.pins.map(lname));
  const hasI2cBus = nameSet.has('sda') && nameSet.has('scl');
  const hasSpiBus = ['cs', 'dc', 'sck', 'mosi'].every((n) => nameSet.has(n));
  const rowPins = stc.pins.filter((p) => /^row\d+$/i.test(p.name) &&
    (p.direction === 'output' || p.direction === 'pwm'));
  const colPins = stc.pins.filter((p) => /^col\d+$/i.test(p.name) && p.direction === 'input');
  const isMatrix = rowPins.length >= 2 && colPins.length >= 2;
  const bareNames = new Set();
  if (hasI2cBus) { bareNames.add('sda'); bareNames.add('scl'); }
  if (hasSpiBus) ['cs', 'dc', 'sck', 'mosi'].forEach((n) => bareNames.add(n));
  if (isMatrix) rowPins.forEach((p) => bareNames.add(lname(p)));
  const matrixColNames = new Set(isMatrix ? colPins.map(lname) : []);

  const usedNames = new Set();
  for (const pin of stc.pins) {
    const pinId = pinName(pin);
    let safeName = pin.name.replace(/[^a-zA-Z0-9_]/g, '_');
    // Two pins may carry the same NAME on different ports ('led' on P1.0
    // and P3.0). Every net and part id below derives from safeName, so a
    // repeat minted duplicate net ids — which the board now rejects as
    // fatal (they make the MNA matrix singular). Disambiguate by pin.
    if (usedNames.has(safeName)) {
      safeName = `${safeName}_${pinId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    }
    usedNames.add(safeName);

    if (bareNames.has(lname(pin))) {
      // Structure pin: just the net; the display/keypad synthesis below
      // attaches the real part.
      nets.push({ id: `net_${safeName}_pin`,
        terminals: [{ part: 'MCU', terminal: pinId }] });
      continue;
    }
    if (matrixColNames.has(lname(pin))) {
      // Keypad column: pull-up to VCC; the buttons come per row below.
      const rId = `R_PU_${safeName}`;
      parts.push({ id: rId, kind: 'resistor',
        params: { ohms: 10000 }, terminals: ['a', 'b'] });
      nets.push({ id: `net_${safeName}_pin`,
        terminals: [{ part: 'MCU', terminal: pinId }, { part: rId, terminal: 'b' }] });
      vccNet.terminals.push({ part: rId, terminal: 'a' });
      continue;
    }

    // Detect buzzer and motor by name convention
    const isBuzzer = /buzz|speaker|tone|beep/i.test(pin.name);
    const isMotor = /motor|fan\b/i.test(pin.name) && !isBuzzer;

    switch (pin.direction) {
      case 'tone': {
        // Timer-driven GPIO toggle → buzzer between pin and GND.
        // buzzerTone measures the toggle period; nothing in the MCU knows about sound.
        const buzzId = `BUZZ_${safeName}`;
        parts.push({
          id: buzzId, kind: 'buzzer',
          params: {}, terminals: ['a', 'b'],
        });
        nets.push({
          id: `net_${safeName}_pin`,
          terminals: [
            { part: 'MCU', terminal: pinId },
            { part: buzzId, terminal: 'a' },
          ],
        });
        gndNet.terminals.push({ part: buzzId, terminal: 'b' });
        break;
      }

      case 'output':
      case 'pwm': {
        if (isMotor) {
          // pin → NPN base via 1k; motor VCC→collector, emitter→GND. A pin
          // named 'motor' rendered as an LED and the owner asked, fairly,
          // where the motor was (2026-08-17). The transistor is not
          // decoration: an MCU pin cannot source a motor, which is the
          // same lesson the port-current examples teach.
          const rId = `R_${safeName}`;
          const qId = `Q_${safeName}`;
          const mId = `MOTOR_${safeName}`;
          parts.push({ id: rId, kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] });
          parts.push({ id: qId, kind: 'npn', params: {}, terminals: ['base', 'collector', 'emitter'] });
          parts.push({ id: mId, kind: 'dc_motor', params: {}, terminals: ['a', 'b'] });
          nets.push({ id: `net_${safeName}_pin`,
            terminals: [{ part: 'MCU', terminal: pinId }, { part: rId, terminal: 'a' }] });
          nets.push({ id: `net_${safeName}_base`,
            terminals: [{ part: rId, terminal: 'b' }, { part: qId, terminal: 'base' }] });
          nets.push({ id: `net_${safeName}_col`,
            terminals: [{ part: mId, terminal: 'b' }, { part: qId, terminal: 'collector' }] });
          vccNet.terminals.push({ part: mId, terminal: 'a' });
          gndNet.terminals.push({ part: qId, terminal: 'emitter' });
          break;
        }
        if (isBuzzer) {
          // pin → buzzer → GND
          const buzzId = `BUZZ_${safeName}`;
          parts.push({
            id: buzzId, kind: 'buzzer',
            params: {}, terminals: ['a', 'b'],
          });
          nets.push({
            id: `net_${safeName}_pin`,
            terminals: [
              { part: 'MCU', terminal: pinId },
              { part: buzzId, terminal: 'a' },
            ],
          });
          gndNet.terminals.push({ part: buzzId, terminal: 'b' });
          break;
        }

        if (pin.activeLow) {
          // VCC → 1kΩ → LED → pin (active-low, the correct wiring)
          const rId = `R_${safeName}`;
          const ledId = `LED_${safeName}`;
          parts.push({
            id: rId, kind: 'resistor',
            params: { ohms: 1000 }, terminals: ['a', 'b'],
          });
          parts.push({
            id: ledId, kind: 'led',
            params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'],
          });
          // VCC → R.a
          vccNet.terminals.push({ part: rId, terminal: 'a' });
          // R.b → LED.anode
          nets.push({
            id: `net_${safeName}_r_led`,
            terminals: [
              { part: rId, terminal: 'b' },
              { part: ledId, terminal: 'anode' },
            ],
          });
          // LED.cathode → MCU pin
          nets.push({
            id: `net_${safeName}_pin`,
            terminals: [
              { part: ledId, terminal: 'cathode' },
              { part: 'MCU', terminal: pinId },
            ],
          });
        } else {
          // pin → 1kΩ → LED → GND (active-high)
          const rId = `R_${safeName}`;
          const ledId = `LED_${safeName}`;
          parts.push({
            id: rId, kind: 'resistor',
            params: { ohms: 1000 }, terminals: ['a', 'b'],
          });
          parts.push({
            id: ledId, kind: 'led',
            params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'],
          });
          // MCU pin → R.a
          nets.push({
            id: `net_${safeName}_pin_r`,
            terminals: [
              { part: 'MCU', terminal: pinId },
              { part: rId, terminal: 'a' },
            ],
          });
          // R.b → LED.anode
          nets.push({
            id: `net_${safeName}_r_led`,
            terminals: [
              { part: rId, terminal: 'b' },
              { part: ledId, terminal: 'anode' },
            ],
          });
          // LED.cathode → GND
          gndNet.terminals.push({ part: ledId, terminal: 'cathode' });
        }
        break;
      }

      case 'analog': {
        // Potentiometer across VCC/GND, wiper → pin
        const potId = `POT_${safeName}`;
        parts.push({
          id: potId, kind: 'potentiometer',
          params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'],
        });
        // VCC → pot.a
        vccNet.terminals.push({ part: potId, terminal: 'a' });
        // pot.b → GND
        gndNet.terminals.push({ part: potId, terminal: 'b' });
        // pot.wiper → MCU pin
        nets.push({
          id: `net_${safeName}_wiper`,
          terminals: [
            { part: potId, terminal: 'wiper' },
            { part: 'MCU', terminal: pinId },
          ],
        });
        break;
      }

      case 'input': {
        // Button pin → GND, plus a 10kΩ pull-up to VCC
        const rpuId = `R_PU_${safeName}`;
        const btnId = `BTN_${safeName}`;
        parts.push({
          id: rpuId, kind: 'resistor',
          params: { ohms: 10000 }, terminals: ['a', 'b'],
        });
        parts.push({
          id: btnId, kind: 'button',
          params: {}, terminals: ['a', 'b'],
        });
        // VCC → R_PU.a
        vccNet.terminals.push({ part: rpuId, terminal: 'a' });
        // R_PU.b → pin net (shared with button and MCU)
        nets.push({
          id: `net_${safeName}_pin`,
          terminals: [
            { part: rpuId, terminal: 'b' },
            { part: btnId, terminal: 'a' },
            { part: 'MCU', terminal: pinId },
          ],
        });
        // button.b → GND
        gndNet.terminals.push({ part: btnId, terminal: 'b' });
        break;
      }

      default:
        notes.push(`Unknown direction '${pin.direction}' for pin ${pin.name} (${pinId})`);
    }
  }

  // ─── Port declarations (whole-port I/O) ────────────────────────────────

  if (stc.ports) {
    for (const port of stc.ports) {
      const safeName = port.name.replace(/[^a-zA-Z0-9_]/g, '_');
      const width = port.width ?? 8;

      if (port.direction === 'output') {
        // PORT OUTPUT: each bit gets a load.
        // Common pattern: 7-segment display or 8-LED bar.
        // Add 8 LEDs with series resistors, each on one port bit.
        for (let bit = 0; bit < width; bit++) {
          const pinId = `P${port.port}.${bit}`;
          const segName = width === 8 && bit < 7
            ? ['a', 'b', 'c', 'd', 'e', 'f', 'g'][bit]
            : bit === 7 ? 'dp' : `b${bit}`;
          const rId = `R_${safeName}_${segName}`;
          const ledId = `LED_${safeName}_${segName}`;

          // Add pin to MCU terminals if not already there
          if (!mcuTerminals.includes(pinId)) mcuTerminals.push(pinId);

          parts.push({
            id: rId, kind: 'resistor',
            params: { ohms: 330 }, terminals: ['a', 'b'],
          });
          parts.push({
            id: ledId, kind: 'led',
            params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'],
          });

          if (port.activeLow) {
            // Active-low: VCC → R → LED → pin
            vccNet.terminals.push({ part: rId, terminal: 'a' });
            nets.push({
              id: `net_${safeName}_${segName}_r_led`,
              terminals: [
                { part: rId, terminal: 'b' },
                { part: ledId, terminal: 'anode' },
              ],
            });
            nets.push({
              id: `net_${safeName}_${segName}_pin`,
              terminals: [
                { part: ledId, terminal: 'cathode' },
                { part: 'MCU', terminal: pinId },
              ],
            });
          } else {
            // Active-high: pin → R → LED → GND
            nets.push({
              id: `net_${safeName}_${segName}_pin_r`,
              terminals: [
                { part: 'MCU', terminal: pinId },
                { part: rId, terminal: 'a' },
              ],
            });
            nets.push({
              id: `net_${safeName}_${segName}_r_led`,
              terminals: [
                { part: rId, terminal: 'b' },
                { part: ledId, terminal: 'anode' },
              ],
            });
            gndNet.terminals.push({ part: ledId, terminal: 'cathode' });
          }
        }
      } else {
        notes.push(`Unknown port direction '${port.direction}' for port ${port.name}`);
      }
    }
  }

  // ─── Parts declarations (shift registers, etc.) ────────────────────────

  if (stc.parts) {
    for (const part of stc.parts) {
      const safeName = part.name.replace(/[^a-zA-Z0-9_]/g, '_');

      if (part.kind === '74hc595') {
        // 74HC595: 3 MCU pins → shift register → 8 outputs with LEDs.
        // The shift register is modeled as a black box in the netlist:
        // the board doesn't simulate the shift register logic itself
        // (that requires edge-order modeling), but it creates the
        // output LEDs so the circuit designer can show them.

        // Add the 3 MCU pins
        for (const pinId of Object.values(part.pins)) {
          if (!mcuTerminals.includes(pinId)) mcuTerminals.push(pinId);
        }

        // Wire MCU pins to nets (the shift register connections)
        for (const [role, pinId] of Object.entries(part.pins)) {
          nets.push({
            id: `net_${safeName}_${role}`,
            terminals: [{ part: 'MCU', terminal: pinId }],
          });
        }

        // Create output LEDs (the display that the shift register drives)
        const numOutputs = part.outputs ?? 8;
        for (let bit = 0; bit < numOutputs; bit++) {
          const segName = numOutputs === 8 && bit < 7
            ? ['a', 'b', 'c', 'd', 'e', 'f', 'g'][bit]
            : bit === 7 ? 'dp' : `q${bit}`;
          const rId = `R_${safeName}_${segName}`;
          const ledId = `LED_${safeName}_${segName}`;

          parts.push({
            id: rId, kind: 'resistor',
            params: { ohms: 330 }, terminals: ['a', 'b'],
          });
          parts.push({
            id: ledId, kind: 'led',
            params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'],
          });

          if (part.activeLow) {
            vccNet.terminals.push({ part: rId, terminal: 'a' });
            nets.push({
              id: `net_${safeName}_${segName}_r_led`,
              terminals: [
                { part: rId, terminal: 'b' },
                { part: ledId, terminal: 'anode' },
              ],
            });
            // Output goes to GND through the LED (active-low:
            // shift register output LOW → current flows → LED on)
            gndNet.terminals.push({ part: ledId, terminal: 'cathode' });
          } else {
            // Active-high: output → R → LED → GND
            nets.push({
              id: `net_${safeName}_${segName}_out`,
              terminals: [{ part: rId, terminal: 'a' }],
            });
            nets.push({
              id: `net_${safeName}_${segName}_r_led`,
              terminals: [
                { part: rId, terminal: 'b' },
                { part: ledId, terminal: 'anode' },
              ],
            });
            gndNet.terminals.push({ part: ledId, terminal: 'cathode' });
          }
        }
      } else {
        notes.push(`Unknown part kind '${part.kind}' for part ${part.name}`);
      }
    }
  }

  // Bus-named pins imply their display: 'sda'+'scl' is the 4-pin OLED,
  // 'cs'+'dc'+'sck'+'mosi' the SPI TFT. The pin loop above already made
  // each an output net; seat the panel on those nets so a generated
  // bench SHOWS what the program draws — before this, a device-picked
  // calculator bench carried the keys and no display (the verbs declare
  // no part, so nothing else can know).
  const findPin = (n) => stc.pins.find((q) => String(q.name).toLowerCase() === n);
  const netOfPin = (pin) => {
    // Robust against net-naming schemes: the pin's net is the one carrying
    // the MCU's own terminal for it (guessing id prefixes missed —
    // outputs name theirs net_<name>_pin_r).
    if (!pin) return null;
    const term = pinName(pin);
    return nets.find((nn) => nn.terminals.some(
      (t) => t.part === 'MCU' && t.terminal === term)) || null;
  };
  if (isMatrix) {
    // The keypad itself: a button at every row/column crossing. Scanning
    // drives one row low; a pressed key pulls its column low through it.
    for (const rp of rowPins) {
      const rNet = netOfPin(rp);
      if (!rNet) continue;
      for (const cp of colPins) {
        const cNet = netOfPin(cp);
        if (!cNet) continue;
        const btnId = `BTN_${lname(rp)}_${lname(cp)}`.replace(/[^a-zA-Z0-9_]/g, '_');
        parts.push({ id: btnId, kind: 'button', params: {}, terminals: ['a', 'b'] });
        rNet.terminals.push({ part: btnId, terminal: 'a' });
        cNet.terminals.push({ part: btnId, terminal: 'b' });
      }
    }
    notes.push(`row/col pins: seated a ${rowPins.length}x${colPins.length} keypad matrix`);
  }
  const sdaPin = findPin('sda'), sclPin = findPin('scl');
  const sdaNet = netOfPin(sdaPin), sclNet = netOfPin(sclPin);
  if (sdaNet && sclNet) {
    // Which panel sits on the bus is the PROGRAM's business (oled vs lcd
    // verbs) — callers that know pass opts.display; 'oled' is the default.
    const isLcd = opts && opts.display === 'lcd';
    const dispId = isLcd ? 'LCD' : 'OLED';
    parts.push({ id: dispId, kind: isLcd ? 'char_lcd_i2c' : 'ssd1306',
      params: {}, terminals: isLcd ? ['sda', 'scl', 'vcc', 'gnd'] : ['vcc', 'gnd', 'sda', 'scl'] });
    sdaNet.terminals.push({ part: dispId, terminal: 'sda' });
    sclNet.terminals.push({ part: dispId, terminal: 'scl' });
    vccNet.terminals.push({ part: dispId, terminal: 'vcc' });
    gndNet.terminals.push({ part: dispId, terminal: 'gnd' });
    notes.push(`sda/scl pins: seated ${isLcd ? 'an I2C character LCD' : 'an SSD1306 OLED'} on the bus`);
  }
  const tftNets = ['cs', 'dc', 'sck', 'mosi'].map((n) => netOfPin(findPin(n)));
  if (tftNets.every(Boolean)) {
    parts.push({ id: 'TFT', kind: 'ili9341', params: {},
      terminals: ['vcc', 'gnd', 'cs', 'rst', 'dc', 'mosi', 'sck', 'miso', 'led'] });
    ['cs', 'dc', 'sck', 'mosi'].forEach((t, i) => tftNets[i].terminals.push({ part: 'TFT', terminal: t }));
    vccNet.terminals.push({ part: 'TFT', terminal: 'vcc' }, { part: 'TFT', terminal: 'led' }, { part: 'TFT', terminal: 'rst' });
    gndNet.terminals.push({ part: 'TFT', terminal: 'gnd' });
    notes.push('cs/dc/sck/mosi pins: seated an ILI9341 TFT on the SPI bus');
  }

  // Add the shared VCC and GND nets
  nets.push(vccNet);
  nets.push(gndNet);

  return { parts, nets, notes };
}

/**
 * Check for wiring issues: pins driven with nothing attached, or parts
 * wired that the code never references.
 *
 * @param {StcPin[]} declaredPins - pins declared in the project
 * @param {Part[]} wiredParts - parts in the current netlist
 * @param {Net[]} wiredNets - nets in the current netlist
 * @returns {string[]} warning notes
 */
export function checkWiring(declaredPins, wiredParts, wiredNets) {
  /** @type {string[]} */
  const notes = [];

  // Find all MCU pin terminals in the netlist
  const mcuPart = wiredParts.find(p => p.kind === 'mcu');
  if (!mcuPart) return notes;

  const wiredPinIds = new Set();
  for (const net of wiredNets) {
    for (const t of net.terminals) {
      if (t.part === mcuPart.id) {
        wiredPinIds.add(t.terminal);
      }
    }
  }

  // Check: declared pins with nothing wired
  const declaredPinIds = new Set(declaredPins.map(pinName));
  for (const pin of declaredPins) {
    const pinId = pinName(pin);
    if (!wiredPinIds.has(pinId)) {
      notes.push(`Pin ${pin.name} (${pinId}) is declared as ${pin.direction} but has nothing wired to it`);
    }
  }

  // Check: MCU terminals wired but not declared in the project
  for (const pinId of wiredPinIds) {
    if (!declaredPinIds.has(pinId)) {
      notes.push(`${pinId} has wiring on the board but is not declared in the project`);
    }
  }

  // Check: wired pins with only their own connection (no external parts)
  for (const net of wiredNets) {
    const mcuTerminals = net.terminals.filter(t => t.part === mcuPart.id);
    if (mcuTerminals.length > 0 && net.terminals.length === 1) {
      for (const t of mcuTerminals) {
        const pin = declaredPins.find(p => `P${p.port}.${p.bit}` === t.terminal);
        const name = pin ? `${pin.name} (${t.terminal})` : t.terminal;
        notes.push(`${name} is connected to a net with no external components`);
      }
    }
  }

  return notes;
}
