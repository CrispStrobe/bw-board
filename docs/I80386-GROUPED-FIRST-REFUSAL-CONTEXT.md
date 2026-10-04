# Predeclared grouped 386 first-refusal diagnostic

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The [source-bound grouped-shadow result](I80386-GROUPED-SHADOW-ADMISSION-RESULT.md)
missed its 15M overall / 5M protected16+VM86 disjoint ≥8-run opportunity
screen. `AT_GROUPED_FIRST_REFUSAL_CONTEXT=1` adds a default-off diagnostic to
the **same grouped grammar**. It never dispatches or executes a guest
instruction; the ordinary CPU remains the syntax and semantics oracle.

For each completed, eligible ordinal that the grouped grammar first refuses,
the diagnostic keeps the first refusal reason and the lengths of the admitted
run before and after it. It records exact fetched prefix sequence, primary
and `0F` secondary opcode, operand/address width, declared ModR/M `mod`/`reg`
(`/reg`)/`rm`, SIB and displacement **shape**, and observed RAM read/write or
port activity for these predeclared opcode families:

- Segment move `8E`;
- Stack push/pop `50–5F`, `06`, `07`;
- Direct call/return `E8`, `C2`, `C3`, `CA`, `CB`;
- Mixed `FF`, `0F` secondary opcodes, and `C1`.

All other refusals remain in an explicit unselected count so selected plus
unselected equals every grouped refusal in each mode. A declared ModR/M is
parsed only where its syntax is known; an unknown `0F` secondary says
`not-declared-modrm`, not a guessed effective address. The observed access
class can include implicit stack effects and does not prove an executable
EA or ordered RAM contract. No complete instruction-byte sequence, address or
guest text enters the cross-tab; opcode, prefix and shape fields are retained.

The predeclared diagnostic decision is to rank exact shapes by **local**
bridges with admitted runs of at least four on both sides, separately for
real, protected16, VM86 and protected32. The targeted families combined must
yield at least **250,000 such refusal ordinals overall and 100,000 in
protected16+VM86** before considering a grouped ordered-contract fixture
programme. Even a passing diagnostic only prioritizes fixtures; local
bridge opportunities cannot be summed as disjoint executable coverage or
used to infer a speedup. If it fails, revisit grammar breadth and guard
causes before further execution work. Any later expanded-admission replay
must independently pass the unchanged 15M/5M disjoint ≥8-run screen.

Run an ordinary baseline with every
cross-mode observer and dispatcher off. Run the observed arm with only
`AT_GROUPED_FIRST_REFUSAL_CONTEXT=1`. Capture both private raw reports,
host record and timing files. Then, from the pinned board checkout, run:

```sh
node scripts/summarize-i80386-grouped-first-refusal-context.mjs \
  observed-private.json baseline-private.json > candidate-private.json
```

The reducer requires the same exact execution revision, complete source-hash
map verified against committed source bytes, matched input pins and selected
reported guest state, 60M-step budget completion, ordinary and grouped run
partitions, and selected/unselected refusal plus adjacent-run histograms.
Publish only a reviewed, bounded media-neutral summary of the verified
candidate. Keep raw reports, full candidate, media identifiers and timings
private. Observed-arm runtime is instrumentation overhead, not speed data.
