# Selected QEMU setup-input inventory v1

This is an initially disabled, read-only metadata observation. It never installs a package, runs a helper or QEMU, changes platform state, admits a runtime candidate or approves setup. The former absent-QEMU event stays consumed. The packet is useful only with an independently selected official job and immutable source/request expectation.

## Closed wire format

All JSON uses UTF-8, sorted keys, compact separators and no NaN (`canonical`), with no trailing newline in the immutable request bytes. The disabled CLI accepts only `--request <owned-path> --expected-sha256 <hash>`; after the literal guard, it lstat-checks an owned regular single-link request, opens with NOFOLLOW and NONBLOCK, reads at most 65,537 bytes, verifies held/named before/after identity and close, refuses any request over 65,536 bytes, and compares exact canonical bytes with the preadmitted digest before parsing or collecting host data. SHA-256 values are lowercase 64 hex digits. A string is exact bytes after UTF-8 encoding. Unknown facts use `null`; a missing member is invalid. The producer emits one `bw.i80386-qemu-setup-inventory-original.v1` JSON object as a single stdout line: canonical body plus exactly one LF is at most 2,097,152 bytes (body at most 2,097,151). It emits no other stdout. The reader imports no producer. Both reject extra keys throughout.

The external immutable request is `bw.i80386-qemu-setup-inventory-request.v1` with exactly `schema`, `repository`, `source`, `selection`, `context`, `limits`. `repository` is `CrispStrobe/bw-board`. `source` has `head` and `tree` full Git hex IDs plus `files`: an exact map of these five repository paths to lowercase SHA-256 of their file bytes: `scripts/i80386-qemu-setup-inventory/run.py`, `reader.py`, `controls.py`, `README.md`, `.github/workflows/i80386-qemu-setup-inventory.yml`. It is external review input; the workflow checks Git HEAD/tree and the collector hashes all five local files before collection. `selection` has `packageVersion`=`1:8.2.2+ds-0ubuntu1.18`, `architecture`=`amd64`, `controlSha256` mapping `qemu-system-x86`=`4075ae4d677d10506b036fd0a7736ad771ba13b179cd02f389ec60615f390e71` and `qemu-system-common`=`90475094295b1c50fbf48f0ff189824e34e92effc7334af5239e49eedc7fc8d5`, and `directDependencyNames`: the sorted 37-name immutable list below. These are source-control facts, not a resolved transaction. `context` has exactly `eventName`=`workflow_dispatch`, `repository`=`CrispStrobe/bw-board`, `job`=`qemu-setup-inventory`, `runAttempt`=`1`, `workflowSha` full Git hex, `workflowRef` nonempty bounded string, `actor` nonempty bounded string. The later official numeric job ID belongs to the external expectation, never this pre-event request. `limits` has `cpuSeconds`=10, `wallSeconds`=30, `fileBytes`=8388608, `hashBytes`=67108864, `outputBytes`=2097152 and `statusRecords`=5000.

The original has exactly `schema`, `requestSha256`, `source`, `context`, `image`, `files`, `status`, `flags`, `failure`, `secondary`. `source` repeats the verified `source` request object. `context` contains only request context fields plus `runId` (actual positive decimal `GITHUB_RUN_ID`), `runnerOS` and `runnerArch` (whitelisted `RUNNER_OS`/`RUNNER_ARCH`), never a hostname or full environment. `image` has `imageOS`, `imageVersion`, `osRelease`, `etcOsRelease`: the first two are the explicitly selected `ImageOS`/`ImageVersion` strings or null; latter two are file observation keys. Missing image fields remain unknown and forbid a complete verdict. `files` maps only the fixed paths below to a file observation: `{kind:"regular",namedBefore:<stat>,heldBefore:<stat>,heldAfter:<stat>,namedAfter:<stat>,closed:true,sha256:<hash>,text:<UTF-8 string|null>}`, `{kind:"alias",target:<string>,namedBefore:<lstat>,namedAfter:<lstat>}`, `{kind:"directory",namedBefore:<stat>,namedAfter:<stat>}`, `{kind:"absent"}`, or `{kind:"error",code:<bounded string>,partial:<partial>}`. The error partial has exactly `namedBefore`, `heldBefore`, `heldAfter`, `namedAfter` (stat or null), `bytesRead` (nonnegative integer), `prefixSha256` (hash of actually read bytes, including empty), `closeAttempted` and `closed` booleans. The first `failure` stays primary and `secondary` retains a close error when both occur. Each stat has exactly `dev`, `ino`, `uid`, `gid`, `mode`, `nlink`, `size`, `mtimeNs` as nonnegative integers. The collector must use lstat, NOFOLLOW open, fstat before/after bounded read, named lstat readback and close, preserving changed-identity and close errors. An alias is a witness, never silently followed or a proof of its terminal file. Text is retained only for selected bounded UTF-8 metadata/scripts; ELF/binary text is null. `status` is null on pre-status failure; otherwise it has `encoding`=`zlib+base64`, `rawBytes`, `sha256`, `packed` and `selected`: an exact map for 38 selected package names to a list of **all** matching `{package,architecture,version,status,depends,preDepends,recommends,provides}` rows, sorted by architecture; missing is `[]`. The raw status enforces unique Package+Architecture records but does not select an architecture, provider or transaction. The complete raw status is zlib-packed only after a strict <=8 MiB read and <=5000 unique Package+Architecture record parse. The reader decompresses within caps and reparses without importing collector logic. `flags` has exactly `setupApproved`, `runtimeCandidate`, `actualRunApproved`, `toolExecuted`, `guestExecuted`, `platformMutated`, all false. `platformMutated:false` reports that this collector makes no package, service or privileged platform mutation attempt; it does not prove global host immutability, absence of access-time updates or background activity. `failure` is null or `{stage,code}`; `secondary` is a bounded array of such errors. A partial result retains observed data and a failure; it never becomes an approval.

The external reader expectation is `bw.i80386-qemu-setup-inventory-expectation.v1` with exactly `schema`, `requestSha256`, `source`, `official`: official has `repository`, `head`, `tree`, `workflowSha`, `workflowRef`, `runId`, `runAttempt`, `jobId` (positive decimal string, at most 20 digits and <=2^63-1), `jobName`, `eventName`, `actor`, `conclusion` fixed independently from official metadata. A reader verdict always fixes all six flags false and reports only observed data completeness/refusal. It does not turn an official SUCCESS or an internally complete packet into setup approval.

## Fixed observation set

Read `/usr/lib/os-release`, `/etc/os-release`, `/var/lib/dpkg/status`, `/bin`, `/bin/sh`, `/usr/bin/sh`, `/usr/bin/dash`, `/usr/bin/deb-systemd-helper`, `/usr/bin/deb-systemd-invoke`, `/usr/bin/dpkg-maintscript-helper`, `/usr/bin/systemctl`, `/usr/sbin/invoke-rc.d`, `/usr/sbin/update-rc.d`, `/usr/sbin/policy-rc.d`, `/var/lib/dpkg/info/dpkg.list`, `/var/lib/dpkg/info/init-system-helpers.list`, `/var/lib/dpkg/info/systemd.list`, `/var/lib/dpkg/info/dash.list`, `/run/systemd/system`, `/usr/lib/systemd/system/qemu-kvm.service`, `/lib/systemd/system/qemu-kvm.service`, and `/etc/init.d/qemu-kvm`. Absent entries and aliases are explicit. Service-helper, maintscript-helper and shell paths are selected for exact byte/identity observation; no invocation. The unit and systemd directory are state witnesses, not stable leases. `/usr/sbin/ldconfig` is an indirect candidate, not assumed relevant from these two control scripts. The four fixed package file lists are raw data witnesses for the `dpkg-maintscript-helper` (dpkg), `deb-systemd-helper` and `deb-systemd-invoke` (init-system-helpers), `systemctl` (systemd), and `dash` (dash) candidate ownership. A listed path is not an installed-byte guarantee. `/bin/sh` alternatives/diversions and interpreter/dynamic dependency closure require later exact selected-runner review if this finite packet cannot establish them.

The immutable 37 direct dependency names, taken from the two selected control records, are:

```
acl
ipxe-qemu
libaio1t64
libasound2t64
libbpf1
libbrlapi0.8
libc6
libcacard0
libcap-ng0
libfdt1
libfuse3-3
libglib2.0-0t64
libgmp10
libgnutls30t64
libhogweed6t64
libibverbs1
libjpeg8
libncursesw6
libnettle8t64
libnuma1
libpixman-1-0
libpmem1
libpng16-16t64
librdmacm1t64
libsasl2-2
libseccomp2
libslirp0
libtinfo6
libudev1
liburing2
libusb-1.0-0
libusbredirparser1t64
libzstd1
qemu-system-common
qemu-system-data
seabios
zlib1g
```

## Execution boundary and controls

`INVT_ENABLED` is a literal false source guard. Every live entry checks it before environment, filesystem, source or output access. Tests replace the guard and inject all filesystem/time/environment operations as tiny in-memory fakes; tests never observe the executing host. The wall/CPU limits are cooperative checks, not a hard timeout, preemption or continuous ownership lease. The workflow itself starts with a literal false job guard. No subprocess, apt, dpkg, ldd, helper, QEMU, guest, service, privilege or resource operation is allowed in either controller or reader. No event is dispatched by source qualification.
