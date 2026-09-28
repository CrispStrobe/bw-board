# Windows 60M first-refusal context result

The [predeclared first-refusal diagnostic](I80386-FIRST-REFUSAL-CONTEXT.md)
completed ordinary 60,000,000-step Windows baseline and
`AT_FORM_REFUSAL_CONTEXT=1` arms at board revision
`cbab1b3535854750ea83bdea86dc5fc6aaeb3960`. The source-bound reducer
reproduced the private candidate byte-for-byte. Exact revision, all 40 reported
source hashes, pinned inputs, and selected reported guest state matched; both
arms stopped at the 60M budget. The private raw reports, host record, timings,
and full 8.9 MB candidate are preserved at private commit `a61f272`. The
[compact public receipt](receipts/2026-09-28-i80386-first-refusal-context-summary.json)
omits media identifiers, paths, guest text, and the large cross-tab. Its
[reducer](../scripts/summarize-i80386-first-refusal-result.mjs) rechecks raw,
host, timing, full source-bound reduction, and candidate hashes. Observed-arm
runtime is instrumentation overhead, not speed data.

The existing typed grammar saw 55,316,160 eligible retired ordinals, admitted
21,057,233, and refused 34,258,927. Only 3,023,405 admitted ordinals lie in
disjoint runs of at least eight; 2,710,535 are in protected16 or VM86. The
earlier 15M / 5M subset opportunity gate therefore remains failed. The new
context report partitioned every refusal and counted 126,618 local contexts
with admitted runs of at least four on **both** sides; only 732 had eight on
both sides. These local contexts overlap and cannot be added to disjoint
retired-run coverage.

| Mode | Refusals | Local bridges ≥4 | Leading first-refusal opcode groups by bridges ≥4 |
| --- | ---: | ---: | --- |
| Real | 9,766,495 | 7,751 | `8E` segment MOV 3,096; `43` INC 952; `FF` 900 |
| Protected16 | 4,294,314 | 53,489 | `A8` TEST AL,imm8 26,320; `8D` LEA 12,631; `0B` OR 6,825; `FF` 4,106 |
| VM86 | 11,757,929 | 62,685 | `8E` segment MOV 50,135; `FF` 5,062; `31` XOR 2,670 |
| Protected32 | 8,440,189 | 2,693 | `FF` 1,048; `E3` JCXZ/JECXZ 975; `0B` OR 265 |

These opcode totals group distinct prefixes, ModR/M extensions, effective
addresses, and observed access shapes. The receipt retains the leading exact
form records. In particular, `FF` mixes register/memory increment and control
transfers; its aggregate is not one executable operation. `8E` changes segment
state, `A8` changes flags, and `8D` computes an address without a RAM read.
Observed accesses do not establish fault timing, segment-cache effects,
stack ordering, or a safe reusable micro-op grammar.

Candidate A had been defined narrowly as `80/81/83` `/0,/1,/4,/5,/6`
`unsupported-group-extension` records with both neighboring admitted runs at
least four. Its exact counts were **850 overall** (real 323, protected16 365,
VM86 99, protected32 63) and **464 protected16 plus VM86**. It missed the
predeclared 250,000 / 100,000 prioritization gate by orders of magnitude.
Do not build the Candidate A ordered replay or a narrow performance executor
from this result.

The next diagnostic should be **one grouped, execution-neutral shadow
admission replay** rather than a single-opcode executor. Predeclare two
strata before another 60M pair: ordinary data/flag/EA forms (`A8`, `8D`,
`0B`, `31`, and typed `FF /0`) and segment/stack/control forms (`8E`, typed
`FF /2`, direct call/return, and stack push/pop). The second stratum must
remain a side exit until focused tests prove selector/cache changes, precise
fault and stack ordering, code/translation identity, and synchronous device
cuts. The replay must retain prefix, ModR/M, EA, RAM/port access, event and
page-identity cuts, then report **disjoint unique retired ordinals in runs ≥8**
separately by mode and stratum. The paired run must again prove exact
source/input/selected guest parity. Retain the existing **15M overall and 5M
protected16+VM86** gate before considering a reusable performance executor;
if either count fails, expand or revise the grammar instead. No extra guest
run or executor is part of this receipt.
