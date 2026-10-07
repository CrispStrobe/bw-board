# Owned CWSDPMI/DJGPP service client — source checkpoint

`client.c` is an owned DJGPP program intended to exercise a DPMI host after
the DJGPP startup code enters 32-bit protected mode. This checkpoint is
**source only**: it has not been compiled, loaded, or run in either AT guest or
an independent oracle. It does not qualify CWSDPMI, callbacks, applications,
or 386 hardware behavior.

The finite intended path is DPMI `INT 31h` function `0501` to allocate a
4 KiB block, a selector mapped to the returned linear address, a 256-byte
write/read checksum, `0300` to simulate BIOS timer `INT 1Ah/AH=00h`, and
`0502` to free the block. The selector uses `0000/0007/0008/0001` for
allocate/base/limit/free. Only successful cleanup prints the stable
`BW_DPMI_OK checksum=4225408` line and returns zero; failure stages return
nonzero. The BIOS timer value is intentionally omitted from console output
because it cannot be required to match across different guest runs.

The allocation address is not cast to a C pointer. DJGPP's documented
`__dpmi_meminfo.address` is linear; `sys/farptr.h` accesses it through a
selector. No `0504` DPMI 1.0 allocation, real-mode callback, or physical
address mapping is involved. [DJGPP's DPMI overview](https://www.delorie.com/djgpp/doc/libc/libc_199.html),
[allocation](https://www.delorie.com/djgpp/doc/libc/libc_204.html),
[free](https://www.delorie.com/djgpp/doc/libc/libc_213.html),
[real-mode interrupt simulation](https://www.delorie.com/djgpp/doc/libc/libc_246.html),
and [selector/far-pointer guidance](https://delorie.com/djgpp/v2faq/faq18_7.html)
define the intended calls.

No behavior control or compilation has run for this checkpoint. The next gate
and unresolved dependencies are in [PLAN.md](PLAN.md).
