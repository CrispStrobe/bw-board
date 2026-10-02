# Excluded from acceptance evidence

`vps-f0-primary/` overlapped an owned reverse-motion diagnostic. Retain its
original comparison, child receipts and stdout unchanged, but do not count its
medians or floors toward acceptance. The run completed with matching guest
observations, yet was not isolated from other owned benchmark work.

`vps-motion-reverse.json` is that aborted, overlapping diagnostic. Its first
candidate process completed; the baseline process was interrupted. The receipt
is incomplete and contaminated, not a four-process comparison.

The separate `vps-motion-primary.json` completed before this overlap began and
before the reverse diagnostic was started. Its ordinary result remains valid
with the usual uncontrolled shared-host limitations.

Clean reruns use distinct `vps-motion-reverse-clean.json`,
`vps-f0-clean-primary/`, `vps-motion-repeat.json`, `vps-f0-clean-reverse/`
paths. They run sequentially in one shell after the preceding owned benchmark
finished. No owned compiler or optimizer overlaps these reruns.

The independent main post-optimizer pilot was intentionally stopped during its
redundant second target to prioritize clean register-inlining timings. The
partial `postopt-main-O3/` tree has no completed BUILD-INFO and is unqualified.
It has not been executed in any timing or promoted into either engine candidate.
