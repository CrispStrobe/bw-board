# Empty-batch direct RAM paired experiment

Status: **SOURCE ONLY; no addon build, guest, or timing result for this profile.**
The default machine and qualified ABI5 provider are unchanged. This directory
prepares a causal comparison of two timing providers for the same free BIOS
316,562-quantum workload. The baseline is the previously measured timing-only
direct provider: it omits per-entry JSON journal serialization while retaining
the scalar 400,000-entry cap, native journal, copied batch validation, board
overlay, ACK and clock callbacks. The candidate adds exactly the reviewed
empty-journal generation Map expression from the guest-qualified empty-batch
profile. Empty batches still call `directDrain` and `directCommit` and preserve
the session, phase and ACK checks. Nonempty batches still clone and validate the
Map before any native ACK.

`provider.mjs` authenticates the exact qualified provider and two imported
dependencies, proves both inverse transforms, and binds normalized and loaded
module hashes separately. The provider controls use fake owners only; they do
not establish actual CPU3, N-API, guest parity, or a speed change. Run them with
an absolute path to a clean checkout of qualified source
`acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1`:

```sh
node scripts/cold-direct-ram-empty-paired/provider-control.mjs "$QUALIFIED_SOURCE_ROOT"
```

The dormant hosted gate uses an exact-head, same-repository labeled PR event.
Before timing, it inventories every tracked file in this directory and the
held paired harness, plus the qualified CPU/board/free-ROM roles; it compares
live bytes to Git objects. It authenticates and replays the original actual
packet, then authenticates the prior empty-batch actual packet and verifies
that every changed direct report field except admission metadata equals the
original. It rebuilds the unchanged qualified addon once and binds the fresh
binary, static build receipt, configuration and Node version. It does not
demand equality with a historical binary built on another host.

Each fresh child has a 300-second wall bound, 240-second CPU bound, 1.5 GiB
observed and post-reap RSS bound, 8 MiB stdout/stderr bound, and process-group
cleanup. The native child is an inverse-verified derivative of the previously
qualified paired child, preserving its stage/resume loop and 166-word CPU
checks. Every child must pass full reset/last/final CPU, board, whole 16 MiB
RAM hash, complete ordered PIO, source-backed owner counters and closure
checks before its duration enters a summary. Plain JS has process-scope
termination rather than a model close API. Failures retain their first
invocation, stdout/stderr, partial receipt and completed-pair records.

Each comparison has two warmup pairs and seven measured pairs with alternating
order. Candidate-versus-baseline is a causal provider-variant comparison and
has no adoption verdict. Candidate-versus-ordinary-JS separately requires at
least 10% lower mean execution process CPU and all seven measured pairs faster
for an adoption verdict; a semantic pass can still be a performance failure.
Startup, execution and whole-child CPU/wall are reported separately. The
configured clock is not a physical 386 speed calibration. No instrumentation
breakdown or native cost share is inferred from this gate. An actual source,
guest and timing review is required before any default change.

Additional source-only controls:

```sh
node scripts/cold-direct-ram-empty-paired/native-child-control.mjs
python3 -B scripts/cold-direct-ram-empty-paired/policy-control.py
```
