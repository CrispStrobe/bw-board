// Hardware SPI reaches the pins: SPI.transfer() clocks a pin-level part.
//
// Every SPI part on the board is modelled at pin level (it watches SCK/MOSI
// and drives MISO). avr8js's AVRSPI never touched a pin, so before
// spi-bridge's pin-level path a hardware transfer reached no part and read
// 0xFF -- measured with an Arduino sketch: an nRF24 read FF FF over
// SPI.transfer and 08 0E bit-banged on the same wires.
//
// Hand-assembled (ATmega328P; D10=PB2 CSN, D11=PB3 MOSI, D12=PB4 MISO, D13=PB5 SCK):
//   0  LDI r16,0x2C       E20C   CSN, MOSI, SCK outputs
//   1  OUT DDRB,r16       B904
//   2  SBI PORTB,2        9A2A   CSN high
//   3  LDI r16,SPCR       E5xx   SPE|MSTR, fosc/4, the mode under test
//   4  OUT SPCR,r16       BD0C
//   5  CBI PORTB,2        982A   CSN low
//   6  LDI r16,0x00       E000   R_REGISTER CONFIG
//   7  OUT SPDR,r16       BD0E
//   8  IN r17,SPSR        B51D   wait SPIF
//   9  SBRS r17,7         FF17
//   10 RJMP 8             CFFD
//   11 IN r19,SPDR        B53E   r19 = what came back with the command: STATUS
//   12 LDI r16,0xFF       EF0F   NOP
//   13 OUT SPDR,r16       BD0E
//   14 IN r17,SPSR        B51D
//   15 SBRS r17,7         FF17
//   16 RJMP 14            CFFD
//   17 IN r18,SPDR        B52E   r18 = CONFIG
//   18 SBI PORTB,2        9A2A
//   19 RJMP .-1           CFFF
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const program = (spcr) => new Uint16Array([
  0xE20C, 0xB904, 0x9A2A, 0xE500 | ((spcr & 0xF0) << 4) | (spcr & 0x0F), 0xBD0C, 0x982A, 0xE000, 0xBD0E,
  0xB51D, 0xFF17, 0xCFFD, 0xB53E, 0xEF0F, 0xBD0E, 0xB51D, 0xFF17,
  0xCFFD, 0xB52E, 0x9A2A, 0xCFFF,
]);

function run(spcr) {
  const n = (id, ...t) => ({ id, terminals: t.map(([part, terminal]) => ({ part, terminal })) });
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
     { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
     { id: 'RF', kind: 'nrf24l01', params: {}, terminals: ['vcc', 'gnd', 'ce', 'csn', 'sck', 'mosi', 'miso', 'irq'] },
     { id: 'U1', kind: 'mcu', params: {}, terminals: ['D10', 'D11', 'D12', 'D13', 'gnd'] }],
    [n('vcc', ['VCC', 'vcc'], ['RF', 'vcc']), n('gnd', ['GND', 'gnd'], ['RF', 'gnd'], ['U1', 'gnd'], ['RF', 'ce']),
     n('csn', ['U1', 'D10'], ['RF', 'csn']), n('mosi', ['U1', 'D11'], ['RF', 'mosi']),
     n('miso', ['U1', 'D12'], ['RF', 'miso']), n('sck', ['U1', 'D13'], ['RF', 'sck'])]);
  board.setPower(true);
  const a = createAvr8jsAdapter({ program: program(spcr) });
  const accesses = [];
  a.onDeviceAccess((d) => accesses.push(d));
  a.attachBoard(board);
  a.advanceNs(100_000);
  return { a, accesses };
}

// The nRF24 is a mode-0 part (datasheet: CPOL=0, CPHA=0); modes 1-3 are
// checked on the waveform below, not against a device outside its spec.
for (const [mode, spcr] of [['mode 0', 0x50]]) {
  test(`SPI ${mode}: a hardware transfer reads the nRF24's STATUS and CONFIG`, () => {
    const { a, accesses } = run(spcr);
    assert.equal(a.cpu.pc, 19, `stuck at word ${a.cpu.pc}`);
    assert.equal(a.cpu.data[19], 0x0E, `STATUS read 0x${a.cpu.data[19].toString(16)} (0xff = nothing on MISO)`);
    assert.equal(a.cpu.data[18], 0x08, `CONFIG read 0x${a.cpu.data[18].toString(16)}`);
    assert.deepEqual(accesses.filter((d) => d.bus === 'spi').map((d) => [d.tx, d.rx]), [[0x00, 0x0E], [0xFF, 0x08]]);
  });
}

test('SPI off: SCK and MOSI go back to the port', () => {
  const { a } = run(0x5C);                      // mode 3: SCK held high, MOSI last bit 1
  assert.equal(a.cpu.data[0x23] & 0x28, 0x28, 'while SPI is on the peripheral holds them');
  a.cpu.writeData(0x4c, 0x00);                  // SPCR = 0
  // PORTB (data 0x25) has SCK/MOSI low; the pins must read what PORTB says.
  assert.equal(a.cpu.data[0x23] & 0x28, a.cpu.data[0x25] & 0x28);
});

// A board that only records what the MCU drives: SCK idles at CPOL, MOSI is
// stable at every sampling edge (leading for CPHA=0, trailing for CPHA=1),
// and the bits decode to the bytes sent, MSB first.
for (const [cpol, cpha] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
  test(`SPI mode ${cpol * 2 + cpha}: the waveform on D13/D11 carries 0x00 then 0xFF`, () => {
    const spcr = 0x50 | (cpol << 3) | (cpha << 2);
    const a = createAvr8jsAdapter({ program: program(spcr) });
    const level = { D11: false, D13: false };
    const bits = [];
    let spiOn = false;
    a.attachBoard({
      advanceTo() {}, readAnalog: () => 0, readPin: () => 0,
      setPin(name, mode, high) {
        if (name !== 'D11' && name !== 'D13') return;
        const was = level[name];
        level[name] = mode === 'pushpull' && high;
        spiOn ||= !!(a.cpu.data[0x4c] & 0x40);
        if (name !== 'D13' || !spiOn || was === level.D13) return;
        const leading = level.D13 !== !!cpol;
        if (leading === !cpha) bits.push(level.D11 ? 1 : 0);
      },
    });
    a.advanceNs(100_000);
    assert.equal(a.cpu.pc, 19, `stuck at word ${a.cpu.pc}`);
    assert.equal(level.D13, !!cpol, 'SCK idles at CPOL while SPI is on');
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
    assert.deepEqual(bytes, [0x00, 0xFF], `bits ${bits.join('')}`);
  });
}
