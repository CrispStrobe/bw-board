# Paired-v3 (ten million retirements, exact device goldens)

A copy of the merged [paired-v2 harness](../i80386-read16-paired-v2/README.md)
in its own namespace, so the v2 files, frozen rows, request and reader stay
byte-identical. Work, schedule, limits and gate are unchanged: 18 children of
10,000,000 measured retirements after a 25,000-instruction throwaway warmup,
ABAB warm then AB BA AB BA BA AB BA; CPU A/B median >= 1.03 AND every pair > 1,
wall B/A median <= 1.02; capfit every child wall <= 30 s.

- `source-rows.json`: arm A master `cda9d13b…`, arm B candidate `fcbd8c68…`
  (branch `perf/i80386-low-ram-read-20261102`). 37 runtime files each (the v2
  list plus `src/i8088-cycles.js` and `src/i8088-timing.js`, which master now
  imports); only `src/experimental/i80386-at-machine.js` differs: `_read386`
  returns `mem[]` directly for a page-table RAM hit below the MP floating
  pointer (0x9fc00), where no A20, reset-alias, MP/APIC or VGA decode applies.
- `request.json`: the predeclaration (arms, rows hash, Node, gate, reader).
  Admits one capfit dispatch, then one paired dispatch only if capfit passes.
- `fixture.mjs`, `run.py`, workflow `i80386-paired-v3.yml`: v2 copies with
  renamed schema, environment and artifact names only.
- `device_golden.py` + `reader.py`: reader v3. Keeps every v2 check and adds
  exact goldens derived from source semantics, never from a child: the
  deferred chip-debt scheduler (`step`/`_flushChips`/`_wakeHorizon`), the
  PIT fractional carry replayed in the same IEEE-754 operation order, RTC
  cycle/periodic phases and register C, CGA cycles/frames/retrace and the
  8042 power-on BAT queue. It also reads the two retained paired-v2
  originals (runs 40521350218 and 40531608266); both are admitted, and a copy
  with any one of those values perturbed is refused.
- `controls.py`: manufactured packets (synthetic, not a measurement); the
  reader must pass good packets of both families and refuse every mutant.

No result here is a physical 386 timing, whole-OS or general-workload claim.
