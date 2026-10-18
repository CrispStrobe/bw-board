# Third AT loaded-main attempt

The third hosted attempt at source `27ff49068baae8af7c54457c422fbb25a5ecfa2d`
([run 37742758925](https://github.com/CrispStrobe/bw-board/actions/runs/37742758925))
**failed loaded-text qualification**. Its original report-only
[artifact 11535096751](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11535096751)
is 124,925 bytes with SHA-256
`c005fff4bcd33d1caa948c30c9d6413c8be1fd56eb5f274039c1978cc9fbb19a`.
Root and independent peer audits accepted the packet integrity and exact source
bindings, but the guest binding result was a failure.

The guest again accepted 34 Set-1 scans and recorded the protected 32-bit
`main` candidate after 44,605,932 ordinary steps. The corrected passive
reader passed the prior signed-CR0 refusal, then exact whole-text binding
stopped at byte offset 23,472 within the linked `.text` section. Its map
address is `0x7598`, named `__djgpp_our_DS` in the retained link map, inside
`libc.a(exceptn.o)`'s `.text` contribution. Nearby map names include
`__djgpp_app_DS` and `__djgpp_dos_sel`. The original packet does not contain
the EXE or copied guest text bytes. The map association suggests a selector
slot, but does not prove a runtime write, a binary-to-source correspondence,
or an emulator fault. The recorded pre/post CPU, board, RAM, page-classifier,
and page-table fingerprints matched at the failed observation.

The follow-up keeps exact whole-text binding and **still fails on any changed
byte**. It adds diagnostic-only expected/observed text hashes, changed-byte
counts and bounded offset spans, and equality/hash results for the complete
owned `main` and seven required wrapper extents. Expected bytes come from the
binding module's private admitted executable, and the observed hash comes
from the single already copied guest snapshot. It does not retain raw guest
code or RAM, exempt an offset, infer acceptable relocation, or change the CPU,
guest, toolchain, or media. A separate hosted run is required; no loaded text
identity, first `main` instruction, INT 31 service, completed client, strict
386 profile, or performance result follows from this failed attempt.
