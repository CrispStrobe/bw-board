# Cold CPU3 direct-RAM source/control checkpoint

**Source-integrated; guest unqualified.** This directory now derives a distinct ABI 5 CPU3 runtime and N-API translation unit, with a same-DSO RAM/ROM owner and an actual JavaScript cold-board provider. The generated native source compiles with a bounded stub, and the C++ model and N-API adversarial controls pass. No Bochs CPU3 addon or affected guest has yet run for this profile. The existing companion addon and ordinary JS path remain unchanged. No guest parity or speed result follows from these controls.

`bridge.h` compiles the existing `bochs-cpu3-native-cold-owned-ram/owned-ram.h` into the same C++ model. `abi.h` pins the companion header SHA-256, profile, extent and journal capacity. A Session copies the initial 1.5 MiB RAM and 64 KiB ROM, and a unique full-initial Shadow belongs to it. The Bridge admits a single 16 MiB board view with a distinct generation view, and copies its four object/buffer identity tokens; borrowed byte pointers are used only during synchronous binding or commit. The derived N-API retains strong references to the exact typed-array objects and ordinary ArrayBuffers, then re-resolves identity, backing and extent at each synchronous commit.

Each memory request is checked against fixed A20, ROM/open-bus/RAM decode, the complete one-page span, source-validated N/Q, exact next effect, owner sequence watermarks and generation. MMIO is excluded. The source `pending_writes` field is the CPU3 alias/publication ledger, **not** the owner journal: CPU3 clears it at its instruction boundary, while the owner can reconcile at a clock/page/scalar observer. The model only bounds that source count. It does not increment or clear CPU3's pending writes. A full owner journal returns an uncommitted retry before owned RAM mutation; the same effect and bytes must be retried after reconciliation. A committed write cannot be replayed. The ROM-only page method requires the owner journal to have been acknowledged and consumes a single-use page ticket from an admitted page boundary.

`prepare` checks phase, observer reason, complete clock tape and final N/Q, due/deadline, whole ROM page and exact PIO scalar arguments before draining a copied journal. A PIC ACK reason is forbidden. `commit` validates the exact copied, session/ticket-bound batch and all borrowed board bytes/generations before acknowledging the private shadow or updating board bytes; its fixed C++ commit loop makes no callbacks. The actual provider stages a copy of the generation Map before native ACK, preserving first-touch order; any post-ACK JavaScript failure poisons the session. Observer and property-getter reentry are denied, and failure closes the model to further effects. A malformed pending-write observer therefore cannot acknowledge or mutate the board. The existing companion `Session::before_observer` is not used here.

Run the bounded controls from the repository root:

```sh
g++ -std=c++17 -O0 -pthread -Wall -Wextra -Werror \
  scripts/bochs-cpu3-native-cold-direct-ram/mock.cc -o bw-cold-direct-ram-mock
./bw-cold-direct-ram-mock
```

The mock tests copied memory and ROM aliases, cross-session/alternate/detached/shared/wrong-span board denial, MMIO and RAM-execute denial, malformed observer admission with a pending write, late-entry batch tampering and board-byte conflict, full-capacity exact retry, pending-effect close denial, distinct source/owner ledgers, reentry and fail-stop behavior. A separate control exercises the companion core's committed code-write fence; that path is outside the ROM-execute-only direct profile. These are pure C++ controls. They do **not** establish that JavaScript `Map` generations or board writes form a nonthrowing transaction.

On a Linux host with Node development headers, set `NODE_HEADERS` to that installation's include directory, then build the bounded N-API stub and run each scenario in its own process:

```sh
node scripts/bochs-cpu3-native-cold-direct-ram/napi-control-materialize.mjs build/direct-ram-control
g++ -std=c++17 -O0 -fPIC -shared -Wall -Wextra -Werror \
  -I"${NODE_HEADERS:?set Node development header directory}" -Ibuild/direct-ram-control \
  build/direct-ram-control/bochs-cpu3-native-direct-board-adapter/napi.cc \
  build/direct-ram-control/bochs-cpu3-native-cold-direct-ram/napi-control-stub.cc \
  -o build/direct-ram-control/direct-control.node
for scenario in normal rom-detach recursive-create recursive-commit duplicate-commit \
  valid-overlap late-tamper ticket-mismatch session-mismatch; do
  node scripts/bochs-cpu3-native-cold-direct-ram/napi-control.mjs \
    build/direct-ram-control/direct-control.node "$scenario"
done
node scripts/bochs-cpu3-native-cold-direct-ram/provider-control.mjs
```

The stub verifies same-DSO N-API object/backing binding, ROM copy before getters, swallowed recursive create/commit denial, one-shot commit, copied batch ticket/session checks, pending-write late-byte tamper with zero board/gen publication, and same-page generations. A duplicate after an accepted empty commit is a terminal fail-stop case; it does not claim rollback of that first acknowledgement. The actual provider control separately checks staged overlapping writes and generation Map insertion order against its real cold-board object.

`runtime.mjs` derives the compact/fused source while replacing only its physical-memory callback path. `napi.mjs` derives the compact-progress N-API, retaining full 166-word snapshots and progress. `owner.inc` binds the owner inside that same DSO; `provider.mjs` retains the real cold clock, page, PIO and device callbacks. These derivations authenticate their held inputs and reverse exactly to those inputs. The source alias/publication ledger and owner journal remain separate. A full owner journal uses a distinct native pre-effect retry context, not a synthetic clock query. The source controls still use model arguments; the stub controls do not execute Bochs or prove that every real CPU3 source phase and JavaScript board callback passes. A clean affected cold guest, exact report parity, closed-owner evidence and later same-host paired timing are mandatory next gates.
