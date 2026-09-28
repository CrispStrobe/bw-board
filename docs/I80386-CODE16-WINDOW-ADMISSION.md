# Code16 first-byte admission: retained opt-in prototype

The [source-bound receipt](receipts/2026-09-28-i80386-code16-first-byte-admission.json)
records two alternating, unprofiled 60-million-step Windows 3.11 opt-in
A/B pairs. The baseline was `ade888dae14b8cc8b6fe555a25e8dbd954c1cbe2`;
the measured candidate was `f6aac9189c6fc6715ee1340b220ccfc0a4ee0695`.
The private media, ROMs, geometry and replay input were identical and are
not published. Both paths used diagnostics and form census. This changes
only the opt-in code16 WASM dispatcher; the ordinary CPU path remains the
same.

Previously, every eligible start copied and froze up to 64 code bytes before
deciding that its first opcode was unsupported. The candidate proves the
same full CS span, translation, permission, page kind and overlay conditions,
but reads only the first byte initially. If that byte cannot begin the
executable grammar, it records the same unsupported-first refusal and lets
the ordinary board step. `26`, `66` and `8E` still take the full capture
because the diagnostic form census reads their following bytes. Executable
starts keep the original full capture, decode, byte revalidation and event
handling. No refusal is cached: guest writes, host writes, DMA-style writes
and ROM reloads are seen on the next admission.

| 60M run | Baseline user CPU | Candidate user CPU | Baseline wall | Candidate wall |
| --- | ---: | ---: | ---: | ---: |
| Pair 1 | 389.08 s | 255.63 s | 880.42 s | 302.13 s |
| Pair 2 | 352.80 s | 263.49 s | 431.85 s | 546.05 s |
| Mean | **370.94 s** | **259.56 s** | — | — |

The candidate reduced mean **user CPU by 30.03%** and was faster in each
pair, passing the predeclared retention gate of at least 10% mean gain and
no individual regression. The four-vCPU virtual Intel Xeon Skylake host had
heavy, changing load (one-minute averages at run boundaries ranged from
4.71 to 11.94), making wall-time comparisons unsuitable. This is an
opt-in-path gain. Its 259.56-second mean is still about **3.31 times** the
earlier 78.52-second ordinary Windows checkpoint; that older run is a
different session, so this ratio is context, not a contemporaneous A/B.

All four reports completed 60 million steps with exactly 39,761,006
eligible attempts, 390,473 decodes, 2,345,288 native calls, 5,042,482
native retirements, 54,957,518 ordinary fallbacks and 180,069 boundary
exits. Normalizing only the expected execution revision and dispatcher
source hash makes their **entire reported JSON** equal. The selected
guest-field digest also matches. This does not prove full RAM, disk or hidden
CPU-state parity because the console report omits those fields; it also
omits diagnostic-census maps. Focused tests check those maps and compare
ordinary execution across host/guest/DMA byte changes, ROM, A20, paging,
CPL, VM86, page/CS limits and device overlays.

The measured CLI source inventory hashed the dispatcher but omitted three
modules in its import closure. The receipt separately pins the measured
code-window file hash. After measurement, the CLI source list was extended
to include the code-window, EA and data-window modules, and a focused test
checks the dispatcher's static import closure. That provenance-only CLI
change was not part of the timed pair. The private raw reports, timing files
and host records are retained; the public receipt gives their hashes and
the [media-neutral reducer](../scripts/summarize-i80386-code16-first-byte-admission.mjs).

The next architectural gate is a low-rate V8 profile of this retained
candidate under the same 60M input. Only if remaining refused-start
admission has at least 20% of **all process self samples** should a more
aggressive negative-start cache or direct discriminator be prototyped.
Such a design must still read live code and preserve segment/paging,
permission, fault and mutation behavior. Retention requires another two
alternating unprofiled full-run pairs with the same selected-report parity,
at least 10% mean user-CPU gain and no individual regression. Default-path
adoption would additionally need a contemporaneous comparison against the
ordinary CPU path.
