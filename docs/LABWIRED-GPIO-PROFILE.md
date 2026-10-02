# Independent GPIO-only attribution

Run the existing `labwired-f0-profile.yml` manual diagnostic with
`gpio_profile=true`, `profile=false`, source `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`
and original deterministic build `36915940413`. The optional path pins Node
22.23.3. It first preserves ordinary RAM+GPIO timing, then launches independent
ordinary and sampled GPIO-only processes. The original acceptance harness,
parser, guest, scheduling and every-window ≥1× requirement remain unchanged.
This is diagnostic tooling, not a source optimization or pin promotion.

The new harness is identical to the existing F0 timing harness except that its
workload list contains only GPIO. It compiles no RAM guest and performs no RAM
workload simulation. A portable source guard enforces this identity. The strict
GPIO parser requires both actual functional/timing tests, all five cycle-indexed
48M-cycle windows, held PA1/BSRR observations, exact exit/verdict counts and zero
skips. Ordinary and sampled runs must have identical loaded image hashes and
cycle-indexed guest observations. Original WASM/glue bytes are verified against
the build manifest before either run. Raw output survives a parse failure.

The CPU profile is **whole-process GPIO-only**, including initialization, guest
compilation, functional tests, warm-up, tiering and measured windows. It is not
a profile of only steady-state timed windows. Sampling can change tiering and
timing; its rates never replace ordinary acceptance measurements, and its frame
shares are not removable-cost percentages. In particular, these diagnostics
cannot establish that an admission probe or GPIO hook can be safely eliminated.

Hosted artifacts include original build info, runner/tool provenance, both raw
ordinary workloads, GPIO-only ordinary/sampled stdout/stderr, the complete raw
CPU profile and its hash/named-frame summary. Do not download engine binaries
to a resource-constrained VPS. Missing or failed evidence is not qualification.
Invalid CPU samples keep the original raw profile and its hash plus the parser
error in the receipt, and fail the diagnostic. Negative time deltas are not
clamped or silently removed. Ordinary timing receipts remain independent.
Core main, app pins, published engines and physical acknowledgements remain
unchanged. Further candidates still require their own correctness and repeated
ordinary RAM/GPIO/motion acceptance.
