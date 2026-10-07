# DJGPP/CWSDPMI source and notice candidate audit

This is a report-only continuation of `scripts/i80386-cwsdpmi-owned/`. It does
not compile the owned client, install or run a toolchain, launch a guest, or
settle component redistribution obligations. The preceding acquisition run
measured candidate archive bytes but included no toolchain notices.

The dedicated labeled workflow authenticates the exact PR head and unchanged
stage-A source, then re-downloads the same FreeDOS CWSDPMI and build-djgpp
toolchain archives. Their stage-A SHA-256 values and selected member hashes are
mandatory before source comparison. It inventories CWSDPMI's nested source ZIP,
the versioned DJCRX205, DJDEV205 and DJLSR205 source archives, and bounded text
notices. Only reports, small text notices and the pinned builder script enter
the artifact. Source archive SHA-256 values are **new candidate measurements**,
not compilation pins. The workflow cannot run on an ordinary PR push; the
dedicated label is applied after review.

`input-manifest.json` records bounded ordinary input sizes and SHA-256 values
before archive admission. Incremental role/source reports and `failure.json`
retain the first rejected phase and observed hashes without uploading archives;
the exact rejected bytes are not retained in this report-only packet.

The pinned [build-djgpp 12.2.0 script](https://github.com/andrewwutw/build-djgpp/blob/0dc28365825f853c3cc6ad0d8f10f8570bed5828/script/12.2.0)
names DJCRX205, DJDEV205 and DJLSR205, and copies DJCRX `include` and `lib`
into the target prefix. This audit compares `dpmi.h`, `crt0.o` and `libc.a`
from DJCRX against the measured stage-A toolchain members. A mismatch or
missing/duplicate role remains an explicit negative result; it cannot be
promoted to byte-origin proof. GCC 12.2.0 `libgcc.a` is pinned as a toolchain
member but needs its own source and runtime-exception review.

The [DJGPP copying terms](https://www.delorie.com/djgpp/dl/ofc/simtel/v2/copying.dj)
and [redistribution guide](https://www.delorie.com/djgpp/doc/ug/basics/copy-redist.html)
differentiate runtime libraries, toolchain components and their source
obligations. The CWSDPMI package's `COPYING.CWS` and nested `SOURCES.ZIP` are
preserved as exact member hashes and bounded notice/source inventories; neither
an archive inventory nor a filename establishes complete source correspondence
or legal clearance. Do not distribute the prebuilt toolchain or a linked
client on this evidence alone.

Local source-only controls, without downloading component archives:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/i80386-cwsdpmi-source-notice/source_control.py
```

The source identity command is meaningful on a committed clean checkout:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/i80386-cwsdpmi-source-notice/source_identity.py "$(git --no-replace-objects rev-parse HEAD)" source-identity.json
```

The output file is disposable local evidence and should remain untracked.
