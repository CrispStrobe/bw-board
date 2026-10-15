# Ordinary JS master-HDD persistence fixture

This source prepares two fresh CLI sessions using the existing ordinary AT
console. The first writes `bw-hdd-persist-ok` to `C:\BWKEEP.TXT`, reads it, and
quits explicitly. The second starts a fresh process, boots the same free floppy, attaches the
first export as its master HDD, reads the marker, and exports a second readback.
This does not qualify booting from the HDD. Both use that fixed boot floppy and an
independently authored 10,653,696-byte FAT16 master disk.

The 120-million machine-step-call limit, 600-second child limits, and 1.5-million
stable step calls after each command are proposed bounds, not measured results.
The enclosing owned unit uses one CPU, 1 GiB, no swap, and one CPU affinity.
Node 22.23.3 and Node/Python/Git binary identities are observed before and after;
this does not certify source builds or a complete ELF/standard-library closure.

The workflow runs authored controls automatically. Only the dedicated
`x86-hdd-export-actual` PR label authorizes a first-attempt actual job on the
reviewed own-repository head; adding ordinary review labels does not boot it.
A later default-branch manual invocation is separate. Do not add the actual
label until source, input policy, resources, and independent reader are reviewed.

The producer retains bounded original PTY/stderr/report bytes and input offers.
Online screen matching is provisional: the independent reader must reparse the
raw bytes and join each response to the final accepted scan-code sequence.
Timeout-induced graceful exit is rejected. The parent retains the child leader
unreaped through group cleanup, then records a single wait4 reap. Missing roles
remain absent diagnostics, never reconstructed successful output.

`reader.py --packet DIRECTORY` checks reported consistency. Final finite
acceptance also needs external official run/job/artifact admission and exact
Git source/runtime/input joins. Producer result booleans do not grant that
acceptance. This is not crash durability, guest flush/completion, installed GUI,
whole-OS compatibility, or a performance measurement.

The artifact contains only the authored initial disk and its two exports plus
bounded records. It excludes boot firmware, the floppy, and the downloaded
archive. Source and notices for the bundled BIOS are in
[the BIOS directory](../../roms/free-at-bios/README.md). The fixed official
FreeDOS archive includes component notices and identifies source releases;
this finite input-use policy grants no blanket redistribution or source-build
identity claim.

The exact public input policy below hashes to
`93a1119016e7e9d2a963ce4491199698e852739f9d20b3b7b0f5fdfe10c41795`
using sorted-key compact ASCII JSON, with no final newline:

```json
{"bios":{"bytes":65536,"notices":"roms/free-at-bios/README.md and roms/free-at-bios/LICENSE","path":"roms/free-at-bios/BIOS-bochs-legacy","sha256":"6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac"},"bootMediaInArtifact":false,"floppy":{"archiveBytes":23624258,"archiveSha256":"45b1fa7c52dd996c3bfa5e352ffcd410781b952a6ad629f15a4c9ec4bbaefc5a","bytes":1228800,"member":"120m/x86BOOT.img","notices":"Official archive README and FreeDOS component notices; floppy edition omits package sources and points to FreeDOS source releases.","sha256":"03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77","url":"https://download.freedos.org/1.4/FD14-FloppyEdition.zip"},"releaseRedistributionClearance":false,"schema":"bw.hdd-free-input-policy.v1","scope":"finite FreeDOS authored-master write/export/reload test","sourceBuildAuthenticityQualified":false,"vga":{"bytes":38400,"notices":"roms/free-at-bios/README.md and roms/free-at-bios/LICENSE","path":"roms/free-at-bios/vgabios-lgpl.bin","sha256":"76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1"}}
```
