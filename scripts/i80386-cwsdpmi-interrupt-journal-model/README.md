# Bounded interrupt journal model

This is a **source-only, unconnected model** for a possible opt-in 80386
interrupt journal. It does not modify the CPU, AT machine, client, media, or
hosted workflow. Its tests supply synthetic records; they are not a guest trace
and cannot authenticate their own CPU origin. There is no AT interrupt, DPMI
service, completed-client, or performance result from this checkpoint.

An eventual producer must keep the journal private inside the CPU and leave it
disabled by default. The producer would begin a one-event transaction before
an instruction or external delivery, copy only primitive metadata after the
original validated operation succeeds, and publish the event only when the
enclosing `step()` or external `interrupt()` returns successfully. Instruction
rollback discards a staged record. Ambiguous post-effect failure, unsupported
task/VM86 paths, malformed frames, reentry, or capacity exhaustion after an
effect must stop the instrumented session. The consumer drains copied events
once after an ordinary `machine.step()`; no foreign callback runs in CPU fault
or delivery code. A separately successful external `interrupt()` transaction
has source `hardware`, never `software`, even if it nests inside a software
service frame. It cannot be credited as INT 31.

The source seams are concrete but **not wired here**:

These notes refer to Git base `27ff49068baae8af7c54457c422fbb25a5ecfa2d`:
`src/experimental/i80386.js` SHA-256
`6fba681208e1443cc9eff00ae6aba444903d23e5feafe62527b25428e72d60ed`,
`src/experimental/i80386-at-machine.js` SHA-256
`6c5f12cc92ba7219ed4b53f6237622f6ce58269402ee14770791e04c68f93cb0`,
and `src/i8086-machine.js` SHA-256
`7cf7fdf4e6de451071809e32e128aa0ac663524eaf8b2e08581780b0ec4f167c`.

- `src/experimental/i80386.js` `_stepInstruction()` has the source
  `instructionStart`, software opcode and vector, and post-immediate return
  EIP for `CC`, `CD`, and `CE`. The `CD` path checks VM/IOPL before `_deliver`.
- `_deliverProtected()` validates gate type 6/7/14/15, width, old/target CPL,
  saved flags, and the prepared same/inner stack frame before committing it.
  Task gate type 5 is outside this first journal profile. `_deliver()` returns
  after the original delivery succeeds. The future producer must copy those
  existing validated locals; it must not reread guest memory for diagnostics.
- `_iret()` has its validated width, old stack, selector/target/flags, outer
  stack, and return CPL before the state update. NT task return and VM86 return
  are outside scope. The model associates nested IRET with the latest open
  delivery and requires the copied return-frame identity, CS:EIP, SS:ESP, and
  CPL to agree. It keeps delivered and consumed flags separately because a
  service may edit saved CF. A later CPU producer must also establish the
  actual frame bytes, allowed flag restoration, and successful original return.
- `step()` snapshots instruction state and restores it on ordinary fault;
  `taskCommitted` is distinct and cannot be called a rolled-back instruction.
  `interrupt()` is a separate external delivery entry. The AT machine's
  `hooks.onInterrupt` fires before hardware delivery and is not a software
  INT or successful-delivery receipt.

The model has a finite queue, private session tickets, one staged event per
boundary, copied primitive records, a nested frame stack, and terminal
fail-stop for post-effect ambiguity. An ordinary step with no interrupt event
publishes nothing. This is only a transaction and association model; its
caller-supplied `before`, `after`, gate, and frame data remain untrusted until
an integrated CPU producer is separately reviewed and guest-qualified.
Neither a loaded-text cut nor this model proves caller-owned CALL/RET edges,
software INT 2F discovery, DPMI INT 31 service results, or return to a shell.

Run the bounded pure control with
`node scripts/i80386-cwsdpmi-interrupt-journal-model/journal-control.mjs`.
