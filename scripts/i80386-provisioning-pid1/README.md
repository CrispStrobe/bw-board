# Unarmed PID1 process-limit preparation

This Linux source-only unit prepares one literal process policy before any future
product-component bootstrap: CPU soft/hard 180 seconds, address space
2,147,483,648 bytes, per-file size 67,108,864 bytes, 256 descriptors, and core size
zero. It does not invoke a bootstrap, delegate, command, FD, archive, compiler or
guest. There is no caller-selected policy or operational arming interface.

`actual()` unconditionally refuses while the production seal remains unset,
before own OS, environment or resource operations. The private preparation
lifecycle is not connected to that entry. It requires observed Linux, local PID1,
root effective UID and real/effective GID, and the fixed own-repository GitHub
Actions context at attempt one. Those are eligibility observations, not proof of
an owned namespace or an authenticated official host: environment values can be
spoofed. External observer/handle and official-run admission remain separate.

Preparation consumes one attempt. It captures and strictly validates the literal
immutable policy and set/get callable bindings before guard hooks. Every set is
followed immediately by exact `getrlimit`, then all five resources are rechecked.
Readbacks require an exact builtin two-element tuple of integers; booleans do not
launder into numeric zero, lists and foreign containers refuse, and infinite or
drifting pairs cannot match the finite policy. Busy preparation/status reentry
latches its first refusal and fences every guard, set, get and observation
adoption. A final recheck refusal cannot return a prepared lifecycle.

The result preserves ordered set/get attempts, partial successful installs and
bounded primitive observations. Original setter/getter exception objects retain
identity. Refusal does not roll back earlier limits, retry an uncertain setter,
or claim the process is unchanged. Preparation is a process-limit observation,
not a namespace aggregate budget, disk quota, sufficient RAM/disk/time proof or
qualification of a 480-second outer timeout. Resource installation, controller,
bootstrap, containment, raw output, official envelope and launch guard connections
remain unfinished. All those authority and actual/compiler/guest/performance
flags stay false even when a manufactured preparation completes.

Run the pure controls from the repository root:

```sh
python -I -B scripts/i80386-provisioning-pid1/controls.py
```

Eighteen methods mock every PID/credential/context and resource operation. They
never install real provisioning PID1/profile limits, create namespaces or signal
processes. The workflow bounds its own control interpreter; that is separate from
the mocked policy under test. Controls cover default no-ops, guard failures,
exact ordering and immediate/final readbacks, wrong/bool/infinite/foreign replies,
partial errors, first-object preservation, captured policy/callable mutations,
swallowed reentry, once-only consumption and copied status isolation. No actual
archive, acquired toolchain executable, compiler or guest executes.
