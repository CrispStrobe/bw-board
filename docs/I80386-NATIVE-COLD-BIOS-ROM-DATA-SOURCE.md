# Cold ROM-data source preparation

The reviewed cold runtime now compares data bytes from the two admitted decoded ROM ranges against the entire initializer-authenticated, unmodified BIOS, instead of requiring that the page was already fetched for execution. Length, page and ROM bounds, alias domains and exact byte mismatches still fail closed. There is no cache warming, ignored byte mismatch or CPU/RAM normalization.

Six bounded source controls passed, including a tiny C++ harness compiling the exact generated helper and reading the pinned BIOS. It covers genuine unvisited ROM data, wrong response bytes, invalid ranges/lengths and page/ROM boundaries. This is predicate evidence, not Bochs integration or guest execution. [Lossless receipts](receipts/native-cold-bios-rom-data-source-20261003/index.json) preserve the actual controls and independent review.

Run 37109832930 stopped with `host-rom-observed-value`; its fatal output did not retain the offending address or N/Q, so the exact failing read remains unobserved. A new full125-input build is required. The original a6fa build and DSO remain unchanged and cannot qualify this C change. The dedicated build workflow only compiles and performs static admission; it never loads the addon or runs a guest.
