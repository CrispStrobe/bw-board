// Internal EEPROM on the AVR engine: a write completes, and reads back.
//
// Before the adapter wired AVREEPROM, EECR's EEPE bit was plain RAM that
// nothing cleared, so a program waiting for a write to finish waited forever
// -- measured: an Arduino sketch using EEPROM printed one line and stopped.
// Hand-assembled, no toolchain (EECR = I/O 0x1F, EEDR 0x20, EEARL 0x21, EEARH 0x22):
//
//   word  instr              encoding
//   0     LDI r16,3          0xE003
//   1     OUT EEARL,r16      0xBD01
//   2     LDI r16,0          0xE000
//   3     OUT EEARH,r16      0xBD02
//   4     LDI r16,0x5A       0xE50A
//   5     OUT EEDR,r16       0xBD00
//   6     SBI EECR,2 (EEMPE) 0x9AFA
//   7     SBI EECR,1 (EEPE)  0x9AF9
//   8     wait: SBIC EECR,1  0x99F9   skip the RJMP once EEPE clears
//   9     RJMP wait          0xCFFE
//   10    SBI EECR,0 (EERE)  0x9AF8
//   11    IN r17,EEDR        0xB510
//   12    LDI r16,0xFF       0xEF0F
//   13    OUT DDRB,r16       0xB904
//   14    OUT PORTB,r17      0xB915
//   15    RJMP .-1           0xCFFF
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter, CHIPS } from '../src/avr8js-adapter.js';

const WRITE_THEN_READ = new Uint16Array([
  0xE003, 0xBD01, 0xE000, 0xBD02, 0xE50A, 0xBD00, 0x9AFA, 0x9AF9,
  0x99F9, 0xCFFE, 0x9AF8, 0xB510, 0xEF0F, 0xB904, 0xB915, 0xCFFF,
]);

test('ATmega328P: an EEPROM write completes and reads back', () => {
  const a = createAvr8jsAdapter({ program: WRITE_THEN_READ });
  a.attachBoard({ setPin() {}, advanceTo() {}, readAnalog: () => 0 });
  a.advanceNs(5_000_000);                    // 5 ms: a 1.8 ms write and change
  assert.equal(a.cpu.data[0x25], 0x5A, `PORTB is 0x${a.cpu.data[0x25].toString(16)}: the read-back never happened`);
  assert.equal(a.cpu.pc, 15, `stuck at word ${a.cpu.pc} -- 8/9 is the EEPE wait`);
});

test('every chip that has EEPROM declares it, with a size', () => {
  for (const [name, chip] of Object.entries(CHIPS)) {
    if (!chip.eeprom) continue;
    assert.ok(chip.eepromBytes > 0, `${name} has an EEPROM config but no size`);
    assert.equal(typeof chip.eeprom.eepromReadyInterrupt, 'number', `${name}: no EE_READY vector`);
  }
  for (const name of ['atmega328p', 'atmega88pa', 'atmega2560', 'atmega32u4', 'attiny85', 'attiny88']) {
    assert.ok(CHIPS[name].eeprom, `${name} has no EEPROM`);
  }
});

test('the written byte lands in the backing store at its address', () => {
  const a = createAvr8jsAdapter({ program: WRITE_THEN_READ });
  a.attachBoard({ setPin() {}, advanceTo() {}, readAnalog: () => 0 });
  a.advanceNs(5_000_000);
  assert.equal(a.eepromBackend.memory[3], 0x5A);
  assert.equal(a.eepromBackend.memory[2], 0xFF, 'neighbouring cell untouched (erased = 0xFF)');
});
