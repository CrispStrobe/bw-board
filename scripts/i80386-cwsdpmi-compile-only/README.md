# Owned DPMI client: internal compile gate only

This profile compiles the owned `scripts/i80386-cwsdpmi-owned/client.c` on a
bounded hosted runner. It does not launch a DOS guest, qualify a 386 CPU, or
publish the linked executable. Compilation of our own source is authorized;
the [notice packet](../i80386-cwsdpmi-notice-completion/RESULTS.md) does not
settle component-specific publication obligations.

The dedicated label-gated job checks the exact clean PR head, re-fetches the
SHA-pinned build-djgpp toolchain and the three measured small DJGPP source
archives, inventories them before execution, compares the selected compiler,
assembler, linker, stubify, headers, CRT and libraries with the stage-A member
hashes, and verifies DJCRX byte origins for both headers, `crt0.o` and
`libc.a`. Only then does it extract the toolchain in a bounded temporary tree.
No source archive, toolchain or executable is uploaded.

The owned C object uses explicit `-march=i386 -mtune=i386`; the link step also
declares those flags. The job records GCC version/search/role/plan output,
exact commands and warnings, extracted member hashes, link map, object and
executable hashes, and the first failing phase. Its artifact contains reports,
map and logs **only**. Even a successful `MZ`-prefixed output would not prove
that the DJGPP real-mode stub or linked runtime uses only 386 instructions:
the cross-compiler target is `i586-pc-msdosdjgpp`. Nor would a compiler pass
prove DPMI discovery, protected entry, services, exit or shell return. Those
are later guest gates.

The bounded local controls use synthetic archives and a trivial host process,
never the DJGPP compiler or DOS guest:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/i80386-cwsdpmi-compile-only/compile-control.py
```
