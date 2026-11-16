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

## Compatible ordinary-test toolchain

The actual failed ordinary run43939491877 at `6b9eefcf` retained both images
in artifact14268933723. GNU as2.46 versus compatible2.42 changes only implicit
alignment padding: five bytes within Win16 file offsets `[0x4a,0x50)` and nine
within VM-task `[0x2a4,0x2b0)`. Independent ELF32 section reading found those
same differences in relocatable .text before linking. Other image bytes and
symbol positions match; original fixture hashes remain the acceptance gate.

The ordinary test job therefore selects Ubuntu24.04 and checks the known
compatible GNU2.42 assembler, linker and objcopy before its existing serial
tests. `check-x86-fixture-toolchain.mjs` records resolved executable paths,
SHA256, version output and runner identity; a missing tool, failed probe or
other version fails admission. It does not change any assembler/linker flag
or fixture byte. The provenance JSON joins the existing ordinary diagnostic
upload; an admission failure also prints the full record in the job log.

Ubuntu24.04 is an environment selector, not an immutable executable digest.
The observed tool identities are retained and both original hard image seals
must still pass. Configuration/retention controls alone do not qualify a new
Board head or Lite pin. Required hosted checks and original fixture success
remain pending until observed on the actual repaired head.

```sh
node --test test/x86-fixture-toolchain.test.mjs test/x86-fixture-failure-retention.test.mjs
```
