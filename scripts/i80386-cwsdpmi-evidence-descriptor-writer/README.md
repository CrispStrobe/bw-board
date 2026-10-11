# Evidence descriptor writer — standalone source preparation

UNCONNECTED. `EvidenceOwner(toolroot, evidenceroot)` privately composes the
exact PR505 route module SHA-256
`59f1a023b08b2e199dd8d464d47224f6beaeef972e281c0fb73ec68c31f78848`.
The bounded source read is hashed and the same verified bytes are loaded; no
compiler or guest helper is loaded. This version-bound private composition uses
retained route internals, not caller descriptors or a public raw-FD ticket.
Python introspection is not an ownership or isolation security boundary.

`before(payload)` observes before-probes routes, then writes only
`tool-before.json`. `terminal(phase, payload)` accepts after-link or failure-final,
rechecks retained routes, writes only `tool-terminal.json`, then takes the
terminal route observation and closes route descriptors. Exact byte payloads
are at most32 KiB, admitted before any route work. Content is bounded reported
diagnostic data, not a verified receipt or compiler result. A complete lifecycle
means these writes and observations finished only.

The fixed name's attempt is consumed before its descriptor-relative exclusive
no-follow open. Preexisting files, symlinks and hardlinks are never overwritten.
The returned file must be regular, single-link and initially zero length. Short writes make positive
progress with at most payload-length iterations; zero progress refuses. Held
and named dev/ino/size and exact output extent must match. Bounded descriptor
`pread` verifies exact payload bytes and EOF, then rechecks held identity/extent.
This boundary readback is not durable-storage or continuous-content proof. Full retained
route rechecks precede and follow writing. No arbitrary role, path, caller FD,
serializer or write callback is accepted.

Observer/status/close reentry latches first refusal, poisons the route owner and
fences each observation or writer syscall. Explicit open-result handling captures
cleanup before callbacks; a swapped open function cannot hide a returned FD.
Every owned descriptor receives a cleanup attempt. Close refusals are counted,
remain uncertain and are never blindly retried. Failed exclusive output stays
preserved, and no alternate destination or second attempt is allowed. The original write refusal is latched before output cleanup; a later close
refusal is counted without replacing that first code or the thrown error object.
Partial fixed-file attempt/completion facts and route first failure survive refusal.
Raw original filesystem exceptions remain caller-visible and require bounded
sanitization before public reporting; status contains no source paths.

Source-owned workspace creation, caller path authority, OS/mount trust and
uninterrupted identity remain external. Directory separation is not full input
alias admission: selected tool-file identities are absent. Exclusive opening
rejects preexisting aliases but does not close all input/file/race authority.
`sourceOwnedQualified`, `inputAliasQualified` and `compilationQualified` stay
false. No final compile/input, archive, environment, binary-format or media
qualification is added; the production compiler disable remains unchanged.

Manufactured filesystem controls only:

```sh
python3 -B scripts/i80386-cwsdpmi-evidence-descriptor-writer/evidence-owner-control.py
```

The controls load only this standalone writer and bound route source. They use
small synthetic directories/data for short writes, collisions, aliases, named
replacement, route change, reentry, close uncertainty and phase caps. No real
tool, compiler, CPU, Node or guest operation occurs. Independent source review,
hosted pure controls, source-owned creation and writer/pair integration, full
input/reader closure and a separately reviewed launch gate remain prerequisites.
