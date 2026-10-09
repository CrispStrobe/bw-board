# Far-attribution CPU controls: preserved fixture failure

The first automatic [push run37940838674](https://github.com/CrispStrobe/bw-board/actions/runs/37940838674)
for [draft PR480](https://github.com/CrispStrobe/bw-board/pull/480), source
`33a8f62a8ac3613007e80f2f3ee066d6ea987edf`, failed before xv6 build or boot.
Root acquired the original raw log once; root and a separate reviewer audited
its identity, official metadata and TAP outcomes without replay or producer
imports. [summary.json](summary.json) records public identities and counts.
The run fetched pinned xv6 source but produced no artifact.

Sixteen new controls failed in `retainedProtectedModeForFar` setup with
`MOV CR requires CPL0`, before their far-transfer assertions. The mixed-entry
fixture began at CPL3; the CPU correctly refused privileged MOV CR0. Current
TAP totals were 1,679 passed, 16 failed and 11 skipped out of 1,706; the
historical suite passed all 288. The separate default-off control passed.
These results do not qualify the far-transfer controls or an xv6 guest.

The test-only correction `6191a70650142ea46552c2d417eb7eb62aa08e38`
models a committed synthetic task-core return into a coherent ring-0 code
and stack context before decoded MOV CR0, and fixes the competing far jump's
code16 encoding. This is explicit constructed control state, not evidence
about the previous AT guest's opcode. Production CPU bytes are unchanged.
Root and independent source/syntax review passed; corrected hosted controls
and affected xv6 qualification remain pending. Preserve the failed original
and both earlier source checkpoints; do not rerun that original or relax
CPU privilege checks to make the fixture pass.
