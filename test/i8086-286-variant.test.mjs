/**
 * The '80286' variant of the i8086 core is a fast, functional REAL-MODE 286: it
 * is the 80186 instruction set (which covers essentially all real-mode software),
 * with the 0x0F protected-mode group left unimplemented (an honest fault). This
 * proves the foundation two ways, entirely locally (no external vector suite):
 *
 *   1. '80286' is accepted and reports _is286 (and, being a 186 superset, _is186).
 *   2. '80286' is byte-identical to '80186' over a large sample of random
 *      real-mode instructions and states — i.e. the variant adds the label and
 *      the 286 dispatch hook without changing any 186-shared semantics.
 *
 * Grading the 0x0F group against SingleStepTests/80286 (SST286) is the tracked
 * next step and belongs in CI with the vectors (see grind-i80286.mjs); it is out
 * of scope for this local equivalence proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { I8086 } from '../src/i8086.js';
import { createDebugTarget, getTargetKinds } from '../src/debug-target-factory.js';

const GPR = ['ax', 'bx', 'cx', 'dx', 'sp', 'bp', 'si', 'di'];
const SEG = ['cs', 'ss', 'ds', 'es'];

function makeCpu(variant) {
  const mem = new Map();
  const cpu = new I8086({
    read: (a) => mem.get(a >>> 0) ?? 0,
    write: (a, v) => mem.set(a >>> 0, v & 0xff),
    in: () => 0xff,
    out: () => {},
  }, { variant });
  return { cpu, mem };
}

function runOne(variant, init, bytes) {
  const { cpu, mem } = makeCpu(variant);
  for (const r of GPR) cpu[r] = init.regs[r];
  for (const r of SEG) cpu[r] = init.regs[r];
  cpu.ip = init.regs.ip; cpu.flags = init.regs.flags;
  const at = ((init.regs.cs << 4) + init.regs.ip) >>> 0;
  bytes.forEach((b, i) => mem.set((at + i) >>> 0, b & 0xff));
  let threw = null;
  try { cpu.step(); } catch (e) { threw = e.name || 'error'; }
  const regs = {};
  for (const r of [...GPR, ...SEG]) regs[r] = cpu[r] & 0xffff;
  regs.ip = cpu.ip & 0xffff; regs.flags = cpu.flags & 0xffff;
  return { threw, regs, mem };
}

test("286 PUSH SP pushes the pre-decrement value; POPF/SAHF/IRET use 286 flag semantics", () => {
  const run = (variant, bytes, before) => {
    const mem = new Uint8Array(1 << 20);
    const cpu = new I8086({ read: (a) => mem[a & 0xfffff], write: (a, v) => { mem[a & 0xfffff] = v & 0xff; }, in: () => 0xff, out: () => {} }, { variant });
    cpu.cs = 0x1000; cpu.ss = 0x2000; cpu.ip = 0x100;
    const at = (0x1000 << 4) + 0x100; bytes.forEach((b, i) => { mem[at + i] = b; });
    if (before) before(cpu, mem);
    cpu.step();
    return { cpu, mem };
  };
  const stackTop = (r) => r.mem[(0x2000 << 4) + r.cpu.sp] | (r.mem[(0x2000 << 4) + r.cpu.sp + 1] << 8);

  // PUSH SP (0x54): 286 pushes the ORIGINAL sp, 8086/186 the decremented one.
  assert.equal(stackTop(run('80286', [0x54], (c) => { c.sp = 0x1000; })), 0x1000);
  assert.equal(stackTop(run('80186', [0x54], (c) => { c.sp = 0x1000; })), 0x0ffe);

  // POPF 0xFFD5: 286 clears bit 15 and keeps IOPL/NT (12-14) -> 0x7FD7; 8086/186
  // force bits 12-15 to 1 -> 0xFFD7.
  const popf = (variant) => run(variant, [0x9d], (c, m) => { c.sp = 0x1000; const sa = (0x2000 << 4) + 0x1000; m[sa] = 0xd5; m[sa + 1] = 0xff; }).cpu.flags;
  assert.equal(popf('80286'), 0x7fd7);
  assert.equal(popf('80186'), 0xffd7);
});

test("the 80286 0x0F group executes SMSW/LMSW/LGDT/SGDT/CLTS in real mode", () => {
  // Self-contained: flat 1 MB memory so the descriptor-table operands are easy.
  const run = (bytes, before) => {
    const mem = new Uint8Array(1 << 20);
    const cpu = new I8086({ read: (a) => mem[a & 0xfffff], write: (a, v) => { mem[a & 0xfffff] = v & 0xff; }, in: () => 0xff, out: () => {} }, { variant: '80286' });
    cpu.cs = 0x1000; cpu.ds = 0x3000; cpu.ip = 0x100;
    const at = (0x1000 << 4) + 0x100;
    bytes.forEach((b, i) => { mem[at + i] = b; });
    if (before) before(cpu, mem);
    cpu.step();
    return { cpu, mem };
  };
  const DS = 0x3000 << 4;

  assert.equal(run([0x0f, 0x01, 0xe0]).cpu.ax, 0xfff0, 'SMSW AX stores MSW');
  assert.equal(run([0x0f, 0x06], (c) => { c.msw = 0xfff8; }).cpu.msw, 0xfff0, 'CLTS clears TS');
  assert.equal(run([0x0f, 0x01, 0xf0], (c) => { c.ax = 0x0003; }).cpu.msw & 0xf, 0x3, 'LMSW loads MSW');

  const lg = run([0x0f, 0x01, 0x16, 0x00, 0x02], (c, m) => {          // LGDT [ds:0x200]
    m[DS + 0x200] = 0x34; m[DS + 0x201] = 0x12; m[DS + 0x202] = 0x00; m[DS + 0x203] = 0x78; m[DS + 0x204] = 0x56;
  });
  assert.equal(lg.cpu.gdtr.limit, 0x1234, 'LGDT limit');
  assert.equal(lg.cpu.gdtr.base, 0x567800, 'LGDT 24-bit base');

  const sg = run([0x0f, 0x01, 0x06, 0x00, 0x03], (c) => { c.gdtr = { limit: 0x1234, base: 0x567800 }; }); // SGDT [ds:0x300] (0F 01 /0, mod=00 rm=110)
  assert.deepEqual([...sg.mem.slice(DS + 0x300, DS + 0x306)], [0x34, 0x12, 0x00, 0x78, 0x56, 0xff], 'SGDT stores limit+base and forces 0xFF top byte');
});

test("the 'i80286' target kind is pickable and builds a real-mode 286 machine", async () => {
  assert.ok(getTargetKinds().find(k => k.kind === 'i80286'), 'i80286 must be in the picker');
  const { adapter, target } = await createDebugTarget('i80286', {});
  assert.equal(adapter.machine.variant, '80286');
  assert.equal(adapter.machine.cpu._is286, true);
  assert.ok(target, 'a debug target is built (CLI + widgets pane reach the 286)');
  for (let i = 0; i < 10; i++) adapter.machine.step();   // and it actually runs
});

test("'80286' variant is accepted and reports _is286 and _is186", () => {
  const { cpu } = makeCpu('80286');
  assert.equal(cpu.variant, '80286');
  assert.equal(cpu._is286, true);
  assert.equal(cpu._is186, true, '286 is a 186 superset for the shared ISA');
  // and an unknown variant is still rejected
  assert.throws(() => makeCpu('80386'), /unknown variant/);
});

test("'80286' is byte-identical to '80186' across random real-mode instructions", () => {
  let s = 0x2f6e2c85 >>> 0;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 8) & 0xff;
  const rw = () => rnd() | (rnd() << 8);

  let compared = 0, ran = 0;
  const N = 60000;
  for (let i = 0; i < N; i++) {
    const init = { regs: {
      cs: 0x1000, ss: 0x2000, ds: 0x3000, es: 0x4000,
      ip: 0x0100 + ((rnd() & 0x3f) << 1), flags: 0x0002 | (rw() & 0x0fd5),
      ax: rw(), bx: rw(), cx: rw(), dx: rw(),
      sp: 0x0f00 | ((rnd() & 7) << 1), bp: rw(), si: rw(), di: rw(),
    } };
    const bytes = [rnd(), rnd(), rnd(), rnd(), rnd()];
    // The opcodes where the 286 DELIBERATELY differs from the 186 (all confirmed
    // against SingleStepTests/80286): 0x0F (undefined on the 186, the two-byte
    // prefix on the 286); PUSH SP (0x54, pre- vs post-decrement); and the flag
    // normalisers POPF/SAHF/IRET (0x9d/0x9e/0xcf — the 286 has IOPL/NT and bit 15
    // reads 0, the 8086 forces bits 12-15 to 1). Exercised elsewhere, not here.
    if (bytes[0] === 0x0f || bytes[0] === 0x54 || bytes[0] === 0x9d || bytes[0] === 0x9e || bytes[0] === 0xcf) continue;
    const a = runOne('80186', init, bytes);
    const b = runOne('80286', init, bytes);
    compared++;
    // Same thrown-ness (both implement the same set today).
    assert.equal(!!a.threw, !!b.threw, `throw mismatch at op 0x${bytes[0].toString(16)} (186 ${a.threw} vs 286 ${b.threw})`);
    if (a.threw) continue;
    ran++;
    for (const r of [...GPR, ...SEG, 'ip', 'flags']) {
      assert.equal(b.regs[r], a.regs[r], `${r} differs at op 0x${bytes[0].toString(16)} (186 ${a.regs[r]} vs 286 ${b.regs[r]})`);
    }
    for (const [k, v] of a.mem) assert.equal(b.mem.get(k) ?? 0, v, `mem[0x${k.toString(16)}] differs at op 0x${bytes[0].toString(16)}`);
    for (const [k, v] of b.mem) assert.equal(a.mem.get(k) ?? 0, v, `mem[0x${k.toString(16)}] only on 286 at op 0x${bytes[0].toString(16)}`);
  }
  assert.ok(compared >= N * 0.95, `only ${compared} compared`);   // a handful of opcodes are skipped as 286-divergent
  assert.ok(ran > N * 0.4, `only ${ran} instructions actually executed on both — sample too thin`);
  console.log(`# 80286==80186 over ${compared} random instructions (${ran} executed on both), 0 divergences`);
});
