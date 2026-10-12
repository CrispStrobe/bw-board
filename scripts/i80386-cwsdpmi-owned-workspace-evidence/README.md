# Retained workspace and evidence composition

This source-only unit joins the existing workspace creator, directory-route
observer, and exclusive evidence writer. It imports only those fixed-hash Python
units and standard-library modules. It does not import or execute a compiler,
client, CPU, guest, sampler, or toolchain.

`OwnedWorkspaceEvidence(parent)` accepts one absolute parent pathname, limited to
30 components and 4,046 UTF-8 bytes (with a cheap character bound before encoding).
The creator generates its session basename internally. `prepare()` creates the
session and fixed `tool` and `evidence` siblings. The wrapper registers successful
returned directory descriptors before the creator appends them to its own list.
It prepares copied route rows before seeding a fresh internal evidence owner.
The seeded chains use the retained descriptors; they do not reopen the created
directories or accept a caller descriptor, receipt, root array, or callback.

`before(bytes)` writes `tool-before.json`; exactly one subsequent
`terminal('after-link' | 'failure-final', bytes)` writes `tool-terminal.json`.
Each payload is exact `bytes`, at most 32 KiB. The held writer retains its
exclusive descriptor-relative creation, ordinary single-link file checks,
positive bounded short writes, exact bounded readback, extent and named/held
identity checks, and route rechecks. Terminal output precedes route release.
A completed `failure-final` means only that this finite diagnostic write and
terminal route observation completed, not that compilation succeeded.

A canonical ledger owns at most 34 unique directory descriptors. Shared parent
rows in the two route chains do not duplicate ownership. Each close is consumed
before its syscall, and an uncertain close is never retried. Writer output
descriptors have separate close accounting and may reuse a numeric descriptor formerly
used for a directory without being mistaken for that directory. A locally
returned descriptor whose ledger registration raises has independent cleanup;
cleanup does not attempt registration again. Partial directories and output
files are preserved, without deletion or alternate-path retries.

Outer observer reentry immediately poisons all potentially active inner owners.
Status calls during an operation are reentry, too. Cleanup still attempts owned
directory closes after poison, but source observations and later writes refuse.
The first inner failure code is retained before cleanup can report a later
refusal, and the original raised exception is rethrown. Nested directory cleanup
fields explicitly use the shared canonical ledger, including attempted and
refused closes; uncertain cleanup never reports qualification. Status returns
fresh bounded copies of finite facts, no descriptor or pathname handoff.

This is version-bound private composition, not an adversarial Python security
boundary. Exact byte bindings do not authenticate a live workspace creator,
parent owner, loader filesystem route, OS, mount namespace, or source session.
The public parent still needs separately admitted creator/source authority.
Verified created-role identities are named/held observations after `mkdir`, not
proof that those inodes were created by the preceding call: substitution before
first observation can remain indistinguishable. There is no uninterrupted
identity claim. Manufactured transfer interruptions and a creator append fault
exercise specific recovery points; they do not establish safety for arbitrary
allocation failures or asynchronous interruptions at every Python bytecode.
Private attributes and module intrinsics require trusted execution context.

All parent-trust, source-ownership, continuous-identity, general input-alias,
compilation, guest, and performance qualification flags remain false. There is
no production integration or public raw-descriptor handoff. The separately
qualified four-unit source-control profile does not qualify this new composition;
new hosted source controls and independent source/reader/input/launch gates are
still required before any compiler connection.

Run only the manufactured filesystem controls for this unit:

```sh
python -I -B scripts/i80386-cwsdpmi-owned-workspace-evidence/owner-control.py
```

The controls create temporary ordinary directories and files. They cover
retained chains without directory reopening, shared-ledger close-once behavior,
original creator/writer failures with cleanup refusal, registration and append
faults, interrupted preparation/transfer, reentry, phase and parent bounds,
readback, and terminal cleanup facts. They do not run product helpers or tools.
