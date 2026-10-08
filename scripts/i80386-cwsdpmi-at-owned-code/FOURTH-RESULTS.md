# Fourth AT loaded-main attempt

The hosted diagnostic at source `eebec7259b4f6bc5c1ef35982d3affc4dc8c94d4`
([run 37745949286](https://github.com/CrispStrobe/bw-board/actions/runs/37745949286))
**failed strict whole-text qualification**. Its original report-only
[artifact 11536894049](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11536894049)
is 127,355 bytes with SHA-256
`7e3fbe8d2b86787e6e71a807c388bf19e3279e26d5c1e16c3adf32a0cae5503b`.
Root and independent peer audits accepted the packet inventory, source and
input bindings. The guest result remained a strict failure at linked `.text`
offset 23,472, before a loaded-text binding or first `main` instruction.

The diagnostic reported 13 changed bytes across eight bounded spans at map
addresses `0x7598`–`0x75fc`, inside `libc.a(exceptn.o)`'s `.text` contribution.
The map associates those addresses with DJGPP selector and exception-state
names. All eight required code extents, covering the owned `main` and seven DPMI
wrappers, were reported byte-equal by the source-authenticated private
comparator. The cut's pre/post CPU, board, RAM, page-classifier and page-table
fingerprints matched. The pinned DJLSR source-member receipt matched two
reviewed mirror hashes; it explicitly did **not** establish binary-to-source
correspondence. The original packet omitted both linked executable and guest
code bytes, so neither audit could recompute the reported differences or
infer why they arose.

The follow-up source defines a **separate owned-code-at-entry** profile for
those exact eight extents while preserving the strict whole-text FAIL. The
follow-up itself is unrun in an AT guest. No wrapper execution, `INT 31h`
service order, IRET, completed client, whole-libc identity, strict 386
qualification or performance conclusion follows from this diagnostic.
