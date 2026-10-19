# Existing 80286 protected-mode binaries

These are byte-for-byte copies of JA1UMI's MIT-licensed prebuilt boot images at
revision `3ee4c6f1178e71db8926caf999416af7f4e340b3` of
https://github.com/ja1umi/80286_programming. The manifest pins each complete
512-byte image, its corresponding upstream assembly, and the included license.
No assembly, patching, or generated substitute is involved in execution.

The test environment starts at `0000:7c00` after loading the sector, with
zeroed RAM and declared register values. This models the BIOS boot handoff,
not execution of an AT BIOS or disk controller. Video output is guest-written
text RAM. Task-dispatch examples need a declared deterministic vertical-retrace
input; that input is functional stimulus, not measured VGA timing.

Acceptance must require the guest's final loop and expected video/privilege
state, or repeated dispatch and return for the continuing task examples.
Reaching protected mode or displaying a partial string alone is insufficient.
