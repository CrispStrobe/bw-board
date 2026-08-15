// TAP loading: the block parser and LD-BYTES trap contract in
// isolation, then the FULL path — typing LOAD "" on the booted
// original ROM and letting it pull header+data through the trap.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseTap, ZXTape } from '../src/zx-tape.js';
import { Z80Machine } from '../src/z80-machine.js';

/** Build one TAP block: [len][flag][data][checksum]. */
function block(flag, data) {
  const len = data.length + 2;
  const out = [len & 0xff, len >> 8, flag, ...data];
  let ck = flag;
  for (const b of data) ck ^= b;
  out.push(ck);
  return out;
}
/** A PROGRAM header (type 0) + its data block. */
function programTap(name, progBytes, autostart = 0x8000) {
  const header = [0,
    ...Array.from({ length: 10 }, (_, i) => (name.charCodeAt(i) || 0x20)),
    progBytes.length & 0xff, progBytes.length >> 8,
    autostart & 0xff, autostart >> 8,
    progBytes.length & 0xff, progBytes.length >> 8];
  return Uint8Array.from([...block(0x00, header), ...block(0xff, progBytes)]);
}

describe('TAP parsing + trap contract', () => {
  it('parses blocks and serves them per the LD-BYTES register contract', () => {
    const tap = new ZXTape(programTap('test', [1, 2, 3]));
    assert.equal(tap.blocks.length, 2);
    const mem = new Uint8Array(65536);
    const cpu = { a: 0xff, f: 0x01, ix: 0x7000, d: 0, e: 3 };
    tap.pos = 1; // skip header; load the data block
    tap.trap(cpu, mem);
    assert.deepEqual([...mem.subarray(0x7000, 0x7003)], [1, 2, 3]);
    assert.equal(cpu.f & 1, 1, 'carry set = success');
    assert.equal(cpu.ix, 0x7003, 'IX past the end');
    assert.equal((cpu.d << 8) | cpu.e, 0, 'DE consumed');
  });
});

describe('LOAD "" on the real ROM', () => {
  const romPath = process.env.ZX_ROM || join(homedir(), 'code', 'zxs-rom', '48.ROM');
  it('the ROM pulls a program through the trap from a typed LOAD ""', {
    skip: !existsSync(romPath) && '48.ROM not built — see spectrum-smoke header',
  }, () => {
    const m = new Z80Machine({
      clockHz: 3_500_000,
      regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }],
      ula: true,
    });
    m.load(readFileSync(romPath), 0);
    m.cpu.pc = 0;
    m.insertTape(programTap('hello', [0xde, 0xad, 0xbe, 0xef]));
    m.advanceToMs(4200); // boot to (c)
    const key = (names, from) => {
      m.ula.setKeys(names); m.advanceToMs(from + 120);
      m.ula.setKeys([]); m.advanceToMs(from + 240);
      return from + 240;
    };
    let t = 4200;
    t = key(['j'], t);          // LOAD keyword
    t = key(['sym', 'p'], t);   // "
    t = key(['sym', 'p'], t);   // "
    t = key(['enter'], t);
    m.advanceToMs(t + 2000);    // ROM searches tape, trap serves both blocks
    // The program lands at PROG (23755 on a clean 48K).
    const prog = m.mem[23627] | (m.mem[23628] << 8); // VARS... use fixed 23755
    const at = 23755;
    assert.deepEqual([...m.mem.subarray(at, at + 4)], [0xde, 0xad, 0xbe, 0xef],
      `program bytes at PROG (${at}), got ${[...m.mem.subarray(at, at + 4)]}`);
  });
});
