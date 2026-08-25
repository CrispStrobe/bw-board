/**
 * Sparse LU kernel — cross-checks against the dense reference elimination,
 * a closed-form ladder oracle through the whole board stack, and the
 * factor-reuse ladder's speed ordering.
 * spec-updates/sparse-lu-factor-reuse.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Matrix, solve } from '../src/mna.js';
import { CooMatrix, SparseLU, toCSC } from '../src/sparse.js';
import { BoardImpl } from '../src/board.js';

/** Deterministic LCG so failures reproduce. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * Random MNA-shaped system: symmetric conductance core + a few asymmetric
 * source rows — the exact structure solveMNA assembles.
 */
function randomSystem(n, nSources, rnd) {
  const A = new CooMatrix(n);
  const b = new Float64Array(n);
  const core = n - nSources;
  for (let i = 0; i < core; i++) A.add(i, i, 1e-12); // gmin
  const nEdges = core * 3;
  for (let e = 0; e < nEdges; e++) {
    const i = Math.floor(rnd() * core);
    const j = Math.floor(rnd() * core);
    if (i === j) continue;
    const g = 1 / (10 + rnd() * 10000);
    A.add(i, i, g); A.add(j, j, g);
    A.add(i, j, -g); A.add(j, i, -g);
  }
  for (let s = 0; s < nSources; s++) {
    const row = core + s;
    const node = s % core;
    A.set(row, node, 1);
    A.set(node, row, 1);
    b[row] = 1 + rnd() * 9;
  }
  for (let i = 0; i < core; i++) b[i] += (rnd() - 0.5) * 0.01;
  return { A, b };
}

function denseSolve(A, b) {
  const dense = new Matrix(A.n, A.n);
  for (let i = 0; i < A.v.length; i++) dense.add(A.ri[i], A.ci[i], A.v[i]);
  return solve(dense, new Float64Array(b));
}

describe('SparseLU vs dense reference', () => {
  it('agrees on 20 random MNA-shaped systems', () => {
    const rnd = lcg(0xC1C0);
    for (let trial = 0; trial < 20; trial++) {
      const n = 5 + Math.floor(rnd() * 60);
      const { A, b } = randomSystem(n, 1 + Math.floor(rnd() * 3), rnd);
      const xd = denseSolve(A, b);
      const lu = new SparseLU();
      lu.factor(toCSC(A));
      const xs = lu.solve(b);
      for (let i = 0; i < n; i++) {
        const scale = Math.max(1, Math.abs(xd[i]));
        assert.ok(Math.abs(xd[i] - xs[i]) / scale < 1e-9,
          `trial ${trial} n=${n} row ${i}: dense ${xd[i]} vs sparse ${xs[i]}`);
      }
    }
  });

  it('refactor with new values matches a fresh factor', () => {
    const rnd = lcg(0xBEEF);
    const { A, b } = randomSystem(40, 2, rnd);
    const lu = new SparseLU();
    lu.factor(toCSC(A));
    // Perturb every value mildly (same pattern), as an NR iteration does.
    for (let i = 0; i < A.v.length; i++) A.v[i] *= 1 + (rnd() - 0.5) * 0.2;
    const csc2 = toCSC(A);
    assert.ok(lu.refactor(csc2), 'refactor must accept the same pattern');
    const xs = lu.solve(b);
    const xd = denseSolve(A, b);
    for (let i = 0; i < A.n; i++) {
      const scale = Math.max(1, Math.abs(xd[i]));
      assert.ok(Math.abs(xd[i] - xs[i]) / scale < 1e-9,
        `row ${i}: dense ${xd[i]} vs refactored ${xs[i]}`);
    }
  });

  it('throws the dense singular contract on a floating block', () => {
    const A = new CooMatrix(3);
    A.add(0, 0, 1);      // row 1/2 empty → singular at column 1
    const b = new Float64Array(3);
    const lu = new SparseLU();
    assert.throws(() => lu.factor(toCSC(A)), /Singular matrix at column/);
    void b;
  });
});

describe('resistor ladder through the whole stack', () => {
  it('50 equal resistors: V_k = 5·k/50 (closed form)', () => {
    const N = 50;
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'net_top', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_0', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    for (let k = 1; k < N; k++) nets.push({ id: `net_${k}`, terminals: [] });
    for (let k = 0; k < N; k++) {
      const id = `R${k}`;
      parts.push({ id, kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] });
      const lower = `net_${k}`;
      const upper = k === N - 1 ? 'net_top' : `net_${k + 1}`;
      nets.find(n => n.id === lower).terminals.push({ part: id, terminal: 'a' });
      nets.find(n => n.id === upper).terminals.push({ part: id, terminal: 'b' });
    }
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    for (const k of [1, 10, 25, 40, 49]) {
      const v = board.nodeVoltage(`net_${k}`);
      const want = 5 * k / N;
      assert.ok(Math.abs(v - want) < 1e-6,
        `V(net_${k}) must be ${want}, got ${v}`);
    }
  });
});

/**
 * Circuit-shaped system: chain conductances with occasional short-range
 * bridges — the near-1D structure real boards assemble to. The random
 * expander above is the wrong perf fixture: with natural ordering its
 * fill-in makes sparse SLOWER than dense (measured 22 ms vs 14.5 ms at
 * n=300), which is a known limitation recorded in ROADMAP E1.1 (AMD
 * ordering is the follow-up), not what boards look like.
 */
function ladderSystem(n, nSources, rnd) {
  const A = new CooMatrix(n);
  const b = new Float64Array(n);
  const core = n - nSources;
  for (let i = 0; i < core; i++) A.add(i, i, 1e-12);
  const edge = (i, j) => {
    const g = 1 / (10 + rnd() * 10000);
    A.add(i, i, g); A.add(j, j, g);
    A.add(i, j, -g); A.add(j, i, -g);
  };
  for (let i = 0; i + 1 < core; i++) edge(i, i + 1);
  for (let i = 0; i + 4 < core; i += 3) edge(i, i + 4);
  for (let s = 0; s < nSources; s++) {
    const row = core + s;
    const node = (s * 97) % core;
    A.set(row, node, 1);
    A.set(node, row, 1);
    b[row] = 1 + rnd() * 9;
  }
  for (let i = 0; i < core; i++) b[i] += (rnd() - 0.5) * 0.01;
  return { A, b };
}

describe('reuse ladder speed ordering (coarse, anti-flake margins)', () => {
  it('factor < dense; refactor < factor; substitution < refactor at n=300', () => {
    const rnd = lcg(0xACE5);
    const { A, b } = ladderSystem(300, 3, rnd);
    const csc = toCSC(A);

    const time = (f, reps) => {
      const t0 = process.hrtime.bigint();
      for (let r = 0; r < reps; r++) f();
      return Number(process.hrtime.bigint() - t0) / reps;
    };

    // The claim is about the STEADY-STATE algorithm, so every timed path is
    // warmed past V8's tier-up first. Unwarmed, the measured reps are
    // dominated by first-call compilation, and how V8 tiers differs by
    // version: on Node 22 that produced a stable refactor-3.6x-slower-than-
    // factor inversion on CI runners while Node 20 passed locally — same
    // commit, same machine reproduces it under Node 22, and warm=10 restores
    // refactor 10x FASTER than factor. Margins below are unchanged.
    const lu = new SparseLU();
    for (let i = 0; i < 10; i++) {
      denseSolve(A, b);
      lu.factor(csc);
      lu.refactor(csc);
      lu.solve(b);
    }

    const tDense = time(() => denseSolve(A, b), 3);
    const tFactor = time(() => lu.factor(csc), 5);
    const tRefactor = time(() => { lu.refactor(csc); }, 10);
    const tSolve = time(() => lu.solve(b), 20);

    // Correctness first — speed claims about wrong answers are worthless.
    const xd = denseSolve(A, b);
    const xs = lu.solve(b);
    for (let i = 0; i < 300; i += 37) {
      const scale = Math.max(1, Math.abs(xd[i]));
      assert.ok(Math.abs(xd[i] - xs[i]) / scale < 1e-9, `row ${i} diverges`);
    }

    // Coarse orderings with wide margins; exact ratios vary by machine.
    assert.ok(tFactor < tDense / 3,
      `sparse factor (${tFactor}ns) must beat dense (${tDense}ns) by ≥3× at n=300`);
    assert.ok(tRefactor < tFactor,
      `refactor (${tRefactor}ns) must beat full factor (${tFactor}ns)`);
    assert.ok(tSolve < tRefactor,
      `substitution (${tSolve}ns) must beat refactor (${tRefactor}ns)`);
  });
});
