# Read16 paired-v2 (ten million retirements) — source preparation

Implements the first slice of [the paired-v2 plan](../../docs/I80386-READ16-PAIRED-V2-PLAN.md).
Every execution guard is **false**. Nothing here runs a paired child, guest,
profiler or actual event, and no result, gain or adoption follows from it.

Present:

- `fixture.mjs`: fixed 10,000,000 measured retirements after a separate
  25,000-instruction throwaway warmup, the exact eighteen-child order
  (ABAB warm, then AB BA AB BA BA AB BA) and the unchanged gate (CPU A/B
  median >= 1.03 and every ratio > 1; wall B/A median <= 1.02). An
  independently derived architectural golden comes from the loop recurrence,
  not candidate output.
- `source-rows.json`: both 35-runtime-file arms frozen by Git blob bytes.
  Arm A is master `e5bf38a5…`; arm B is the unadopted `55917c48…`. Only
  `src/experimental/i80386.js` differs (five added lines).

The architectural tuple saturates after 16 loops (AX alone after 15 from the
reset value), so at ten million it cannot distinguish correct from wrong
progress. Activation still needs, separately: independent PIT/RTC/CGA/PIC/
keyboard/debt device goldens, a 60-second cap-fit proof including every error
branch and the host witness, `run.py`/`reader.py`/`controls.py`, a guarded
workflow, and separate request/one-shot admission. The old minimum ratio
.999455 remains FAILED and unadopted. No physical RTx claim.
