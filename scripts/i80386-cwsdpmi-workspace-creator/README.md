# Workspace creator — standalone source preparation

UNCONNECTED. `WorkspaceCreator(parent)` creates one internally generated session
basename with a fixed prefix and32 lowercase hexadecimal digits, then fixed
`tool` and `evidence` siblings. No caller-selected name, caller descriptor,
callback, compiler or handoff is accepted. Parent source/context admission is
not implemented; Python introspection is not an ownership security boundary.

The absolute parent route is bounded before scanning/encoding:4096 characters
and UTF-8 bytes,32 components,255 bytes per component. Empty/dot/dotdot/NUL or
malformed Unicode refuses. The generated name is exact primitive data with a
fixed length before any filesystem operation. Opens begin at an OS `/`
descriptor, use descriptor-relative no-follow ordinary directories, and compare
before/opened/named dev/ino. All retained parent and created routes are rechecked.
A created-directory identity colliding with any retained parent or previously
created directory refuses. At most36 descriptors are retained.

`create()` is once-only. Exactly three mkdir attempts are possible: session,
tool, evidence. Each logical attempt is consumed before the syscall, including
when it throws or a swallowed reentry makes its outcome uncertain. Verified
identity credit follows opening and route rechecks only. `mkdir` returns no
inode/descriptor: `verifiedRoles` are post-call named/held observations, not proof
that the observed inode was created by that mkdir. Replacement before the first
observation may be indistinguishable and does not grant source ownership. Partial artifacts and
facts survive failures; no retry, alternate name/parent, rollback or deletion
exists. A later failure does not relabel an earlier verified action.

Every observation syscall is fenced against status/create/close reentry.
Returned-open cleanup is explicit and captures the close function before its
callback. First fixed refusal is latched before cleanup; secondary close errors
cannot replace the original thrown object. Cleanup attempts all owned closes,
records refused/uncertain closes and never blindly retries them. `close()` is
required when abandoning a completed creator. Existing, foreign, replaced or
nonempty directories are never removed, including partial created artifacts.

Status copies logical roles, integer identities, bounded attempts/cleanup facts
and fixed refusal codes without paths or session names. `creationComplete` is a
historical finite action fact; later firstFailure/closure still applies. Original
filesystem exceptions remain caller-visible and may contain paths; future
owners must sanitize those separately before public output.

Parent trust, workspace/source admission, OS/mount behavior, uninterrupted
identity and compilation remain unqualified. The module does not authenticate
exclusive parent control or original tool/input aliases. Private route/writer
handoff is deliberately UNIMPLEMENTED; no source ticket or raw FD is returned.
The disabled compiler and held helpers remain unchanged.

Manufactured filesystem controls only:

```sh
python3 -B scripts/i80386-cwsdpmi-workspace-creator/workspace-control.py
```

Controls cover exact three actions, malformed parent/name without filesystem
calls, collisions, child failure/original exception identity, parent symlink or
replacement, uncertain mkdir reentry, returned-FD/fstat/cleanup reentry, sibling
identity collisions and close uncertainty. They neither import helpers nor
copy tools, extract archives, run compilers, CPU, Node or guests. Independent
source review and hosted pure controls precede later parent-context admission,
internal route/writer handoff, pair/input/reader acceptance and reviewed launch.
