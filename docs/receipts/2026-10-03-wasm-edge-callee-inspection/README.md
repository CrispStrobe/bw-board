# Production WASM GPIO callee inspection

Static diagnostics only. No engine execution, benchmark, tier forcing, new
optimization, app pin or hardware acknowledgement change. The ≥1× all-target
goal remains open; the ordinary measurements in the warmed-window archive
are unchanged.

Three hosted inspections verify original production build 36915940413,
core `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, WASM SHA-256
`7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d`
and glue SHA-256
`b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73`.
No module bytes were downloaded to the VPS. The full 201,474,404-byte WAT
stayed on the runner; its digest and selected original text are retained.

The cold GPIO eligibility loop calls indirectly through device-vtable byte
offset 48, signature `(i32, i32) -> void`, then tests the returned slice length.
The Button resident-device vtable at address 17,082,440 has Button destructor,
Debug, service and stimulus-conversion entries. Its offset-48 entry is table
index **7707**, named `DeclarativeLogicDevice::input_channels`. That function
only stores `i64.const 8` into the output pointer: an empty slice with its
aligned dangling pointer. The exact source has a default borrowed empty
`edge_service_addrs` slice and Button does not override it. The compiled
empty-slice method is shared across these trait implementations.

This resolves the misleading sampled label in the earlier warmed-window
profiles: it is consistent with GPIO eligibility dispatch, not metadata
allocation/discovery. Static inspection does not observe the runtime device
inventory of every sample, establish all candidate windows as valid vtables,
or make the sampled self share removable. Other scan candidates include
unrelated or shifted windows; the conclusion uses the typed Button table,
the compiled caller and the matching exact source together.

Datasets are immutable: `initial/` (run 37115219824, tool 5f89d76f),
`types/` (run 37115264554, tool 3c4ddab3), and `static/` (run 37115675629,
tool 8764ff68). The intermediate static run 37115414464 failed on unsupported
WABT data formatting. Its original full job log and complete failed-step
output are preserved. The final parser accepts the terminal data/module
closing parentheses; its fixture regression and actual hosted inspection
pass. No failure was waived. PR #295 landed only after all eleven enabled
checks passed; the two existing vectors-full skips are unchanged.

The manifest binds every retained receipt, run metadata, original selected
disassembly, losslessly compressed job log and exact source file. Portable
tests independently check hashes, table resolution, call sites, source
contracts, failure provenance and the exact-head tooling merge.

Next experiment: target repeated empty-edge eligibility dispatch while
preserving live inventory/address changes, mux/timer delivery and synchronous
edge ordering. Do not reuse the rejected caller-gate result as a qualified
optimization. Any new core change must start from current main and pass
correctness, actual WASM integration, and all four ordinary Node/order A/B
pairs before promotion.
