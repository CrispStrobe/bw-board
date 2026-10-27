# Read16 paired-v2 (ten million retirements)

Implements [the paired-v2 plan](../../docs/I80386-READ16-PAIRED-V2-PLAN.md)
(claim PR712). **Default off:** the hosted `actual` job refuses unless master
carries a committed `request.json` admitting the dispatched mode. No local
benchmark route exists; `run.py` refuses outside GitHub Actions.

- `fixture.mjs`: 10,000,000 measured retirements of the authored five-op AT
  loop on fresh state after a separate 25,000-instruction throwaway warmup.
  The child verifies its arm's 35 runtime files by bytes/SHA-256 before import
  and records a fresh pre-step `setup` observation.
- `source-rows.json`: arm A master `e5bf38a5…`, arm B unadopted `55917c48…`;
  only `src/experimental/i80386.js` differs (five added lines).
- `run.py`: inside a systemd service with one CPU, CPUQuota 100%, 1 GiB, no
  swap, 64 tasks; each child has a 60 s deadline, bounded streams and wait4
  usage. Records a host witness (selected CPU vendor/family/model/stepping,
  kernel, runner image, Node version/bytes/SHA-256, cgroup limits; no hostname
  or machine IDs). `capfit` runs one child per arm; `paired` runs the eighteen
  children ABAB, then AB BA AB BA BA AB BA. Failures are retained, never retried.
- `reader.py`: standalone stdlib reader. Independent goldens: the saturated
  architectural tuple (closed form over every AX0), retirements/charges, and
  device goldens from declared constants (machine cycles, debt/deadline bound,
  CGA frame count and retrace phase at applied clocks, PIT fraction range,
  no-I/O PIT/PIC/RTC/8042 invariants against the child's own setup). Exact PIT
  fraction, RTC phases and keyboard progression are recorded, not asserted.
  Capfit: every child wall <= 30 s (half the 60 s deadline, predeclared).
  Gate: CPU A/B median >= 1.03 AND every ratio > 1, wall B/A median <= 1.02.
- `controls.py`: manufactured packets; the reader must pass a synthetic good
  packet and refuse or gate-fail every mutant. Synthetic, not a measurement.

The architectural tuple alone saturates by 16 loops and cannot show progress;
the device goldens are what tie a child to ten million actual retirements.
The old minimum ratio .999455 remains FAILED and unadopted. No result here is
a physical 386 timing, whole-OS or general-workload claim.
