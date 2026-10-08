# AX=0501 frame controller source checkpoint

This unconnected checkpoint prepares a narrow controller for one owned DPMI
`INT 31h` AX=0501 delivery and matching protected 32-bit IRET. It has no AT
guest result, workflow, or source-closure admission yet. The earlier finite
high-memory client result does not establish interrupt-frame ownership.

`admitFreshWrapper` calls the unchanged fresh executable/map/compile admission
and immediately copies the authenticated `allocateMemory` extent and expected
bytes into private state. Public `layout.roles` and `layout.textBytes` can be
mutated later and are not authority. `compareWrapperSnapshot` compares a
caller-supplied whole-text copy against that private wrapper. It also checks
the inherited private diagnostic on a whole-text mismatch, while the
whole-text exact case is checked directly. The result is a byte-comparison
receipt. It does not authenticate that the caller paused the real machine,
read ordinary RAM, or preserved CPU/board state. A future driver must own the
synchronous between-step passive read and unchanged-state fingerprint.

The CPU-free policy accepts one source-owned opportunity after an admitted
main cut. It arms the optional CPU journal at the wrapper address, polls only
after ordinary machine steps, drains once on completion or invalidation, and
requires the committed AX=0501 pair before it can accept the same-session
strict client result. The returned CF must be clear and returned BX:CX must
equal the client's strictly parsed linear address. Delivered saved flags,
consumed frame flags, and actual returned flags remain separate fields. A
pre-step wrapper PC is only an opportunity: the board can service an IRQ
before the CPU executes the next instruction. The CPU's decoded committed
event, not that pre-step PC, must establish delivery.

The pure test supplies synthetic records. It verifies policy ordering and
negative cases; it does not import or execute the CPU, establish guest
provenance, prove physical frame identity, or qualify other DPMI services.
