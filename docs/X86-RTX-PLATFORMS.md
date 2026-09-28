# Media-free x86 platform benchmark

`node scripts/bench-x86-platforms.mjs --steps 1000000 --passes 3` runs the
same five-instruction real-mode loop on the 8086 and experimental 386 cores,
and through their board machine paths. It uses no BIOS, DOS, disk, or network.
The JSON includes the source revision, dirty flag, host CPU model, Node version,
run times, guest state, instructions per second, and virtual factor. Each path
gets an excluded warmup followed by the requested measured passes; the factor
uses the median wall time. The default comparison clocks are a 4.772727 MHz XT
and a declared 16 MHz 386 AT profile.

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
archive on `/kaggle/input`, so it does not rely on Kaggle worker internet.
Both runs execute Node on the CPU; the GPU model is recorded but no GPU kernel
is used. A Kaggle script push immediately starts a run and uses quota, so only
push after the source dataset and kernel metadata are ready.
