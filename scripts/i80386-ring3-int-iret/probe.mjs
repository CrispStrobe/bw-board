// MIT. Ordinary-CPU probe. Importing this module never imports or executes a CPU.
import {performance} from 'node:perf_hooks';
import {buildFixture, REGISTERS, SEGMENTS, RANGES, WIRE_MAGIC, WIRE_END, sha256} from './fixture.mjs';

export const LIMITS = Object.freeze({calls: 2000000, wallMs: 120000, writes: 4096, wireBytes: 131072});
const require = (condition, message) => { if (!condition) throw Error(message); };
const initial = Object.freeze([0x11223344, 0x99aabbcc, 0xddeeff00, 0x55667788, 0x9000, 0x0badc0de, 0x12345678, 0x87654321]);

// Declarative architectural expectations; no CPU or output-derived expected values.
export function expectedMemory(fixture) {
  const {manifest: m, rom} = fixture, memory = Buffer.alloc(1048576);
  for (const block of m.blocks) memory.set(rom.subarray(block.offset, block.offset + block.bytes), block.address);
  for (const [offset, value] of [[13, 0x9b], [21, 0x93], [29, 0xfb], [37, 0xf3], [45, 0x8b]]) memory[0x1000 + offset] = value;
  memory.writeUInt32LE(0xa000, 0x2004);
  const frame = (address, eip) => {
    [eip, 0x1b, 0x202, 0x9000, 0x23].forEach((value, index) => memory.writeUInt32LE(value, address + index * 4));
  };
  const record = (address, kernel, response) => {
    initial.forEach((value, index) => memory.writeUInt32LE(index === 4 && kernel ? 0x7fec : index === 0 && response ? 0xa1b2c3d4 : value, address + index * 4));
    [0x23, kernel ? 8 : 0x1b, kernel ? 0x10 : 0x23, 0x23, 0x23, 0x23]
      .forEach((value, index) => memory.writeUInt16LE(value, address + 32 + index * 2));
    memory.writeUInt32LE(kernel ? 2 : 0x202, address + 44);
  };
  record(0x7000, false, false); record(0x7040, true, false); record(0x7080, false, true);
  frame(0x70c0, m.symbols.returned); frame(0x7fec, m.symbols.returned);
  frame(0x9fec, m.symbols.int81 + 2);
  [0x5000, 0x1b, 0x202, 0x9000, 0x23].forEach((value, index) => memory.writeUInt32LE(value, 0xafec + index * 4));
  // PUSHFD scratch is an expected write, not an unchanged guard or part of INT80's frame.
  memory.writeUInt32LE(2, 0x7fe8); memory.writeUInt32LE(0x202, 0x8ffc);
  memory.writeUInt32LE(0x48414e44, 0x70d4); memory.writeUInt32LE(0x5245544e, 0x70d8);
  return memory;
}

export function expectedWire(fixture) {
  const memory = expectedMemory(fixture);
  return Buffer.concat([WIRE_MAGIC, ...RANGES.map(range => memory.subarray(range.address, range.address + range.bytes)), WIRE_END]);
}

export function wirePaddingOffsets() {
  const result = []; let offset = WIRE_MAGIC.length;
  for (const range of RANGES) {
    for (const frame of [0x70c0, 0x7fec, 0x9fec]) {
      if (frame >= range.address && frame + 20 <= range.address + range.bytes) {
        result.push(...[6, 7, 18, 19].map(byte => offset + frame - range.address + byte));
      }
    }
    offset += range.bytes;
  }
  return result;
}

export function validateWire(actual, fixture) {
  const bytes = Buffer.from(actual), expected = expectedWire(fixture), padding = new Set(wirePaddingOffsets());
  require(bytes.length === expected.length, 'closed reporter wire extent');
  const at = address => {
    let offset = WIRE_MAGIC.length;
    for (const range of RANGES) {
      if (address >= range.address && address < range.address + range.bytes) return offset + address - range.address;
      offset += range.bytes;
    }
    throw Error('frame outside fixed reporter ranges');
  };
  for (let index = 0; index < 20; index++) require(bytes[at(0x70c0) + index] === bytes[at(0x7fec) + index], 'all twenty original frame-copy bytes');
  for (let index = 0; index < bytes.length; index++) {
    if (!padding.has(index)) require(bytes[index] === expected[index], `reporter defined byte mismatch at ${index}`);
  }
  return {bytes: bytes.length, sha256: sha256(bytes), projectedPaddingBytes: padding.size};
}

function snapshot(cpu, read, stage, call) {
  const cs = cpu.segmentCaches[1], ss = cpu.segmentCaches[2];
  return {stage, beforeCall: call, eip: cpu.eip >>> 0, linear: (cs.base + cpu.eip) >>> 0,
    cpl: cpu.currentPrivilegeLevel, eflags: cpu.eflags >>> 0, cr0: cpu.cr0 >>> 0, cr3: cpu.cr3 >>> 0,
    registers: Object.fromEntries(REGISTERS.map(name => [name, cpu[name] >>> 0])),
    selectors: Object.fromEntries(SEGMENTS.map(name => [name, cpu[name]])),
    cs: {base: cs.base, limit: cs.limit, default32: cs.default32},
    ss: {base: ss.base, limit: ss.limit, default32: ss.default32},
    tr: {selector: cpu.tr.selector, base: cpu.tr.base, limit: cpu.tr.limit, present: cpu.tr.present},
    opcode: Array.from({length: stage === 'before-int80' ? 2 : 1}, (_, index) => read((cs.base + cpu.eip + index) >>> 0)),
    frame: Array.from({length: 20}, (_, index) => read(0x7fec + index))};
}

export function validateObservations(rows, fixture) {
  const symbols = fixture.manifest.symbols;
  const expected = [['before-int80', symbols.int80, 3, 0x202, false], ['handler-entry', 0x6000, 0, 2, false],
    ['before-iretd', symbols.iretd, 0, 2, true], ['returned-ring3', symbols.returned, 3, 0x202, true]];
  require(rows.length === 4, 'four original instruction observations');
  let previous = 0;
  rows.forEach((row, index) => {
    const [stage, eip, cpl, flags, response] = expected[index];
    require(row.stage === stage && row.eip === eip && row.linear === eip && row.cpl === cpl, 'ordered original CPU site');
    require(Number.isSafeInteger(row.beforeCall) && row.beforeCall > previous, 'ordinary call ordering'); previous = row.beforeCall;
    require(row.eflags === flags && row.cr0 === 1 && row.cr3 === 0, 'IF/flags or paging premise');
    REGISTERS.forEach((name, reg) => require(row.registers[name] === (reg === 4 && cpl === 0 ? 0x7fec : reg === 0 && response ? 0xa1b2c3d4 : initial[reg]), `original register ${name}`));
    SEGMENTS.forEach((name, reg) => require(row.selectors[name] === (reg === 1 ? cpl === 0 ? 8 : 0x1b : reg === 2 ? cpl === 0 ? 0x10 : 0x23 : 0x23), `original selector ${name}`));
    require(row.cs.base === 0 && row.ss.base === 0 && row.cs.default32 === true && row.ss.default32 === true && row.cs.limit === 0xffffffff && row.ss.limit === 0xffffffff, 'flat code32 and stack32 caches');
    require(row.tr.selector === 0x28 && row.tr.base === 0x2000 && row.tr.limit === 0x67 && row.tr.present === true, 'current TSS identity');
    require(JSON.stringify(row.opcode) === JSON.stringify(index === 0 ? [0xcd, 0x80] : index === 2 ? [0xcf] : [0x89]), 'original opcode witness');
    require(Array.isArray(row.frame) && row.frame.length === 20 && row.frame.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'closed twenty-byte original frame');
    if (index > 1) require(row.frame.every((value, byte) => value === rows[1].frame[byte]), 'original frame retained through IRETD');
    const frame = expectedMemory(fixture).subarray(0x7fec, 0x8000);
    row.frame.forEach((value, byte) => require(index === 0 ? value === 0xcc : [6, 7, 18, 19].includes(byte) || value === frame[byte], 'original INT80 frame bytes'));
  });
}

export async function executeFixture({fixture = buildFixture(), createCPU, now = () => performance.now()} = {}) {
  const started = now(), memory = new Uint8Array(1048576), before = memory.slice(), observations = [], writes = [], output = [], ports = [];
  let calls = 0, completed = false, primary = null;
  const {rom, manifest} = fixture;
  const read = address => {
    const at = address >>> 0;
    if (at >= 0xffff0000) return rom[at & 65535];
    if (at >= 0xf0000 && at <= 0xfffff) return rom[at - 0xf0000];
    require(at < memory.length, 'owned read extent'); return memory[at];
  };
  const bus = {read, fetch: read, write: (address, value) => {
    const at = address >>> 0; require(at < 0xf0000 && value >= 0 && value <= 255, 'owned writable RAM extent');
    require(writes.length < LIMITS.writes, 'write journal cap');
    writes.push({index: writes.length, call: calls, address: at, before: memory[at], after: value}); memory[at] = value;
  }, inPort: () => { throw Error('no input-port dependency admitted'); }, outPort: (port, value) => {
    require([0x21, 0xa1, 0xe9, 0xf4].includes(port), 'unexpected output port');
    if (port === 0xe9) { require(output.length < LIMITS.wireBytes, 'reporter output cap'); output.push(value & 255); }
    else if (port === 0xf4) { require(!completed && value === 0, 'one terminal debug exit'); completed = true; }
    else { require(value === 255, 'PIC mask value'); ports.push({port, value, call: calls}); }
  }};
  try {
    require(rom.length === 65536 && sha256(rom) === manifest.romSha256, 'frozen ROM identity');
    const make = createCPU ?? (async (ownedBus, options) => {
      const {ExperimentalI80386} = await import('../../src/experimental/i80386.js');
      return new ExperimentalI80386(ownedBus, options);
    });
    const cpu = await make(bus, {cpuProfile: 'strict386', hardwareReset: true, deliverFaults: false});
    const sites = [['before-int80', manifest.symbols.int80], ['handler-entry', 0x6000],
      ['before-iretd', manifest.symbols.iretd], ['returned-ring3', manifest.symbols.returned]];
    while (!completed) {
      require(calls < LIMITS.calls && now() - started <= LIMITS.wallMs, 'ordinary step/wall bound');
      require(!cpu.shutdown && !cpu.halted, 'unexpected shutdown or halt');
      const site = sites[observations.length];
      if (site && ((cpu.segmentCaches[1].base + cpu.eip) >>> 0) === site[1]) observations.push(snapshot(cpu, read, site[0], calls + 1));
      calls++; cpu.step();
    }
    require(ports.length === 2 && ports[0].port === 0x21 && ports[1].port === 0xa1, 'both original PIC masks');
    validateObservations(observations, fixture); validateWire(output, fixture);
    const replay = before.slice();
    for (const row of writes) { require(replay[row.address] === row.before, 'write replay before byte'); replay[row.address] = row.after; }
    require(sha256(replay) === sha256(memory), 'whole owned RAM write replay');
  } catch (error) {
    primary = {phase: 'ordinary-js-probe', name: error?.constructor?.name ?? 'Error', message: String(error?.message ?? error),
      vector: Number.isInteger(error?.vector) ? error.vector : null, errorCode: Number.isInteger(error?.errorCode) ? error.errorCode : null};
  }
  return {report: {schema: 'bw.ring3.js-probe.v1', finiteRoundTripPass: primary === null, firstFailure: primary,
    calls, completed, fixtureSha256: manifest.romSha256, memoryBeforeSha256: sha256(before), memoryAfterSha256: sha256(memory),
    outputSha256: sha256(Buffer.from(output)), ports, observations: observations.length},
    observations, writes, memoryBefore: before, memoryAfter: memory.slice(), stdout: Uint8Array.from(output)};
}
