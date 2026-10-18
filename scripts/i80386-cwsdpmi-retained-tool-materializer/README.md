# Selected retained-tool materialization source unit

This unconnected source unit accepts four immutable `bytes` arguments through
`RetainedToolMaterializer(parent).materialize(toolchain, djcrx, djdev, djlsr)`.
It checks all four exact extents and SHA-256 pins before constructing a parser
or preparing the privately constructed retained observer. The tool archive is
build-djgpp v3.4's `djgpp-linux64-gcc1220.tar.bz2`; the source archives are
Delorie's `djcrx205.zip`, `djdev205.zip` and `djlsr205.zip`. Constants come from
the held compile source; historical hashes do not grant compiler authority.

The observer dependency is loaded from one fixed repository file with a
64-KiB read bound and SHA-256
`53d295bca750edce8d2b3496498195c8f735528dd15bff6eba26127b55558312`.
Its own exact dependency bindings retain the creator, routes, writer and owner.
External source admission of this new module remains required. There is no
caller FD, callback, expected-pin override, caller receipt adoption or provision
API. Controls privately replace pins for manufactured archive bytes only.

The strict TAR subset accepts ordinary USTAR files and directories. It rejects
links, extended/PAX/GNU headers, sparse and special members, set-id modes,
non-ASCII or unsafe names, duplicate canonical names and parent-file conflicts
in either order. Bzip2 truncation, concatenated streams and trailing compressed
bytes refuse. Both end blocks and zero trailing decoded padding are checked.
ZIPs require a terminal comment-free single-disk EOCD, exact member count,
ordinary type/name coherence, canonical uniqueness and matching parent types.
Every ordinary ZIP body is streamed through CRC/extent/EOF checks; directory
entries must have zero extent, compressed extent and CRC with stored encoding.
Empty ZIP directory local headers are also opened and checked. This is not a
complete physical-extent or general binary-parser proof. The TAR inventory and source ZIP inventories must all finish before workspace
preparation. Four runtime-role hashes join `djcrx205.zip` to the selected files.
These checks do not prove source-to-binary correspondence for the whole archive.

Each archive has at most 30,000 members; each declared file is at most 256 MiB.
The aggregate 3-GiB budget counts every TAR decoded byte, including headers,
padding and tail, plus source ZIP envelopes and every decoded ZIP body. ZIP
ratios are at most 1000. Selected extent is reserved before its body is read:
at most 16 MiB per selected file and 64 MiB total. Other file bytes are streamed,
not retained as a full inventory dictionary. Notice candidates are processed
only up to 32 KiB each, 256 KiB aggregate and 256 accepted notices. Status exposes
counts and hashes, never notice text or archive/file contents. Oversized or
unsupported notices are explicitly omitted; this is not notice retention,
redistribution permission or license clearance. The original input archives
must remain available for later notice and provenance review.

Only the nine pinned roles are copied under the privately borrowed tool-root
descriptor. Fixed relative directory walks use no-follow opens and held/named
identity checks; files use exclusive no-follow creation, extent-zero admission,
bounded writes, exact bounded readback, EOF, hash and final metadata checks.
Local close attempts are consumed once and uncertainty stays visible. The
borrowed root is never locally registered or closed. Aggregate cleanup includes
local files, observer files, directory-ledger uncertainty and evidence-writer
output uncertainty. The first original error is latched before cleanup and its
exception object is re-raised; secondary cleanup does not replace it. Reentry
poisons the active private observer/owner and permits cleanup only. One public
materialization attempt is consumed before authentication; no retry occurs.
Close marks the instance closed before cleanup. Later materialization refuses
before hashing, parsing or preparation, and repeated close does not retry cleanup.
Every ordinary ZIP open is followed by a reentry check before its first read,
including zero-length members.

The observer emits its bounded before observation and a failure-final diagnostic
terminal observation, each using the existing 32-KiB exclusive evidence writer.
No compiler is invoked. Nine written roles are a historical count, even if a
later observation refuses. Selected files do not constitute the complete
implicit toolchain or its hard-link aliases, runtime inputs or environment.

All source-owned, parent-trust, input-filesystem-lease, license, compiler, guest
and performance qualifications remain false. Immutable byte admission is not
a live filesystem lease. Post-mkdir held/named observations cannot prove that
an indistinguishably replaced directory was the inode created by our call.
Mount/OS trust, arbitrary mutation of Python internals, arbitrary asynchronous
allocation failures, actual archive compatibility, elapsed time and full input
alias authority are unqualified. The strict subset may refuse real pinned
archives. No archive download, actual tools, compiler, guest or helper replay is
part of the manufactured controls.

Run source-only manufactured controls with Python `-I -B materialize-control.py`.
Hosted exact-source qualification and independent source/reader/input/launch
review remain required before any separately named connected compiler profile.
