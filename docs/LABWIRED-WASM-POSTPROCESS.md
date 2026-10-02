# Opt-in post-link optimizer experiment (not production)

The normal builder still runs Cargo release and wasm-bindgen without executing
the wasm-pack package metadata's wasm-opt settings. This separate manual CI
experiment transforms a verified original artifact with pinned native Binaryen
123 `-O3`, retaining each original glue file and generating new BUILD-INFO.
It does not change normal build defaults, publication, app pins or core source.

`labwired-wasm-postopt.yml` downloads a declared original build-B artifact only
after checking the original run's exact tooling commit, two independent Rust
builds, determinism and integration gates. Source commit, original module hash
and exact original BUILD-INFO hash are explicit inputs. Archive and executable
hashes are pinned in `scripts/postprocess-labwired-wasm.mjs`; the executable is
hashed before even running `--version`. Two new independent runners transform
the same original bytes and compare all emitted module/glue bytes. No release
publication job exists, and workflow permissions are read-only.

Defaults describe original main `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`,
build run 36915940413, module SHA-256
`7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d` and
build-B metadata SHA-256
`d3052e87f1be597cf7e9665ab1720a9a89355aebadaf147ad86266a630cd1d16`.
This is independent of the unqualified register experiments in PRs 149/150.

The script refuses source-nested output, existing outputs, symlink artifacts,
unverified executable files and already-transformed input. Partial failures
preserve diagnostics but never receive final BUILD-INFO. Both original target
modules must be identical; only then may one transformed module be reused for
web and Node. Import/export descriptors and module validation are checked, but
these are ABI guards, not proof of instruction semantics. All 101 actual WASM
integration tests must run without failures or skips. The actual motion guest
and its unchanged every-window 1× floor run separately, with failed floor logs
retained. Neither small code nor a passing median waives that floor.

`builtAt`, `rawBytes`, bindgen version and Rust flags still describe the original
Rust/bindgen build. New module sizes/hashes describe transformed bytes;
`postprocess` records processed time, flags, exact optimizer/archive hashes,
source metadata hash, original target declarations and disabled publication/pins.
SOURCE-BUILD-INFO is byte-identical to the original. No original metadata is
silently reused to describe modified module bytes.

The local native pilot produced a 24,492,963-byte module from 27,556,189 bytes,
with unchanged glue and matching descriptors. After installing the checkout's
missing locked dependencies, all 101 actual integration tests passed. The first
42-test/four-failure attempt is preserved as an invalid dependency-incomplete
attempt, not accepted evidence. Local sequential ordinary VPS comparisons are
mixed: motion +8.61%, reverse +1.37%, repeat −5.97%; F0 RAM −5.23% then +14.98%,
GPIO −8.12% then +14.69%. Every selected every-window qualification fails.
This does not establish a workload-wide speedup or justify enabling optimization
by default. Independent hosted reproduction and Node 20/22 normal/reverse
comparisons are still owed before considering production acceptance.

After successful independent determinism and actual integration, use the
existing `labwired-motion-ab.yml` with the original build as baseline and this
workflow's build-B output as candidate. Both declared core source commits are
the same original main commit; artifact hashes and explicit transformation
provenance distinguish them. Run Node 20.20.2 and 22.23.3 in both orders with
F0 enabled. Do not relabel failed floors, pool hosts, discard negative results,
change hardware acknowledgements or publish this diagnostic artifact.
