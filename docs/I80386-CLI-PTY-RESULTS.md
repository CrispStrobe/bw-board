# 386 AT live terminal acceptance

The [actual run 37641845715, attempt 2](https://github.com/CrispStrobe/bw-board/actions/runs/37641845715/attempts/2) passed at source `f03b51bf2475bc77a50af8c43c87512c0317c6fb` in [PR434](https://github.com/CrispStrobe/bw-board/pull/434). The ordinary JavaScript AT console booted an owned INT 10h/INT 16h guest from a generated FAT16 HDD and accepted live input through a real PTY. Native blocks and the code16 WebAssembly dispatcher were disabled.

The retained terminal transcript contains five redraw frames. Frame 3 shows `PTY READY> `; after the driver sends `abc`, frame 4 shows `PTY READY> abc PTY DONE`. Ctrl-L produces the distinct fifth frame with the same guest output, then Ctrl-] exits. The guest report contains exactly six accepted Set-1 make/break events: `30, 158, 48, 176, 46, 174`. Scheduled input was empty. The run stopped at 2,450,000 steps with `user-quit`.

Terminal setup and teardown each occur once in the raw transcript. The driver reports restored terminal attributes, exit status zero and an empty child process group. Its live and reaped-child RSS checks passed the 1.5 GiB bound. Reaped-child RSS is the conservative Linux maximum across reaped children, not an isolated measurement of one PID. This is an interaction test, not a throughput benchmark.

Attempt 1 never acquired a runner and has no guest execution, steps or artifacts. Its runner-acquisition failure remains part of the run history; attempt 2 retried the unchanged source.

## Evidence and limits

[Artifact 11494027040](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11494027040) is 26,291 bytes, SHA-256 `12170a0b47cfe9aa8c77c4a1a04a83f5440a63e0950c1cb61f68f8f26d059011`. It retains the raw transcript, guest and driver reports, source and media identities, workflow and inventory. The root independent stdlib reader verified all 20 members, 19 inventory entries, six source digests against the tested Git revision, exact workflow bytes, terminal frame sequence, accepted keys, reported media digest bindings and reported cleanup. A second independent reader agrees and also checks all 77 console source roles against the tested Git revision. Neither reader imported the producer's parser or replayed a guest. See the [summary receipt](receipts/2026-10-07-cli-pty.json).

The fixture checks a finite BIOS keyboard/text path and terminal lifecycle. It does not qualify FreeDOS shell interaction, a mouse-driver application, DOS extenders, DOSBox package compatibility, graphics frame rate or every terminal. No full RAM reconstruction or independent instruction oracle follows from this packet. The generated owned disk and external ROMs are not included in the artifact.

For terminal commands and supported media formats, use the [loading guide](X86-LOADING-GUIDE.md#cli-experimental-386-raw-hdd-boot). Broader guests need their own bounded, observable acceptance results.
