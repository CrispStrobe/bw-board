# First CWSDPMI/DJGPP guest gate

This plan is prospective. There is no acquired CWSDPMI package, pinned DJGPP
toolchain, compiled client, or guest evidence for this directory yet.

1. Pin the exact official CWSDPMI and DJGPP packages, hashes, component source,
   compiler/linker flags, executable format, and redistributable notices before
   acquisition or compilation. The [FreeDOS CWSDPMI 7a catalog](https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/repositories/1.4/html/en/tools/cwsdpmi/20250318.2/index.html)
   identifies GPLv2 copying policy, but the precise package members, source
   correspondence, and resulting distribution obligations remain unreviewed.
   Do not bundle binaries or guest images in public results without that review.
2. Compile `client.c` with the pinned DJGPP headers and library. Preserve exact
   compiler output and inspect the generated executable and startup dependency.
   A DJGPP executable's startup may discover a DPMI host through real-mode
   `INT 2Fh/AX=1687h` and enter protected mode; the C source does not itself
   prove those transitions. Future instrumentation must separately record the
   discovery reply, protected-mode entry, service numbers/results, selector
   setup, and cleanup. [DPMI function table](https://delorie.com/djgpp/doc/dpmi/ch5.g.html).
3. Use one authenticated free FreeDOS/FAT image with identical client and
   CWSDPMI bytes in the current AT compatibility profile with 4 MiB mapped
   guest RAM, and an independent QEMU TCG oracle configured with 4 MiB RAM.
   The AT implementation may have a larger backing address span; report it
   separately. Run the same bounded command once in each. Require a protected
   32-bit entry witness,
   `0501` allocation, checked byte data, `0300` interrupt simulation, `0502`
   free, the exact `BW_DPMI_OK checksum=4225408` line, DOS error level zero, and an observed
   current shell prompt after return. Preserve first failures, source and
   media hashes, host and CPU/device profiles, and raw output. The QEMU and AT
   machines need not have identical CPU or BIOS state; compare the finite
   application behavior, not full-machine equivalence. Source-bound service
   diagnostics should record the returned BIOS tick value as nondeterministic
   raw evidence, outside the exact console-output comparison. Do not call a
   loader banner or marker alone a pass.
4. Real-mode callback allocation/free (`0303/0304`) is a separate later client
   and gate. `0300` software interrupt simulation does not qualify callbacks.

The source-only client can expose missing memory, selector, simulated
interrupt, or cleanup behavior when a compiled guest is eventually run. It
cannot establish a performance change or broad DPMI/application compatibility.
