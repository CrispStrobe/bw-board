# Direct V8 tool census source checkpoint

This separately named, report-only gate follows the [frozen 64 MiB preflight](../xv6-js-rollback-direct-v8/preflight.py). Its first hosted run refused a complete exit-zero `cc1plus --version` probe with empty stdout and stderr before it retained the located tool's executable identity. That failure remains unchanged.

The census repeats exact pinned Node and header admission, then records each tool's compiler locator, real executable target, size and SHA-256 **before** its exact `--version` probe. It retains bounded raw probe output, hashes the tool and compiler again afterward, and rechecks the complete tool set. Only a complete exit-zero, empty-stdout/stderr `cc1plus` result receives `VERSION_UNAVAILABLE_EMPTY`. This records an unavailable version string; it never validates the component version. Other empty, failed, timed-out, noisy or incomplete probes refuse the gate and retain the first failure and partial identities.

The dedicated workflow is same-repository, exact-head, attempt-one and label-only. It uploads only a closed bounded JSON/text inventory, including partial reports on failure. Source identity is recomputed at the start and, for a completed census, at the end; a failed partial report does not claim an end-source recheck. It does not compile, load an addon, sample allocations or execute an emulator or guest. The source checkpoint is unrun; no hosted tool authority has yet been established by it.

Pure controls: `python3 -B scripts/xv6-js-rollback-direct-v8-tool-census/control.py`, `source-control.py`, and `inventory-control.py`. The full Git source identity requires a complete clean checkout and is checked by the hosted workflow before and after observation.
