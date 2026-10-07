# Cold CPU3 direct-RAM correctness checkpoint

Updated 2026-10-07. The experimental ABI 5 same-DSO direct-RAM profile passes its finite full cold free-BIOS comparison against the companion owned-RAM and unchanged callback paths. Tested source is `acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1`, published in [PR420](https://github.com/CrispStrobe/bw-board/pull/420). [Actual run 37605762900](https://github.com/CrispStrobe/bw-board/actions/runs/37605762900) passed the hosted controls, pinned Bochs build, static admission and all three actual guest arms. This is a correctness result; paired timing has not run. Functional JavaScript remains the user-facing baseline.

The [public receipt](receipts/2026-10-07-cold-direct-ram.json) identifies the exact source, original official artifact, hashes, host and limits. The evidence artifact is `cold-direct-ram-actual-37605762900-1`, ID `11474662523`, 2,405,475 bytes, SHA-256 `3881456e5dd46f256640cd28af30117f0be1a92f1b2fe9df1712067c3ea31905`. Its 40 original members include raw guest reports, the complete ordered journal and initial RAM, build/source manifests, controls, logs, configuration and notices. Compiled addons are deliberately omitted. Their reported hashes bind the producer's build receipt and inventory; the coordinator did not independently rehash an uploaded binary.

## Observed parity

All three arms match full reset, requested-last and final native state (20 + 20 + 90 + 30 + 6 words), compact progress, architectural clock/callback/execution counters, complete board state, all 16,475 ordered PIO events and the whole 16 MiB RAM hash. Each reaches 316,562 native ticks and successful quanta (N/Q) in 16,524 resumes, with zero fallback. The distinct instruction counters record 316,167 attempts and 316,166 completions; N/Q must not be relabeled as those counters. Final RAM SHA-256 is `af0c07fc87959f6481ab7611967ac40a2c8d3d5fa14beac0979cc99e95913f02`.

The coordinator, coder and independent reviewer read the original evidence without importing the producer's comparator or rerunning the emulator. They checked the source/generated maps and replayed all 91,958 journal writes from the complete initial RAM: exact before/after bytes, contiguous sequence and acknowledgement, ordered effect IDs, session/epoch, bounded N/Q, page generations and first-touch Map order. Replay reproduces the whole final RAM hash.

Native committed and acknowledged watermarks both end at 91,958. Pending journal, prepared batch, page ticket, uncommitted retry and code fence are clear. Actual CPU/owner and provider/board closure are recorded.

## The identified failure and correction

[First attempt 37602755657](https://github.com/CrispStrobe/bw-board/actions/runs/37602755657) at `26520e5ecce8be4a84f5484e0849ded7c62048a6` built successfully but aborted with a generic clock-callback failure. That trace did not establish the failing subphase. [Diagnostic attempt 37604871518](https://github.com/CrispStrobe/bw-board/actions/runs/37604871518) at `a265cb54d7fd0dad30abb80a48cf1a7004384934` exposed a PAGE clock flush with two tape words rejected by the actual ROM-page-address check. Both original failed artifacts remain identified in the receipt.

The bridge had conflated a clock flush before fetching a page with the later page-admission callback. The correction introduces private `PAGE_CLOCK` kind 15 only for the clock flush. It validates and publishes the clock tape without a page address or ticket. Actual PAGE kind 4 retains strict ROM-page admission and one-use ticket consumption. Controls cover a pending-write acknowledgement at the clock flush without a ticket, malformed clock/page requests, a valid subsequent ROM page, and denial of page access from a clock callback. No ownership or phase check was removed.

## Remaining limits and next gate

Physical RAM/ROM/open-bus effects now run in C++ inside the CPU3 addon. The actual run records 91,949 native direct reads, 91,958 writes and zero JavaScript physical-memory entries. It retains 233,122 clock transfers and 282,652 owner reconciliations, plus page, PIO and device callbacks. These are event counts, not measured CPU-cost shares or evidence of a speed gain.

The profile remains fixed-A20, ordinary-memory and ROM-execution-only. MMIO ownership, paging, DMA, RAM execution and a clock lease are excluded. This fixture does not establish complete AT boot, protected-mode OS/application compatibility, general media loading or GUI adoption. See the [user loading guide](X86-LOADING-GUIDE.md) for the functional baseline.

Next, perform separate same-host direct-versus-companion and direct-versus-plain-JS timing: two warm-up pairs, seven alternating measured pairs of fresh children, exact source/addon/configuration binding and a semantic proof for every child. Retain execution CPU/wall and whole-child windows separately. The adoption bar remains at least 10% lower mean execution CPU than ordinary JS with all seven measured pairs favorable. Preserve a failed performance result. The [previous compact result](I80386-COLD-PAIRED-RESULTS.md) remains historical and cannot supply this profile's speed or RTx. See [next lanes](X86-NEXT-LANES.md) for clock authority and wider protected-mode work.
