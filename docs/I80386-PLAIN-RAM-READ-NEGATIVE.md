# Plain RAM read shortcut: stopped Windows timing trial

The [predeclared shortcut gate](https://github.com/CrispStrobe/bw-board/blob/a0ac741d9f17bbf4b0528927280e13b4921e2936/docs/I80386-PLAIN-RAM-READ-SHORTCUT.md)
at board revision
`a0ac741d9f17bbf4b0528927280e13b4921e2936` failed its predeclared
Windows retention gate. The pinned protocol ran serial AB/BA pairs of the
ordinary and shortcut arms, each to the 60,000,000-step budget, and stopped at
the first pair that did not favor the shortcut. Pair 1 measured 78.33 versus
78.23 user CPU seconds (baseline, shortcut); pair 2 measured 77.53 versus
80.18. Pair 2 was unfavorable. The third Windows pair and separate xv6 pair
were not run. This trial establishes no speed benefit and does not justify
retaining the shortcut.

The [public result](receipts/2026-09-29-i80386-plain-ram-read-windows-negative.json)
pins the board and private protocol revisions, the key executable source
hashes, the private archive commit, and SHA-256 hashes of the archived host,
reports, and timing files. The
[reducer](../scripts/summarize-i80386-plain-ram-read-windows-result.mjs)
verifies all 42 executable source blobs against the committed board revision,
checks the host timing record against the raw files, and compares all four
complete reports after removing only `inputs.plainRamReadShortcut`. Every
remaining field matches, including final RAM and disk hashes. Thus this was
a timing-gate failure, not an observed guest-state mismatch. The private raw
evidence is archived at commit `77eabfc` under
`performance/2026-09-29/plain-ram-read/evidence`.
