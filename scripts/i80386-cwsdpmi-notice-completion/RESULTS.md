# DJGPP and GCC notice completion result

The notice-only [hosted run 37684000070](https://github.com/CrispStrobe/bw-board/actions/runs/37684000070)
completed at tested source `41cb46c82f9de07812d1e8dd372954b7cc665aea`.
The sole official [artifact 11510147628](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11510147628)
has ZIP SHA-256 `0239674ac19f06222051674c364bd5a27988538f0a02af6bfa19800299e037bd`.
The later documentation head only records this result; it does not replace the
tested source identity or imply another hosted run.

The packet contains 34 ZIP members, including 33 files bound by its inventory,
and matching before/after source reports with 18 exact roles. The three
SHA-pinned DJCRX205, DJDEV205 and DJLSR205 archives each yielded the original
26,530-byte `copying.lib` notice, SHA-256
`dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551`.
Their retained raw bytes are identical. The notice includes nine form feeds;
the byte-preserving Latin-1 projection is a display aid, not an assertion of
the file's original encoding.

The raw GCC `releases/gcc-12.2.0` tag response binds tag object
`58051b1d9986afc5262c335a42e50b4730bc82b0` and peeled commit
`2ee5e4300186a92ad73f1a1a64cb918dc76c8d67`. The report retains that
145-byte response (SHA-256
`a571a55867c8038dc1536b3f2a9855cdd1674855613e4e24349a6fb43e6c68c3`)
and exact original commit-specific notices:

| GCC notice | Bytes | SHA-256 |
| --- | ---: | --- |
| `COPYING.RUNTIME` | 3,324 | `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74` |
| `COPYING3` | 35,147 | `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903` |

The workflow retrieved those notice bytes before the audit validated the
retained tag response. The accepted report binds both to that exact commit;
it does not establish the source composition of the measured `libgcc.a` or
decide how the runtime exception applies to a future linked executable.
`copying.lib` is now available for component review, but notice capture is not
blanket redistribution clearance. No compiler or guest ran, and no binary or
performance result exists.

The next compile-only gate may execute the SHA-pinned cross-toolchain on hosted
CI. Publication of a linked executable requires the separate component review.
The gate must retain the exact command,
implicit startup/link roles, map, warnings, failures and output hash while
keeping the linked client executable out of the public artifact. QEMU and AT
guest acceptance remain later steps.
