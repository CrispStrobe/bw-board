# Cold direct RAM paired timing gate

This is a proposed, unrun timing gate for the guest-qualified ABI5 direct RAM
profile. The qualified CPU3 source is fixed at
`acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1`. The harness has its own
reviewed head and never relabels that head as the guest-qualified source.

The gate authenticates the original three-arm actual artifact and independently
replays all 91,958 journal writes against the initial 16 MiB RAM before any
timing child. It then rebuilds the direct addon from the qualified source and
authenticates the fresh static build receipt, checks the separately pinned
compact companion addon, compiles the owner addon from the qualified source,
binds its toolchain/source/build receipt, and
runs the current-source ordinary JavaScript machine as the adoption baseline.
Every child runs in a fresh process, checks its exact source, addon, ROM/config,
and reference roles, and completes full reset/terminal CPU, board, RAM and
ordered PIO checks before its duration may enter the summary. Failures preserve
the child input, invocation, stdout, stderr, partial receipt and exit result.
The native children observe CPU/provider closure. The ordinary JS machine has
no close API, so its termination claim is limited to the child's successful
exit and empty owned process group, measured by the parent with `wait4`.

Each comparison has two warm-up pairs and seven measured pairs, alternating
arm order. `direct-v-companion` is descriptive. Only `direct-v-plain-js` applies
the lane's 10% lower mean execution CPU and all-seven-faster adoption gate.
Execution process CPU/wall, process startup CPU/elapsed time, and whole-child
CPU/wall are separate. The fixed configured clock is not a physical 386 speed
calibration.

The timed direct provider is an authenticated derivative of the qualified
provider. It removes per-write JSON diagnostic record construction from the
execution interval, retaining the 400,000-entry bound as a scalar count,
native owner journal, copied batch validation, generation Map, ACK and clock
callbacks. Original provider bytes, inverse transform, two imported dependency
hashes, normalized derivative hash and loaded-module hash are bound in each
direct child receipt. The companion provider has no comparable raw journal
record allocation. This timing variant requires its own per-child semantic
qualification and cannot be cited as timing of the unmodified actual-fixture
provider.

The labeled workflow is dormant until a reviewer applies
`x86-direct-ram-paired` to a same-repository PR at its exact reviewed head.
It uses read-only permissions and uploads source/notice and bounded result
evidence, without publishing addon binaries. A gate failure leaves ordinary
JavaScript as the default. A successful quantitative result would still be
limited to this exact free BIOS slice and host.

Bounded source controls, without a guest or addon build:

```sh
python3 -B scripts/cold-direct-ram-paired/policy_control.py
node --check scripts/cold-direct-ram-paired/direct-provider.mjs
```
