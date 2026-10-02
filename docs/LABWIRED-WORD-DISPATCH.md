# Actual-WASM live-word dispatch regression

`test/labwired-word-admission.test.mjs` exercises deployed Cortex-M execution,
not a JS double or the native-only unit-test composition. Its hand-encoded F0
guest repeatedly executes the **same STR/LDR instruction addresses** while
changing their live target: first RAM's lower bound, then actual GPIO ODR, then
RAM again, an unaligned RAM word, and the last fully backed RAM word. External
PA1 transitions advance a guest-owned descriptor pointer. No host memory poke,
register write, reset, breakpoint or single-step mode clears caches between
these phases.

Seven tests use batch budgets 1, 7, 8, 16, 31, 64 and 257. They verify bounded
progress, guest readback/count/phase receipts, concrete SRAM bytes, untouched
unaligned neighbors, and actual GPIO MODER/IDR/ODR effects. The adapter retains
the engine's declared-safe peripheral tick interval; the tests do not widen it
to bypass scheduler guards.

Run with an existing original Node WASM artifact and ordinary repo dependencies:

```sh
LABWIRED_WASM=/absolute/path/to/nodejs LABWIRED_WORD_REQUIRED=1 \
  node --test test/labwired-word-admission.test.mjs
```

No engine download, engine build or guest compiler happens inside the test.
The required flag fails closed when the actual artifact is absent. Future
`labwired-wasm.yml` builds include all seven tests and require at least 108
executed tests with zero failures and zero skips (the previous suite ran 101).
Existing archived 101-test receipts and the frozen performance harness remain
unchanged.

The separate `labwired-word-dispatch.yml` proof job reuses original artifacts
from baseline run 36915940413 (core `43b2d62f`) and selective candidate run
37027849668 (core `90ff69aa`). It pins Node 22.23.3, source identities and original
module/glue hashes, runs all seven cases against both engines, and preserves
their build manifests and raw test logs. Those experiment artifacts expire;
the fixed-run proof must not be treated as an evergreen download service.
The ordinary build workflow is the ongoing regression gate.

This is architectural/peripheral behavior coverage, **not fast-path hit-count,
RTx, physical-hardware or production-promotion evidence**. It covers valid word
boundaries, not faulting cross-boundary/unmapped accesses or arbitrary IRQ
interleavings. Native differential tests remain necessary. Performance still
requires separate unchanged, repeated, order-controlled comparisons; failed
floors and minima cannot be erased by a passing correctness test. No production
source pin, published artifact or physical drift acknowledgement is changed by
adding this gate.
