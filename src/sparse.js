/**
 * Sparse assembly and solve for the MNA system.
 *
 * `CooMatrix` is the assembler the stamps write into: a coordinate map with
 * dense-Matrix semantics (`add` accumulates, `set` overwrites whatever the
 * cell holds — the op-amp follower stamps set-then-add on one cell, so order
 * matters and is preserved per cell). `reset()` zeroes values but KEEPS the
 * slot map: across Newton–Raphson iterations the pattern only ever grows
 * (region flips stamp different cells; the old ones stay as structural
 * zeros), which is exactly what lets a later factorization reuse its
 * symbolic work against a superset pattern.
 *
 * spec-updates/sparse-lu-factor-reuse.md. Licence note (binding): KLU, BTF,
 * CSparse/CXSparse and mathjs's sparse module are LGPL — not used, ported,
 * or read for this implementation. This file is a from-scratch
 * Gilbert-Peierls-style left-looking LU (the algorithm is from the
 * published literature) over the CooMatrix's CSC form.
 *
 * @module
 */

/**
 * Coordinate-format matrix with first-touch slot allocation.
 * API-compatible with the dense Matrix used by the MNA stamps.
 */
export class CooMatrix {
  /** @param {number} n */
  constructor(n) {
    this.n = n;
    this.rows = n;
    this.cols = n;
    /** @type {Map<number, number>} cell key (r*n+c) → slot in v */
    this.idx = new Map();
    /** @type {number[]} */ this.ri = [];
    /** @type {number[]} */ this.ci = [];
    /** @type {number[]} */ this.v = [];
  }

  /** @param {number} r @param {number} c @returns {number} slot */
  _slot(r, c) {
    const k = r * this.n + c;
    let s = this.idx.get(k);
    if (s === undefined) {
      s = this.v.length;
      this.idx.set(k, s);
      this.ri.push(r);
      this.ci.push(c);
      this.v.push(0);
    }
    return s;
  }

  /** @param {number} r @param {number} c @param {number} val */
  add(r, c, val) { this.v[this._slot(r, c)] += val; }

  /** @param {number} r @param {number} c @param {number} val */
  set(r, c, val) { this.v[this._slot(r, c)] = val; }

  /** @param {number} r @param {number} c @returns {number} */
  get(r, c) {
    const s = this.idx.get(r * this.n + c);
    return s === undefined ? 0 : this.v[s];
  }

  /** Zero the values, keep the pattern (slots survive for the next fill). */
  reset() {
    const v = this.v;
    for (let i = 0; i < v.length; i++) v[i] = 0;
  }

  /** Number of structurally nonzero cells (incl. explicit zeros). */
  get nnz() { return this.v.length; }
}

/**
 * Compressed-sparse-column view of a CooMatrix. Duplicates cannot occur
 * (the slot map guarantees one entry per cell).
 *
 * @param {CooMatrix} A
 * @returns {{n: number, colPtr: Int32Array, rowIdx: Int32Array, values: Float64Array}}
 */
export function toCSC(A) {
  const n = A.n;
  const nnz = A.v.length;
  const colPtr = new Int32Array(n + 1);
  for (let i = 0; i < nnz; i++) colPtr[A.ci[i] + 1]++;
  for (let c = 0; c < n; c++) colPtr[c + 1] += colPtr[c];
  const rowIdx = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  const fill = Int32Array.from(colPtr.subarray(0, n));
  for (let i = 0; i < nnz; i++) {
    const p = fill[A.ci[i]]++;
    rowIdx[p] = A.ri[i];
    values[p] = A.v[i];
  }
  return { n, colPtr, rowIdx, values };
}
