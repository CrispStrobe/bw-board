# Fixed archive byte acquisition

`FixedArchiveAcquisition(parent)` exposes only `acquire()`, copied `status()` and
`report()`, and once-only `close()`. It owns the fixed materialization runner,
constructed only after all four fixed public input extents and SHA-256 values
match. There are no caller URLs, pins, descriptors, callbacks, receipt adoption,
CLI, subprocesses or compiler calls. The pinned runner inspects the disabled
compiler's hash and AST; it does not import or execute it. This source unit is
unqualified until its source, hosted controls, reader and launch gates are
independently admitted.

The four inputs total 86,048,982 bytes: the fixed build-djgpp v3.4 GCC 12.2.0
Linux tool archive and Delorie djcrx205, djdev205 and djlsr205 ZIPs. Each attempt
has a 90-second monotonic deadline, a ten-second request timeout, no retry, reads
of at most 64 KiB bounded by remaining fixed extent, and one EOF guard byte.
All four are authenticated before parsing or workspace preparation. Immutable
bytes remain private in memory; no archive staging files or uploads are made.
Conversion temporarily holds mutable and immutable copies, so byte admission
is not a tight process-memory bound or a live input-filesystem lease. Network
operations and source hashing may return after a deadline; the next fence
refuses rather than granting a hard process interruption guarantee.

Requests disable proxy environment discovery. HTTPS redirects are capped at
three per input. The GitHub input permits its exact initial URL and release
asset hosts `release-assets.githubusercontent.com` and
`objects.githubusercontent.com`; Delorie inputs permit only their exact fixed
URLs. Credentials, fragments, foreign origins and nonstandard ports refuse.
Live responses carried by HTTP status errors are also closed once; retained
identity prevents closing a consumed redirect response again. Redirect bodies
are never consumed: each returned redirect response receives
one close attempt before the next request. Final response status must be 200
and its URL must satisfy the same policy. Signed final URLs and queries are
never reported. Authentication, not an approved origin alone, binds the bytes.
TLS, DNS, OS and Python standard-library behavior remain external trust. An
exception before the library returns a response cannot prove its internal
socket cleanup.

Acquisition consumes its attempt before opening any input. Completed and failed
input prefixes retain fixed role names, byte counts, authentication facts and
close-attempt uncertainty only. Accepted byte counts exclude a returned chunk
refused at a reentry fence. Returned responses are closed once, never retried
following uncertain close. First original exceptions survive secondary cleanup
and report errors; public failures use fixed codes without paths or exception
messages. Busy observer reentry latches refusal and poisons an existing private
runner and its active owners immediately. Normal acquisition/materialization
work then stops; cleanup remains allowed. An absent runner report stays absent and grants no report-presence credit.
A failed materialization may retain
its bounded copied partial report. Reports are source reserializations, not
byte-exact original writer outputs. Inner reported cleanup uncertainty is
included in the adapter's cleanup flag.

The standalone controls use manufactured HTTP responses, tiny private input
pin substitutions and a synthetic runner. They invoke neither networking nor
real archive materialization, compiler, Node, CPU or guest code. They cover
extent/hash/EOF/deadline/origin refusal, redirect bounds and body avoidance,
all-four-before-runner ordering, response close uncertainty, first exception
identity, reentry, copied reports, failed prefixes, once-only lifecycle and
source hash refusal. Source-loading executes only the pinned standalone Python
modules; the disabled compiler remains AST-only.

Every report retains false input lease, source-owned workspace, measured
namespace/mode, full toolchain, compiler, guest and performance flags. This
adapter does not provide extraction completeness, license closure, raw archive
compatibility, continuous identity, hard runtime/resource qualification or a
launch authority. Hosted acquisition and materialization require a separately
reviewed exact-source profile, original reader and one-shot gate.

This revision preserves the failed original and carries bounded first-rule TAR
diagnostics in copied materializer statuses. Packet schema is v2. Acceptance and
compiler refusal remain unchanged; diagnostic facts are source-issued serialized
content rather than original emitted writer bytes or raw archive header proof.
