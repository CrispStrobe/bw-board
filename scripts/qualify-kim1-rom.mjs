// SPDX-License-Identifier: MIT
// Run with two user-supplied ROM paths, followed by any paper tapes to verify.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createKim1Machine, controlKim1Machine, stepKim1Machine, parseKim1Program, peekKim1Byte} from '../src/kim1-machine.js';
const [application, monitor, ...tapes] = process.argv.slice(2);
if (!application || !monitor) throw new Error('Usage: node scripts/qualify-kim1-rom.mjs 6530-003.bin 6530-002.bin [program.ptp ...]');
const s = createKim1Machine('0200: A9 42 8D 00 03 4C 05 02\n17FA: 00 1C');
const run = (cycles=100_000) => {
  const end = cycles + s.cpu.cycles;
  while (s.cpu.cycles < end && !s.error) stepKim1Machine(s);
  assert.equal(s.error, null);
};
controlKim1Machine(s, 'loadRoms', [readFileSync(application), readFileSync(monitor)]);
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
for (const file of tapes) {
  const source = readFileSync(file, 'utf8');
  const tape = parseKim1Program(source);
  controlKim1Machine(s, 'loadProgram', source);
  for (const [address, value] of Object.entries(tape.image)) assert.equal(peekKim1Byte(s, Number(address)), value);
  console.log(file, 'loaded bytes:', Object.keys(tape.image).length);
}
console.log('original-ROM keypad, SST using NMIV, GO, ST, TTY prompt, interactive write passed');
