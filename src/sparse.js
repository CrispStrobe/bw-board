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
 * Sparse LU with partial pivoting — left-looking, one column at a time.
 *
 * factor(csc):   full factorization. Per column: DFS reachability over L's
 *                pattern gives the triangular-solve order, numeric update,
 *                pivot = the largest remaining |entry| in the column.
 *                Stores the per-column reach lists and the pivot order.
 * refactor(csc): numeric-only refill assuming the SAME input pattern and
 *                the SAME pivot order — skips every DFS. Returns false
 *                (caller must full-factor) if a fixed pivot has collapsed.
 * solve(b):      permuted forward/back substitution. b is not modified.
 *
 * Everything is indexed in pivot-position space after factor completes.
 * Singularity throws the same "Singular matrix at column N" contract the
 * dense elimination throws, so the NR loop's bail path is unchanged.
 */
export class SparseLU {
  constructor() {
    this.n = 0;
    /** @type {Int32Array} pivot position → original row */
    this.perm = null;
    /** @type {Int32Array} original row → pivot position */
    this.pinv = null;
    // L: unit lower triangular, entries strictly below the diagonal.
    this.Lp = null; this.Li = null; this.Lx = null;
    // U: entries strictly above the diagonal, plus the diagonal itself.
    this.Up = null; this.Ui = null; this.Ux = null;
    this.Udiag = null;
    /** @type {Int32Array[]} per-column topological reach (pivot positions) */
    this.reach = null;
    // The input pattern the factorization was built for.
    this.inColPtr = null; this.inRowIdx = null;
  }

  /**
   * @param {{n: number, colPtr: Int32Array, rowIdx: Int32Array, values: Float64Array}} csc
   */
  factor(csc) {
    const { n, colPtr, rowIdx, values } = csc;
    this.n = n;
    const perm = new Int32Array(n).fill(-1);
    const pinv = new Int32Array(n).fill(-1);

    // Growable L/U column stores (plain arrays during factor, typed after).
    /** @type {number[][]} */ const LiCols = [];
    /** @type {number[][]} */ const LxCols = [];
    /** @type {number[][]} */ const UiCols = [];
    /** @type {number[][]} */ const UxCols = [];
    const Udiag = new Float64Array(n);
    /** @type {Int32Array[]} */ const reachCols = [];

    const w = new Float64Array(n);        // dense accumulator, by ORIGINAL row
    const touched = new Int32Array(n);    // rows to clear after each column
    const mark = new Uint8Array(n);       // row is in the current column's set
    const stack = new Int32Array(n);      // DFS stack of pivot positions
    const stackPos = new Int32Array(n);   // per-frame progress into L(:,p)
    const visited = new Uint8Array(n);    // pivot position seen this column
    const topo = new Int32Array(n);       // reach in reverse-topological fill

    for (let j = 0; j < n; j++) {
      // Scatter A(:,j) and collect the DFS roots among pivoted rows.
      let nTouched = 0;
      let nTopo = 0;
      for (let p = colPtr[j]; p < colPtr[j + 1]; p++) {
        const r = rowIdx[p];
        if (!mark[r]) { mark[r] = 1; touched[nTouched++] = r; w[r] = 0; }
        w[r] += values[p];
        const pv = pinv[r];
        if (pv >= 0 && !visited[pv]) {
          // Iterative DFS from pivot position pv over L's pattern.
          let top = 0;
          stack[top] = pv; stackPos[top] = 0; visited[pv] = 1;
          while (top >= 0) {
            const pcol = stack[top];
            const Lrows = LiCols[pcol];
            let k = stackPos[top];
            let descended = false;
            for (; k < Lrows.length; k++) {
              const rr = Lrows[k];           // original row index
              const ppv = pinv[rr];
              if (ppv >= 0 && !visited[ppv]) {
                stackPos[top] = k + 1;
                top++;
                stack[top] = ppv; stackPos[top] = 0; visited[ppv] = 1;
                descended = true;
                break;
              }
            }
            if (!descended) {
              topo[nTopo++] = pcol;          // post-order = reverse topo
              top--;
            }
          }
        }
      }

      // Numeric triangular solve in topological order (reverse post-order).
      const reachJ = new Int32Array(nTopo);
      for (let t = nTopo - 1, o = 0; t >= 0; t--, o++) {
        const pcol = topo[t];
        reachJ[o] = pcol;
        const prow = perm[pcol];
        if (!mark[prow]) { mark[prow] = 1; touched[nTouched++] = prow; w[prow] = 0; }
        const xj = w[prow];
        if (xj !== 0) {
          const Lrows = LiCols[pcol];
          const Lvals = LxCols[pcol];
          for (let k = 0; k < Lrows.length; k++) {
            const rr = Lrows[k];
            if (!mark[rr]) { mark[rr] = 1; touched[nTouched++] = rr; w[rr] = 0; }
            w[rr] -= Lvals[k] * xj;
          }
        }
      }

      // Pivot: largest |w| over unpivoted touched rows.
      let pivotRow = -1;
      let pivotAbs = 0;
      for (let t = 0; t < nTouched; t++) {
        const r = touched[t];
        if (pinv[r] >= 0) continue;
        const a = Math.abs(w[r]);
        if (a > pivotAbs) { pivotAbs = a; pivotRow = r; }
      }
      if (pivotRow < 0 || pivotAbs < 1e-15) {
        // Restore workspace before throwing so the instance is reusable.
        for (let t = 0; t < nTouched; t++) { mark[touched[t]] = 0; }
        for (let t = 0; t < nTopo; t++) visited[topo[t]] = 0;
        throw new Error(`Singular matrix at column ${j}`);
      }
      const pivotVal = w[pivotRow];
      perm[j] = pivotRow;
      pinv[pivotRow] = j;
      Udiag[j] = pivotVal;

      // U(:,j): pivoted rows (position < j), stored by pivot position.
      const Ui = []; const Ux = [];
      // L(:,j): remaining unpivoted rows, stored by ORIGINAL row for now.
      const Li = []; const Lx = [];
      for (let t = 0; t < nTouched; t++) {
        const r = touched[t];
        const val = w[r];
        mark[r] = 0;
        if (r === pivotRow) continue;
        // Numeric zeros are KEPT: the pattern is structural. Dropping a
        // cell that happens to be 0.0 at factor time would let refactor()
        // produce a value outside the stored pattern and silently corrupt
        // the columns after it.
        const pv = pinv[r];
        if (pv >= 0 && pv < j) { Ui.push(pv); Ux.push(val); }
        else if (pv < 0) { Li.push(r); Lx.push(val / pivotVal); }
      }
      for (let t = 0; t < nTopo; t++) visited[topo[t]] = 0;
      LiCols.push(Li); LxCols.push(Lx);
      UiCols.push(Ui); UxCols.push(Ux);
      reachCols.push(reachJ);
    }

    // Freeze into CSC-style typed arrays; remap L's rows to pivot positions.
    const finLp = new Int32Array(n + 1);
    const finUp = new Int32Array(n + 1);
    for (let j = 0; j < n; j++) {
      finLp[j + 1] = finLp[j] + LiCols[j].length;
      finUp[j + 1] = finUp[j] + UiCols[j].length;
    }
    const finLi = new Int32Array(finLp[n]);
    const finLx = new Float64Array(finLp[n]);
    const finUi = new Int32Array(finUp[n]);
    const finUx = new Float64Array(finUp[n]);
    for (let j = 0; j < n; j++) {
      let o = finLp[j];
      const Li = LiCols[j]; const Lx = LxCols[j];
      for (let k = 0; k < Li.length; k++, o++) {
        finLi[o] = pinv[Li[k]];   // by factor's end every row is pivoted
        finLx[o] = Lx[k];
      }
      o = finUp[j];
      const Ui = UiCols[j]; const Ux = UxCols[j];
      for (let k = 0; k < Ui.length; k++, o++) {
        finUi[o] = Ui[k];
        finUx[o] = Ux[k];
      }
    }

    this.perm = perm; this.pinv = pinv;
    this.Lp = finLp; this.Li = finLi; this.Lx = finLx;
    this.Up = finUp; this.Ui = finUi; this.Ux = finUx;
    this.Udiag = Udiag;
    this.reach = reachCols;
    this.inColPtr = colPtr.slice();
    this.inRowIdx = rowIdx.slice();
  }

  /**
   * Same-pattern check against the pattern factor() was built from.
   * @param {{n: number, colPtr: Int32Array, rowIdx: Int32Array}} csc
   */
  samePattern(csc) {
    if (csc.n !== this.n || !this.inColPtr) return false;
    const { colPtr, rowIdx } = csc;
    if (colPtr.length !== this.inColPtr.length || rowIdx.length !== this.inRowIdx.length) return false;
    for (let i = 0; i < colPtr.length; i++) if (colPtr[i] !== this.inColPtr[i]) return false;
    for (let i = 0; i < rowIdx.length; i++) if (rowIdx[i] !== this.inRowIdx[i]) return false;
    return true;
  }

  /**
   * Numeric-only refactorization: same pattern, same pivot ORDER, no DFS.
   * Returns false when a fixed pivot has collapsed (values moved enough
   * that the stored pivot choice is no longer safe) — the caller then runs
   * a full factor().
   *
   * @param {{n: number, colPtr: Int32Array, rowIdx: Int32Array, values: Float64Array}} csc
   * @returns {boolean}
   */
  refactor(csc) {
    const n = this.n;
    const { colPtr, rowIdx, values } = csc;
    const { perm, pinv, Lp, Li, Lx, Up, Ui, Ux, Udiag, reach } = this;
    const w = new Float64Array(n);   // by pivot position this time

    for (let j = 0; j < n; j++) {
      // Scatter A(:,j) into pivot-position space. Only positions in the
      // stored patterns are read back, and those are exactly the positions
      // the stored elimination can produce — same pattern in, same out.
      for (let p = colPtr[j]; p < colPtr[j + 1]; p++) {
        w[pinv[rowIdx[p]]] += values[p];
      }
      const reachJ = reach[j];
      for (let t = 0; t < reachJ.length; t++) {
        const pcol = reachJ[t];
        const xj = w[pcol];
        if (xj !== 0) {
          for (let k = Lp[pcol]; k < Lp[pcol + 1]; k++) {
            w[Li[k]] -= Lx[k] * xj;
          }
        }
      }
      const pivotVal = w[j];
      if (!(Math.abs(pivotVal) >= 1e-13)) {
        // Clear workspace before handing back.
        w.fill(0);
        return false;
      }
      Udiag[j] = pivotVal;
      for (let k = Up[j]; k < Up[j + 1]; k++) { Ux[k] = w[Ui[k]]; w[Ui[k]] = 0; }
      for (let k = Lp[j]; k < Lp[j + 1]; k++) { Lx[k] = w[Li[k]] / pivotVal; w[Li[k]] = 0; }
      w[j] = 0;
      // Anything the fixed elimination produced OUTSIDE the stored pattern
      // cannot exist when the input pattern is identical; positions not in
      // U/L for this column were never written except via scatter, and the
      // scatter positions are all consumed above or belong to later columns.
    }
    return true;
  }

  /**
   * @param {Float64Array} b - untouched
   * @returns {Float64Array}
   */
  solve(b) {
    const n = this.n;
    const { perm, Lp, Li, Lx, Up, Ui, Ux, Udiag } = this;
    const y = new Float64Array(n);
    for (let j = 0; j < n; j++) y[j] = b[perm[j]];
    // Forward: L is unit lower, entries strictly below the diagonal.
    for (let j = 0; j < n; j++) {
      const yj = y[j];
      if (yj !== 0) {
        for (let k = Lp[j]; k < Lp[j + 1]; k++) y[Li[k]] -= Lx[k] * yj;
      }
    }
    // Back: U entries are strictly above the diagonal, diag in Udiag.
    for (let j = n - 1; j >= 0; j--) {
      const yj = (y[j] /= Udiag[j]);
      if (yj !== 0) {
        for (let k = Up[j]; k < Up[j + 1]; k++) y[Ui[k]] -= Ux[k] * yj;
      }
    }
    return y;
  }
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
