# Resource admission for large local work

Before a substantial build, optimization, profile or benchmark on the shared
VPS, check load averages, **available** memory and disk space. Do not start it
unless capacity permits. Light receipt inspection and small unit tests can
continue while large work is deferred to CI. This is an execution constraint,
not permission to delete another task's files, and not a speed/fidelity verdict.

```sh
node scripts/check-local-resources.mjs --kind build --path "$PWD" --path /tmp
node scripts/check-local-resources.mjs --kind benchmark --path "$PWD" --path /tmp
```

Use every filesystem that will hold output, compiler caches or temporary files.
The command emits a timestamped JSON sample and exits nonzero if work should
not start. Check **immediately before** each large task; a previous passing
sample is not a reservation and conditions can change mid-run.

Conservative defaults: 1/5-minute loads must each be at most 75% of the
affinity-available CPU count, and 15-minute load at most that count. A large
build requires 4 GiB available memory and 20 GiB available disk on each named
filesystem; a benchmark requires 2 GiB memory and 4 GiB disk. Budget task-specific
peaks and other users' needs too; a passing check is not a capacity guarantee.
Restrict compiler parallelism to its actual memory budget. Linux MemAvailable
includes reclaimable cache, unlike MemFree; filesystem bavail excludes reserved
blocks. Missing/invalid samples refuse work. The CLI is Linux-oriented and has
no force/bypass flag.

This helper does not inject checks into existing pinned performance harnesses,
alter historical receipts, or modify production/CI defaults. Call it as a
precondition to new substantial **local** runs. Keep resource diagnostics outside
timed guest windows and preserve the sample with the run's provenance. Avoid
overlapping owned local builds, optimizers, profiles and ordinary benchmarks.
