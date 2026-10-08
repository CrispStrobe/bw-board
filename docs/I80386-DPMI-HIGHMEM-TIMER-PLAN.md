# Owned DPMI high-linear-memory and BIOS timer gate

This is a separate free/owned fixture under draft qualification. The [current DJGPP client](https://github.com/CrispStrobe/bw-board/blob/cc5b2ac7a40788f7d0100c4a1b5b5a9996bc2c66/scripts/i80386-cwsdpmi-owned/client.c) allocates 4,096 bytes, checks 256 bytes through an LDT selector, and checks that one simulated BIOS timer interrupt returns successfully. It does **not** require an address above 1 MiB or advancing ticks. Preserve that client and its existing QEMU and [AT completion evidence](I80386-DPMI-AT-COMPLETION-RESULTS.md). [PR456](https://github.com/CrispStrobe/bw-board/pull/456) remains a draft at this checkpoint; its observed result is not a merge or a qualification of this later fixture.

The [fourth AT loaded-main diagnostic](https://github.com/CrispStrobe/bw-board/blob/cc5b2ac7a40788f7d0100c4a1b5b5a9996bc2c66/scripts/i80386-cwsdpmi-at-owned-code/FOURTH-RESULTS.md) retained a strict whole-`.text` **FAIL**. Its authenticated comparator reported exact bytes for the owned `main` and seven wrapper extents, but the original packet omitted executable and guest code bytes. That finding motivated a separately named owned-code-at-entry profile; it did not qualify client completion or any interrupt service trace. Review the linked, audited [AT completion outcome](I80386-DPMI-AT-COMPLETION-RESULTS.md) before building on it.

## Current source checkpoint

[Draft PR458](https://github.com/CrispStrobe/bw-board/pull/458) implements the
separate QEMU gate at
[`6ec767b`](https://github.com/CrispStrobe/bw-board/tree/6ec767b50008beb53b012dafcf55361de3ffb146/scripts/i80386-cwsdpmi-highmem-timer).
Root and peer source review passed, together with pure compiler-adapter,
strict-output, media, observer, artifact-inventory and source-admission controls.
Exact source admission binds 105 roles and three reachable JavaScript modules.
These controls do not execute a compiler or guest.

The first [hosted QEMU attempt](https://github.com/CrispStrobe/bw-board/actions/runs/37764261886),
attempt 1, passed; root and peer independently audited its original report-only
artifact. Read the [finite QEMU result and evidence boundary](I80386-DPMI-HIGHMEM-QEMU-RESULTS.md)
before continuing. The original source and outcome remain frozen; no rerun was
needed. The subsequent AT outcome is recorded below. The earlier client
and its AT evidence are unchanged.

The separate AT source gate is published as [draft PR459](https://github.com/CrispStrobe/bw-board/pull/459)
at [`41db7ba4`](https://github.com/CrispStrobe/bw-board/tree/41db7ba4a0c96076aa6a5e5c74cd70be2a0ad0d7/scripts/i80386-cwsdpmi-highmem-at).
Root and peer source review and pure binding, cut, grade, driver and source
controls passed; source admission binds 184 roles and 53 reachable JavaScript
modules. The gate pins the QEMU executable, linker map and initial-media hashes,
authenticates ten owned code extents, and binds later observations to a private
copy of the approved client output. Its declared limits are 120 million steps
and 640 seconds of scenario wall time.

Its first [hosted AT attempt](https://github.com/CrispStrobe/bw-board/actions/runs/37776895780),
attempt 1, passed; root and peer independently audited the original report-only
artifact. Read the [finite AT result and retained strict-text failure](I80386-DPMI-HIGHMEM-AT-RESULTS.md).
The original source and outcome remain frozen; no rerun was needed. This
completes the finite application/output gate, not interrupt-frame attribution
or general compatibility. No CPU/device implementation or consumer dependency
pin was changed. Next work follows the [single-allocation frame-attribution contract](I80386-DPMI-FRAME-ATTRIBUTION-LANE.md).

## Fixture and acceptance sequence

1. Add a new owned client under `scripts/i80386-cwsdpmi-highmem-timer/` with its own source, output markers, media roles, and exact source-binding adapters. Keep the existing client, compiler/package pins and prior receipts unchanged. Record the exact CWSDPMI, FreeDOS, BIOS, toolchain, source and media hashes and the explicit 4 MiB machine profile for each run.
2. Authenticate a request for 4,096 bytes through DPMI function `0501h`. Require successful status and retain the returned handle without assuming it must be nonzero; require a linear start **strictly greater than** `0x00100000` and check that the requested 4,096-byte span has a 32-bit last address that does not wrap. Allocate and initialize an LDT data selector, write/read the owned 256-byte pattern, check its fixed checksum, and attempt both selector and block cleanup even after a later failure, reporting any cleanup failure. Read back the selector base and require it to equal the returned linear address; use CPU `LSL` to require an exact byte-granular limit of 4,095. [DPMI 0501h](https://www.delorie.com/djgpp/doc/dpmi/api/310501.html) returns a committed *linear* block's address and handle, not its size, and does not create a descriptor. A library structure's retained request size is not an independently returned allocation extent. This gate does not establish physical placement above 1 MiB.
3. Call `__dpmi_int` for BIOS `INT 1Ah`, `AH=00h` more than once, initializing every input register structure before each call. Retain first/last `CX:DX` values and poll count; require each value below `0x1800B0` and a positive, bounded modulo-day tick difference, including midnight wrap. [DJGPP documents](https://www.delorie.com/djgpp/doc/libc/libc_246.html) that `__dpmi_int` uses DPMI `0300h`; the [BIOS timer contract](https://www.delorie.com/djgpp/doc/rbinter/id/80/22.html) defines the ticks-since-midnight result. Establish a generous finite poll budget on the QEMU control before choosing an AT cap. Cap expiry means progress was not observed within that budget, not that the timer is broken. Do not seed guest ticks from the host, sleep to manufacture progress, or patch an executable or image.
4. First compile and run the fresh fixture on QEMU TCG with an explicit `pc`/486/4 MiB profile. Require exact fixed success, zero-exit and separate shell-return marker bytes plus a current prompt. Parse variable address and tick diagnostics with a strict bounded grammar and validate their ranges and predicates; do not require whole-output byte equality across machines. Then run the same newly authenticated source/client/media bytes on the AT path with its separately recorded CPU/device profile, requiring an owned-code entry observation, the same fixed markers and parsed predicates, accepted input, and fresh current-prompt evidence. Preserve the first failure and bounded original observations in both runs. Compare the **address and tick predicates**, not absolute linear addresses or timer values across machines; QEMU and AT are not identical hardware profiles.

Passing both finite runs would establish this owned client's high *linear* allocation, pattern readback, advancing reported BIOS ticks, zero exit and shell return under the stated profiles. It would not establish physical high-memory placement, calibrated clock accuracy, `INT 31h` frame/IRET ownership, all DPMI functions, strict 386 hardware equivalence, or general application compatibility. The QEMU and AT finite outcomes are recorded separately above; interrupt-frame attribution remains unqualified.
