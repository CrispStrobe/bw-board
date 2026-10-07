# Exact missing notice bytes, no executable work

This separate, report-only stage follows the measured [source/notice result](../i80386-cwsdpmi-source-notice/RESULTS.md).
It acquires only three already measured DJGPP source archives, **not** the
80 MB cross-toolchain. Each archive must match the preceding hosted SHA-256
before its members are inspected. The missing `copying.lib` notice must have
the measured 26,530 bytes and SHA-256 in all three archives, with exact byte
equality. Its original bytes are retained. The JSON display uses a reversible
one-codepoint-per-byte Latin-1 projection so form feeds and other control bytes
remain visible as escapes; it does not claim the file's historical encoding.

The workflow also records the raw Git tag/ref response and requires the
`releases/gcc-12.2.0` tag object and peeled commit before retaining the exact
bounded GCC `COPYING.RUNTIME` and `COPYING3` files from that commit. These
notices are primary GCC source references. They alone do **not** prove which
objects are in the measured cross-toolchain `libgcc.a`, that all such objects
carry the exception, or that a future linked client meets redistribution
obligations. Those decisions remain separate compile-admission work.

The dedicated label triggers one exact-head, same-repository, read-only hosted
job. Inputs are inventoried before validation; partial raw notice bytes, role
comparisons, progress and the first failure are kept in a bounded report-only
artifact. No source archive, executable, compiler output or guest image is
uploaded. No compiler, QEMU or AT guest runs in this stage.

The bounded local control needs no component downloads:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/i80386-cwsdpmi-notice-completion/notice-control.py
```
