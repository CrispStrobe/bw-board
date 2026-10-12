# Manufactured-only retained-tree writer

This is not a parser, archive acquisition adapter, public integration or compiler
profile. It writes only small manufactured fixtures in its controls. The default
policy data is hash bound to the local [manifest.json](manifest.json), derived from the reported Stage A inventory: 1,196 ordinary files, 78 directories, 13 hardlink mappings and 11 targets.
The four fixed input extents/hashes remain unchanged as metadata; authentication,
raw GNU archive parsing and a source-issued materializer handoff are unimplemented.
Neither the reported manifest nor caller content proves a minimal C closure.

`Provisioner(parent)` performs no OS calls in construction. `provision(contents,
notices)` is once-only and accepts exact builtin dictionaries, fixed-role names,
and exact builtin list/tuple containers of bytes chunks. Containers and chunk
sizes are bounded before filesystem work and revalidated before slicing/writing;
no generator, custom container, caller FD, root, extractor, callback or expected-pin
API is admitted. Caller bytes and parent remain untrusted. Controls patch
small fixture constants; there is no public fixture-swap argument.

Version `reported-full-tree-v1` limits ordinary file content to 34,200,152 bytes
per file and 258,686,704 bytes reserved in aggregate. These are exact reported
content bounds, not sufficient disk/RAM/elapsed-time budgets. Each body chunk is
at most 64KiB, and readback uses its known extent plus one EOF guard byte. No full
file copy is accumulated internally. The old selected-nine16MiB/64MiB caps and
all held source modules remain unchanged. Input containers themselves are
caller-supplied; this is not an authenticated streaming archive-input interface.

The prototype admits a bounded canonical parent route with nofollow directory
opens and retained named/opened devino fences. It creates one internally named
exclusive session and fixed tool/notices siblings, then only fixed manifest
members. Missing/extra content refuses before creation; duplicate role keys cannot
be represented in this closed builtin dictionary API. The immutable manifest
contains unique rows; the separately reviewed pure policy checked exact rows,
duplicates and file-ancestor conflicts in either order. Files use exclusive
nofollow opens, streamed hashes, extent checks and bounded readback. Dir descriptors
use a bounded consumed-before-close ledger; output descriptors close separately.
Registration interruption before or after slot assignment has one fallback close.
Pre-existing collisions, partial files and directories are never recursively
removed or retried.

Physical aliases use only the13fixed mappings and `os.link` to prior ordinary
files. Immediate target/alias identity/link count fences and a final observation
after ALL links require nlink1+the fixed target alias count. Every canonical file's
bytes/hash/extent/identity are re-observed; aliases join that target identity and
multiplicity. Thus this is a new policy, not the old canonical-nine nlink1 observer.
Copied aliases, external links, target substitutions and changed bytes refuse.
These are finite OS observations under manufactured conditions, not a samefile or
continuous namespace/input lease against arbitrary hostile processes, mounts or
Python monkeypatching. Modes are0600 and no executable is launched; complete mode
policy and host ELF/environment/child delegation remain future work.

Five **selected notice subset** roles live only under the disjoint notices sibling:
DJGPP copying/copying.dj/copying.lib and GCC COPYING.RUNTIME/COPYING3. They have a
separate pre-admitted aggregate content budget85,182bytes and per-file cap64KiB.
The DJGPP source inventory report pins copying/copying.dj; retained notice-completion
metadata pins copying.lib and GCC notice hashes/extents. See [provenance.json](provenance.json).
Raw bytes, including formfeeds and a35,147byte fixture, are hash checked and finally
re-observed without text sanitization. No actual notice bytes were provided,
retained or published by this prototype; this subset is not complete toolchain
notice coverage or legal clearance. The tool archive's reported inventory itself
has no COPYING/LICENSE rows.

Reentry latches first refusal and stops ordinary syscalls; cleanup attempts all
owned descriptors once and preserves initial error identity over close refusals.
`handlesClosedWithoutReportedRefusal` describes descriptor accounting only; it
is not filesystem cleanup qualification. Partial artifacts intentionally remain.
mkdir then first stat cannot prove that an observed inode was created by that
mkdir, and descriptor identity does not establish trusted parent/source ownership.
All source/parent/filesystem/rawarchive/minimalclosure/fulltoolchain/complete-notice/
compiler/guest/performance flags are always false, even on successful fixtures.

Controls: 20 manufactured methods, including13links/11targets, exact formfeed/>32KiB
notice bytes, missing/extra/custom/iterator refusal, caps, hash failure, parent
symlink/session collision, short/zero writes, write-plus-close dual error, swallowed
status reentry, external link count, final byte/notice substitution, route rename,
closed consumption, nonblocking FIFO substitution refusal and before/after-registration interruption. No real tool archive,
compiler, Node, CPU, guest, network, download or product helper ran. Tests demonstrate
these finite cuts; arbitrary asynchronous Python allocation/process safety remains
unqualified. Run `python -I -B scripts/i80386-full-tree-provisioner/controls.py` from the repository root. The accompanying PR workflow runs these synthetic filesystem controls only.

Earlier mutation controls exposed enumeration of a substituted custom list before
its type check and comparison of a substituted custom dictionary key. The current
writer checks exact builtin containers and string keys before enumeration, sets
and lookups at each content and notice boundary. Original failures remain part
of the review history; the guards do not claim arbitrary concurrent Python safety.

The GCC notices are separate source inputs; their metadata pins do not establish
that the four fixed archives supply their bodies. No notice body is bundled here.
