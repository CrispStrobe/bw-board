# Observed backward-Jcc hot-loop locator

Set `AT_HOT_LOOP_LOCATOR=1` for the ordinary, noninteractive AT console or
`XV6_HOT_LOOP_LOCATOR=1` for the ordinary xv6 probe. The option is incompatible
with native dispatchers and other fetch observers. It adds `hotLoopLocator` to
the guest report; it does not read ahead, translate a new address, or change
guest execution. The observer wraps ordinary fetch and interrupt callbacks,
restoring both when the run ends.

An unprefixed short `70–7f` or near `0f 80–8f` Jcc with a negative signed
displacement is a seed only when a completed ordinary step fetched it from its
entry CS:EIP and its post-step EIP is the computed taken target. A 16-bit
taken target wraps to 16 bits; the fallthrough EIP retains its full width.
The next completed step must actually fetch the target. A traversal ends at
the next execution of the same branch site and bytes, with a valid taken or
fallthrough outcome. Its length is the number of completed step calls from
that target through the ending branch. Branches nested within a traversal may
produce overlapping traversal counts; these are not disjoint guest-step
coverage. A branch site can be hot while its body has multiple paths.

The pending traversal retains mode, CS selector and full descriptor-cache
identity, CR0/CR3/CR4, translation generation, A20 configuration/state,
linear code page, and observed fetched bytes by EIP. An input, observed
interrupt callback, due chip event, no-retirement step, entry redirect,
identity or page change, instruction crossing the page, changed observed byte,
or 256-step budget breaks it. The byte check detects changed bytes only at
EIPs actually fetched again; it does not prove body stability, physical code
coherence, data safety, or fault-safe native execution. In particular, a
host/DMA write followed by restoration before the next fetch is invisible.

Per-mode counters include backward branch outcomes, completed traversals,
length histogram, >=8 and >=16 tails, and break reasons. Entry attempts
partition into completed steps, no-retirement calls, and aborted calls. The
candidate table is bounded to 4,096 entries and the output to the top 64 per mode;
eviction is reported, so individual candidate counts are lower bounds after
eviction while aggregate traversal counters remain exact. Candidate keys
include guest addresses and observed branch bytes. Keep a commercial Windows
raw report private; publish only aggregate mode histograms and counts.

This diagnostic locates a candidate for a later guarded trace prototype. A
reproducible >=8-step Windows 16-bit loop and xv6 protected-32 loop would be
an engineering target, not a proof or speed claim. Its instrumented runtime
is not a performance A/B.
