# Fixed outer-boundary hosted results

The five fixed Linux fixtures passed in [original run 38361521769](https://github.com/CrispStrobe/bw-board/actions/runs/38361521769), attempt 1, on Ubuntu 24.04. The tested source is [80a19c789b350be3a10bf3443f14a3fb34e948b3](https://github.com/CrispStrobe/bw-board/tree/80a19c789b350be3a10bf3443f14a3fb34e948b3/scripts/i80386-supervisor-outer-boundary); [PR537](https://github.com/CrispStrobe/bw-board/pull/537) publishes that implementation. This result establishes the observed behavior of these manufactured fixtures only.

| Fixture | Observed seconds | Outcome | Namespace censuses | Original report |
| --- | ---: | --- | ---: | --- |
| Success | 0.035976 | Exit 0 | 2 empty | [JSON](receipts/outer-boundary-38361521769/success.json) |
| Startup stall | 5.009290 | Signal 9 | 2 empty | [JSON](receipts/outer-boundary-38361521769/startup-stall.json) |
| Detached-session sleeper | 5.008906 | Signal 9 | 2 empty | [JSON](receipts/outer-boundary-38361521769/detached-sleeper.json) |
| Partial binary stderr then stall | 5.008867 | Signal 9 | 2 empty | [JSON](receipts/outer-boundary-38361521769/partial-stderr.json) |
| Setup refusal | 0.029349 | Exit 4 | No namespace credit | [JSON](receipts/outer-boundary-38361521769/setup-refusal.json) |

The first four reports record admitted namespace/PID1 handles, terminal PID1, a reaped owned launcher, pipe EOF and two complete bounded empty namespace censuses. Setup refusal correctly records no admitted namespace, terminal-init or empty-census credit. All five report zero cleanup refusals and empty host-exception diagnostics. Direct signal termination is retained as return code `-9`, separately from shell-style status `137`.

Root and independent reviewers read the original ZIP without importing source helpers or replaying the fixtures. They checked official event, own-repository branch, tested head, first attempt, the single successful job and its steps, artifact identity, exact member set, output lengths/hashes and source hashes. The five linked JSON files retain original member bytes. They are reports from the fixture observer; they do not independently certify kernel or host behavior.

Original artifact: `supervisor-outer-boundary-38361521769-1`, [artifact 11795181495](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11795181495), 9,098 ZIP bytes, SHA256 `70fe92cec5e15a7aa41ae196153fab0e23120a3f3832d78e8c819b3faf277a54`. The original artifact has finite retention. Retained reports include raw-output lengths and hashes. Review confirmed exact stderr for the partial-output case: 27 bytes, hex `666978747572652d7061727469616c2d6f726967696e616c00ff0a`, SHA256 `e7db8a8707dfb9f9e1c874ff4343627197f9d754eebef1b606b7fcff7888cfad`.

The nineteen pure mock controls also passed in that hosted job. Source preparation passed root and independent review; the independent reviewer additionally exercised two refusal cuts for ancillary descriptor cleanup and HUP-only pidfd readiness. Those controls are separate from the five privileged hosted observations.

## Remaining work

This is not a full supervisor integration, universal syscall deadline, security sandbox, tool provenance certificate, provisioning run, compiler result, guest compatibility result or RTx measurement. Production remains unsealed. Every report keeps actual, compiler and guest qualification false. The five-second timer covers contained setup and bootstrap; observer admission has separate hosted bounds.

Finish all enabled exact-head CI checks before merging the reader and outer-boundary source checkpoints. Then connect the reviewed lifecycle reader and containment profile to a separately admitted actual provisioning invocation, with official event/job/step/artifact joins and a single-run gate. Keep compilation disabled until provisioning is independently qualified. Compiler closure and a freely licensed protected-mode client tested against an independent DPMI oracle and the AT guest follow that result. The [x86 lane guide](X86-NEXT-LANES.md) retains the broader acceptance criteria.
