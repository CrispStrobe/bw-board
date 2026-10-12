# Corrected post-PF CPU prerequisite regression original

[Exact-source push run38145633988](https://github.com/CrispStrobe/bw-board/actions/runs/38145633988) at [3bd7b09c](https://github.com/CrispStrobe/bw-board/commit/3bd7b09cc01f02bd99f2c3b4d72b982d1f511f77) passed, attempt1. Coordinator and independent original-byte audits pass the closed five-member packet, official metadata, current/historical controls and three finite freely licensed xv6 regressions.

Current controls recorded 1,773 tests: 1,762 passed, zero failed and 11 skipped. All 288 historical controls passed. The new post-PF controls, including repaired accepted/rejected IRQ admission and CR0/VM86/retained-CS adversaries, passed. CPU bytes remain unchanged from the first prerequisite source; only the fixture's incoming-task IF premise was corrected. The [first failed original](../2026-10-11-post-pf-cpu-first-failure/README.md) remains preserved.

The pinned MIT xv6 source and redistributable Bochs BIOS reached the 4 MiB filesystem marker in 14,643,086 steps, 14 MiB boot marker in 10,962,834 steps and process-exhaustion marker in 24,338,279 steps, within unchanged 30M/30M/40M budgets. Each records user-mode entries and syscall activity; the filesystem scenario records post-boot IRQ14. All 70 guest source roles match the exact Git head, and raw input-image/filesystem hashes bind both fresh build receipts. Runtime disk hashes represent padded and guest-modified media and are distinct from those raw input hashes.

This qualifies the authored controls and ordinary finite xv6 regressions for this CPU source. It does not qualify an actual post-PF guest continuation, owned frame return, fault service/repair/retry, full OS compatibility or performance. All enabled exact-head checks still need to pass before a separately admitted connection. No default branch or consumer pin is adopted.

[Curated summary](summary.json) retains the sole official artifact identity. Raw host logs, image paths and binaries are not bundled.
