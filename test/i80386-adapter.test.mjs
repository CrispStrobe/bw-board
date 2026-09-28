import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebugTarget, getTargetKinds } from '../src/debug-target-factory.js';
import { applyMedia } from '../src/machine-media.js';
import { resolveDosboxMedia } from '../src/dosbox-config.js';
import { PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP } from '../src/experimental/i80386-at-machine.js';

test('experimental 80386 is a first-class browser target with VGA/key surfaces', async () => {
  assert.ok(getTargetKinds().some(k => k.kind === 'i80386'));
  const { adapter, target } = await createDebugTarget('i80386', {});
  assert.equal(adapter.machine.cpuBackend, 'i80386-experimental');
  assert.equal(target.capabilities().keys.includes('scancode'), true);
  assert.equal(target.video().width, 720);
  assert.equal(typeof adapter.sendScancode, 'function');
  assert.equal(typeof adapter.mouseIn, 'function');
  assert.equal(adapter.mouseIn({dx: 1, dy: 1, buttons: 1}), false);
});

test('DOSBox disk media can attach lazily to the experimental target', async () => {
  const { adapter, target } = await createDebugTarget('i80386', {});
  const image = new Uint8Array(4 * 17 * 512);
  const result = applyMedia({ adapter, machine: adapter.machine, kind: 'i80386' }, { hdd: image });
  assert.equal(result.errors.some(e => e.slot === 'bios'), true);
  assert.deepEqual(result.applied, ['hdd']);
  assert.equal(adapter.machine.ata.mediaBytes().length, image.length);
  assert.equal(target.capabilities().keys.includes('scancode'), true);
});

test('DOSBox primary HDD config resolves through browser adapter media', async () => {
  const { adapter } = await createDebugTarget('i80386', {});
  const image = new Uint8Array(4 * 17 * 512);
  const config = new TextEncoder().encode('[autoexec]\nimgmount 2 "disk/owned.img" -t hdd\nboot -l c');
  const configured = applyMedia({ adapter, machine: adapter.machine, kind: 'i80386' }, { 'dosbox-conf': config });
  assert.deepEqual(configured.applied, ['dosbox-conf']);
  const resolved = resolveDosboxMedia(adapter.dosboxConfig, { 'owned.img': image });
  assert.deepEqual(resolved.missing, []);
  assert.deepEqual(resolved.refused, []);
  assert.equal(resolved.images[0].bytes, image);
  const attached = applyMedia({ adapter, machine: adapter.machine, kind: 'i80386' }, { hdd: resolved.images[0].bytes });
  assert.deepEqual(attached.applied, ['hdd']);
  assert.equal(adapter.machine.ata.mediaBytes().length, image.length);
});

test('native blocks are opt-in and the GUI run loop reaches the dispatcher', async () => {
  const plain = await createDebugTarget('i80386', {});
  assert.equal(plain.adapter.nativeDispatcher, null);

  const { adapter, target } = await createDebugTarget('i80386', {
    config: PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP, nativeBlocks: true,
  });
  const machine = adapter.machine;
  const dispatcher = adapter.nativeDispatcher;
  assert.ok(dispatcher);
  assert.equal(machine.mem.buffer, dispatcher.ramBridge.memory.buffer);

  const code = 0x80120000, phys = 0x120000, data = 0x80130000;
  const put32 = (address, value) => {
    for (let i = 0; i < 4; i++) machine._write386(address + i, value >>> (i * 8) & 0xff);
  };
  put32(0x1800, 0x4007);
  put32(0x4000 + 0x120 * 4, phys | 7);
  put32(0x4000 + 0x130 * 4, 0x130007);
  // MOV EAX,[EBX+ECX*4+10h]; CMP EAX,EDX; JNZ back to MOV.
  [0x8b, 0x44, 0x8b, 0x10, 0x39, 0xd0, 0x75, 0xf8]
    .forEach((byte, i) => machine._write386(phys + i, byte));
  put32(0x130000 + 24, 0x12345679);
  const cpu = machine.cpu;
  cpu.segmentCaches[1] = {base: 0, limit: 0xffffffff, default32: true,
    present: true, code: true, readable: true, writable: false};
  cpu.segmentCaches[0] = {base: 0, limit: 0xffffffff, default32: true,
    present: true, code: false, readable: true, writable: true};
  cpu.segmentCaches[3] = {base: 0, limit: 0xffffffff, default32: true,
    present: true, code: false, readable: true, writable: true};
  cpu.cr0 = 0x80000001; cpu.cr3 = 0x1000; cpu.eip = code;
  cpu.ebx = data; cpu.ecx = 2; cpu.edx = 0x12345678;
  cpu._translate(code); cpu._translate(data + 24);
  machine._chipDebt = 0; machine._chipDeadline = 100;

  target.run();
  const before = machine.cycles;
  assert.equal(target.runFor(36 * 1e9 / machine.clockHz), 'budget');
  assert.ok(dispatcher.stats.blockCalls > 0, 'the debugger did not run a native block');
  assert.ok(machine.cycles >= before + 36);
  assert.equal(cpu.eax, 0x12345679);

  const attempts = dispatcher.stats.attempts;
  target.step('insn');
  assert.equal(target.runFor(36 * 1e9 / machine.clockHz), 'halted');
  assert.equal(dispatcher.stats.attempts, attempts, 'instruction stepping must bypass native blocks');

  const bp = target.setBreakpoint({kind: 'code', addr: 0});
  assert.equal(typeof bp, 'number');
  target.run();
  assert.equal(target.runFor(12 * 1e9 / machine.clockHz), 'budget');
  assert.equal(dispatcher.stats.attempts, attempts, 'a breakpoint must keep per-instruction checks');
  target.clearBreakpoint(bp);

  const beforeAdvance = dispatcher.stats.attempts;
  adapter.advanceNs(12 * 1e9 / machine.clockHz);
  assert.ok(dispatcher.stats.attempts > beforeAdvance, 'adapter time advance did not use dispatcher');
  assert.equal(adapter.stats.advanceToCount, 1);
});

test('invalid native block options fail target creation', async () => {
  await assert.rejects(
    createDebugTarget('i80386', {nativeBlocks: {blockInstructions: 0}}),
    /invalid native dispatcher cache or block budget/,
  );
});
