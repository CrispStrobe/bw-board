# Unconnected observer lifetime and original-output controls

This source-only unit composes the exact
[receiver admission](../i80386-provisioning-observer/README.md) and its hash-bound
[boundary helpers](../i80386-supervisor-outer-boundary/README.md). A fresh private
receiver module owns admitted namespace/pidfd handles; the lifetime borrows them
and leaves their close ledger to that receiver. Historical handle admission is
separate from usable cleanup authority: closed or consumed handles are never
polled or signaled again, including after an ACK failure. Parent source files are unchanged.
`actual()` always refuses before OS work. The fixed private launch/channel/pipe
route is unconnected, and no caller command, policy, FD, factory or arming API is
provided. A completed manufactured control does not connect a provisioning launch.

The proposed cooperative policy observes an eight-second startup budget, up to
480 seconds of execution and an absolute 488-second lifetime budget. The execution
stamp is conservatively taken before receiver admission, so admission time cannot
extend the execution allowance. Clock values must be finite nonboolean numbers,
nonnegative and nondecreasing. These checks do not bound synchronous source reads,
bootstrap, launch, admission or census calls that fail to return. An independently
enclosing host deadline and fixed contained launch remain future integration; no
480-second kernel/external timeout or whole-process hard deadline is qualified.

Bindings are captured before hooks. Every recognizable owned resource in a
returned launch tuple is retained before post-return refusal. Channel transfer is
derived from the receiver's actual ownership, including partial admission, and
pipe aliases are excluded from the receiver's close ledger. Before admission no
cancellation or namespace authority is invented: an attempted but unobserved
launch remains explicitly uncertain. Owned descriptors consume close attempts
once. Original errors survive secondary cleanup refusal and reentry.

Owned output pipes must be observed nonblocking before admission. Original binary
stdout/stderr prefixes are retained separately, each capped at 65536 bytes, using
reads bounded by remaining capacity plus one. Overflow stores the allowed prefix
before refusal. Observed byte counts include the received overflow byte; prefix
lengths and SHA256 digests describe only stored bytes. EOF, admission, PID1 exit,
launcher reaping and census facts are separate. EOF or numeric exit alone grants
no completion credit.

Finite manufactured completion requires both EOFs, a zero owned-launcher return,
a terminal admitted PID1 and two complete bounded zero censuses while the namespace
handle remains retained. The existing census helper refuses unreadable or uncertain
process entries; its synchronous entry cap is not a time guarantee. Refusal may
signal only the admitted pidfd, once, with SIGKILL. It never signals discovered PIDs
or inferred process groups. Expired or incomplete cleanup leaves terminal, reaping
and census facts missing where they were not observed. It cannot manufacture zero
censuses or undo already delivered ACK. Successful output remains a mock observation,
not actual provisioning, host authority or a continuous namespace/PID lease.

Run on Linux with system Python from the repository root:

```sh
/usr/bin/python3 -I -B scripts/i80386-provisioning-observer-lifetime/controls.py
```

Thirty-nine methods mock all clocks, pipe, socket, process, namespace, signal and
kernel operations. They include an exact receiver-byte loader check with mocked
source reads, two exact held-receiver positive/ACK-error connections with mocked kernel/channel
edges, and lifecycle fixtures with a fake admission helper; those fixtures
do not qualify the held receiver or real namespace behavior. Controls exercise
startup/execution/absolute budgets, binary prefix overflow, terminal/reap/census
joins, partial admission ownership, duplicate ledgers, nonblocking readback,
returned-resource reentry, first-error cleanup, policy capture and close-once facts.
Early ownership findings and a clock-fixture ordering failure were corrected;
no archived candidate or private evidence is bundled here. The workflow limits its
own test interpreter, and does not install provisioning limits or launch namespaces.
Actual acquisition, compiler, guest, performance, official host, aggregate quota,
resource sufficiency and whole-process/continuous-lease authority remain false.
