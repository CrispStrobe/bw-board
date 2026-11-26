// SPDX-License-Identifier: MIT
// Run with --brickwright or two user-supplied ROM paths, followed by optional paper tapes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createKim1Machine, controlKim1Machine, stepKim1Machine, parseKim1Program, peekKim1Byte} from '../src/kim1-machine.js';
const args = process.argv.slice(2);
const builtIn = args[0] === '--brickwright';
const tapeStart = builtIn ? 1 : 2;
if (!builtIn && args.length < tapeStart) {
  throw new Error('Usage: node scripts/qualify-kim1-rom.mjs --brickwright | 6530-003.bin 6530-002.bin [program.ptp ...]');
}
const tapes = args.slice(tapeStart);
const s = createKim1Machine('0200: A9 42 8D 00 03 4C 05 02\n17FA: 00 1C');
const run = (cycles = 100_000) => {
  const end = cycles + s.cpu.cycles;
  while (s.cpu.cycles < end && !s.error) stepKim1Machine(s);
  assert.equal(s.error, null);
};
if (builtIn) controlKim1Machine(s, 'useBrickwrightRom');
else controlKim1Machine(s, 'loadRoms', args.slice(0, 2).map(path => readFileSync(path)));
run();
assert.equal(s.display, '000000');
const key = value => { controlKim1Machine(s, 'key', value); run(); };
for (const value of ['AD', '0', '2', '0', '0']) key(value);
assert.equal(s.display, '0200A9');
controlKim1Machine(s, 'setSst', true);
key('GO');
assert.equal(s.display, '02028D');
assert.equal(peekKim1Byte(s, 0x300), 0);
controlKim1Machine(s, 'setSst', false);
key('GO');
assert.equal(peekKim1Byte(s, 0x300), 0x42);
key('ST');
assert.equal(s.display, '02054C');
controlKim1Machine(s, 'setTty', {enabled: true, baud: 300});
run(800_000);
assert.match(s.ttyOutput, /KIM/);
controlKim1Machine(s, 'clearTty');
controlKim1Machine(s, 'sendTty', '0200 5A.');
run(1_900_000);
assert.match(s.ttyOutput, /0200 A9/);
assert.equal(peekKim1Byte(s, 0x0200), 0x5a);
// Send binary data through the monitor's own TTY loader.
controlKim1Machine(s, 'clearTty');
controlKim1Machine(s, 'sendTty', 'L;030260A942000150\r\n;0000010001\r\n\x13');
run(4_500_000);
assert.deepEqual([0x260, 0x261, 0x262].map(address => peekKim1Byte(s, address)), [0xa9, 0x42, 0]);
if (builtIn) {
  controlKim1Machine(s, 'clearTty');
  controlKim1Machine(s, 'sendTty', 'L;010264EA0000\r\n;0000010001\r\n');
  run(4_000_000);
  assert.match(s.ttyOutput, /ERR/i);

  controlKim1Machine(s, 'loadProgram', '0260: A9 42 00\n17F7: 62 02');
  controlKim1Machine(s, 'clearTty');
  controlKim1Machine(s, 'sendTty', '0260 Q');
  run(6_000_000);
  const records = s.ttyOutput.match(/;[0-9a-f]{10,}/gi);
  assert.ok(records?.length, 'paper tape dump must include MOS records');
  assert.deepEqual(parseKim1Program(records.join('\n')).image, {608: 0xa9, 609: 0x42, 610: 0});
}
for (const file of tapes) {
  const source = readFileSync(file, 'utf8');
  const tape = parseKim1Program(source);
  controlKim1Machine(s, 'loadProgram', source);
  for (const [address, value] of Object.entries(tape.image)) assert.equal(peekKim1Byte(s, Number(address)), value);
  console.log(file, 'loaded bytes:', Object.keys(tape.image).length);
}
console.log(`${builtIn ? 'Brickwright' : 'Historical'} ROM passed keypad, SST, GO, ST, TTY prompt, interactive write and serial tape load.`);
if (builtIn) console.log('Brickwright ROM also rejected a bad tape checksum and dumped a round-trip image.');
