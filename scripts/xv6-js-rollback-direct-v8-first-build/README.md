# Direct V8 first-build receipt

This separately named source profile prepares one bounded hosted build of the reviewed direct V8 addon. It does not load the addon or run a support case, profiler, or guest. The frozen tool-roster original observed all five compiler-tool identities and a complete split-output collect2 probe, but that output remains an **unverified delegation observation**. The exact reviewed original run, artifact, source and report digests, tool target bytes/locators, Node executable, and full header-map digest are bound in `authority.json`.

On a fresh Ubuntu 24.04 runner the new build runner downloads only the exact official Node 20.20.2 executable and header archives, verifies their digests and sizes, and parses headers under the existing 64 MiB aggregate, 2,000,000-byte member, 4,096-member and depth-12 build limits. It admits the frozen addon source and arguments. A closed compiler environment excludes ambient compiler and loader prefix variables. It resolves all five tools again, compares each locator and target hash/size to the reviewed authority, invokes the **pinned compiler real target** with fixed arguments, then rehashes the full tool set and source. Device and inode are checked only within the new run; they are not cross-run identity pins.

The inherited `build.py` main function is not invoked: it resolves `g++` anew through `shutil.which`. This profile owns an explicit bounded process runner with a 90-second compile and a 32 KiB combined output cap. A positive build requires a complete exit-zero child with empty diagnostics and a bounded ordinary `.node` file. Only its SHA-256 and size enter the receipt. Pre/post tool hashes do not prove which subtool subprocess executed, and the addon is never loaded. Even a successful receipt says `BUILT_UNLOADED_UNQUALIFIED`.

The dedicated same-repository, exact-head, attempt-one workflow retains a bounded report and first failure. The closed artifact inventory rejects binaries, raw archives, headers, media and profiles. Pure controls are source/file/process-mock tests; they do not compile or execute Node:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-direct-v8-first-build/source-control.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-direct-v8-first-build/control.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-direct-v8-first-build/inventory-control.py
```

This source checkpoint is unrun. Any addon loading or four-case allocation-support qualification needs a separate reviewed profile and original hosted evidence.
