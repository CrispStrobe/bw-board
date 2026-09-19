import test from 'node:test';
import assert from 'node:assert/strict';
import I8086, {UnsupportedProtectedMode} from '../src/i8086.js';
import {SEG_ES, SEG_CS, SEG_DS} from '../src/experimental/i80286-protected.js';
import ProtectedI80286, {ProtectedModeFault} from '../src/experimental/i80286-protected.js';

function fixture() {
  const mem = new Map(), reads = [], writes = [];
  const cpu = new ProtectedI80286({
    read(a) { reads.push(a >>> 0); return mem.get(a >>> 0) ?? 0; },
    fetch(a) { reads.push(a >>> 0); return mem.get(a >>> 0) ?? 0; },
    write(a, v) { writes.push([a >>> 0, v & 0xff]); mem.set(a >>> 0, v & 0xff); },
  });
  const put = (at, bytes) => bytes.forEach((b, i) => mem.set(at + i, b));
  const descriptor = (at, base, limit, access) => put(at, [
    limit & 0xff, limit >> 8, base & 0xff, (base >> 8) & 0xff,
    (base >> 16) & 0xff, access, 0, 0,
  ]);
  return {cpu, mem, reads, writes, put, descriptor};
}

function installBootstrap(f, code) {
  // LGDT [0100]; MOV AX,1; LMSW AX; JMP FAR 0000:0008
  f.put(0, [0x0f,0x01,0x16,0x00,0x01, 0xb8,0x01,0x00,
    0x0f,0x01,0xf0, 0xea,0x00,0x00,0x08,0x00]);
  f.put(0x100, [0x17,0x00, 0x00,0x02,0x00]);
  f.descriptor(0x208, 0x100000, 0xffff, 0x9a);
  f.descriptor(0x210, 0x120000, 0xffff, 0x92);
  f.put(0x100000, code);
  f.cpu.cs = 0; f.cpu.ip = 0;
}

test('owned program enters ring-0 protected mode and uses cached 24-bit segments', () => {
  const f = fixture();
  installBootstrap(f, [
    0xb8,0x10,0x00,       // MOV AX,0010
    0x8e,0xd8,            // MOV DS,AX
    0xb8,0x34,0x12,       // MOV AX,1234
    0x89,0x06,0x20,0x00,  // MOV [0020],AX
    0x8b,0x1e,0x20,0x00,  // MOV BX,[0020]
    0xf4,
  ]);
  for (let i = 0; i < 10 && !f.cpu.halted; i++) f.cpu.step();
  assert.equal(f.cpu.halted, true);
  assert.equal(f.cpu.cs, 8); assert.equal(f.cpu.ds, 0x10);
  assert.equal(f.cpu.pc, 0x100011, 'visible pc uses the cached 24-bit CS base');
  assert.equal(f.cpu.segmentCaches[SEG_CS].base, 0x100000);
  assert.equal(f.cpu.segmentCaches[SEG_DS].base, 0x120000);
  assert.equal(f.cpu.bx, 0x1234);
  assert.equal(f.mem.get(0x120020) | (f.mem.get(0x120021) << 8), 0x1234);
  assert.equal(f.mem.has(0x120), false, 'protected data access did not use selector<<4 alias');
  assert.equal(f.mem.get(0x20d) & 1, 1, 'far jump sets code descriptor accessed bit');
  assert.equal(f.mem.get(0x215) & 1, 1, 'MOV DS sets data descriptor accessed bit');
});

test('hidden caches belong to register identities, not selector values', () => {
  const f = fixture();
  installBootstrap(f, [0xb8,0x10,0x00, 0x8e,0xd8, 0x90]);
  for (let i = 0; i < 6; i++) f.cpu.step();
  assert.equal(f.cpu.ds, 0x10); assert.equal(f.cpu.segmentCaches[SEG_DS].base, 0x120000);
  f.descriptor(0x210, 0x140000, 0xffff, 0x93);
  f.put(0x100005, [0x8e,0xc0]); // MOV ES,AX using the same visible selector
  f.cpu.step();
  assert.equal(f.cpu.ds, f.cpu.es);
  assert.equal(f.cpu.segmentCaches[SEG_DS].base, 0x120000, 'DS retains its hidden cache');
  assert.equal(f.cpu.segmentCaches[SEG_ES].base, 0x140000, 'ES loaded the changed descriptor');
});

test('limit faults preflight full words, restart, and never fall through the real-mode IVT', () => {
  const f = fixture();
  installBootstrap(f, [0xb8,0x10,0x00, 0x8e,0xd8, 0x8b,0x06,0x10,0x00]);
  f.descriptor(0x210, 0x120000, 0x10, 0x92);
  for (let i = 0; i < 6; i++) f.cpu.step();
  const beforeReads = f.reads.length, beforeWrites = f.writes.length;
  assert.throws(() => f.cpu.step(), (e) => {
    assert.ok(e instanceof ProtectedModeFault); assert.equal(e.vector, 13);
    assert.equal(e.errorCode, 0); assert.equal(e.restartIp, 5); return true;
  });
  assert.equal(f.cpu.ip, 5, 'faulting MOV restarts at its opcode');
  assert.deepEqual(f.reads.slice(beforeReads), [0x100005,0x100006,0x100007,0x100008], 'only instruction bytes were fetched');
  assert.equal(f.writes.length, beforeWrites, 'no data byte or IVT stack write occurred');
});

test('code and stack spans fault before the first forbidden bus cycle', () => {
  const fetch = fixture();
  installBootstrap(fetch, [0xb8,0x10,0x00]);
  fetch.descriptor(0x208, 0x100000, 0, 0x9a);
  for (let i = 0; i < 4; i++) fetch.cpu.step();
  const fetchWrites = fetch.writes.length;
  assert.throws(() => fetch.cpu.step(), (e) => e instanceof ProtectedModeFault && e.vector === 13);
  assert.equal(fetch.cpu.ip, 0); assert.equal(fetch.cpu.ax, 1);
  assert.equal(fetch.writes.length, fetchWrites);

  const stack = fixture();
  installBootstrap(stack, [0xb8,0x10,0x00, 0x8e,0xd0, 0xbc,0x01,0x00, 0x50]);
  stack.descriptor(0x210, 0x120000, 0x10, 0x92);
  for (let i = 0; i < 7; i++) stack.cpu.step();
  const state = stack.cpu.getProtectedState(), writes = stack.writes.length;
  assert.throws(() => stack.cpu.step(), (e) => e instanceof ProtectedModeFault && e.vector === 12);
  assert.deepEqual(stack.cpu.getProtectedState(), state, 'faulting PUSH restored SP and all caches');
  assert.equal(stack.writes.length, writes, 'faulting PUSH did not write either byte');
});

test('forbidden privilege and descriptor types fail before cache or accessed-bit commit', () => {
  for (const [name, access, error] of [
    ['ring 1 code', 0xba, UnsupportedProtectedMode],
    ['data as CS', 0x92, ProtectedModeFault],
    ['system descriptor', 0x82, UnsupportedProtectedMode],
  ]) {
    const f = fixture(); installBootstrap(f, [0x90]); f.descriptor(0x208, 0x100000, 0xffff, access);
    for (let i = 0; i < 3; i++) f.cpu.step();
    const state = f.cpu.getProtectedState(), writes = f.writes.length;
    assert.throws(() => f.cpu.step(), error, name);
    assert.deepEqual(f.cpu.getProtectedState(), state, `${name} changed protected state`);
    assert.equal(f.writes.length, writes, `${name} wrote descriptor access byte`);
    assert.equal(f.mem.get(0x20d), access);
  }
});

test('unsupported protected paths refuse without architectural side effects', () => {
  for (const [name, bytes] of [
    ['software INT', [0xcd,0x21]], ['far CALL', [0x9a,0,0,8,0]],
    ['IRET', [0xcf]], ['POP DS', [0x1f]], ['LDS', [0xc5,0x06,0,0]],
    ['REP', [0xf3,0x90]],
  ]) {
    const f = fixture(); installBootstrap(f, bytes);
    for (let i = 0; i < 4; i++) f.cpu.step();
    const state = f.cpu.getProtectedState(), writes = f.writes.length;
    assert.throws(() => f.cpu.step(), UnsupportedProtectedMode, name);
    assert.deepEqual(f.cpu.getProtectedState(), state, `${name} changed CPU state`);
    assert.equal(f.writes.length, writes, `${name} wrote memory`);
  }

  const irq = fixture(); installBootstrap(irq, [0x90]);
  for (let i = 0; i < 4; i++) irq.cpu.step();
  const irqState = irq.cpu.getProtectedState(), irqWrites = irq.writes.length;
  assert.throws(() => irq.cpu.interrupt(0x20), UnsupportedProtectedMode);
  assert.deepEqual(irq.cpu.getProtectedState(), irqState);
  assert.equal(irq.writes.length, irqWrites, 'hardware interrupt did not use real-mode IVT');
});

test('ordinary 80286 core refuses to continue after LMSW sets PE', () => {
  const mem = new Uint8Array(32);
  mem.set([0x0f,0x01,0xf0,0x90]);
  const cpu = new I8086({read: a => mem[a] ?? 0, write: (a,v) => { mem[a] = v; }}, {variant:'80286'});
  cpu.cs = 0; cpu.ip = 0; cpu.ax = 1;
  cpu.step(); assert.equal(cpu.msw & 1, 1);
  assert.throws(() => cpu.step(), UnsupportedProtectedMode);
  assert.equal(cpu.ip, 3, 'unsupported continuation did not consume the next opcode');
});

test('legacy physical-address helper preserves raw selectors 0000h through 0004h', () => {
  const mem = new Map(), cpu = new I8086({read: a => mem.get(a) ?? 0, write: (a,v) => mem.set(a,v)}, {variant:'80286'});
  cpu.es = 0x1111; cpu.cs = 0x2222; cpu.ss = 0x3333; cpu.ds = 0x4444;
  for (let selector = 0; selector <= 4; selector++) {
    assert.equal(cpu._phys(selector, 7), (selector << 4) + 7, `raw selector ${selector}`);
  }
});

test('protected checkpoints resume execution and reset restores real-mode caches', () => {
  const f = fixture(); installBootstrap(f, [0x90,0x90,0xf4]);
  for (let i = 0; i < 5; i++) f.cpu.step();
  const saved = f.cpu.getProtectedState();
  assert.equal(f.cpu.pc, 0x100001);
  f.cpu.ax = 0xbeef; f.cpu.ip = 2; f.cpu.segmentCaches[SEG_CS].base = 0;
  f.cpu.setProtectedState(saved);
  assert.equal(f.cpu.pc, 0x100001, 'checkpoint restores the cached-base program counter');
  f.cpu.step(); assert.equal(f.cpu.ip, 2); assert.equal(f.cpu.ax, 1);
  f.cpu.step(); assert.equal(f.cpu.halted, true);
  f.cpu.reset();
  assert.equal(f.cpu.msw & 1, 0); assert.equal(f.cpu.cpl, 0);
  assert.equal(f.cpu.segmentCaches[SEG_CS].base, 0xffff0);
  assert.equal(f.cpu.segmentCaches[SEG_DS].base, 0);
});

test('protected instructions retain the 286 length cap and HLT performs no later fetch', () => {
  const long = fixture(); installBootstrap(long, Array(11).fill(0x26));
  for (let i=0; i<4; i++) long.cpu.step();
  assert.throws(() => long.cpu.step(), (e) => e instanceof ProtectedModeFault && e.vector === 13);
  assert.equal(long.cpu.ip, 0, 'overlong prefixed instruction restarts at its first prefix');

  const halt = fixture(); installBootstrap(halt, [0xf4,0x90]);
  for (let i=0; i<5; i++) halt.cpu.step();
  const reads=halt.reads.length, state=halt.cpu.getProtectedState();
  assert.equal(halt.cpu.step(), 0); assert.equal(halt.reads.length, reads);
  assert.deepEqual(halt.cpu.getProtectedState(), state, 'halted step is inert');
});

test('protected instruction fetch faults instead of wrapping from CS:FFFF to CS:0000', () => {
  const f=fixture(); installBootstrap(f, []);
  // Change the entry far jump to 0008:FFFF and place MOV AX,1234 there. The
  // opcode byte is legal; its first immediate byte would wrap the logical
  // instruction stream and must not be fetched from offset zero.
  f.mem.set(12,0xff); f.mem.set(13,0xff);
  f.put(0x10ffff,[0xb8]); f.put(0x100000,[0x34,0x12]);
  for(let i=0;i<4;i++)f.cpu.step();
  const reads=f.reads.length;
  assert.throws(()=>f.cpu.step(),e=>e instanceof ProtectedModeFault&&e.vector===13);
  assert.equal(f.cpu.ip,0xffff);
  assert.deepEqual(f.reads.slice(reads),[0x10ffff],'only the legal opcode byte reached the bus');
  assert.equal(f.cpu.ax,1,'faulting instruction did not commit its immediate');
});

test('TF on the PE transition refuses trap delivery without touching the real-mode IVT', () => {
  const f=fixture(); f.put(0, [0x0f,0x01,0xf0]);
  f.cpu.cs=0; f.cpu.ip=0; f.cpu.ax=1; f.cpu.flags=0x0102;
  const writes=f.writes.length, sp=f.cpu.sp;
  assert.throws(() => f.cpu.step(), UnsupportedProtectedMode);
  assert.equal(f.cpu.msw&1, 1, 'LMSW committed before its post-instruction trap point');
  assert.equal(f.cpu.sp, sp); assert.equal(f.writes.length, writes, 'no real-mode interrupt frame or IVT path ran');
});
