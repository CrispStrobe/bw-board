# Fixed supervisor outer-boundary controls

This source-only Linux profile tests five fixed manufactured fixtures: success,
startup stall, a detached `setsid` sleeper, original partial stderr followed by a
stall, and a setup refusal. It does not acquire archives, execute a compiler,
emulate a CPU, run a guest, or connect an application. `actual()` always refuses;
the production seal remains unset.

Run the pure controls from the repository root:

```sh
python -I -B scripts/i80386-supervisor-outer-boundary/controls.py
```

The nineteen manufactured methods mock process, signal, namespace and `/proc` operations. No namespace or
privileged process experiment is performed by that command. The dedicated PR
workflow alone runs the fixed privileged host fixtures on Ubuntu Linux after
source review. Its root observer launches root GNU `timeout --signal=KILL 5s`,
then util-linux `unshare --pid --fork --mount-proc --kill-child=KILL`, then the
fixed source-owned Python fixture. It never drops credentials, accepts a caller
program or environment, downloads dependencies, or signals census-discovered PIDs.
Tool and source byte identities are retained before launch and compared again.
These observations do not establish continuous executable identity or host trust.

The fixture hands the observer its namespace FD and PID1 pidfd over a private
socket. Kernel credentials, typed namespace ioctl, pidfd identity and local PID1
join before ACK permits fixture work. The observer retains the namespace FD to
prevent namespace-inode reuse. A successful containment observation requires a
terminal PID1 pidfd, reaped owned timeout process, bounded pipe EOF, and two
complete host `/proc` censuses with no matching namespace member. Missing entries
are skipped only when the corresponding process directory is also gone; remaining
zombies, permission errors and census caps refuse qualification. Setup refusal
has no admitted namespace and receives no namespace-empty credit.

[Linux PID namespaces](https://www.man7.org/linux/man-pages/man7/pid_namespaces.7.html)
specify that PID1 termination kills the remaining namespace processes, including
detached sessions. [util-linux unshare 2.39.3 source](https://github.com/util-linux/util-linux/blob/v2.39.3/sys-utils/unshare.c)
sets a parent-death signal and checks its parent pidfd when built with that
support. Installed tool hashes are observed by the hosted probe; the cited source
is mechanism review, not an installed-binary provenance certificate. The probe
is not a security sandbox: fixed fixtures run as root, mount a private `/proc`,
and perform no credential changes or arbitrary untrusted work.

Raw stdout and stderr retain their original bounded prefixes, including non-UTF8
bytes, in exclusive output files. Refusals preserve those prefixes and fixed
sanitized reason codes. A separate capped diagnostic retains the original host
exception type, errno and primitive arguments; close uncertainty cannot become a passing control. The
five-second timer starts before namespace setup and Python bootstrap, after the
external observer has admitted tool/source identities. Observer admission and
startup are covered only by the enclosing hosted timeout. Direct signal 9 and
shell-style exit 137 are recorded separately. Either status
alone receives no containment credit: independent handles, elapsed observation
and census facts are also required. The outside observer has a separate observed
eight-second loop deadline, bounded waits and a hosted job timeout; those do not
certify hard deadlines during every kernel operation or observer bootstrap.
All actual, compiler and guest qualification flags remain false, even when a
hosted synthetic control passes. No existing supervisor or acquisition profile
is armed by this workflow.
