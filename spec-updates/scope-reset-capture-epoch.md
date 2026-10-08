# Attached scope capture after reset

`Board.reset()` returns simulation time to zero. Attached scope handles now
start a new capture epoch rather than retaining an old future sampling deadline
or displaying samples from the preceding run.

- Voltage envelope/sample and manually sampled current rings become empty,
  with zero count/write index and NaN unwritten slots. Old partial extrema and
  sample interpolation state are discarded. Voltage sampling restarts one
  configured interval after zero; envelope labels remain bucket starts and
  sample labels remain acquisition instants, including after wrap.
- Digital rings discard old transitions and record the newly solved reset level
  once at time zero. An unchanged level is not recorded again on advance.
- Handles, rate, depth, capture mode, threshold, reference and finite probe
  loading remain configured. Manual current sampling still occurs only when
  its caller requests it; this does not redesign its cadence or time labels.
- A refused capture remains refused. Reset neither clears its failure reason
  nor repairs skipped device history. Board failure/overflow authority is
  unchanged; a new valid Board is the positive recovery control.

The regression witness attaches a100kHz scope at20us, then resets: previously
the first two10us intervals disappeared because the old30us deadline survived.
Focused native tests cover late/partial/wrapped sine envelopes and samples
against a fresh Board, retained loaded-probe configuration, current and digital
history, and actual finite-analysis refusal. Existing device-overflow and live
clock tests remain required.

This is capture-state reset only, not general device-model reinitialization,
solver/budget changes, a benchmark speedup or a qualified consumer package.
Actual installed GUI restart qualification follows upstream CI and exact package
adoption; source tests alone do not establish that consumer behavior.
