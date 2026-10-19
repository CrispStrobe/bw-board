// The whole 6502-display chain, engine-side, no browser: an Eater-map
// machine whose VIA is a SEATED PART on a real board, running a
// hand-assembled ROM that writes "HI" to an HD44780 in 8-bit mode —
// exactly Ben Eater's wiring (PB0-7 = D0-7, PA5/6/7 = RS/RW/E). The
// machine's chip-qualified pin edges (via.PA7 …) must land on the wired
// nets and the LCD device model must decode them into text.
//
// This is the test the fork's rebuttal said was missing: sixty5o2.test
// proves machine→VIA→LCD at chip level with hooks; THIS proves it
// through BoardImpl, qualified pins, MNA and the device model.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { createM6502Adapter } from '../src/m6502-adapter.js';

registerAllDevices();

function eaterBoard() {
  const pa = ['PA5', 'PA6', 'PA7'];
  const pb = Array.from({ length: 8 }, (_, i) => `PB${i}`);
  const parts = [
    // The designer collapses the w65c22 to kind 'mcu' — mirror that.
    { id: 'via', kind: 'mcu', params: {}, terminals: [...pa, ...pb] },
    { id: 'lcd', kind: 'hd44780', params: {},
      terminals: ['vss', 'vdd', 'v0', 'rs', 'rw', 'e',
        'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'a', 'k'] },
    { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [];
  for (let i = 0; i < 8; i++) {
    nets.push({ id: `n_d${i}`, terminals: [
      { part: 'via', terminal: `PB${i}` }, { part: 'lcd', terminal: `d${i}` }] });
  }
  nets.push({ id: 'n_rs', terminals: [{ part: 'via', terminal: 'PA5' }, { part: 'lcd', terminal: 'rs' }] });
  nets.push({ id: 'n_rw', terminals: [{ part: 'via', terminal: 'PA6' }, { part: 'lcd', terminal: 'rw' }] });
  nets.push({ id: 'n_e', terminals: [{ part: 'via', terminal: 'PA7' }, { part: 'lcd', terminal: 'e' }] });
  nets.push({ id: 'n_vcc', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'lcd', terminal: 'vdd' }, { part: 'lcd', terminal: 'a' }] });
  nets.push({ id: 'n_gnd', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'lcd', terminal: 'vss' }, { part: 'lcd', terminal: 'v0' }, { part: 'lcd', terminal: 'k' }] });
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

/** Hand-assembled LCD hello for the Eater map, VIA at $6000.
 *  PORTB=$6000 PORTA=$6001 DDRB=$6002 DDRA=$6003. Program at $8000.
 *  The HD44780 model enforces the busy window (§p.22 — writes while
 *  BF=1 are rejected), so like any real program that skips busy-flag
 *  polling, this one spaces its writes with delay loops: ~400 us per
 *  call, four calls after Clear Display (1.52 ms busy). */
function helloRom() {
  const rom = new Uint8Array(0x8000).fill(0xea); // NOPs
  const CMD = 0xc0, PUTC = 0xd0, DLY = 0xe0;     // subroutine offsets in page $80
  const code = [];
  const emit = (...b) => code.push(...b);
  const jsr = off => emit(0x20, off, 0x80);
  emit(0xa9, 0xff, 0x8d, 0x02, 0x60);            // DDRB = $FF
  emit(0xa9, 0xe0, 0x8d, 0x03, 0x60);            // DDRA = $E0
  for (const [val, sub, dlys] of [
    [0x38, CMD, 1],   // function set: 8-bit, 2 lines
    [0x0e, CMD, 1],   // display on, cursor on
    [0x01, CMD, 4],   // clear display — long busy
    [0x06, CMD, 1],   // entry mode: increment
    [0x48, PUTC, 1],  // 'H'
    [0x49, PUTC, 1],  // 'I'
  ]) {
    emit(0xa9, val); jsr(sub);
    for (let i = 0; i < dlys; i++) jsr(DLY);
  }
  const spin = code.length;
  emit(0x4c, spin & 0xff, 0x80);                 // JMP self
  rom.set(code, 0x0000);
  rom.set([                                       // cmd: strobe with RS=0
    0x8d, 0x00, 0x60,
    0xa9, 0x00, 0x8d, 0x01, 0x60,
    0xa9, 0x80, 0x8d, 0x01, 0x60,
    0xa9, 0x00, 0x8d, 0x01, 0x60,
    0x60], CMD);
  rom.set([                                       // putc: strobe with RS=1
    0x8d, 0x00, 0x60,
    0xa9, 0x20, 0x8d, 0x01, 0x60,
    0xa9, 0xa0, 0x8d, 0x01, 0x60,
    0xa9, 0x20, 0x8d, 0x01, 0x60,
    0x60], PUTC);
  rom.set([0xa2, 0x50, 0xca, 0xd0, 0xfd, 0x60], DLY); // ~400 us
  rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;        // reset vector -> $8000
  return rom;
}

describe('machine → board → LCD, end to end', () => {
  it('the ROM writes HI and the seated HD44780 shows it', () => {
    const board = eaterBoard();
    const adapter = createM6502Adapter({
      config: {
        clockHz: 1_000_000,
        regions: [
          { kind: 'ram', start: 0x0000, end: 0x3fff },
          { kind: 'rom', start: 0x8000, end: 0xffff },
        ],
        chips: [{ kind: 'via', name: 'via', at: 0x6000 }],
      },
      rom: helloRom(),
    });
    adapter.attachBoard(board);
    adapter.advanceNs(10_000_000); // 10 ms — covers six writes + 4 ms of delays
    const st = board.getDeviceState('lcd');
    assert.ok(st, 'lcd device state exists');
    const text = String(st.text ?? '');
    assert.ok(/HI/.test(text), `LCD shows HI, got ${JSON.stringify(text)}`);
  });
});
