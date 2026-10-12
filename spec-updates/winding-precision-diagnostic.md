# Finite winding precision diagnostic

This is an evidence tool, not a solver repair or a waveform-fidelity certificate.
It uses the existing authored 5 V, 5 mH / 10 ohm exponential NPN winding with
flyback diode and explicit 12 pF / 10 Mohm probe load. Device equations, source
corners, precision policy and whole-capture ceilings remain unchanged.

Run from the repository root:

```sh
node scripts/diagnose-winding-transient.mjs --case zero-storage --profile precision-v1
node scripts/diagnose-winding-transient.mjs --case time-zero-op --profile precision-v1
node scripts/diagnose-winding-transient.mjs --case dc-turnoff --profile precision-v1
```

JSON records the actual initial capacitor voltage and inductor current, public
operating-point receipt when selected, exact bounded receipt, failure status,
work counts and provisional observation values. Every capture retains one
20000-attempt / 60001-solve / 200-advance authority. Samples are not qualified
merely because the observer received them. Exit 1 means incomplete or inaccurate
capture; exit 0 means completed within that engine policy, **not SPICE agreement**.

The default zero-storage pulse rises for 1 us, stays high for 1 ms and falls
for 1 us. Its falling edge ends at 1.002 ms. The diagnostic ends at 1.01 ms
with 20 us observation intervals. The separately selected time-zero OP charges
the collector capacitor before simulation; it is intentionally not an equivalent
initial state. The DC control starts with drive high at its solved operating
point, falls from 1 us to 2 us, and captures 20 us at 100 ns intervals.

The current zero-storage regression explicitly checks preservation of the known
precision refusal. A passing diagnostic test does not count this circuit as
working. A later repair must replace that known-failure assertion with genuine
completion and independently refined waveform agreement, without substituting
OP initial storage, increasing work/error bounds or clearing the failure latch.
Reference comparisons must explicitly match initialization and physical load.

Runtime diagnosis is hosted. No current measurements or new reference agreement
were asserted by the source-only preparation of this tool. Late nonlinear ringing
and unloaded turn-off remain separate from the existing bounded sample and
passive RLC instrument qualifications.

## First exact hosted receipt

[CI38221691144](https://github.com/CrispStrobe/bw-board/actions/runs/38221691144)
at source `35848f2797add30b06b09c669a09e8a34a3b80de` reproduces the original
zero-storage precision refusal at 0.0010020000019999998 s, with a 1 ps step
and normalized error 11.950940967672846. Its whole-capture receipt reaches
20000 attempts / 59992 solves / 51 advances and retains only 50 provisional
observations. The ordinary status work record includes only the previously
completed integration intervals (3135 / 9401 / 50); use the bounded receipt,
not those partial counters, to audit the whole-capture authority.

The same pulse with public OP initialization completes at 1.01 ms within
3736 attempts / 11200 solves / 51 advances, but starts with capacitor voltage
4.999994999954797 V and winding current 0.5000045202874226 uA, not zero storage.
The separate DC falling-edge control completes within 551 / 1647 / 200 and
starts at 4.804253778974755 V / 19.574622102524475 mA. These are observed
engine values, not a newly qualified SPICE reference.

That first CI is **red** because the diagnostic test incorrectly assumed the
DC control current exceeded 100 mA. The forward evidence repair replaces that
unsupported assumption with independent series KVL: current equals the
5 V supply minus collector bias, divided by the 10 ohm winding resistance.
No capture, source or device equation is changed to make that assertion pass.
Fresh exact-head qualification remains required.

## Isolated Newton sensitivity hypothesis

The forward diagnostic explores one possible source of the step-independent
full/half disagreement: nonlinear Newton convergence uses a fixed 1e-6 threshold,
whereas the precision controller applies tighter endpoint voltage/error scales.
This is a hypothesis, not an established cause.

```sh
node scripts/diagnose-winding-newton-sensitivity.mjs
```

Two isolated in-memory module arms use the same zero-storage precision caller:
the unchanged 1e-6 Newton threshold and one experimental 1e-10 threshold.
Actual source files are never written; original source hashes and the edited
MNA hash accompany each public capture. Both Board solver imports must bind to
the same isolated MNA arm. All other modules, equations, integration policy,
sample partition, initialization and whole-capture limits remain unchanged.
Missing or duplicated anchors refuse the experiment. There is no arbitrary
user-selectable tolerance knob and no production policy change.

Hosted method checks accept either actual completion or an honestly preserved
refusal for the experimental arm. A green method test is **not** evidence of
improvement. The CLI remains nonzero while either capture fails. Completion,
if observed, still requires independently refined waveform/residual agreement
and broader qualification before any solver repair is proposed.

### Observed sensitivity result

[CI38251375347](https://github.com/CrispStrobe/bw-board/actions/runs/38251375347)
and [Harris38251375321](https://github.com/CrispStrobe/bw-board/actions/runs/38251375321)
passed at `f5be8c2566333f2213eb1b718db47dd80eccb8c3`.
The full suite reports 8478 passed, zero failed and 302 skipped. Both arms
remain incomplete, each exhausting 20000 attempts / 59992 solves / 51 advances
with 50 provisional observations. The unchanged arm reproduces the 1 ps
minimum-step refusal and normalized error 11.950940967672846. The 1e-10 arm
instead retains its first trapezoidal solve-convergence failure at
0.00001941114800327344 s. That earlier failure latch is not the final reached
time: the bounded capture continues and ultimately exhausts its work authority.
The simple tighter-Newton hypothesis supplies no successful waveform and is
not adopted as a production repair. Original Board/caller/MNA hashes match
across arms; only the isolated experimental MNA hash differs.

### Endpoint-error component diagnostic

```sh
node scripts/diagnose-winding-error-components.mjs
```

This separately isolated Board module observes, without altering acceptance,
the same controller's full-step versus two-half-step endpoint comparison.
It retains the last eight rejected comparisons and the first floor witness,
including signed values, normalization scale, dominant node/storage component,
each solve's convergence flag and copied incoming capacitor/inductor histories.
The original caller, production files, zero storage, model, precision policy,
sample partition and bounded work authority remain unchanged. Exact single
instrumentation/import anchors are mandatory. This is a bounded diagnostic,
not a new simulation mode, repair, physical measurement or oracle qualification.
Numerical execution and the recorded component outcome await hosted checks.

### Observed endpoint-error result and linear-solver isolation

Exact `80411f08858f2a02e1e01872ef92e96c2adb0952` passed
[CI38265472136](https://github.com/CrispStrobe/bw-board/actions/runs/38265472136)
and [Harris38265472103](https://github.com/CrispStrobe/bw-board/actions/runs/38265472103)
(8481 passed, zero failed, 302 skipped). At the first floor witness, all
three solves report convergence. The winding node dominates: full/half values
5.8175934364425625 / 5.817592739990311 V differ by 0.696452251425228 uV,
while winding currents differ by only 2.42861286636753e-17 A. Collector voltage
error alone is below the normalized acceptance bound at that witness. The
non-monotonic voltage error under refinement motivates a linear-solve check;
it does not yet establish a cache or conditioning defect.

```sh
node scripts/diagnose-winding-linear-solver.mjs
```

This evidence-only diagnostic compares original cached sparse LU, fresh
sparse factorization and the existing dense partial-pivot implementation on
the same stamped systems. Original files remain untouched; both Board solver
imports and the same zero-storage caller select each isolated arm explicitly.
Newton tolerances, integration histories, policies, physical parameters and
work authority are unchanged. Actual outcomes await hosted qualification.
Neither an alternative solver completing nor a green method test alone
constitutes a production repair or independent waveform agreement.

Exact `8961915887ea4ea34079bc8f3e2311a40bf00a6d` passed
[CI38277473063](https://github.com/CrispStrobe/bw-board/actions/runs/38277473063)
and [Harris38277473010](https://github.com/CrispStrobe/bw-board/actions/runs/38277473010)
(8484 passed, zero failed, 302 skipped). The original cached sparse arm
reproduces the normalized11.950940967672846 floor refusal and exhausts20000
attempts/59992 solves with50 provisional observations. Fresh sparse and dense
arms both complete the requested1.01ms with3432 attempts/10288 solves and51
observations under identical authority. Disabling factor reuse alone removes
this failure: reuse is causal for this fixture. This does not yet establish
the exact numerical mechanism, safe reuse admission rule, physical fidelity
or SPICE agreement. A bounded production repair needs actual sparse pivot/
residual adversaries, unchanged-policy waveform regression and broad solver
checks; globally disabling reuse is not the selected production fix.

### Bounded numeric-reuse admission candidate

The candidate makes numeric refactor refuse when its retained pivot is smaller
than another structurally reachable unpivoted candidate. This restores full
factorization's existing largest-remaining partial-pivot invariant rather than
introducing an arbitrary relative threshold. The caller already discards a
refused partial factor and performs full factorization. Identical-value
substitution and changed-value reuse with stable pivots remain available.

An independently authored two-row system changes from `[[1,1],[0,1]]` to
`[[1e-10,1],[1,1]]` with exact solution `[1,1]` and right-hand side
`[1+1e-10,2]`. The executable old-guard mutant must admit its obsolete pivot
and exceed1e-8 equation residual; guarded refusal plus full factorization
must recover below1e-14. Separate unchanged and changed stable-pivot controls
protect retained reuse. Actual kernel, broad solver and unchanged-policy
zero-storage completion tests run hosted. This is a candidate until those
results pass, and it does not replace the pending independent SPICE reference.

The exact candidate `ca168e03e549a0960f22161d5e30fa147f0a4dba` passed
[CI38284904347](https://github.com/CrispStrobe/bw-board/actions/runs/38284904347)
and [Harris38284904465](https://github.com/CrispStrobe/bw-board/actions/runs/38284904465):
8485 passed,zero failed,302 skipped. The actual obsolete-pivot refusal,
independent residual, executable guard-removal mutant and stable reuse controls
pass. The real zero-storage caller completes1.01ms using3432 attempts/10288
solves/51 observations, without a floor witness and without changed accuracy
or work bounds. Earlier failed-source receipts remain preserved above. This
proves this fixture's completion repair, not independent waveform agreement
or a measured general speedup. A concurrent ESP32 integration is merged for
fresh combined qualification, preserving the tested solver and affected tests.
