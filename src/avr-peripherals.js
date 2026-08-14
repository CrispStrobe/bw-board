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
 * @param {object} [opts]
 * @param {Uint8Array} [opts.externalEeprom] - Backing store for the TWI EEPROM
 *   stub.  If provided, I2C reads/writes go to this array (24Cxx model).
 *   If omitted, all reads return 0xFF (empty EEPROM).
 * @returns {object} The same adapter, augmented with:
 *   - `eeprom`  AVREEPROM instance (if chip.eeprom defined)
 *   - `eepromBackend`  EEPROMMemoryBackend (if chip.eeprom defined)
 *   - `twiInstalled`  boolean
 *   - `externalEeprom`  Uint8Array (if provided via opts)
 */
export function wirePeripherals(adapter, opts = {}) {
  const { cpu, chip } = adapter;

  // ── Internal EEPROM ──
  if (chip.eeprom) {
    const size = chip.eepromBytes ?? 512;
    const backend = new EEPROMMemoryBackend(size);
    const eeprom = new AVREEPROM(cpu, backend, chip.eeprom);
    adapter.eeprom = eeprom;
    adapter.eepromBackend = backend;
  }

  // ── ADC free-running polyfill ──
  // avr8js's AVRADC clears ADSC after each conversion but does not
  // re-trigger when ADATE (auto-trigger) is set.  This clock event
  // checks every ~conversion-period and re-sets ADSC if the ADC is
  // idle with ADATE enabled, effectively implementing free-running mode.
  if (chip.adc) {
    const ADCSRA_ADDR = chip.adc.ADCSRA;
    const ADSC = 0x40, ADEN = 0x80, ADATE = 0x20;
    const prescaler = [2, 2, 4, 8, 16, 32, 64, 128];
    function adcPoll() {
      const reg = cpu.data[ADCSRA_ADDR];
      if ((reg & ADEN) && (reg & ADATE) && !(reg & ADSC)) {
        cpu.writeData(ADCSRA_ADDR, reg | ADSC);
      }
      // Conversion = 13 ADC clocks. ADC clock = CPU / prescaler.
      const ps = prescaler[reg & 0x07] || 32;
      cpu.addClockEvent(adcPoll, 13 * ps);
    }
    // Start polling after a short delay (firmware needs time to configure ADC)
    cpu.addClockEvent(adcPoll, 10000);
  }

  // ── TWI stub (I2C) ──
  if (chip.twi) {
    const extEE = opts.externalEeprom;
    installTWIStub(cpu, chip.twi, extEE);
    adapter.twiInstalled = true;
    if (extEE) adapter.externalEeprom = extEE;
  }

  return adapter;
}
