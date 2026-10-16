# Ring-changing INT/IRETD source checkpoint

This MIT-authored fixture targets one 80386 software-interrupt roundtrip from
ring 3 through a ring-0 interrupt gate and TSS stack, then IRETD back to ring 3.
It is a source checkpoint under the
[merged task claim](../../docs/X86-NEXT-LANES.md#ordinary-js-ring-changing-intiretd-fixture).
No guest execution or QEMU comparison has qualified this candidate yet.

`fixture.mjs` builds a deterministic 64 KiB reset ROM without an assembler or
compiler. It exports the ROM identity, symbols, copied memory blocks and record
layout. `probe.mjs` defers the ordinary JavaScript CPU import until explicitly
invoked. Its intended observations cover the instruction before INT80, handler
entry, the instruction before IRETD and the returned ring-3 instruction. A
separate one-way INT81 reporter emits records saved before reuse of the first
interrupt frame.

The defined frame fields, flags, selectors, registers and stack guards have
explicit expectations. Undefined selector padding is retained rather than
assigned an architectural value. Within one execution, the saved frame must
still match the original frame, including its padding. Flag-recording scratch
words are declared writes; adjacent guard bytes remain checked.

Run the pure source controls from the repository root:

```sh
node --test test/i80386-ring3-int-iret.test.mjs
```

These controls generate bytes and exercise manufactured validation inputs.
They do not run the CPU or establish a successful privilege transition.

The independent original-only reader (`reader.py`), packet controls
(`controls.py`) and a controls-only hosted controller (`run.py`) are now source
checkpoints. Run their inert controls with:

```sh
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/controls.py
/usr/bin/python3 -B scripts/i80386-ring3-int-iret/run.py --controls
```

The controller has named runtime-discovery functions for executable files,
interpreters, libraries, the i386 TCG module, aliases and selected package data.
The runtime observation policy requires named probes once before guests; later
readback rehashes
every retained file and rereads every retained alias. Package data is a selected
superset, not proof of a complete host graph or continuous file identity.
Process controls use mocked kernel and process edges. They do not run QEMU,
the CPU or guests.

Actual tool execution, privileged entry, the outer deadline and unconditional
cleanup, packet finalization, the hosted actual job and results document are
still unconnected. The 120-second polling loop does not bound a blocking process
creation or identity read; an independently reviewed outer owner is still needed.
The actual command refuses to run at this checkpoint. Remaining implementation
stays within the existing nine-path claim. Before any actual event, freeze the
complete source/input/runtime graph,
independent expectations, finite resource and output bounds, original roles and
separately observed QEMU binary/package identity. QEMU's version requirement
alone does not identify the executable. Admit one hosted event only after its
source checks and execution plan pass review; preserve failures and acquire
each official original once before independent audits.

This fixture does not establish hardware IRQ delivery, paging, task switching,
general DPMI or protected-application compatibility. CPU or device repairs need
their own reviewed ownership scope.
