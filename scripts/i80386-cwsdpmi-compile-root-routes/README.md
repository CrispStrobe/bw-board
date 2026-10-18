# Compiler root routes — standalone source preparation

UNCONNECTED. This unit observes exactly two supplied logical directory roles,
`toolroot` and `evidenceroot`, without loading helpers, executing compilers or
writing receipts. The disabled PR503 compiler remains unchanged. A future
source-owned driver must authenticate both paths and exclusive workspace
creation; this module cannot confer that authority on caller paths.

Paths are absolute, at most 4096 UTF-8 bytes and 32 components, with components
at most 255 bytes. Empty, dot, dotdot and NUL components refuse. Each route starts
at an opened OS `/` directory and uses descriptor-relative ordinary directory
opens with no-follow flags. Before/opened/named dev/ino identities must match.
Every component descriptor is retained and named routes rechecked. The evidence
ancestor identity list must exclude the extracted tool-root dev/ino, including
same-identity aliases; path-prefix comparison is insufficient. Evidence writes
may legitimately alter directory timestamps, so timestamps are not fenced.

At most two captures are permitted: `before-probes` then `after-link` or
`failure-final`; alternatively one initial `failure-final`. Terminal phases
attempt to close all owned descriptors. Each role retains at most33 identities; at most66
descriptors are held. Every observed syscall is fenced against swallowed
reentry, including returned-open descriptor cleanup. Open-result handling is explicit
and captures its cleanup function before the callback; replacing `os.open`
during a swallowed reentry cannot hide the returned descriptor. Status/close/capture reentry
latches the first refusal; after poison there are no further observation calls.
Cleanup attempts every owned close even if another close refuses. Close-attempt
and close-refusal counts retain uncertain cleanup; `cleanupQualified` is false
after a refused close. Such descriptors are not proven closed and are never
blindly retried because descriptor reuse could affect another owner. Explicit
`close()` is required when abandoning a successful first capture. No destructor
or automatic continued route lifetime is claimed.

Partial status retains only logical role identities, attempted captures, owned
FD count and fixed first-refusal codes. No path or exception text is serialized.
Caller-visible original filesystem exceptions may contain paths and require
sanitization by a future driver. Status is a copied report, not a reusable source
ticket. Reentry or cleanup failure prevents a successful terminal result.

The OS, filesystem and mount behavior remain trusted. Repeated dev/ino checks
do not establish uninterrupted identity, protect against privileged inode reuse,
or authenticate caller workspace/source creation. Directories alone do not
prove destination-file admission: a future exclusive writer must operate under
an admitted evidence descriptor and reject output aliases. Bind-route identity
collisions are refused when observable, not proof of mount isolation.

Manufactured controls only:

```sh
python3 -B scripts/i80386-cwsdpmi-compile-root-routes/root-routes-control.py
```

Controls cover evidence metadata changes, malformed/capped paths, symlinks,
inside-tool routes, manufactured alias identity, named route replacement,
returned-FD and fstat/cleanup reentry, closed phases, poison and partial facts.
No real tools, compile helper, CPU, Node or guest are imported or executed.
Independent source review and hosted pure controls are still required. Pair
integration, complete input/archive/environment/format/media acceptance,
independent reader and reviewed launch gates precede any compiler connection.
