/**
 * Optional AVR peripheral wiring — EEPROM and TWI.
 *
 * These are chip-config-driven: if the chip definition exports `eeprom`
 * or `twi` fields, this module wires them onto the CPU after the base
 * adapter creates it.  Chips without those fields are unaffected.
 *
 * Kept separate from avr8js-adapter.js so the coordinator-owned adapter
 * stays untouched.
 *
 * @module
 */

import { AVREEPROM, EEPROMMemoryBackend } from 'avr8js';
import { installTWIStub } from './avr-twi-stub.js';

/**
 * Wire optional peripherals onto an existing avr8js adapter.
 *
 * @param {ReturnType<import('./avr8js-adapter.js').createAvr8jsAdapter>} adapter
 *   The adapter returned by createAvr8jsAdapter().
 * @returns {object} The same adapter, augmented with:
 *   - `eeprom`  AVREEPROM instance (if chip.eeprom defined)
 *   - `eepromBackend`  EEPROMMemoryBackend (if chip.eeprom defined)
 *   - `twiInstalled`  boolean
 */
export function wirePeripherals(adapter) {
  const { cpu, chip } = adapter;

  // ── Internal EEPROM ──
  if (chip.eeprom) {
    const size = chip.eepromBytes ?? 512;
    const backend = new EEPROMMemoryBackend(size);
    const eeprom = new AVREEPROM(cpu, backend, chip.eeprom);
    adapter.eeprom = eeprom;
    adapter.eepromBackend = backend;
  }

  // ── TWI stub (I2C) ──
  if (chip.twi) {
    installTWIStub(cpu, chip.twi);
    adapter.twiInstalled = true;
  }

  return adapter;
}
