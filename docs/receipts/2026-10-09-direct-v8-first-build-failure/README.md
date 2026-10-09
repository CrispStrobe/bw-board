# Direct V8 first build: compiler refusal before addon output

[Draft PR484](https://github.com/CrispStrobe/bw-board/pull/484), reviewed source
`77fd5fbbc132d48622eb0790c0b2d66a6e66a5a4`, passed all ten enabled
checks with only two declared optional skips before the single
[original run 37963686779](https://github.com/CrispStrobe/bw-board/actions/runs/37963686779).
The official conclusion is failure. Root and an independent reviewer audited
the retained original packet, source and log; [summary.json](summary.json)
records the first failure and public original identities.

The nine-member packet admits 51 source roles. Its first failure is
`compiler-exit` after a complete bounded compiler return: exit code 1,
zero stdout bytes and 8,146 stderr bytes. The diagnostic shows incomplete
`v8::HeapProfiler` and undeclared `AllocationProfile` declarations; the
source omits the `v8-profiler.h` include. This supports a narrow header
correction, with any later compiler result still untested. All five
post-compile tool observations matched their admitted identities and reported
no separate tool failure. No addon was reported, bundled or loaded.

Preserve the failed original. A separately reviewed source correction must
pass a fresh pinned build before any same-run addon-load or lifetime support
gate. This run establishes no successful build, delegated subprocess lineage,
profiler behavior, guest result, allocation hotspot or speedup.
