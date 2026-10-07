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

The planned hosted gate must authenticate the original actual artifact before
any child, rebuild unchanged qualified addon source once and bind the fresh
binary/build/configuration, run fresh alternating baseline/candidate and
candidate/ordinary-JS pairs, and require complete architecture, board, whole
RAM, ordered PIO and closure parity for every timed child. Two warmup pairs and
seven measured pairs are required. Baseline-versus-candidate is a causal
comparison; candidate-versus-ordinary-JS is the separate adoption gate. An
actual source and guest review is required before dispatch or adoption.
