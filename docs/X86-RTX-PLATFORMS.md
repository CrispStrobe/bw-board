# Media-free x86 platform benchmark

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
throughput under those configured charges. This real-mode loop says nothing
about 32-bit protected-mode, paging, or DOS/Windows boot speed.

The `X86 platform throughput` GitHub workflow can be started with
`gh workflow run x86-rtx-platforms.yml --ref <branch>`. Download its JSON and
`lscpu` receipts with `gh run download <run-id> -n
x86-platforms-<sha>-<attempt>`. GitHub's runner image is Ubuntu 24.04 with
Node 22, but the CPU model is recorded from the allocated runner rather than
assumed from the image name.

For Kaggle, first make a source dataset from an exact committed revision:

```sh
mkdir -p /mnt/volume1/x86-kaggle-bundle
mkdir -p /mnt/volume1/x86-kaggle-bundle/source
git archive --format=tar HEAD package.json src scripts/bench-x86-platforms.mjs \
  | tar -xf - -C /mnt/volume1/x86-kaggle-bundle/source
git rev-parse HEAD > /mnt/volume1/x86-kaggle-bundle/source/source-revision.txt
tar -C /mnt/volume1/x86-kaggle-bundle/source -czf \
  /mnt/volume1/x86-kaggle-bundle/bw-board-x86-bench.tar.gz .
sha256sum /mnt/volume1/x86-kaggle-bundle/bw-board-x86-bench.tar.gz
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
