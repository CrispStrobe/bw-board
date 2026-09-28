import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebugTarget, getTargetKinds } from '../src/debug-target-factory.js';
import { applyMedia } from '../src/machine-media.js';
import { resolveDosboxMedia } from '../src/dosbox-config.js';
import { PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP,
  PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA } from '../src/experimental/i80386-at-machine.js';

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

test('386 browser target loads the Doom board media at BIOS, VGA and FDC addresses', async () => {
  const {adapter, target} = await createDebugTarget('i80386', {
    profile: 'freedos-vga',
  });
  const bios = new Uint8Array(0x10000).fill(0xf4);
  const vgaRom = new Uint8Array(38400).fill(0x5a);
  vgaRom[vgaRom.length - 1] = 0xa5;
  const hdd = new Uint8Array(306 * 4 * 17 * 512);
  const floppy = new Uint8Array(80 * 2 * 15 * 512);
  floppy[0] = 0xeb;
  const media = applyMedia({adapter, machine: adapter.machine, kind: 'i80386'},
    {bios, 'vga-rom': vgaRom, hdd, floppy});
  assert.deepEqual(media, {applied: ['bios', 'vga-rom', 'hdd', 'floppy'], errors: []});
  const machine = adapter.machine;
  assert.equal(machine._read386(0xf0000), 0xf4);
  assert.equal(machine._read386(0xfffffff0), 0xf4);
  assert.equal(machine._read386(0xc0000), 0x5a);
  assert.equal(machine._read386(0xc0000 + vgaRom.length - 1), 0xa5);
  assert.deepEqual(machine.ata.geometry, {cylinders: 306, heads: 4, sectors: 17});
  assert.deepEqual(machine.chips.fdc1.drives[0].geom,
    {cylinders: 80, heads: 2, sectors: 15, bytesPerSector: 512});
  assert.equal(machine.chips.fdc1.drives[0].image[0], 0xeb);
  machine.reset();
  assert.equal(machine.cpu.pc, 0xfffffff0);
  assert.equal(target.keyIn(0x1e), true);
  assert.equal(target.video().width, 720);
});

test('386 browser Doom preset is opt-in and rejects ambiguous profiles', async () => {
  const plain = await createDebugTarget('i80386', {});
  assert.equal(plain.adapter.machine.vgaMemory, null);
  assert.ok(plain.adapter.machine.chips.cga1);
  await assert.rejects(createDebugTarget('i80386', {profile: 'unknown'}), /unknown 386 adapter profile/);
  await assert.rejects(createDebugTarget('i80386', {
    profile: 'freedos-vga', config: PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA,
  }), /config or profile/);
});

test('386 adapter refuses unsupported floppy size without replacing installed media', async () => {
  const {adapter} = await createDebugTarget('i80386', {
    config: PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA,
  });
  const first = new Uint8Array(80 * 2 * 15 * 512);
  first[0] = 0xeb;
  adapter.attachFloppyImage(first);
  const installed = adapter.machine.chips.fdc1.drives[0].image;
  assert.notEqual(installed, first);
  assert.equal(installed[0], 0xeb);
  assert.throws(() => adapter.attachFloppyImage(new Uint8Array(123)), /360KiB or 1.2MiB/);
  assert.equal(adapter.machine.chips.fdc1.drives[0].image, installed);
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
