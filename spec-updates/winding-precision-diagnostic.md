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

## Independent zero-storage reference preparation

```sh
node scripts/diagnose-winding-uic-reference.mjs
```

The independent authored ngspice deck has explicit capacitor/inductor IC=0
and UIC, the same stated thermal voltage, device parameters, physical 12pF /
10Mohm load and finite PULSE corners. It does not import the engine or exporter.
Three fixed maximum steps (100, 50 and 25 ns) characterize ten aligned voltage
and winding-current measurements through 1.01 ms. Both adjacent refinement
differences must remain within 10 uV and 1 nA for a stable-reference result.
Unstable results remain evidence, not qualified goldens; the CLI exits 1.
Full decks, hashes, solver version and original measurement output are retained.
The authoritative measurements bypass FIND entirely: direct transient voltage
and current vectors are exported through `wrdata`, with one time scale,
explicit vector names and `numdgt=15`. The parser requires three finite
full-precision columns and strictly increasing times. A separately tested
linear interpolation retains both original bracketing rows for each requested
time, together with the original waveform hash and row count. No extrapolation,
missing/duplicate time row, wrong vector authority or low-precision table is
accepted. Solver output remains in the receipt. Each solver uses a fresh owned
temporary directory, removed on every success/failure path.
See ngspice's [wrdata command](https://nmg.gitlab.io/ngspice-manual/interactiveinterpreter/commands/wrdata_writesimpledata.html).
CI38268219098 at f14713d2 stopped correctly on insufficient v0 precision;
Harris38268219115 passed. This is a reference-harness failure, not measured
reference instability or an engine fix. Its scalar-vector successor4d22bb12
passed the numerical method job in CI38277122271, but independent raw audit
found rounded FIND results were also stored rounded: e.g. raw1.957462e-02
became printed1.957462000000000e-02. The decimal-length gate therefore had a
false-positive padding hole. Those results are not qualified reference
precision or instability evidence. The direct-vector repair removes FIND
and adds actual nontrivial-value negatives against seven-digit rounding,
not merely a decimal-length assertion. Fresh hosted qualification is required.
An actual normal-OP negative control must differ from the zero-storage early
collector voltage. Neither reference completion nor reference refinement alone
constitutes engine agreement. Hosted numerical results are still pending.
