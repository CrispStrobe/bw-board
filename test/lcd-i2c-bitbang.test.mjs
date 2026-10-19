/**
 * char_lcd_i2c END-TO-END: the transpiler's exact bit-banged driver
 * sequence, through real board pins, must put text on the display.
 *
 * The 49-lcd-hello example runs its firmware in the app (count advances,
 * sda/scl toggle) yet the engine display stays blank — this test decides
 * WHERE the bytes die: it mirrors the generated C driver line for line
 * (i2c_start/write/stop, PCF8574 D7..D4|BL|EN|RW|RS framing, HD44780
 * 4-bit init, nibble pairs) against the same netlist shape the example
 * seats (open-drain master, 4k7 pull-ups, address 0x27).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

function lcdBoard() {
  const board = new BoardImpl(5.0);
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'LCD', kind: 'char_lcd_i2c', params: { address: 0x27, cols: 16, rows: 2 },
      terminals: ['sda', 'scl', 'vcc', 'gnd'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P2.1', 'P2.2'] },
  ], [
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }, { part: 'LCD', terminal: 'vcc' }] },
    { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LCD', terminal: 'gnd' }] },
    { id: 'nsda', terminals: [{ part: 'MCU', terminal: 'P2.1' }, { part: 'R1', terminal: 'b' }, { part: 'LCD', terminal: 'sda' }] },
    { id: 'nscl', terminals: [{ part: 'MCU', terminal: 'P2.2' }, { part: 'R2', terminal: 'b' }, { part: 'LCD', terminal: 'scl' }] },
  ]);
  let t = 0n;
  const tick = () => { t += 5_000n; board.advanceTo(t); };
  // The 8051 driver drives quasi-bidirectional pins; writing 1 releases
  // (weak high via pull-up), writing 0 sinks. Open-drain models that.
  const sda = (h) => { board.setPin('P2.1', 'opendrain', h); tick(); };
  const scl = (h) => { board.setPin('P2.2', 'opendrain', h); tick(); };

  // ── the generated C driver, line for line ──
  const i2c_start = () => { sda(1); scl(1); sda(0); scl(0); };
  const i2c_stop = () => { sda(0); scl(1); sda(1); };
  const i2c_write = (b) => {
    for (let i = 7; i >= 0; i--) { sda((b >> i) & 1); scl(1); scl(0); }
    sda(1);            // release for ACK
    scl(1); scl(0);    // ACK clock (slave would pull low; write-only: ignored)
  };
  const lcd_i2c_send = (val) => { i2c_start(); i2c_write(0x27 << 1); i2c_write(val); i2c_stop(); };
  const lcd_nibble = (nib, rs) => {
    const val = (nib & 0xF0) | 0x08 | rs;   /* BL=1 */
    lcd_i2c_send(val | 0x04);               /* EN=1 */
    lcd_i2c_send(val & ~0x04);              /* EN=0 */
  };
  const lcd_cmd = (c) => { lcd_nibble(c & 0xF0, 0); lcd_nibble((c << 4) & 0xF0, 0); };
  const lcd_data = (d) => { lcd_nibble(d & 0xF0, 1); lcd_nibble((d << 4) & 0xF0, 1); };
  const lcd_init = () => {
    lcd_nibble(0x30, 0); lcd_nibble(0x30, 0); lcd_nibble(0x30, 0);
    lcd_nibble(0x20, 0);
    lcd_cmd(0x28); lcd_cmd(0x0C); lcd_cmd(0x06); lcd_cmd(0x01);
  };
  return { board, lcd_init, lcd_data, lcd_cmd };
}

describe('char_lcd_i2c: the generated driver sequence lands text', () => {
  it('init + "HI" appears in the display rows', () => {
    const { board, lcd_init, lcd_data } = lcdBoard();
    lcd_init();
    lcd_data('H'.charCodeAt(0));
    lcd_data('I'.charCodeAt(0));
    const st = board.getDeviceState('LCD');
    assert.ok(st, 'device state exists');
    const rows = st.display;
    assert.ok(Array.isArray(rows), 'display rows exist');
    assert.ok(rows[0].startsWith('HI'),
      `expected "HI" at row 0, got ${JSON.stringify(rows)}`);
  });

  it('cursor to row 1 + text lands on row 1', () => {
    const { board, lcd_init, lcd_data, lcd_cmd } = lcdBoard();
    lcd_init();
    lcd_cmd(0x80 | 0x40);   // row 1, col 0
    lcd_data('X'.charCodeAt(0));
    const rows = board.getDeviceState('LCD').display;
    assert.ok(rows[1].startsWith('X'),
      `expected "X" at row 1, got ${JSON.stringify(rows)}`);
  });
});
