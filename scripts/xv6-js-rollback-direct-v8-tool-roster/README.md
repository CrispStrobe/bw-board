# Direct V8 tool roster observation

This separately named, hosted **report-only** profile follows the frozen tool-census failure. The earlier census retained a complete, silent `cc1plus --version` result and then refused the bounded `collect2 --version` result because it had both stdout and stderr. That refusal remains unchanged.

The new runner admits the same pinned Node 20.20.2 executable and header archive, then records all five compiler-tool locators and executable identities **before any version probe**. It retains partial locator and probe receipts on refusal. The ordinary strict probe still rejects mixed output. Two narrowly named observations are separate from validated versions:

- A complete exit-zero `cc1plus --version` with empty stdout and stderr is `VERSION_UNAVAILABLE_EMPTY`.
- A complete exit-zero `collect2 --version` with bounded UTF-8 GNU ld stdout and exactly the reviewed two stderr lines is `SPLIT_OUTPUT_DELEGATION_UNVERIFIED`. The second line must name the already located `ld` path. The runner rehashes that target before and after the collect2 probe and compares collect2 stdout with a separate direct `ld --version` stdout receipt.

The text comparison records advertised delegation and output consistency. It cannot prove which subprocess wrote the bytes, establish a `collect2` component version, or qualify a compiler build. Every target is rehashed after its probe and the complete set is rechecked at the end. The successful report status remains `TOOL_ROSTER_SPLIT_OUTPUT_UNQUALIFIED`; no addon is compiled or loaded, and no profiler or guest runs.

The dedicated workflow requires a same-repository pull-request label, exact head, and first attempt. It uploads only a closed, bounded JSON/text inventory after inventory admission. Node archives, headers, binaries, media, and profiles stay outside the artifact. The source and inventory controls can be run without invoking Node or a compiler:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-direct-v8-tool-roster/source-control.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-direct-v8-tool-roster/control.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-direct-v8-tool-roster/inventory-control.py
```

This source checkpoint is unexecuted on the hosted runner. A later build-control profile needs separate source, tool, binary, and support evidence before it can claim more than these observations.
