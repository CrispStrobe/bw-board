# CWSDPMI/DJGPP source and notice candidate result

The report-only [hosted run 37682399616](https://github.com/CrispStrobe/bw-board/actions/runs/37682399616)
completed at tested source `ad8085bf2e8c36439b9cba198845cbabc0140dbb`.
The sole official [artifact 11510315779](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11510315779)
has ZIP SHA-256 `f56014ad78ebd503ceb73d38a1e211a1c91075776404cf2af5b4071f7a949f96`.
Root and independent peer audited its bounded inventory and source bindings.
The separate documentation head does not replace the tested source identity.

| Candidate official DJGPP archive | Bytes | Hosted SHA-256 | Inventoried members |
| --- | ---: | --- | ---: |
| `djcrx205.zip` | 895,256 | `22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60` | 178 |
| `djdev205.zip` | 2,509,574 | `4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda` | 190 |
| `djlsr205.zip` | 2,047,171 | `80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea` | 1,970 |

The DJCRX `include/dpmi.h`, `lib/crt0.o`, and `lib/libc.a` each had one exact
SHA-256 match to the corresponding member of the pinned stage-A cross-toolchain
archive. This establishes those three byte origins within the measured
archives; it does not establish every linked component's source or terms.
CWSDPMI's nested source ZIP and `COPYING.CWS` were inventoried and their
measured stage-A member hashes matched. No archive bytes or executables were
uploaded in this report packet.

`copying.lib` exists in each DJGPP source archive at 26,530 bytes with SHA-256
`dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551`,
but its text was omitted by the bounded text filter. Its terms have **not**
been reviewed from this evidence. GCC 12.2.0 `libgcc.a` source correspondence,
runtime exception, and component-specific obligations also remain open.
The measured source ZIP hashes are candidates, not yet compilation admission.
No client was compiled or run; there is no DPMI guest or performance result.

The next bounded step is a small notice/source audit of these already measured
DJGPP archives and the required official GCC source/exception references. It
should retain the exact `copying.lib` text with a justified cap and source
identity, then decide compile admission separately. It need not re-inventory
the 80 MB cross-toolchain archive: the tested report already pins its SHA-256
and relevant member hashes. Any later compile and QEMU/AT guest gate must bind
the resulting dependency and notice decisions to its own exact source head.
