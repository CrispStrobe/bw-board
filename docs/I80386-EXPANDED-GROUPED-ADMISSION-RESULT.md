# Expanded grouped 386 shadow admission: Windows opportunity gate fails

The [predeclared execution-neutral diagnostic](I80386-EXPANDED-GROUPED-ADMISSION.md)
completed an ordinary observer-off / expanded-observer Windows pair, begun
September 29 and completed September 30, at pinned
board revision `9cdec8cf10ccee264b1719c34c7948d5ddb7542b`, 60,000,000
steps in each arm. Its [source-bound compact receipt](receipts/2026-09-30-i80386-expanded-grouped-windows-result.json)
verifies committed source bytes and exact whole-report equality after
removing only the diagnostic and opt-in flag. The final full CPU instruction
snapshot, CPU and board cycles, RAM, and attached disk hashes match. The
private raw reports have SHA-256
`ff093dd32bad3d849961922f49a117dcaed41df170f7703718cc376d06a62b23`
(baseline) and
`cd73defe49dc16bd874b7bc51187fe3c7d3b510e15596574a43231e8010522e2`
(observed). The compact public receipt has SHA-256
`5036de31fe3f72649e1a051cc3b5bf823c09bb3ce2884e8a06b1c88c68338720`.
Observer runtime is instrumentation overhead, not a speed measurement.
Both pairs' raw reports, protocol manifests, and timing files are archived
privately at commit `86495d3d0806c49294090af4b08666b60e9d192d`.

The expanded grammar admitted **25,233,207** of **55,316,160** eligible
retired ordinals. It reached **6,098,778** unique ordinals in disjoint runs
of at least eight overall and **5,594,423** in protected16+VM86. The
predeclared **15M overall / 5M protected16+VM86 gate fails**: the overall
count is short by **8,901,222**, although the lower mode threshold passes by
**594,423**. The previous grouped grammar reached 4,642,606 and 4,298,838,
respectively, at an earlier source revision. These are disjoint-run counts,
not sums of local bridge opportunities.

| Entry mode | Eligible | Admitted | Unique ordinals in ≥8 runs |
| --- | ---: | ---: | ---: |
| Real | 12,134,947 | 3,129,532 | 284,857 |
| Protected16 | 9,068,664 | 5,592,414 | 2,992,087 |
| VM86 | 20,282,881 | 10,208,827 | 2,602,336 |
| Protected32 | 13,829,668 | 6,302,434 | 219,498 |
| **Total** | **55,316,160** | **25,233,207** | **6,098,778** |

The largest remaining refusal reasons are **10,674,869**
`unsupported-opcode`, **8,003,890** `unsafe-code`, and **7,401,896**
`deferred-stack-state`. These totals combine disjoint retired-ordinal
refusals across modes, but changing one reason can reconnect runs, so their
counts are not possible coverage gains. In particular, `unsafe-code` remains
an unchanged plain-RAM code-window cut. The diagnostic also found
**1,212,277** typed candidates rejected by an existing global cut, including
459,818 VM86 identity changes and 435,424 real-mode unsafe-code cuts.
Their syntax did not make them admitted ordinals. The added `8E` form did not
relax segment-cache identity: a changed cache still cuts the run, and a
changed visible ES selector cuts even with unchanged cache identity.

Register `50–5F` PUSH/POP instructions were observed **6,990,953** times
across the four modes and none entered the expanded grammar. Those opcode
totals include global-cut cases and do not predict long-run coverage. The
separate [selected register-stack ordered contract](I80386-REGISTER-STACK-ORDERED-CONTRACT.md)
now pins owned ordinary-CPU effects across protected16, VM86, and
protected32. The next bounded diagnostic candidate is to classify only those
proven register-stack forms with exact width, stack byte order, and the
unchanged page/event/identity/write cuts, then recompute **disjoint**
Windows ≥8-run ordinals. The large unsupported-opcode and unsafe-code
totals mean even that extension has no assumed route to the 15M screen.
No broader executor or speed claim follows from this failed gate.

A separate ordinary lean stock 4 MiB xv6 `forktest` baseline/observed pair
also ran from September 29 to September 30, completing **24,338,279** guest
steps per arm at the same pinned board
revision. Its [compact source-bound receipt](receipts/2026-09-30-i80386-expanded-grouped-xv6-result.json)
has SHA-256
`010ba88ea57575081c9ac3830359fb8972e3a7e524bc41861eb56839596a9db1`.
The private raw baseline and observed report SHA-256 values are
`74326bdba8ae7a38030f0d2ff3624a9c028862dee8f5acd8c1757e2dc483dd52`
and
`0cd3bbb3f750bc1cd4b4c6125acf0194011fc3c98f2c1f83728a793ee16391fc`.
The reducer independently verified the committed source map and whole-report
equality after removing only the diagnostic and flag, including final RAM,
both attached disk hashes, full CPU snapshot, and CPU/board cycles.

The xv6 grammar admitted **13,397,105** of **22,098,966** eligible
retirements, but only **317,206** unique ordinals entered disjoint runs of
at least eight, all in protected32. The real, protected16, and VM86 long-run
counts were zero. Its largest protected32 refusals were 4,295,874
`unsupported-opcode`, 1,731,637 `unsupported-group-extension`, and
1,012,882 `deferred-stack-state`; 1,504,465 real-mode ordinals hit the
unchanged `unsafe-code` cut. This is a separate coverage census with **no
xv6 pass threshold**. It cannot compensate for the failed Windows overall
gate, and step counts do not establish avoidable CPU cost or speed.
