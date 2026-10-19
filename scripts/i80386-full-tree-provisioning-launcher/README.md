# Fixed provisioning transport source slice

This portable source-only unit retains six reviewed public URL, extent and SHA256
bindings in their exact order: toolchain TAR, DJCRX, DJDEV, DJLSR, GCC runtime notice
and GCC GPLv3 notice. Their total pinned extent is 86,087,453 bytes. It has not
acquired those inputs. It does not parse archives, construct a coordinator or
admission gate, run a namespace, execute a tool/compiler, or run a guest.

`actual()` refuses before any operation. `Transport().acquire()` also refuses
before clock or opener work because source admission is unimplemented and the
production seal is unset. Supplying a non-null seal string cannot invent missing
admission. There are no caller URL, pin, factory, command or environment arguments.
Later integration needs the existing separately reviewed source gate, resource
executor, official original reader and once-only launch guard; this slice arms
none of them and changes no held profile.

The internal acquisition lifecycle consumes one attempt. It captures and validates
the fixed immutable table before transport, admits only its source-owned current
input index, and poisons on busy acquisition/status reentry. The intended bounded
transport requires exact integer HTTP 200, disables proxy delegation, and reads
at most 64KiB per call with an extent-plus-one EOF guard. Every body must have its
exact extent and SHA before the next input proceeds. Cooperative deadlines remain
90 seconds per input and 360 seconds aggregate, with ten-second socket waits.
Those are observed checks, not a hard process or whole-bootstrap deadline or a
RAM sufficiency guarantee.

Only the toolchain input may follow up to three redirects. HTTPS redirects admit
only the fixed GitHub asset hosts, with no credentials, nonstandard port or
fragment. A custom handler closes each redirect response before following and
never reads its redirect body. Read, status, hashing and cleanup boundaries check
for swallowed reentry before later ordinary work. Failure rows preserve received
prefix counts and hash/authentication facts; no body is fabricated as complete.
Original exception objects propagate, with secondary close uncertainty recorded.
Returned immutable bodies would be transport data, not source ownership or a
lease; all actual/source/lease/compiler/guest/performance status flags stay false.

Exact `urllib.error.HTTPError` wrappers are normalized to their raw `fp`. The
reviewed CPython `_closer.file` detachment prevents the wrapper finalizer from
closing an already consumed raw response again. This implementation-specific
behavior has explicit mocked compatibility controls; a hosted implementation
must qualify it before any real input acquisition. The bounded identity ledger
consumes each response close once, preserves original failures, and does not
retry uncertain closes. Response references may remain reachable; no memory
purging or arbitrary Python reflection security is claimed.

Run the pure controls from the repository root:

```sh
python -I -B scripts/i80386-full-tree-provisioning-launcher/transport-controls.py
```

Twenty-nine methods use only tiny manufactured bodies/pins and mocked HTTP
responses. A separate test harness patches private admission/table wiring inside
controls; there is no public fixture or authority API. Controls cover exact order,
all six failure cuts, missing/extra/wrong hashes, status and chunk types, redirects,
HTTPError finalization, primary-plus-close errors, deadlines, once-only entry,
closed helper routes and swallowed reentry. An initial per-input clock fixture
advanced too slowly to reach that bound and was corrected; no production deadline
was widened. The dedicated workflow runs only this pure suite, with no network,
archive, namespace, compiler or guest fixture.

Request construction is fenced before the opener call. A swallowed constructor
reentry now stops with zero opens; the controls retain that failure cut.
