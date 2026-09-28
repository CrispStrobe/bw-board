# Predeclared grouped shadow admission for 386 Windows traces

The [first-refusal result](I80386-FIRST-REFUSAL-CONTEXT-RESULT.md) rejected
Candidate A: its `80/81/83` arithmetic-extension local bridge count was only
850 overall and 464 in protected16+VM86, below the predeclared
250,000/100,000 prioritization gate. The stronger local contexts involve
several different forms, especially `A8` TEST AL,imm8, `8D` LEA and `0B` OR
in protected16; `8E` segment MOV, `FF` and `31` XOR in VM86. Local bridges
overlap and cannot be counted as disjoint trace coverage.

`AT_GROUPED_SHADOW_ADMISSION=1` is a separate, default-off observer variant.
It runs the **ordinary CPU** for every step and classifies only the bytes
already fetched by a successfully completed instruction. It keeps the prior
typed MOV/CMP/TEST/group-7/short-control/byte-I/O grammar and adds this
single grouped data/flag/effective-address stratum:

| Opcode/form | Shadow admission | Required observed data shape |
| --- | --- | --- |
| `A8` | TEST AL,imm8 | Exact byte immediate; no RAM or port access |
| `8D` with `mod != 3` | LEA | Complete ModR/M, SIB and displacement; no RAM access |
| `0B` | OR r,r/m | Register or RAM read, separately typed |
| `31` | XOR r/m,r | Register or RAM read and write, separately typed |
| `FF /0` | INC r/m | Register or RAM read and write, separately typed |

Other `FF` extensions, including `/2` near call, remain deferred control or
stack side exits. `8E` segment moves, direct call/return and push/pop are
explicitly deferred. A global fault, event, data safety or identity refusal
can take precedence over the deferred-form label. A later grammar must prove
segment selector/cache updates, precise stack/fault ordering, and control and
translation identity before admitting those forms. The grouped classifier
still refuses unproved or extra memory/port activity, page crossings,
nonlinear successors for data forms, unsupported prefixes and incomplete
ModR/M/EA bytes. It does not implement or dispatch any guest instruction.

The observer inherits the existing physical code-page, data-page,
code/translation write, mode/CS/identity, host/DMA write, chip deadline,
interrupt, I/O helper and external-event cuts. It excludes REP iteration
calls, no-retirement calls and aborts from the architectural-retirement
denominator. A run is a disjoint sequence of uniquely counted eligible
retired ordinals; the 64-instruction budget and the ≥8-run gate are unchanged.
Successful ordinary execution is still an optimistic syntax and semantics
oracle; this is **opportunity measurement**, not a safe executable micro-op
proof or performance estimate.

Before a Windows run, pin one clean board revision, the known licensed media
hashes and input geometry, then run two serial **60,000,000-step** arms:
ordinary baseline with all dispatchers/observers off, followed by an ordinary
observed arm with only `AT_GROUPED_SHADOW_ADMISSION=1`. Reduce with
`node scripts/summarize-i80386-grouped-shadow-admission.mjs observed.json baseline.json`.
The reducer requires the exact same execution revision, complete source hash
map verified against committed bytes, matching input pins and selected guest
state, typed partition invariants and disjoint per-mode run histograms.
Publish a media-neutral receipt only if all checks pass. No heavy Windows run
accompanies this change.

The predeclared stop/go screen is **at least 15,000,000 unique eligible
retired ordinals in disjoint runs of eight or more overall and at least
5,000,000 in protected16+VM86**. Report both counts and all four modes.
Passing is only an optimistic opportunity screen and does not justify an
executor until the admitted forms' ordered RAM, flags, fault, code identity
and synchronous device contracts are proved against the ordinary CPU.
If either count misses, revise the grouped grammar or guards before building
a performance backend. Observed-arm runtime is instrumentation overhead and
must not be used as speed evidence.
