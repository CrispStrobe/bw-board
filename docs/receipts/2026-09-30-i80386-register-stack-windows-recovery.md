# Windows register-stack receipt provenance

The serial 60,000,000-step observer-off/on Windows pair used board revision
`aaa0b558bf8f48a744b99ba1979c53408d21e979` and committed private
protocol `f8fbd9780bb591a1c9d4f26a637f42c936caee00`. Both raw reports and
their stdout, stderr, and `/usr/bin/time` files were written before the
supervising parent exited with status **143**. The cause is unknown. Its
historical host manifest, artifact index, comparison, and reducer candidate
were never written.

A later read-only private audit checked the original preflight and all eight
original artifact hashes, validated both reports against the committed full
source inventory, pinned inputs, completed step counts, complete reported
CPU/board/RAM/disk state parity, and reran the committed board reducer. It
produced the exact [compact candidate](2026-09-30-i80386-register-stack-windows-result.json)
with SHA-256
`9c6192e1ae526860b07a9025b3b0b19d0d8d353a643851f1a1f19304cda18038`.
The original preflight SHA-256 is
`14527f1e77d64d035da551c7ba79a9c0bf3054e7892ef4a73514b6c70b645e54`.
The private archive at commit
`3e54aed32e2a78bcaf0236241e8222e55799b576` retains the eight originals,
the preflight, exact protocol source, and separately labeled fresh
postvalidation. No missing historical file was reconstructed. The later audit
host and UTC are not original run-start or host-timing facts; observer wall or
CPU time is not a speed comparison.
