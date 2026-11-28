// SPDX-License-Identifier: MIT
/**
 * Stable logical GPIO numbering for host-driven circuit programs.
 *
 * These profiles describe the existing electrical model's named pads. They
 * do not compile firmware or select a processor interpreter. Keep this table
 * explicit: gpioFollowsPinStates alone does not establish a usable pin map,
 * and autonomous controller devices cannot share a host's GPIO ownership.
 */
import { getDevice } from './devices.js';

const range = (first, last, terminal, firstId = first) => Array.from(
  { length: last - first + 1 }, (_, offset) => ({
    pin: firstId + offset, terminal: `${terminal}${first + offset}`,
  }));
const ports = (names, width) => names.flatMap((name, port) =>
  range(0, width - 1, `p${name}`, port * width));
const profile = (kind, label, nominalVoltage, numbering, help, pins) => Object.freeze({
  kind, label, nominalVoltage, numbering, help,
  execution: 'host-driven-circuit', hardware: false, nativeInterpreter: false,
  pins: Object.freeze(pins.map(pin => Object.freeze(pin))),
});

/** Public inventory. null nominalVoltage means the generic MCU uses board.vcc.
 * Pin numbers are logical IDs, never connector positions or CPU addresses. */
export const PORTABLE_GPIO_PROFILES = Object.freeze([
  profile('mcu', 'STC / 8051 logical ports', null, '8 * port + bit',
    'P0.0–P7.7 use 8 × port + bit. Only terminals present in this circuit are available; voltage follows the bench.',
    Array.from({ length: 8 }, (_, port) => range(0, 7, `p${port}.`, port * 8)).flat()),
  profile('stc15_mcu', 'STC15F2K60S2 DIP-40', 5, '8 * port + bit',
    'P0–P3 use 0–31; P4.1/P4.2/P4.4/P4.5 use 33/34/36/37; P5.4/P5.5 use 44/45. Use one case spelling per circuit pad. Reset, crystal and fuse behavior are not emulated by this host.',
    [...Array.from({ length: 4 }, (_, port) => range(0, 7, `p${port}.`, port * 8)).flat(),
      ...[1, 2, 4, 5].map(bit => ({ pin: 32 + bit, terminal: `p4.${bit}` })),
      ...[4, 5].map(bit => ({ pin: 40 + bit, terminal: `p5.${bit}` }))]),
  profile('arduino_uno', 'Arduino Uno', 5, 'Dn = n; An = 14 + n',
    'D0–D13 use 0–13; A0–A5 use 14–19 as digital pins.',
    [...range(0, 13, 'd'), ...range(0, 5, 'a', 14)]),
  profile('arduino_nano', 'Arduino Nano', 5, 'Dn = n; An = 14 + n',
    'D0–D13 use 0–13; A0–A5 use 14–19. Analog-only A6/A7 are unavailable.',
    [...range(0, 13, 'd'), ...range(0, 5, 'a', 14)]),
  profile('arduino_mega', 'Arduino Mega', 5, 'Dn = n; An = 54 + n',
    'D0–D53 use 0–53; A0–A15 use 54–69 as digital pins.',
    [...range(0, 53, 'd'), ...range(0, 15, 'a', 54)]),
  profile('pi_pico', 'Raspberry Pi Pico', 3.3, 'GPn = n',
    'GP0–GP22, GP25 and GP26–GP28 use their GPIO numbers. GP23/24/29 are unavailable.',
    [...range(0, 22, 'gp'), ...range(25, 28, 'gp')]),
  profile('microbit', 'BBC micro:bit', 3.3, 'Pn = n',
    'The large P0, P1 and P2 edge pads use 0, 1 and 2.', range(0, 2, 'p')),
  profile('microbit_breakout', 'BBC micro:bit breakout', 3.3, 'Pn = n',
    'The model exposes P0, P1, P2, P8, P12 and P16 using their pad numbers.',
    [0, 1, 2, 8, 12, 16].map(pin => ({ pin, terminal: `p${pin}` }))),
  profile('calliopemini', 'Calliope mini', 3.3, 'Pn = n',
    'The four ring pads P0–P3 use 0–3. Header and Grove pins are outside this model.', range(0, 3, 'p')),
  profile('circuit_playground_express', 'Circuit Playground Express', 3.3, 'An = n',
    'The eight A0–A7 pads use 0–7 as digital pins. Onboard sensors and NeoPixels are separate devices.', range(0, 7, 'a')),
  profile('pybadge', 'Adafruit PyBadge independent GPIO pads', 3.3, 'Arduino digital IDs; RX = 0, TX = 1, FREE = 7; An = 14 + n',
    'RX/TX use 0/1; D2/D3/D5/D6/D9–D13 keep their numbers; FREE uses 7; A0–A5 use 14–19; MISO/MOSI/SCK use 26/27/28. SDA/SCL and STEMMA aliases are unavailable. Onboard peripherals are separate devices.',
    [{ pin: 0, terminal: 'rx' }, { pin: 1, terminal: 'tx' },
      ...[2, 3, 5, 6, 9, 10, 11, 12, 13].map(pin => ({ pin, terminal: `d${pin}` })),
      { pin: 7, terminal: 'free' }, ...range(0, 5, 'a', 14),
      { pin: 26, terminal: 'miso' }, { pin: 27, terminal: 'mosi' }, { pin: 28, terminal: 'sck' }]),
  profile('esp8266', 'ESP8266', 3.3, 'GPIOn = n',
    'GPIO0–GPIO5 and GPIO12–GPIO15 use their GPIO numbers; flash pins and GPIO16 are unavailable.',
    [...range(0, 5, 'gpio'), ...range(12, 15, 'gpio')]),
  profile('esp32_4848s040', 'ESP32-4848S040 H1 connector', 3.3, 'GPIOn = n',
    'Only H1 expansion GPIO1, GPIO2, GPIO40, GPIO43 and GPIO44 are available; display and memory pins are excluded.',
    [1, 2, 40, 43, 44].map(pin => ({ pin, terminal: `gpio${pin}` }))),
  profile('attiny85', 'ATtiny85 DIP-8', 5, '8 * port index + bit (A = 0)',
    'PB0–PB5 use 8–13. This is logical circuit GPIO; reset and fuse behavior are not emulated by this host.',
    range(0, 5, 'pb', 8)),
  profile('attiny88', 'ATtiny88 DIP-28', 5, '8 * port index + bit (A = 0)',
    'PB0–PB7 use 8–15, PC0–PC7 use 16–23 and PD0–PD7 use 24–31. This package has no PA pads.',
    ports(['a', 'b', 'c', 'd'], 8).filter(({ pin }) => pin >= 8)),
  profile('attiny88_qfn32', 'ATtiny88 QFN-32', 5, '8 * port index + bit (A = 0)',
    'PA0–PA3 use 0–3; PB0–PB7 use 8–15, PC0–PC7 use 16–23 and PD0–PD7 use 24–31.',
    ports(['a', 'b', 'c', 'd'], 8).filter(({ pin }) => pin < 4 || pin >= 8)),
  profile('stm32f030', 'STM32F030 TSSOP-20', 3.3, '16 * port index + bit (A = 0)',
    'PA0–PA7, PA9 and PA10 keep their bit numbers; PB1 uses 17. Boot, reset, crystal and SWD pads are excluded.',
    [...range(0, 7, 'pa'), { pin: 9, terminal: 'pa9' }, { pin: 10, terminal: 'pa10' }, { pin: 17, terminal: 'pb1' }]),
  profile('eater6502', 'Eater 6502 VIA', 5, 'VIA1 PA = 0–7; PB = 8–15',
    'VIA1.PA0–PA7 use 0–7 and VIA1.PB0–PB7 use 8–15. The host drives the circuit pads without running the 6502 CPU.',
    [...range(0, 7, 'via1.pa'), ...range(0, 7, 'via1.pb', 8)]),
]);

const profiles = new Map(PORTABLE_GPIO_PROFILES.map(entry => [entry.kind, entry]));
const pinMaps = new Map(PORTABLE_GPIO_PROFILES.map(entry =>
  [entry.kind, new Map(entry.pins.map(({ pin, terminal }) => [terminal, pin]))]));
const unavailable = message => Object.assign(new Error(message), { code: 'unavailable' });

export const getPortableGpioProfile = kind => profiles.get(kind) ?? null;

/** Match complete canonical pad names case-insensitively. No aliases, prefix
 * guesses, leading-zero spellings or physical header positions are accepted. */
export function logicalPinForTerminal(kind, terminal) {
  return typeof terminal === 'string' ? pinMaps.get(kind)?.get(terminal.toLowerCase()) ?? null : null;
}

/** Resolve a single existing controller. The circuit may expose a subset of
 * the model's terminals; only that subset is available to a program. Unknown
 * terminals are never guessed into GPIO, and duplicate case aliases refuse. */
export function resolvePortableGpioController(board) {
  if (!board || !Array.isArray(board.parts) || !Array.isArray(board.nets)) {
    throw unavailable('Open a supported circuit in the Circuit tab first');
  }
  const controllers = board.parts.filter(part => part &&
    (profiles.has(part.kind) || getDevice(part.kind)?.gpioFollowsPinStates));
  if (controllers.length !== 1) throw unavailable('BASIC circuit simulation requires exactly one GPIO controller');
  const controller = controllers[0];
  const selected = profiles.get(controller.kind);
  if (!selected) throw unavailable(`BASIC circuit simulation does not support ${controller.kind}`);
  if (controller.kind !== 'mcu') {
    const model = getDevice(controller.kind);
    if (!model?.gpioFollowsPinStates) throw unavailable(`The circuit engine has not registered ${controller.kind}`);
    if (model.vcc !== selected.nominalVoltage || !Array.isArray(model.terminals)) {
      throw unavailable(`The circuit engine has an incompatible GPIO model for ${controller.kind}`);
    }
    const registered = new Set(model.terminals.map(terminal => String(terminal).toLowerCase()));
    if (selected.pins.some(({ terminal }) => !registered.has(terminal))) {
      throw unavailable(`The circuit engine is missing GPIO terminals for ${controller.kind}`);
    }
  }
  if (!Array.isArray(controller.terminals)) throw unavailable('The circuit controller has no terminal map');
  const seen = new Set();
  const pinMap = [];
  for (const terminal of controller.terminals) {
    if (typeof terminal !== 'string') throw unavailable('The circuit controller has an invalid terminal');
    const pin = logicalPinForTerminal(controller.kind, terminal);
    if (pin === null) continue;
    if (seen.has(pin)) throw unavailable(`The circuit controller has duplicate logical pin ${pin}`);
    seen.add(pin);
    pinMap.push(Object.freeze({ pin, terminal }));
  }
  if (!pinMap.length || pinMap.length > 256) throw unavailable('The circuit controller has no supported digital pins');
  pinMap.sort((a, b) => a.pin - b.pin);
  return Object.freeze({
    controller: Object.freeze({ id: controller.id, kind: controller.kind }),
    profile: selected,
    pins: Object.freeze(pinMap.map(({ pin }) => pin)),
    pinMap: Object.freeze(pinMap),
  });
}
