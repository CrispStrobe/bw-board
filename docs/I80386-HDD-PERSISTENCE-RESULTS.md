# Finite ordinary-JS HDD persistence result

The [hosted run38806122785](https://github.com/CrispStrobe/bw-board/actions/runs/38806122785)
passed independent original-byte review on 2026-10-15. Two fresh ordinary CLI
processes booted the same admitted FreeDOS floppy and attached a 306×4×17
FAT16 **master data disk**. The first wrote and closed `C:\BWKEEP.TXT`, observed
its contents and a later prompt, explicitly quit, and exported the disk. The
second used those exact exported bytes, read the marker without its writer,
returned to a prompt, explicitly quit, and exported an identical readback.
This qualifies this finite write/export/fresh-process reload route. It does
not qualify HDD boot, installed GUI, filesystem flush/crash durability, whole-OS
compatibility, performance, physical timing or release redistribution.

## Original identities

- Tested source: [`b8f95cfdb8ee654407b63e626e46eb8859ce7b41`](https://github.com/CrispStrobe/bw-board/tree/b8f95cfdb8ee654407b63e626e46eb8859ce7b41),
  tree `c459bc54c7f8e71ea2633fa07746121b4668e2c7`.
- Attempt1, actual [job116667315031](https://github.com/CrispStrobe/bw-board/actions/runs/38806122785/job/116667315031),
  [workflow source](https://github.com/CrispStrobe/bw-board/blob/b8f95cfdb8ee654407b63e626e46eb8859ce7b41/.github/workflows/i80386-hdd-export.yml).
- Sole official [artifact12007362159](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/12007362159):
  82,511-byte ZIP, SHA-256
  `7b03d62d48907737c4774476b2a8145300d96e55ec16cacddde4126acc91b5e6`.
- [PR625](https://github.com/CrispStrobe/bw-board/pull/625) merged at
  `cb5058e5f8865110aa099ff3fbc84092668563c0` after all nine enabled checks passed.
  All 87 selected source rows, including the 79-row console map, match the
  tested source at the landed merge.

The [reader output](receipts/i80386-hdd-export-38806122785-reader.json) is an
unchanged copy of the independently admitted artifact-mode result. Root and
independent reviews joined official run/job/artifact identities, source bytes,
fixed media, observed runtime, both process lifecycles and enclosing cleanup.
The [standalone reader](../scripts/i80386-hdd-export/reader.py) imports no
producer validators. Its [guide](../scripts/i80386-hdd-export/README.md) documents
reported-consistency versus externally admitted original-artifact mode and the
public fixed-input policy. Node22.23.3 identity/version and executable bytes
were observed before/after; this is not canonical binary/source-build or full
ELF/standard-library authentication. Separate firmware/guest component notices
and source obligations remain; this result grants no blanket bundling clearance.

## Observed finite result

| Observation | Writer process | Fresh reader process |
| --- | ---: | ---: |
| Ordinary `machine.step()` calls | 54,400,000 | 46,350,000 |
| Accepted live scan bytes | 124 | 46 |
| Complete terminal frames | 68 | 57 |
| Stop | Explicit user quit | Explicit user quit |

These are CLI loop calls, including idle calls, not retired instructions,
CPU cycles or a speed measurement. The one-CPU affinity/quota, 1GiB/no-swap
resource profile and bounded children were checked. Both children exited and
were reaped with PTY/stderr EOF and empty owned groups; no timeout, OOM or
cleanup failure was accepted. The official actual job and enclosing owned
controller cleanup completed successfully.

The independent disk proof found `BWKEEP  TXT` initially absent and a new
file containing `bw-hdd-persist-ok` followed by CRLF at cluster3 (19 bytes total). Both FAT copies have the
expected EOC, the root entry and payload agree, and all 43 changed bytes fall
within the admitted FAT/root-entry/payload regions. Geometry and the other
initial bytes remain unchanged. Initial image SHA-256:
`2fa9c252f22cec4f8c5bdc82d1587293ffcaed791e0982384628d19a7316a851`.
Both exports are byte-identical, SHA-256:
`ad35596e5c10c70527386d44d953df745ab7e195fe2cbb438f1262125e1c1712`.
Original floppy and initial HDD identities were preserved.

The top-level `finitePersistencePass` and `byteProofPass` are true;
`fullAcceptanceQualified`, `installedGuiQualified`, `fullOsQualified` and
`crashDurabilityQualified` remain false. Nested slice outputs retain their
original unimplemented-gate lists: the outer artifact reader supplies the
finite original/source/runtime/process joins, not broader qualification.
Producer self-reported finite/byte flags remain false by design; they are not
the independent acceptance authority.

## Preserved failure and next handoff

The [first run38790214003](https://github.com/CrispStrobe/bw-board/actions/runs/38790214003)
failed with a truncated ECHO command, no completing prompt and an unchanged
exported disk; no second process ran. Its originals remain unchanged. Accepted
controller scan bytes did not prove guest consumption. The corrected CLI paces
accepted scan bytes by 65,536 machine-step calls, retaining 1,024-step retries
and mouse polling. The successful corrected-source result supports the pacing
change; it does not establish a proven BIOS fault or physical keyboard model.

The board helper handoff is complete. Lite must still adopt the qualified
supplier under its ownership, then capture genuine image/JSON browser downloads
and reload the exact image through **Boot FreeDOS VGA** with the same boot
floppy and the exported master data disk in a fresh session. Preserve the old
session and original inputs. Mocked clicks, source tests and this CLI result do
not replace that installed-GUI journey. ISO/CD-ROM and broader DOS packages
remain separate lanes.
