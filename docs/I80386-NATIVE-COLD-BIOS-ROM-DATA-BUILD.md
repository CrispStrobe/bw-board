# Cold ROM-data build result

The first [build 37110636554](https://github.com/CrispStrobe/bw-board/actions/runs/37110636554) at `d4281b28` passed compilation and static admission with 125 authenticated source inputs. The new DSO is 2,069,552 bytes, SHA-256 `40179a4f0bc2456e59bc2ea49303e17e29be72ef564adb1fe1a6879abb015ab0`; generated runtime SHA-256 is `6fdf5fccf797777acce655be2609cf58fb498d18ad6d0dd78fdef8e38a505643`. ABI/NAPI and configuration remain unchanged. No addon was loaded or guest executed in this build.

Coder static audit passed 1,009 checks; independent audit passed 1,635. Earlier read-only audit parser assumptions are retained separately and were not compile retries. [Lossless small records](receipts/native-cold-bios-rom-data-build-20261003/index.json) bind official ZIP digest and retain metadata, logs, inventories and audits; binaries and source TARs remain in the canonical external ZIP.

The preceding native diagnostic 37109832930 aborted with `host-rom-observed-value`, with source/artifact guards unchanged. Fatal output did not retain its exact address/N/Q. Its raw error and official digest are retained. It does not qualify E16 or BIOS boot.

An obsolete source test still expected only two workflow trigger paths, causing general CI failure after the successful build. The correction asserts the exact five approved paths; two focused bounded controls passed. Because pull-request path filtering uses the cumulative diff, the corrected publication head will produce a distinct new build/source context. The original d428 result remains immutable; no result is relabeled and no guest is authorized here.
