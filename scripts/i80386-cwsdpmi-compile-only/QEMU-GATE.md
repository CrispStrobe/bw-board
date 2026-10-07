# Prospective owned DPMI guest gate

This is an acceptance contract, not a guest result. The first affected run
must use the owned [client](../i80386-cwsdpmi-owned/client.c), the measured
CWSDPMI package and a freshly authenticated DJGPP compile in one bounded
hosted job. Keep the compiled object and executable in the job's temporary
workspace; record their fresh hashes, commands, map and notices, but exclude
those binaries, the package archive and disk images from public artifacts.
The successful [compile-only result](RESULTS.md) is source evidence for this
preparation, not a license to reuse an unretained binary.

Before either guest starts, admit the exact clean PR head and the inherited
source closure; recheck it afterward. Reacquire and hash the pinned
80,596,981-byte toolchain (`8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00`),
the DJCRX205/DJDEV205/DJLSR205 archives and the 163,241-byte CWSDPMI
package (`6ae65336f780e54dee889b5ac865992cf72738717aff5565ef84ccba3459e141`).
Admit its `BIN/CWSDPMI.EXE` member as exactly 21,325 bytes, SHA-256
`2de899fecaa90632b8b9bdfc0305cb0375e59ae252c37e32d06c1ed3f98a8f44`.
Retain its `COPYING.CWS` and source-location notices. The client and host
must be in the same DOS directory or on an explicitly bound `PATH`; the
[DJGPP startup account](https://www.delorie.com/djgpp/doc/eli-m17n99.html)
describes lookup and auto-loading of `cwsdpmi.exe`. None of these source or
notice checks alone settles component publication obligations.

Create one immutable FAT image containing the fresh client, that exact
CWSDPMI member and owned batch commands; hash every input and the completed
image. Use the same authenticated FreeDOS 1.4 floppy and hard-disk images
once each in QEMU TCG and in the current AT compatibility profile. Pin the already
qualified FreeDOS boot-image member (`x86BOOT.img`, SHA-256
`03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77`)
and record its archive/source notices. Both guests have 4 MiB of mapped RAM;
report the AT backing/address span separately. QEMU's CPU, BIOS and devices
are independent, so equal finite application behavior does not imply machine
state or cycle parity.

The owned batch must run the client once, capture its output and DOS error
level, then execute a separate return-to-shell command. Require the exact
`BW_DPMI_OK checksum=4225408` line, zero exit level, the second command's
unique output, and a **current** shell prompt after completion on both
machines. Preserve the raw output bytes and bounded final VGA-text snapshot
and hash; a stale prompt elsewhere on screen, CWSDPMI banner or success text
alone cannot pass. The AT must additionally observe source-bound real-mode
`INT 2Fh/AX=1687h` discovery (or an explicitly observed pre-existing DPMI
host), a 32-bit protected code entry, and ordered `INT 31h` service/result
milestones: `0501` allocation, selector allocation/base/limit configuration,
checked data, `0300` real-mode interrupt simulation, selector release, then
`0502` free.
The nonconstant BIOS tick may be retained as raw diagnostic evidence but is
excluded from exact cross-guest output comparison. `0300` does not qualify
real-mode callback functions `0303/0304`.

Bound guest time, memory, input offers and output size; keep one owned process
group per emulator and clean it up. Preserve the original first failure plus
partial source/media hashes, command transcript, CPU/device milestones,
screen and disk observations before cleanup. An independent QEMU result must
come from QEMU itself, not a host-side DOS-service substitute. A later
comparison may declare only this single-client DPMI functional result after
both guests meet every finite condition. No speed or broad DOS/DPMI/game
compatibility claim follows.
