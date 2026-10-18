import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildFixture, sha256, RANGES, WIRE_MAGIC, WIRE_END} from '../scripts/i80386-ring3-int-iret/fixture.mjs';
import {expectedMemory, expectedWire, validateWire, validateObservations, wirePaddingOffsets, executeFixture} from '../scripts/i80386-ring3-int-iret/probe.mjs';

test('pure authored ROM has independent reset, gate, TSS and code32 transition bytes', () => {
  const f = buildFixture(), bytes = Buffer.from(f.rom), m = f.manifest;
  assert.equal(bytes.length, 65536); assert.equal(sha256(bytes), m.romSha256);
  assert.equal(sha256(bytes), 'd1aa0e35a81c68bc61621309589c8f4afa12ce2e7369af43879c718d109e2529');
  assert.deepEqual(m.symbols, {initialIretd: 0x405e, int80: 0x505b, returned: 0x505d, int81: 0x50c2, iretd: 0x60a6, exit: 0x628c});
  assert.deepEqual([...bytes.subarray(0xfff0, 0xfff5)], [0xea, 0, 0, 0, 0xf0]);
  assert.equal(bytes.subarray(0x1000, 0x1030).toString('hex'), '0000000000000000ffff0000009acf00ffff00000092cf00ffff000000facf00ffff000000f2cf006700002000890000');
  assert.equal(bytes.subarray(0x1c00, 0x1c10).toString('hex'), '0060080000ee00000062080000ee0000');
  assert.equal(bytes.readUInt32LE(0x2004), 0x8000); assert.equal(bytes.readUInt16LE(0x2008), 0x10);
  assert.equal(bytes.readUInt16LE(0x2066), 0x68);
  assert.deepEqual([...bytes.subarray(m.symbols.int80, m.symbols.returned)], [0xcd, 0x80]);
  assert.equal(bytes[m.symbols.iretd], 0xcf); assert.notEqual(bytes[m.symbols.iretd - 1], 0x66);
  assert.deepEqual([...bytes.subarray(m.symbols.int81, m.symbols.int81 + 2)], [0xcd, 0x81]);
  assert.equal(bytes[m.symbols.exit], 0xee);
  for (const block of m.blocks) assert.ok(block.bytes > 0 && block.bytes < 1024 && block.address === block.offset);
  const another = buildFixture(); f.rom[0] ^= 255; assert.equal(sha256(another.rom), m.romSha256);
});

test('independent literal register/frame/flags and scratch expectations cover actual records and guards', () => {
  const f = buildFixture(), memory = expectedMemory(f);
  assert.deepEqual(Array.from({length: 8}, (_, index) => memory.readUInt32LE(0x7000 + 4 * index)),
    [0x11223344, 0x99aabbcc, 0xddeeff00, 0x55667788, 0x9000, 0x0badc0de, 0x12345678, 0x87654321]);
  assert.equal(memory.readUInt32LE(0x7040 + 16), 0x7fec);
  assert.equal(memory.readUInt32LE(0x7080), 0xa1b2c3d4);
  assert.deepEqual(Array.from({length: 5}, (_, index) => memory.readUInt32LE(0x70c0 + index * 4)),
    [f.manifest.symbols.returned, 0x1b, 0x202, 0x9000, 0x23]);
  assert.equal(memory.readUInt32LE(0x7fe8), 2); assert.equal(memory.readUInt32LE(0x8ffc), 0x202);
  for (const address of [0x7fc0, 0x8000, 0x8fc0, 0x9000, 0x9fc0, 0xa000]) assert.ok(memory.subarray(address, address + 32).every(value => value === 0xcc));
  assert.deepEqual([13, 21, 29, 37, 45].map(offset => memory[0x1000 + offset]), [0x9b, 0x93, 0xfb, 0xf3, 0x8b]);
  assert.equal(memory.readUInt32LE(0x2004), 0xa000);
});

test('binary reporter projection preserves padding only and rejects defined frame, guard and register mutations', () => {
  const f = buildFixture(), wire = expectedWire(f), offsets = wirePaddingOffsets();
  assert.equal(wire.length, f.manifest.wireBytes); assert.equal(offsets.length, 12);
  assert.deepEqual(wire.subarray(0, WIRE_MAGIC.length), WIRE_MAGIC); assert.deepEqual(wire.subarray(-WIRE_END.length), WIRE_END);
  assert.equal(validateWire(wire, f).projectedPaddingBytes, 12);
  const padding = Buffer.from(wire); for (const offset of offsets) padding[offset] ^= 0x5a;
  assert.doesNotThrow(() => validateWire(padding, f));
  const copyOnlyPadding = Buffer.from(wire); copyOnlyPadding[WIRE_MAGIC.length + 0xc0 + 6] ^= 1;
  assert.throws(() => validateWire(copyOnlyPadding, f), /frame-copy/);
  const starts = new Map(); let start = WIRE_MAGIC.length;
  for (const range of RANGES) { starts.set(range.name, start); start += range.bytes; }
  for (const offset of [0, starts.get('records'), starts.get('records') + 0xc0, starts.get('records') + 0xc4,
    starts.get('records') + 0xc8, starts.get('records') + 0xcc, starts.get('records') + 0xd0, starts.get('kernelStack'), starts.get('userStack')]) {
    const changed = Buffer.from(wire); changed[offset] ^= 1;
    assert.throws(() => validateWire(changed, f), /mismatch|frame-copy/);
  }
  assert.throws(() => validateWire(wire.subarray(1), f), /extent/);
});

test('actual observation validator requires all original frame bytes and catches semantic record changes', () => {
  const f = buildFixture();
  const phases = [['before-int80', 0x505b, 3, 0x202, false], ['handler-entry', 0x6000, 0, 2, false],
    ['before-iretd', 0x60a6, 0, 2, true], ['returned-ring3', 0x505d, 3, 0x202, true]];
  const frame = Buffer.alloc(20); [0x505d, 0x1b, 0x202, 0x9000, 0x23].forEach((value, index) => frame.writeUInt32LE(value, index * 4));
  const rows = phases.map(([stage, eip, cpl, eflags, response], index) => ({stage, eip, linear: eip, cpl, eflags,
    beforeCall: index + 1, cr0: 1, cr3: 0,
    registers: {eax: response ? 0xa1b2c3d4 : 0x11223344, ecx: 0x99aabbcc, edx: 0xddeeff00, ebx: 0x55667788,
      esp: cpl === 0 ? 0x7fec : 0x9000, ebp: 0x0badc0de, esi: 0x12345678, edi: 0x87654321},
    selectors: {es: 0x23, cs: cpl === 0 ? 8 : 0x1b, ss: cpl === 0 ? 0x10 : 0x23, ds: 0x23, fs: 0x23, gs: 0x23},
    cs: {base: 0, limit: 0xffffffff, default32: true}, ss: {base: 0, limit: 0xffffffff, default32: true},
    tr: {selector: 0x28, base: 0x2000, limit: 0x67, present: true},
    opcode: index === 0 ? [0xcd, 0x80] : index === 2 ? [0xcf] : [0x89], frame: index === 0 ? Array(20).fill(0xcc) : [...frame]}));
  assert.doesNotThrow(() => validateObservations(rows, f));
  const emptyFrames = structuredClone(rows); for (const row of emptyFrames) row.frame = [];
  assert.throws(() => validateObservations(emptyFrames, f), /twenty-byte/);
  for (const body of [[], [...frame].slice(1), [...frame, 0], [-1, ...frame.subarray(1)], [256, ...frame.subarray(1)], [0.5, ...frame.subarray(1)], [NaN, ...frame.subarray(1)]]) {
    const changed = structuredClone(rows); changed[1].frame = body;
    assert.throws(() => validateObservations(changed, f), /twenty-byte/);
  }
  for (const change of [value => {value[1].cpl = 3;}, value => {value[2].eflags = 0x202;},
    value => {value[3].registers.eax ^= 1;}, value => {value[1].frame[12] ^= 1;}, value => {value[2].opcode = [0x66, 0xcf];}]) {
    const changed = structuredClone(rows); change(changed); assert.throws(() => validateObservations(changed, f));
  }
  const changedPadding = structuredClone(rows); changedPadding[2].frame[6] ^= 1;
  assert.throws(() => validateObservations(changedPadding, f), /frame retained/);
  const samePadding = structuredClone(rows); for (const row of samePadding.slice(1)) row.frame[6] ^= 1;
  assert.doesNotThrow(() => validateObservations(samePadding, f));
});

test('actual probe refuses an inert constructor fault without loading or stepping the emulator', async () => {
  let calls = 0;
  const result = await executeFixture({createCPU: async (bus, options) => {
    calls++; assert.deepEqual(options, {cpuProfile: 'strict386', hardwareReset: true, deliverFaults: false});
    assert.equal(bus.fetch(0xfffffff0), 0xea);
    throw Object.assign(new Error('authored inert constructor refusal'), {vector: 13, errorCode: 0});
  }});
  assert.equal(calls, 1); assert.equal(result.report.finiteRoundTripPass, false); assert.equal(result.report.calls, 0);
  assert.equal(result.report.firstFailure.message, 'authored inert constructor refusal');
  assert.equal(result.report.firstFailure.vector, 13); assert.equal(result.report.firstFailure.errorCode, 0);
  assert.deepEqual(result.observations, []); assert.deepEqual(result.writes, []); assert.equal(result.stdout.length, 0);
  assert.equal(sha256(result.memoryBefore), sha256(result.memoryAfter));
  const source = fs.readFileSync(new URL('../scripts/i80386-ring3-int-iret/probe.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/await import\('\.\.\/\.\.\/src\/experimental\/i80386\.js'\)/g) || []).length, 1);
  assert.match(source, /calls\+\+; cpu\.step\(\);/); assert.doesNotMatch(source, /cpu\.interrupt\(/);
});
