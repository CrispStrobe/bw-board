# Guest snapshot cohort seam source

UNCONNECTED and unrun. Exact source base:
`3a0e595c7b813a753fd79c436bfafe2c20cea690`. No CPU, board, probe, addon,
runner, media, pin or default behavior changes. The accompanying PR workflow
runs synthetic source controls only; it does not execute a CPU or guest.

`createGuestSnapshotCohort(cpu)` installs one own data method around the admitted
`_snapshotInstruction` callable. Its finite descriptor walk rejects accessors and
Node-detectable CPU, prototype and callable proxies before their hooks run.
Each invocation calls the original exactly once with its original receiver and
arguments and preserves the identical return value or thrown value. At most64
distinct ordinary returned roots are retained. After the64th root it restores
the exact prior own descriptor or absence of an own method. Cleanup refuses
changed descriptor/prototype boundaries and never overwrites another owner.
Reentry, duplicate/malformed roots, stale wrappers and cleanup failures latch
the first refusal; no later success clears it. A private weak issuance set
refuses a second seam for the same instance, including after disposal; it exports
no reset or reflection capability.

The closure exposes `status()`, `extract()` and `dispose()`. Status is frozen
primitive data, with no roots, callable markers or reusable public ticket.
Extraction takes no arguments, transfers one frozen array of captured roots
once, clears internal references and closes the session. Early or caller-root
extraction refuses. The outer controlled adapter must own the closure and adopt
the extracted roots promptly; it must never serialize or publish them. Disposal
clears retained roots. A saved stale wrapper calls the original but refuses
observation. Tests use ordinary synthetic objects only, without public test
symbols or reflection markers in production.

The seam does not authenticate exact source, live CPU/machine identity, reset
generation, private session authority or the allocation origin of returned
objects. `sourceInstanceQualified:false` and `guestConnected:false` remain
explicit. Outer exact-source/live-instance/probe admission and reset/callback
fences are REQUIRED; caller reports or serialized arrays cannot substitute.
A synthetic object satisfying these mechanical controls establishes no CPU
qualification.

The selected CPU snapshot branch contains both a returned rollback object and
its segment-cache array. Weak roots are not mapped to individual sample IDs;
no root-only allocation count or cost is claimed. Prior failed originals and
the independently audited successful four-case nursery fixture stay unchanged.
A later separately reviewed profile must retain unarmed nursery admission,
all64 weak callbacks, full ancestry and exact sample-ID lifetime predicates in
four fresh connected guest cases. Every complete reported CPU/RAM/disk/serial/
input/IRQ/device outcome must match a fresh ordinary reference under explicit
runtime and resource bounds. None of those gates has run for this seam; sampling
cost, a benchmark and any RTx claim remain later work.

Authored hosted controls: `test/xv6-guest-snapshot-cohort.test.mjs`. They cover
receiver/result/throw,64cap,duplicates,reentry,proxy/accessor refusal, prior own
descriptors, replacement, stale/disposed handles, extraction and cleanup. They
have not executed locally. Independent static review and exact-source hosted
controls remain required.
