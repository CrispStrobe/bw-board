# Mixed-profile corrected-source xv6 regression

[Run 37850270611](https://github.com/CrispStrobe/bw-board/actions/runs/37850270611)
passed at reviewed [PR466](https://github.com/CrispStrobe/bw-board/pull/466)
source `1ecb987b86217c7c549fffc1d3b7ff498898b9dd`. This push run reports that
same executed revision. Its retained original ZIP contains the fresh pinned
MIT xv6 build receipts and three finite guest results: 4 MiB filesystem boot,
14 MiB boot and process-exhaustion `forktest`, each with the expected returned
shell output and user-mode/kernel milestones.

All 69 focused journal/boundary/policy/orchestration tests pass, including the
corrected fault expectation, mixed-width positive and descriptor-mutation
cases. The current CPU cohort passes 1,633 tests with 11 skips; all 288
historical-source tests pass. Source hashes in each guest report match reviewed
Git, and ROM/build/image identities agree with the retained receipts.

This is the existing PSE/APIC compatibility profile, not strict physical 386DX
qualification. It does not establish a new CWSDPMI AT interrupt/IRET pair,
complete PC compatibility or speed. Other required exact-head checks are still
pending; the dedicated frame guest run has not been launched.

[Summary](summary.json) records original ZIP/log hashes, public acquisition
URLs, finite scenario counts and source identities. Root and independent peer
audited originals without importing producer parsers or replaying a guest.
