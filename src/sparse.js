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
    // Small circuits can index cells directly without hashing. Bound the
    // table to 8 KiB and keep the existing sparse index for larger boards.
    this.directIndex = n <= 64 ? new Int16Array(n * n) : null;
    this.idx = this.directIndex ? null : new Map();
    /** @type {number[]} */ this.ri = [];
    /** @type {number[]} */ this.ci = [];
    /** @type {number[]} */ this.v = [];
  }

  /** @param {number} r @param {number} c @returns {number} slot */
  _slot(r, c) {
    const k = r * this.n + c;
    const direct = this.directIndex;
    let s = direct ? direct[k] - 1 : (this.idx.get(k) ?? -1);
    if (s < 0) {
      s = this.v.length;
      if (direct) direct[k] = s + 1;
      else this.idx.set(k, s);
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
    const k = r * this.n + c;
    const s = this.directIndex ? this.directIndex[k] - 1 : (this.idx.get(k) ?? -1);
    return s >= 0 ? this.v[s] : 0;
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
        const Lrows = LiCols[pcol];
        const Lvals = LxCols[pcol];
        for (let k = 0; k < Lrows.length; k++) {
          const rr = Lrows[k];
          // Reach is structural, even when this factorization happens to see
          // a numerical zero.  If the row is not retained here, a later
          // same-pattern refactor can make xj non-zero and create fill for
          // which L/U have no slot.  The solve then looks plausible at its
          // node voltages but can violate an MNA source row.  A MOS Newton
          // sequence exposed exactly that: the first cut-off stamp had gm=0;
          // the conducting stamp reused the incomplete factor and missed
          // 6.964 mA from the voltage-source unknown.
          if (!mark[rr]) { mark[rr] = 1; touched[nTouched++] = rr; w[rr] = 0; }
          if (xj !== 0) w[rr] -= Lvals[k] * xj;
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
   * Returns false when a fixed pivot has collapsed or no longer satisfies
   * factor()'s largest-remaining partial-pivot rule. An absolute nonzero
   * pivot alone does not control elimination growth after values change.
   * The caller discards partial factors and runs a full factor().
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
      let remainingMax = Math.abs(pivotVal);
      // L's structural pattern retains every reachable unpivoted row,
      // including numeric zeros. Compare the same candidates as factor().
      for (let k = Lp[j]; k < Lp[j + 1]; k++) {
        remainingMax = Math.max(remainingMax, Math.abs(w[Li[k]]));
      }
      if (!(Math.abs(pivotVal) >= 1e-13) || Math.abs(pivotVal) < remainingMax) {
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
 * @param {object} [workspace] Optional scratch buffers and the last coordinate layout.
 *   Results backed by a workspace are valid until its next use.
 * @returns {{n: number, colPtr: Int32Array, rowIdx: Int32Array, values: Float64Array}}
 */
export function toCSC(A, workspace) {
  const {n, ri, ci, v} = A;
  const nnz = v.length;
  const buffers = workspace ?? {};
  const layout = buffers.layout;
  if (layout && layout.n === n && layout.slots.length === nnz) {
    // Check insertion order as well as membership. A changed stamping order
    // can change the CSC order within a column, including its pivot tie breaks.
    let unchanged = true;
    for (let i = 0; i < nnz; i++) {
      if (ri[i] !== layout.rows[i] || ci[i] !== layout.cols[i]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) {
      const {colPtr, rowIdx, values} = buffers;
      for (let i = 0; i < nnz; i++) values[layout.slots[i]] = v[i];
      return {n, colPtr, rowIdx, values};
    }
  }

  if (buffers.colPtr?.length === n + 1) {
    buffers.colPtr.fill(0);
  } else {
    buffers.colPtr = new Int32Array(n + 1);
    buffers.fill = new Int32Array(n);
  }
  if (buffers.rowIdx?.length !== nnz) {
    buffers.rowIdx = new Int32Array(nnz);
    buffers.values = new Float64Array(nnz);
  }
  const {colPtr, rowIdx, values, fill} = buffers;
  const slots = layout?.slots.length === nnz ? layout.slots : workspace && new Int32Array(nnz);
  for (let i = 0; i < nnz; i++) colPtr[ci[i] + 1]++;
  for (let c = 0; c < n; c++) {
    fill[c] = colPtr[c];
    colPtr[c + 1] += colPtr[c];
  }
  for (let i = 0; i < nnz; i++) {
    const p = fill[ci[i]]++;
    rowIdx[p] = ri[i];
    values[p] = v[i];
    if (slots) slots[i] = p;
  }
  if (workspace) buffers.layout = {n, slots, rows: ri.slice(), cols: ci.slice()};
  return {n, colPtr, rowIdx, values};
}
