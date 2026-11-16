# Owned x86 fixture failure diagnostics

The Win16 I/O and VM-task host builds retain evidence only when their existing
image-hash check fails. The original assertion/error is rethrown unchanged;
missing diagnostic tools or unwritable storage cannot turn the mismatch into
success or replace the original error. Matching images create no diagnostic
files or tool calls. Assembly sources, command options and sealed hashes stay
unchanged; no reference capture is rerun.

Set `BW_X86_FIXTURE_DIAGNOSTICS` to a writable directory to retain evidence
there. Otherwise failures use a `bw-x86-fixture-failures` directory under the
system temporary directory. Each failure gets a fresh subdirectory. The
ordinary owned CI test job sets the variable and uploads this directory with
its existing test log, including on failure. Its existing event/tier selection
and failure condition are unchanged; this does not request additional jobs.

A manifest binds the original pipeline argv, expected and actual image SHA256,
source and OBJ/ELF/raw file sizes/hashes, GNU tool paths/versions/executable
hashes, diagnostic argv, selected environment and explicit diagnostic gaps.
Disassembly, ELF metadata and complete offset-addressed image hex support a
later byte comparison. Only the three named small build outputs and source
are copied; the VM-task pipeline has no linked ELF, so none is invented.
Tool identities are observations at failure retention time, not retrospective
proof of the historical capture toolchain. A future record is not recovery of
a discarded original image.

Focused host controls (synthetic bytes and tool boundaries; no GNU pipeline
or guest replay):

```sh
node --test test/x86-fixture-failure-retention.test.mjs
```

The diagnostics do not fix the image drift or qualify a new Board/Lite pin.
Do not restamp either oracle hash. Use actual failing bytes and tool identities
to establish the cause before selecting a deterministic recipe/toolchain fix.
