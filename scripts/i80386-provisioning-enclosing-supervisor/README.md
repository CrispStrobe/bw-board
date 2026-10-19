# Fixed refusal launch and owned-wiring preparation

This source-only slice prepares a fixed launch plan and ownership mapping. It is
not an operational provisioning supervisor. `actual()` unconditionally refuses
before OS work. Private creation and launch routes are unset; a caller cannot
supply commands, policies, FDs, process objects, environments, factories or seals.
Tests patch private wiring only. No namespace, process, socket, signal or network
probe runs locally.

The contained command is fixed and assumes an already privileged enclosing observer:

```text
/usr/bin/timeout --signal=KILL 480s /usr/bin/unshare --pid --fork --mount-proc --kill-child=KILL -- /usr/bin/python3 -I -B bootstrap.py --unarmed-channel-fd OWNED_CHILD_FD
```

The source resolves only its fixed bootstrap path and internally generated FD.
The [bootstrap](bootstrap.py) prints `bootstrap-unarmed` and exits with failure;
it does not import or invoke contained Entry. Entry's channel, controller approval
and actual provisioning connection remain unset. No credential-drop route is
provided. Before source loading, creation or launch, captured Linux/root-credential
getters must return exact integer uid/euid/gid/egid zero. These are eligibility
observations, not proof of an owned namespace, official host or privileged
bootstrap. All credential getters are mocked in the controls. Installed tool
identities, privilege behavior, PDEATHSIG and namespace termination remain
unqualified.

The [primary sudo manual source](https://github.com/sudo-project/sudo/blob/main/docs/sudo.man.in)
describes closing descriptors beyond standard input/output/error by default;
changing that behavior requires policy support. An inner sudo could discard the
prepared channel, so it is excluded. Any future privilege acquisition must happen
outside this command and before socket/pipe creation. That external root bootstrap
is not implemented here.

A proposed enclosing 488-second timer must start before the observer Python
bootstrap, outside the contained 480-second timer. This slice does not implement
that observer bootstrap, enclosing timer or host collector. The existing
[lifetime](../i80386-provisioning-observer-lifetime/README.md) budgets are cooperative;
no whole-process hard deadline is credited. An enclosing timeout can kill an
observer before it records terminal/census evidence, so missing evidence must stay
unknown. There is no inferred process-group, numeric-PID or pre-ACK cancellation
authority here.

Exact lifetime and refusal-bootstrap bytes are verified before the fresh lifetime
module is loaded or ownership wiring begins. Parent sources are unchanged. The
closed command prefix, environment, standard-input policy, syscall bindings and
source pins are captured before hooks. Standard input is DEVNULL. A source-owned
sequence-packet pair and two nonblocking pipes use CLOEXEC; all returned resources
are retained before post-hook shape/reentry checks. Each original endpoint is
observed noninheritable before the launch route is used.

Only the generated child channel FD appears in `pass_fds`. The original output
write ends are mapped through stdout/stderr to descriptors 1/2, avoiding extra
inherited writer aliases that could delay EOF. The parent child-end copies consume
close attempts once after a returned launch handle is captured. Cross-ledger FD
aliases refuse, with unique close accounting. Ownership of the parent channel and
read ends transfers only through the exact lifetime's internal launch-phase
handoff, once. The tuple is constructed before transfer is recorded. Transferred
resources are distinct from still-owned pending descriptors; consumed attempts do
not prove closure after uncertainty.

The preparation does not run the lifetime, inspect process exit, signal processes,
accept ACK or declare a namespace empty. An attempted launch remains explicitly
unobserved for cleanup, including an exception without a returned process handle.
Original errors and owned partial wiring are preserved through secondary close
errors. A prepared refusal plan is not permission to run provisioning.

Run the pure controls on Linux with system Python from the repository root:

```sh
/usr/bin/python3 -I -B scripts/i80386-provisioning-enclosing-supervisor/controls.py
```

Twenty-eight methods mock credential, socket, FD and launch operations. They cover exact command,
environment and child-FD mapping, CLOEXEC/nonblocking readback, returned-resource
reentry, partial creation, alias accounting, launch uncertainty, close-once transfer,
source-byte loading, root eligibility/reentry and the fixed bootstrap refusal. Tiny lifetime stand-ins verify
orchestration; they do not qualify a live lifetime or host launch. Early stdin,
extra output-FD, ownership-report and inner-sudo propagation findings were corrected. No historical private
receipts or candidate copies are bundled.

The next gate is a separately reviewed full-source/resource/lifetime/original-output
envelope and independent reader, followed by fixed operational source/approval
connections, installed-host hard-bound qualification and official event/job/artifact
and sole-run gates. Source-graph admission, namespace/host authority, actual
acquisition, compiler, guest and performance qualification remain false.
