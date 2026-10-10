# Tool census: preserved collect2 split-output refusal

[Draft PR479](https://github.com/CrispStrobe/bw-board/pull/479), source
`8ffca01b8ca675fcd2a3980ffd0697665b080771`, passed all ten enabled checks
with only two declared optional skips before the single
[run37945340430](https://github.com/CrispStrobe/bw-board/actions/runs/37945340430).
Root and an independent reviewer audited the sole original ZIP, raw log,
source identities and probe transcripts without producer imports or replay.
[summary.json](summary.json) records public identities and attribution.
The official conclusion remains failure.

The nine-member packet admits 34 Git roles. Its reported 2,365-entry header
map totaling 49,002,796 bytes matches the retained census exactly. Node
versions pass. Located executable identities for g++, cc1plus and collect2
are retained and equal their post-probe identities. The exact silent cc1plus
case reports `VERSION_UNAVAILABLE_EMPTY`, without validating its version.

Collect2's version probe completed with exit zero, no timeout or output cap,
281 stdout bytes and 46 stderr bytes. Stderr reports its version banner and
an ld version command; stdout contains GNU ld version text. The unchanged
strict probe refuses stderr with `bounded tool probe refused`. Independent
as/ld identity and version records, final tool/source rechecks, compilation,
addon loading, support cases and guests were not reached. Raw executable and
archive bytes remain absent; these are source-bound reported identities.

Preserve this original and source without relabeling or retrying. Next review
a separately named profile that locates and retains all five tool identities
before any version probe. Only collect2's bounded exact split-output shape
may be reported as `SPLIT_OUTPUT_DELEGATION_UNVERIFIED`; retain raw transcripts
and rehash the prelocated named linker around that probe. Compare against a
direct probe of the independently pinned ld target as output consistency,
without claiming subprocess provenance or a validated collect2 version.
[GCC documents several linker search paths](https://gcc.gnu.org/onlinedocs/gccint/Collect2.html);
a printed command alone cannot identify the process that actually ran.
Keep generic strict probes unchanged, preserve first failures and partial
rosters, and require mutation/order/extra-output/consistency adversaries plus
closed report-only source and inventory review. Complete original audit of
that distinct profile precedes the separate first build. No performance
result or allocation cost share follows from this census.
