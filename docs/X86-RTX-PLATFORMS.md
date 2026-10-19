# Media-free x86 platform benchmark

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

`node scripts/bench-x86-platforms.mjs --steps 1000000 --passes 3` runs the
same five-instruction real-mode loop on the 8086 and experimental 386 cores,
and through their board machine paths. It uses no BIOS, DOS, disk, or network.
The JSON includes the source revision, dirty flag, host CPU model, Node version,
run times, guest state, instructions per second, and virtual factor. Each path
gets an excluded warmup followed by the requested measured passes; the factor
uses the median wall time. The default comparison clocks are a 4.772727 MHz XT
and a declared 16 MHz 386 AT profile.

The first VPS receipt is [here](receipts/2026-09-28-x86-platform-vps.json).
It records a KVM Skylake 4-vCPU host running Node 20.20.2 at source revision
`853c667de3f7025eb3bc6342d1c7f5f1e74b76cf`.
The [GitHub receipt](receipts/2026-09-28-x86-platform-gh.json) and
[runner CPU details](receipts/2026-09-28-x86-platform-gh-lscpu.txt) are from
[run 36422589375](https://github.com/CrispStrobe/bw-board/actions/runs/36422589375)
at source revision `6b74b9364e706ca11e00178e6e67e22f619aac67`: an AMD
EPYC 7763 runner with four logical CPUs and Node 22.23.2. Its 8086 core and
machine measured 47.19× and 29.84× XT; the 386 core and AT machine measured
0.253× and 0.839× configured virtual time under the synthetic charges.

The 8086 factor uses estimated instruction cycles. The 386 executor has no
measured 80386 instruction timing: its core assigns one cycle per instruction,
and the board charges six synthetic scheduling cycles. The 386 factors are
throughput under those configured charges.

The `X86 platform throughput` GitHub workflow can be started with
`gh workflow run x86-rtx-platforms.yml --ref <branch>`. Download its JSON and
`lscpu` receipts with `gh run download <run-id> -n
x86-platforms-<sha>-<attempt>`. GitHub's runner image is Ubuntu 24.04 with
Node 22, but the CPU model is recorded from the allocated runner rather than
assumed from the image name.

For Kaggle, first make a source dataset from an exact committed revision:

```sh
mkdir -p x86-kaggle-bundle
mkdir -p x86-kaggle-bundle/source
git archive --format=tar HEAD package.json src scripts/bench-x86-platforms.mjs \
  | tar -xf - -C x86-kaggle-bundle/source
git rev-parse HEAD > x86-kaggle-bundle/source/source-revision.txt
tar -C x86-kaggle-bundle/source -czf \
  x86-kaggle-bundle/bw-board-x86-bench.tar.gz .
sha256sum x86-kaggle-bundle/bw-board-x86-bench.tar.gz
```

Upload the directory as a Kaggle dataset with its usual `dataset-metadata.json`,
then attach that dataset to a script kernel whose `code_file` is
`scripts/kaggle/x86-rtx-platforms.py`. Use `enable_gpu: "false"` for the CPU
run and `enable_gpu: "true"` for the GPU-attached run. The runner uses the
source on `/kaggle/input` (Kaggle may unpack the archive at upload), so it does
not rely on Kaggle worker internet.
Both runs execute Node on the CPU; the GPU model is recorded but no GPU kernel
is used. A Kaggle script push immediately starts a run and uses quota, so only
push after the source dataset and kernel metadata are ready.

## Kaggle receipts

Both Kaggle runs used bundle revision `853c667de3f7025eb3bc6342d1c7f5f1e74b76cf`
with Node 20.19.0 and four logical CPUs. The [CPU run](https://www.kaggle.com/code/chr1s4/bw-board-x86-rtx-cpu)
reported a Xeon at 2.20 GHz; the [GPU-attached run](https://www.kaggle.com/code/chr1s4/bw-board-x86-rtx-gpu)
reported a Xeon at 2.00 GHz and two Tesla T4s. Raw [CPU](receipts/2026-09-28-x86-platform-kaggle-cpu.json)
and [GPU-attached](receipts/2026-09-28-x86-platform-kaggle-gpu.json) JSON
receipts preserve all three pass times and final guest state.

| Path | Kaggle CPU instructions/s | Kaggle GPU host instructions/s |
|---|---:|---:|
| 8086 core | 14.18 M | 16.61 M |
| 8086 machine | 7.82 M | 9.28 M |
| 386 core | 2.64 M | 3.20 M |
| 386 AT machine | 1.48 M | 1.85 M |

The GPU column measures its CPU host. On this loop, 8086 XT factors were
29.12×/16.06× on the Kaggle CPU host (core/machine) and 34.11×/19.05× on the
GPU host. The 386 configured virtual-time factors were 0.165×/0.556× and
0.200×/0.692×, respectively, under the synthetic one/six-cycle charges.


## Hosted ordinary-JS diagnostic — 2026-10-14

[Run38628917093](https://github.com/CrispStrobe/bw-board/actions/runs/38628917093)
passed root and independent original-packet consistency audits at
[source c2f0936d](https://github.com/CrispStrobe/bw-board/blob/c2f0936d5fcc22e3757531eeaa30828413a6ede7/scripts/bench-x86-platforms.mjs).
The media-free five-operation real-mode loop used one million steps, three
measured passes and an excluded warmup. All four paths reached AX65534,
BX65535, IP0 and memory word65535. This covers functional core/machine paths,
not all 8086 variants, 32-bit/protected-mode execution or an operating system.

| Path | Million instructions/s | Configured model factor |
|---|---:|---:|
| 8086 core | 28.608730 | 58.743263 |
| 8086 machine | 19.016350 | 39.046907 |
| 386 core | 7.262239 | 0.453889958 |
| 386 AT machine | 3.863230 | 1.448711336 |

The allocated EPYC9V74 runner had four logical CPUs and Node22.23.3; this
run had no enforced one-CPU cgroup quota. These timed-loop rates exclude
startup/setup. The 386 core charges one synthetic unit per instruction;
the AT scheduler charges six. Their factors against the declared 16 MHz
profile therefore are not physical clock throughput or comparable speed-target
measurements. The core-versus-AT gap does not establish a CPU cost share.

The sole [original artifact11925262354](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11925262354)
is 2245 bytes, SHA256 `7f5124e6aefaea6fe082e1cc30ce1b4ca519e33f74a830ce9a6a8bc2d87c1da6`.
This current-source diagnostic is GitHub-only; the historical VPS and Kaggle
receipts above retain their own source/runtime/workload scope.
The separate [guarded-fetch paired result](X86-NEXT-LANES.md#guarded-word-fetch-public-paired-measurement)
used EPYC7763, Node20.20.2, enforced one-CPU resources and whole-Node timing
for another authored workload. Its approximately 12.6% isolated gain cannot
be inferred from or combined with these absolute loop rates.

Next: coordinate Lite pin adoption with the shared package-path owner and
qualify the installed consumer separately. An AT-platform profiling hypothesis
is proposed only; a separate merged scope is required before implementing or
running it. No additional profile, benchmark or GUI adoption is reported here.

## Adopted literal-mask operational checkpoint — 2026-10-15

The sole [run38711737457](https://github.com/CrispStrobe/bw-board/actions/runs/38711737457)
succeeded on merged source `bfe99d562e9b57a819ec92025faafba271b8751c`, after
isolated literal-mask adoption. Original metadata, artifact, arithmetic and
three source roles (benchmark, workflow and CPU) passed independent review.
The CPU SHA256 is `8f92cc4f8117d2371b493a7ee5a49dbf0245d1367f050194680f68a1454a9846`.
The benchmark and workflow bytes match the prior operational checkpoint.

Node **22.23.3** ran on an AMD EPYC **7763** runner exposing four logical CPUs.
Each row has one excluded warmup and three timed-loop-only passes of one million
ordinary real-mode instructions. The five-operation loop is INC AX; store AX;
load BX; ADD AX,BX; jump. All four rows ended AX=65534, BX=65535, IP=0 and
stored word=65535. Medians and IPS were independently recomputed from originals.

| Path | Median seconds | Instructions/s | Clock charge | Configured factor |
|---|---:|---:|---:|---:|
| 8086 core | 0.059013206 | 16,945,359.654 | 9,800,000 estimated cycles | 34.794473811 |
| 8086 machine | 0.062821716 | 15,918,062.474 | 9,800,000 estimated cycles | 32.685090147 |
| 386 core | 0.154174266 | 6,486,166.764 | 1,000,000 synthetic cycles | 0.405385423 |
| 386 AT machine | 0.375633840 | 2,662,166.966 | 6,000,000 synthetic scheduling cycles | 0.998312612 |

IPS is instructions divided by median loop seconds. Configured factors divide
charged cycles by median seconds and configured clock: 4,772,727 Hz for 8086,
16,000,000 Hz for 386. The 386 charges are one and six synthetic cycles per
completed instruction; they are not measured physical 386 timing. This covers
the four named paths, not every wired/functional 8086 variant, protected mode,
a full OS, whole-process CPU cost or a calibrated physical RTx result. No quota,
affinity or complete source-graph authentication is asserted by this workflow.

The earlier operational run used EPYC 9V74 hardware. These independently
observed checkpoints are not a paired experiment; do not infer a speedup or
regression ratio between them. The separate authored paired gate retains its
own workload and limits.

The sole [artifact11963296391](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11963296391)
is 2173 bytes, ZIP SHA256
`bdb9984286d5a8d480e9861ec432b67a27e72979159fe7771fe4f05779b24e3b`.
No benchmark retry, guest replay or consumer pin update was needed for this
original-byte checkpoint.
