# Unconnected resource-handshake observer admission

This source-only receiver independently decodes the fixed contained-entry resource
packet. It does not import the entry's resource validator, implement another
namespace validator or gate, discover or signal processes, or install limits.
`actual()` unconditionally refuses before OS work. The private channel is
unconnected by default; no caller FD, policy, factory, URL or command API exists.

The receiver captures literal packet/component/resource policy, source-loader,
channel and `prlimit` bindings before hooks. It accepts a sequence-packet channel
with credentials enabled and a bounded timeout. All delivered RIGHTS descriptors
are collected before payload/metadata refusal, including later well-formed chunks
following malformed or unknown ancillary rows. Truncated control/data, remainder
bytes, duplicate descriptors, noninteger/bool metadata or multiple credentials
refuse; unique owned handles are consumed for close once. Returned handles are
retained before a swallowed receive reentry can stop ordinary admission work.

The independent decoder caps JSON at 8192 bytes, rejects duplicate keys, floats,
nonfinite numbers, excessive depth/nodes and foreign shapes. Exact version, keys,
component extents/hashes, all five policies, ten immediate/final observations,
strict integers/counters and false authority flags are required. A boolean cannot
become core-limit zero. `controllerBootstrapStarted` must remain false.

The exact hash-bound [outer-boundary source](../i80386-supervisor-outer-boundary/README.md)
supplies `admit_handles` and `pidfd_terminal`. Its existing namespace-type,
namespace/pidfd/sender credential joins are reused. The local loader observes
bounded ordinary leaf bytes and fixed SHA; ancestor-route ownership, host
interpreter/standard library trust and external bootstrap remain separate.
After handle admission, the receiver calls only the two-argument read-only form
`resource.prlimit(senderHostPID, resourceID)` for each fixed resource. Every
read has terminal-pidfd checks before and after it; exact integer pairs must match.
The namespace/sender join and terminal check repeat before ACK. These finite
positions narrow races but do not establish a continuous numeric-PID or namespace
lease, quota, official host authority or resource sufficiency.

Exact four-byte `ACK\n` must be sent with an integer full-length result. ACK
attempt/may-have-escaped facts are conservative when a short send, exception or
reentry follows: cleanup cannot undo permission already delivered. Success retains
the source-owned namespace FD and pidfd until explicit close. Close uncertainty
preserves the original primary error, consumes the attempt and permits no retry;
zero remaining unconsumed handles does not prove uncertain descriptors closed.
The actual observer lifetime, new resource envelope/independent reader, proposed outer
480-second timeout, official event/job/artifact, launcher and compiler integration
remain unfinished. Actual acquisition, compiler, guest and performance flags stay
false even when a manufactured admission succeeds.

Run the pure controls from the repository root on Linux with system Python
providing `resource.prlimit` (the controls mock these kernel calls):

```sh
/usr/bin/python3 -I -B scripts/i80386-provisioning-observer/controls.py
```

Twenty-eight methods mock all kernel/socket/FD/`prlimit` operations. The suite
includes fake-helper lifecycle cuts and separate exact held-boundary source
loader/helper tests with mocked namespace/ioctl/fdinfo/poll edges. Fake-helper
results do not qualify a real namespace. Controls cover JSON/component/type
mutations, ancillary closure, credentials, kernel drift and terminal transitions,
identity recheck, ACK uncertainty, first-error/close preservation, reentry and
captured source/policy bindings. The workflow bounds its own interpreter only.
An initial mock returned a socket enum where a real `getsockopt` returns an int;
the fixture was corrected without weakening type admission. Early loader kwargs
and binding findings were corrected and retained. No real resource, namespace,
process, network, archive, toolchain executable, compiler or guest probe runs.
