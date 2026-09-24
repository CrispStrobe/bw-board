// Serial INPUT on the AVR: bytes sent to UART0 reach the program, in order,
// at the programmed baud rate -- proven with a hand-assembled echo, no
// toolchain in the loop. The program sends back each byte PLUS ONE, so a
// pass proves the byte went in AND was read by the program, not looped back.
//
//   word  instr              encoding
//   0     LDI r16,0x18       1110 0001 0000 1000 = 0xE108  RXEN0|TXEN0
//   1-2   STS 0xC1,r16       0x9300 0x00C1                 UCSR0B
//   3     LDI r16,0x06       0xE006                        8N1
//   4-5   STS 0xC2,r16       0x9300 0x00C2                 UCSR0C
//   6     LDI r16,0x08       0xE008                        UBRR0L=8 (~111 kbaud)
//   7-8   STS 0xC4,r16       0x9300 0x00C4
//   9-10  loop: LDS r17,0xC0 0x9110 0x00C0                 UCSR0A
//   11    SBRS r17,7         1111 1111 0001 0111 = 0xFF17  RXC0 set?
//   12    RJMP loop          0xCFFC  (-4)
//   13-14 LDS r18,0xC6       0x9120 0x00C6                 UDR0
//   15    INC r18            1001 0101 0010 0011 = 0x9523
//   16-17 wait: LDS r17,0xC0 0x9110 0x00C0
//   18    SBRS r17,5         0xFF15                        UDRE0 set?
//   19    RJMP wait          0xCFFC  (-4)
//   20-21 STS 0xC6,r18       0x9320 0x00C6                 UDR0
//   22    RJMP loop          0xCFF2  (-14)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';

const ECHO_PLUS_ONE = new Uint16Array([
  0xE108, 0x9300, 0x00C1, 0xE006, 0x9300, 0x00C2, 0xE008, 0x9300, 0x00C4,
  0x9110, 0x00C0, 0xFF17, 0xCFFC, 0x9120, 0x00C6, 0x9523,
  0x9110, 0x00C0, 0xFF15, 0xCFFC, 0x9320, 0x00C6, 0xCFF2,
]);

function run(sendBeforeStart, sendAfterStart = null) {
  const a = createAvr8jsAdapter({ program: ECHO_PLUS_ONE });
  let out = '';
  a.onSerial((b) => { out += String.fromCharCode(b); });
  // Sent at t=0, before the program has enabled its receiver: must WAIT.
  if (sendBeforeStart) assert.equal(a.sendSerial(Buffer.from(sendBeforeStart)), true);
  a.advanceNs(1_000_000);
  if (sendAfterStart) a.sendSerial(Buffer.from(sendAfterStart));
  a.advanceNs(10_000_000);
  return out;
}

test('bytes sent before the receiver is enabled wait, then arrive in order', () => {
  assert.equal(run('abc'), 'bcd');
});

test('a burst sent to a running program arrives whole and in order', () => {
  assert.equal(run(null, 'hello world'), 'ifmmp!xpsme');
});

test('a single byte (a number) is accepted too', () => {
  const a = createAvr8jsAdapter({ program: ECHO_PLUS_ONE });
  let out = [];
  a.onSerial((b) => out.push(b));
  a.advanceNs(1_000_000);
  a.sendSerial(0x41);
  a.advanceNs(2_000_000);
  assert.deepEqual(out, [0x42]);
});

test('a chip without a USART says so instead of swallowing the bytes', () => {
  const a = createAvr8jsAdapter({ chip: 'attiny85' });
  assert.equal(a.sendSerial(0x41), false);
});

test('under the debugger too: its run loop bypasses advanceNs, and still delivers', async () => {
  const { createAvr8jsDebugTarget } = await import('../src/avr8js-debug.js');
  const a = createAvr8jsAdapter({ program: ECHO_PLUS_ONE });
  let out = '';
  a.onSerial((b) => { out += String.fromCharCode(b); });
  const target = createAvr8jsDebugTarget(a);
  a.sendSerial(Buffer.from('HAL'));                 // before the receiver is on
  target.run();
  for (let i = 0; i < 20; i++) target.runFor(1_000_000);
  assert.equal(out, 'IBM');
});
