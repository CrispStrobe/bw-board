# Opt-in protected 32-bit native eligibility census

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

Set `AT_NATIVE32_CENSUS=1` on a noninteractive ordinary
`scripts/run-i80386-at-console.mjs` run. The report gains `native32Census`.
The option cannot be combined with native execution, code16 experiments, or
the mode CPU sampler. It never calls the native runner or changes guest state.

At each protected 32-bit entry, the census calls the existing native byte
decoder without executing its result. That decoder admits only previously
cached translations and direct RAM; it does not walk page tables, set A/D
bits, or issue bus reads. A wrapper around the ordinary CPU's `_fetch8` records
bytes the guest actually fetched, without fetching additional bytes. After
the step, the census counts a fetched opcode and selected ModR/M families only
when the core cycle count advanced and the first fetch matches the entry
CS:EIP. Interrupt redirects and nonretiring calls are reported separately.

`entryAttempts` counts protected 32-bit **step calls**, while
`sameEntryRetirements` counts completed instructions observed at the same
entry CS:EIP. Candidate categories partition the entry attempts:
`codeWindowRefusedAttempts`, `decodeNullAttempts`, `singleCandidateAttempts`,
`multiCandidateAttempts`, and `repeatCandidateAttempts`. A decoder result with
two or more instructions is only a syntactic candidate, not an executable
coverage or speed claim. `candidateStopReasons` is deliberately coarse:
`unsupported-or-page-boundary` combines several exits the current decoder
does not distinguish. The census decodes at each entry rather than mirroring
the dispatcher's cache, so its null counts are **not** native null-cache hits.

`retiredOpcodes` and `retiredModrmForms` count actual fetches from same-entry
retirements. `nullByRetiredOpcode`, `singleByRetiredOpcode`, and
`candidateCategoryByRetiredModrmForm` relate those retirements to the
pre-step decoder result. ModR/M form keys use `m0`–`m3`; group opcodes 81,
83, and C1 also include `g0`–`g7`. Forms with prefixes retain the underlying
opcode key; `prefixBytesOnRetiredSteps` records their aggregate prefix count.

Use a pinned private guest report and compare all ordinary guest outputs
after removing only the census field, source hashes, and revision. That threshold chooses work to test; it does not predict a speedup. A later
executable trial must prove exact faults, memory and code coherence, chip
events, and full guest parity while retiring multiple instructions per call.
