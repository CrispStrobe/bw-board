import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL_4M,
  PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from
  '../src/experimental/i80386-at-machine.js';
import {createI80386Code16WasmDispatcher} from
  '../src/experimental/i80386-code16-wasm-block.js';

function fixture(code, mode = 'real') {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M);
  const cpu = machine.cpu;
  cpu.cs = 0x1000; cpu.ds = 0x2000; cpu.eip = 0x20;
  cpu.segmentCaches[1] = {base: 0x10000, limit: 0xffff, default32: false,
    present: true, code: true, readable: true, writable: false};
  cpu.segmentCaches[3] = {base: 0x20000, limit: 0xffff, default32: false,
    present: true, code: false, readable: true, writable: true};
  if (mode !== 'real') cpu.cr0 = 1;
  if (mode === 'vm86') cpu.eflags |= 0x20000;
  machine.mem.set(code, 0x10020);
  machine._chipDebt = 0;
  machine._chipDeadline = 10000;
  return machine;
}
function put32(machine, address, value) {
  for (let i = 0; i < 4; i++) machine._write386(address + i, value >>> (i * 8));
}
function paged(machine) {
  const cpu = machine.cpu;
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  put32(machine, 0x1000, 0x4007);
  put32(machine, 0x4000 + ((0x10000 >>> 10) & 0xffc), 0x10007);
  put32(machine, 0x4000 + ((0x20000 >>> 10) & 0xffc), 0x120007);
  cpu._translate(0x10020);
  cpu._translate(0x20020);
}
function state(machine) {
  const cpu = machine.cpu;
  return {regs: [cpu.eax, cpu.ecx, cpu.edx, cpu.ebx, cpu.esp, cpu.ebp,
    cpu.esi, cpu.edi], eip: cpu.eip, eflags: cpu.eflags,
  cpuCycles: cpu.cycles, cycles: machine.cycles, debt: machine._chipDebt};
}
async function compare(code, count, customize = () => {}, mode = 'real') {
  const fast = fixture(code, mode), slow = fixture(code, mode);
  customize(fast); customize(slow);
  const dispatcher = await createI80386Code16WasmDispatcher(fast);
  const completed = dispatcher.run(count);
  for (let i = 0; i < completed; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  return {fast, slow, dispatcher, completed};
}

test('real, protected16, and VM86 register MOV/CMP/JZ blocks match steps', async () => {
  // MOV AX,1234h; MOV BX,AX; CMP BX,AX; JZ +2.
  const code = [0xb8, 0x34, 0x12, 0x89, 0xc3, 0x39, 0xc3, 0x74, 0x02, 0x90, 0x90];
  for (const mode of ['real', 'protected16', 'vm86']) {
    const {fast, completed} = await compare(code, 4, () => {}, mode);
    assert.equal(completed, 4);
    assert.equal(fast.cpu.eip, 0x2b);
  }
});

test('8B word and 8A high-byte reads use current shared RAM', async () => {
  // MOV AX,[BX]; MOV AH,[BX+2]; CMP AX,BX; JNZ +0.
  const code = [0x8b, 0x07, 0x8a, 0x67, 0x02, 0x39, 0xd8, 0x75, 0x00];
  for (const mode of ['real', 'protected16', 'vm86']) {
    const {fast, completed} = await compare(code, 4, machine => {
      machine.cpu.bx = 0x20;
      machine.cpu.eax = 0xdead0000;
      machine.mem.set([0x34, 0x12, 0x78], 0x20020);
    }, mode);
    assert.equal(completed, 4);
    assert.equal(fast.cpu.eax, 0xdead7834);
  }
});

test('paged 8B reads and TLB-miss fallback match interpreter', async () => {
  const code = [0x90, 0x8b, 0x07, 0x90];
  const {fast, dispatcher, completed} = await compare(code, 3, machine => {
    paged(machine);
    machine.cpu.bx = 0x20;
    machine.mem.set([0xcd, 0xab], 0x120020);
  }, 'protected16');
  assert.equal(completed, 3);
  assert.equal(fast.cpu.ax, 0xabcd);
  assert.equal(dispatcher.stats.blockCalls, 1);

  const miss = fixture(code, 'protected16');
  paged(miss);
  miss.cpu.invalidateTranslationCache();
  const runner = await createI80386Code16WasmDispatcher(miss);
  assert.equal(runner.run(3), 1);
  assert.equal(runner.stats.blockCalls, 0);
});

test('word read crossing two cached, noncontiguous pages matches interpreter', async () => {
  const code = [0x90, 0x8b, 0x07, 0x90];
  const {fast, completed} = await compare(code, 3, machine => {
    paged(machine);
    machine.cpu.segmentCaches[3].base = 0x20f00;
    machine.cpu.bx = 0xff;
    put32(machine, 0x4000 + ((0x21000 >>> 10) & 0xffc), 0x130007);
    machine.cpu._translate(0x10020);
    machine.cpu._translate(0x20fff);
    machine.cpu._translate(0x21000);
    machine.mem[0x120fff] = 0x34;
    machine.mem[0x130000] = 0x12;
  }, 'protected16');
  assert.equal(completed, 3);
  assert.equal(fast.cpu.ax, 0x1234);
});

test('CMP16 flags match ordinary subtraction across carry and overflow cases', async () => {
  for (const opcode of [0x39, 0x3b]) {
    const code = [opcode, 0xd8, 0x90]; // Opposite reg/rm orientations.
    for (const [ax, bx] of [[0, 1], [1, 0], [0x7fff, 0x8000],
      [0x8000, 0x7fff], [0xffff, 0], [0, 0xffff], [0xffff, 0xffff]]) {
      const {completed} = await compare(code, 2, machine => {
        machine.cpu.ax = ax;
        machine.cpu.bx = bx;
        machine.cpu.eflags = 0xa02;
      });
      assert.equal(completed, 2);
    }
  }
});

test('changed EA register exits after complete prior instruction', async () => {
  // Entry BX=20h, but MOV BX,30h changes the subsequent load address.
  const code = [0xbb, 0x30, 0x00, 0x8b, 0x07, 0x90];
  const {fast, slow, dispatcher, completed} = await compare(code, 3, machine => {
    machine.cpu.bx = 0x20;
    machine.mem.set([0x11, 0x11], 0x20020);
    machine.mem.set([0x22, 0x22], 0x20030);
  });
  assert.equal(completed, 1);
  assert.equal(dispatcher.stats.boundary, 1);
  assert.equal(dispatcher.run(2), 2);
  slow.step(); slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(fast.cpu.ax, 0x2222);
});

test('chip deadline stops before the next instruction', async () => {
  const code = [0x90, 0xb8, 0x34, 0x12, 0x90, 0x90];
  const {fast, completed} = await compare(code, 4, machine => {
    machine._chipDeadline = machine.functionalInstructionCycles * 2;
  });
  assert.equal(completed, 2);
  assert.equal(fast.cpu.eip, 0x24);
});

test('code mutation and ROM/MMIO read refusal fall back before state change', async () => {
  const code = [0x90, 0x8b, 0x07, 0x90];
  const machine = fixture(code);
  machine.cpu.bx = 0x20;
  const dispatcher = await createI80386Code16WasmDispatcher(machine);
  machine.cpu.segmentCaches[3].base = 0xa0000;
  assert.equal(dispatcher.run(3), 1);
  assert.equal(dispatcher.stats.blockCalls, 0);
  machine.cpu.segmentCaches[3].base = 0x20000;
  machine.mem[0x10020] = 0xb8;
  machine.mem[0x10021] = 0x44;
  machine.mem[0x10022] = 0x33;
  const before = machine.cpu.eip;
  dispatcher.run(1);
  assert.notEqual(machine.cpu.eip, before);
});

test('cached code is rechecked and changed immediate is decoded afresh', async () => {
  const code = [0xb8, 0x11, 0x11, 0x90];
  const machine = fixture(code);
  const dispatcher = await createI80386Code16WasmDispatcher(machine);
  assert.equal(dispatcher.run(2), 2);
  machine.cpu.eip = 0x20;
  machine.mem[0x10021] = 0x22;
  const slow = fixture([0xb8, 0x22, 0x11, 0x90]);
  assert.equal(dispatcher.run(2), 2);
  slow.step(); slow.step();
  assert.equal(machine.cpu.ax, slow.cpu.ax);
  assert.equal(machine.cpu.ax, 0x1122);
});

test('ROM read is admitted and crossing an uncached page falls back', async () => {
  const code = [0x90, 0x8b, 0x07];
  const {fast, completed} = await compare(code, 2, machine => {
    machine.cpu.bx = 0x20;
    machine.cpu.segmentCaches[3].base = 0xf0000;
    machine.loadRom(Uint8Array.of(0xcd, 0xab), 0xf0020);
  });
  assert.equal(completed, 2);
  assert.equal(fast.cpu.ax, 0xabcd);

  const crossing = fixture(code, 'protected16');
  crossing.cpu.bx = 0xfff;
  crossing.cpu.segmentCaches[3].base = 0x20000;
  paged(crossing);
  // Only the first data page is translated; second-page admission refuses.
  const dispatcher = await createI80386Code16WasmDispatcher(crossing);
  assert.equal(dispatcher.run(2), 1);
  assert.equal(dispatcher.stats.blockCalls, 0);
  assert.equal(crossing.cpu.eip, 0x21);
});

test('taken CS-limit branch exits at boundary after prior instructions', async () => {
  const code = [0xb8, 0x01, 0x00, 0x39, 0xc0, 0x74, 0x20];
  const machine = fixture(code, 'protected16');
  machine.cpu.segmentCaches[1].limit = 0x28;
  const dispatcher = await createI80386Code16WasmDispatcher(machine,
    {diagnosticReasons: true});
  assert.equal(dispatcher.run(3), 2);
  assert.equal(dispatcher.stats.boundary, 1);
  assert.equal(dispatcher.diagnostics.exits.branchTargetLimit, 1);
  assert.equal(machine.cpu.eip, 0x25);
  assert.equal(machine.cpu.eflags & 0x40, 0x40);
});

test('BP selects SS and an untaken JNZ falls through', async () => {
  // NOP; MOV AX,[BP]; CMP AX,AX; JNZ +4.
  const code = [0x90, 0x8b, 0x46, 0x00, 0x39, 0xc0, 0x75, 0x04];
  const {fast, completed} = await compare(code, 4, machine => {
    machine.cpu.ss = 0x3000;
    machine.cpu.segmentCaches[2] = {base: 0x30000, limit: 0xffff,
      default32: false, present: true, code: false, readable: true, writable: true};
    machine.cpu.bp = 0x40;
    machine.mem.set([0x78, 0x56], 0x30040);
    machine.mem.set([0x11, 0x11], 0x20040);
  });
  assert.equal(completed, 4);
  assert.equal(fast.cpu.ax, 0x5678);
  assert.equal(fast.cpu.eip, 0x28);
});

test('interrupt shadow and pending IRQ force ordinary board stepping', async () => {
  const code = [0x90, 0x90, 0x90];
  const shadow = fixture(code);
  shadow.cpu._interruptShadow = 1;
  const shadowRunner = await createI80386Code16WasmDispatcher(shadow);
  assert.equal(shadowRunner.run(2), 1);
  assert.equal(shadowRunner.stats.blockCalls, 0);
  const pending = fixture(code);
  pending.cpu.eflags |= 0x200;
  pending._pic._intActive = true;
  const pendingRunner = await createI80386Code16WasmDispatcher(pending);
  pendingRunner.run(2);
  assert.equal(pendingRunner.stats.blockCalls, 0);
});

test('opt-in diagnostic reasons identify exact refusal and exit sites', async () => {
  const cases = [
    {code: [0x40, 0x90], reason: 'unsupportedFirstOpcode'},
    {code: [0x90, 0x40], reason: 'shortBlock', shortStop: 'unsupportedOpcode'},
    {code: [0x74, 0x00, 0x90], reason: 'shortBlock', shortStop: 'terminalBranch'},
    {code: [0x90, 0x8b, 0x07], reason: 'dataProofRefusal',
      setup: machine => { machine.cpu.bx = 0x20;
        machine.cpu.segmentCaches[3].base = 0xa0000; }},
    {code: [0x90, 0x90], reason: 'mode32',
      setup: machine => { machine.cpu.segmentCaches[1].default32 = true; }},
    {code: [0x90, 0x90], reason: 'interruptShadow',
      setup: machine => { machine.cpu._interruptShadow = 1; }},
    {code: [0x90, 0x90], reason: 'codeWindowRefusal', mode: 'protected16',
      setup: machine => { paged(machine); machine.cpu.invalidateTranslationCache(); }},
  ];
  for (const {code, reason, shortStop, setup, mode} of cases) {
    const fast = fixture(code, mode), slow = fixture(code, mode);
    setup?.(fast); setup?.(slow);
    const dispatcher = await createI80386Code16WasmDispatcher(fast,
      {diagnosticReasons: true});
    assert.equal(dispatcher.run(2), 1);
    slow.step();
    assert.deepEqual(state(fast), state(slow));
    assert.equal(dispatcher.diagnostics.fallbacks[reason], 1);
    if (shortStop) assert.equal(dispatcher.diagnostics.shortBlockStops[shortStop], 1);
    if (reason === 'unsupportedFirstOpcode')
      assert.equal(dispatcher.diagnostics.unsupportedFirstOpcodes[0x40], 1);
  }

  const code = [0xbb, 0x20, 0x00, 0x8b, 0x07, 0x90];
  const fast = fixture(code), slow = fixture(code);
  fast.mem.set([0x34, 0x12], 0x20000);
  slow.mem.set([0x34, 0x12], 0x20000);
  const dispatcher = await createI80386Code16WasmDispatcher(fast,
    {diagnosticReasons: true});
  assert.equal(dispatcher.run(3), 1);
  slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.diagnostics.exits.dynamicEA, 1);
  assert.equal(dispatcher.stats.boundary, 1);
  assert.equal(dispatcher.stats.fallback, 0);

  const ordinary = await createI80386Code16WasmDispatcher(fixture([0x90, 0x90]));
  assert.equal(ordinary.diagnostics, null);
});

test('vendored free BIOS bounded run preserves CPU and full guest RAM hash', async () => {
  const bios = readFileSync(new URL('../roms/free-at-bios/BIOS-bochs-legacy', import.meta.url));
  const vga = readFileSync(new URL('../roms/free-at-bios/vgabios-lgpl.bin', import.meta.url));
  const make = () => {
    const machine = new ExperimentalI80386ATMachine(
      PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA);
    machine.loadRom(bios, 0xf0000);
    machine.loadRom(bios, 0xff0000);
    machine.loadRom(vga, 0xc0000);
    machine.reset();
    return machine;
  };
  const fast = make(), slow = make();
  const dispatcher = await createI80386Code16WasmDispatcher(fast);
  let steps = 0;
  while (steps < 512) steps += dispatcher.run(Math.min(64, 512 - steps));
  for (let i = 0; i < steps; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  const sha = machine => createHash('sha256').update(machine.mem).digest('hex');
  assert.equal(sha(fast), sha(slow));
});
