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
  assert.ok(compared >= N * 0.99, `only ${compared} compared`);
  assert.ok(ran > N * 0.4, `only ${ran} instructions actually executed on both — sample too thin`);
  console.log(`# 80286==80186 over ${compared} random instructions (${ran} executed on both), 0 divergences`);
});
