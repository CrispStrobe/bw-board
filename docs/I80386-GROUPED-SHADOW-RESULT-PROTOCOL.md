# Compact publication protocol for grouped-shadow admission

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

Its opt-in observed arm is paired with an observer-off baseline at one pinned
board revision and identical media/input pins. The source-bound paired reducer
must pass before any result is published. This file defines a compact public
view; it does not contain a broader guest result or start a guest run.

First produce the full private source-bound candidate with
`scripts/summarize-i80386-grouped-shadow-admission.mjs`. Then run the
[compact summarizer](../scripts/summarize-i80386-grouped-shadow-result.mjs):

```sh
node scripts/summarize-i80386-grouped-shadow-result.mjs \
  observed-60m-private.json baseline-60m-private.json \
  receipt-public-candidate.json > grouped-shadow-public-summary.json
```

The compact script verifies the candidate's raw-report hashes, obtains every
reported source blob from the exact execution revision, reruns the complete
paired reducer, and requires exactly matching parsed candidate content. The
underlying reducer checks exact revision and complete source-hash map,
selected guest/input parity, all four mode partitions, run histograms and the
predeclared gate. The compact script refuses any parity/source difference or
inconsistent per-mode disjoint count. It caps the emitted JSON at **32 KiB**.

The output retains raw/candidate SHA-256 references, eligible/admitted/refused
retired ordinals, disjoint runs and unique ordinals in runs of at least eight
for each mode, the protected16+VM86 subtotal, the **15M overall / 5M
protected16+VM86** stop/go screen, access-class counts, and at most eight
leading admitted forms, long-run forms, refusal reasons and run-end reasons
per mode. Form keys describe opcode/prefix/ModR/M/EA/access shape without
guest instruction bytes or addresses. Media identifiers, local paths, guest
text, host names and timing are omitted. Top-form counts can overlap with
other rankings and do not replace disjoint-run counts.

A passing gate would be an optimistic opportunity result, not proof of an
executable trace grammar or speedup. Observed-arm time is instrumentation
overhead. Keep raw reports and the full candidate in private evidence and
audit the compact JSON before any public receipt is committed.
