# Owned DPMI client: first compile-only result

The [hosted run 37686644243](https://github.com/CrispStrobe/bw-board/actions/runs/37686644243)
completed the internal compile gate at tested source
`b327898fa66ee818faa4a6d2369724ee1ee3a039`. Its sole official
[artifact 11511766071](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11511766071)
has ZIP SHA-256 `cdf8853adc4d6ecc87e7da410ec603867c85f2f301bc0d606b23ff7171672a22`.
The packet has 67 unique members, 66 exact inventory entries, matching source
reports for 24 Git roles, and a completed compile phase. This documentation
head is distinct from the tested source; it does not imply another compiler
or guest run.

The SHA-pinned toolchain and three DJGPP source archives passed input and
selected-member checks. GCC's six reported assembler, linker, stubifier,
CRT, libc and libgcc paths resolved inside the admitted extraction to the
selected files and hashes. The owned `client.c` compiled with
`-march=i386 -mtune=i386 -Wall -Wextra -Werror`; both compile and link exited
zero with empty standard error. The 1,848-byte object is admitted i386 COFF,
SHA-256 `fe150a3ff9a9eb7fe78ace8759ed307ebdaa93af4710363583c2a7d67ccb9315`.
The 179,581-byte linked output is an MZ stub followed at offset 2,048 by an
admitted executable i386 COFF image, SHA-256
`66ce1db6017aff8a491c0775f14639281e780fe31b1ecd6da0005dfd9d31b43b`.
The retained 191,810-byte link map hashes to
`63f4c74c5f1f02e4c521339a4c0263140c26d0b413dc4ec70bc252af78303972`.
No object, linked executable, toolchain or source archive was uploaded.

The link report also records literal path-substring observations. Most are
false because GCC and the map spell paths differently; those booleans are
diagnostics, not proof that a component was or was not used at runtime.
The admitted GCC role probes, archive hashes, format checks and successful
commands establish this **compile-only** result. They do not prove a 386-only
startup/runtime, DPMI discovery, protected entry, any `INT 31h` service,
DOS exit, component publication clearance, or speed. The linked target is
`i586-pc-msdosdjgpp`; the owned-object flags do not recompile its runtime.

The next finite QEMU and AT acceptance contract is in [QEMU-GATE.md](QEMU-GATE.md).
It requires a fresh source-bound build and actual guest observations; the
historical linked hash above is a receipt, not a substituted guest result.
