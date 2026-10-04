# Loading freely licensed software on x86 machines

This guide separates the available loaders. Use your own fixtures or freely licensed software such as FreeDOS, ELKS or xv6, together with BIOS/media whose licenses permit your use. A DOSBox configuration is a partial import format here; importing it does not provide DOSBox compatibility. A CPU model, a board profile and a software loader are separate choices.

## Choose a path

| Path | Loader | Scope |
| --- | --- | --- |
| Functional 8086/80186/80286 DOS services | `scripts/run-dos.mjs` | Loads a `.COM` or MZ `.EXE` directly; implements DOS services without booting an OS disk. |
| Functional 8086 board | `I8086Machine`, `runI8086FloppyBundle` | BIOS and floppy hardware path; the floppy bundle requires caller-supplied BIOS bytes. |
| Experimental 80286 AT boot | `PCAT80286_BOOT` / `PCAT80286_BOOT_640K` | Separate experimental reset/protected-mode board profile; selecting `--variant 80286` in the DOS runner does not select this boot profile. |
| Experimental functional 386 AT | `scripts/run-i80386-at-console.mjs` | Pinned BIOS, VGA BIOS and raw CHS HDD; bounded instruction run or live terminal. |
| Wired circuit execution | Frontend machine config with `executionMode: "wired"` and `circuit.ref` | Runs a circuit configuration. Functional disk/OS acceptance does not establish wired execution of that software. |
| Native 386 addon | Fixed, source-authenticated diagnostic runners | Bounded reviewed fixtures and cold-board captures. There is no general GUI or DOSBox-package loader for these addons. |

The `--native-blocks` console option selects `src/experimental/i80386-native-dispatch.js`; it is separate from the Bochs Node addon. `--code16-wasm` selects a distinct code16 WebAssembly dispatcher. Neither option grants the fixed native addon a general OS-loading interface.

## CLI: direct DOS programs

From the repository root, supply a freely licensed program you already have:

```sh
node scripts/run-dos.mjs path/to/program.com --variant 8086 --preset xt --max 1000000 --screen
node scripts/run-dos.mjs path/to/program.exe --variant 80286 --preset at --screen
```

`--keys "text"` preloads keyboard input. Repeat `--file PATH` or `--file DOSNAME=PATH` to supply files to the in-memory DOS filesystem; `--out DIR` saves files created by the program. The default instruction budget is 20,000,000. Exit status is the DOS program's exit code, or 2 when the budget expires without termination. This runner is the functional DOS-service tier, not a BIOS boot or physical timing measurement.

A minimal configuration beside `program.com` is:

```ini
[dosbox]
machine=cga
[cpu]
cycles=3000
[autoexec]
mount c .
c:\program.com
```

```sh
node scripts/run-dos.mjs --dosbox-conf path/to/dosbox.conf --variant 8086 --screen
```

This CLI resolves `mount` paths relative to the configuration directory and selects the first `.COM`/`.EXE` command. It does not execute the autoexec as a host shell. `machine` chooses an XT-like or AT-like preset; `cycles` is recorded, not a DOSBox speed-control implementation. The command-line variant remains authoritative. Program selection does not recursively mount all files in the host directory: use `--file` for additional inputs. ZIP packages are not unpacked by this runner.

## CLI: experimental 386 raw HDD boot

The console requires external files and their SHA-256 hashes. Example paths below are placeholders for your freely licensed BIOS, VGA BIOS and prepared FreeDOS raw HDD:

```sh
AT_BIOS_ROM=/absolute/path/bios.bin AT_BIOS_SHA256=BIOS_SHA256 \
VGA_BIOS_ROM=/absolute/path/vgabios.bin VGA_BIOS_SHA256=VGA_SHA256 \
AT_HDD_SHA256=HDD_SHA256 \
node scripts/run-i80386-at-console.mjs \
  --hdd-image /absolute/path/freedos.img --geometry 615,4,17 --steps 1000000
```

Replace every hash placeholder with the actual 64-digit hash. The system BIOS must be 64 KiB. The HDD byte length must equal cylinders × heads × sectors × 512. The geometry limits are 1–1024 cylinders, 1–16 heads and 1–63 sectors. `--live` enables the terminal; `--steps` sets the instruction budget.

The console's **different** DOSBox parser accepts one HDD declaration, for example:

```ini
[autoexec]
imgmount 2 "freedos.img" -t hdd -fs none -size 512,17,4,615
boot -l c
```

Use `--dosbox-conf path/to/config.conf` instead of the direct image/geometry options; the BIOS/VGA/HDD hash environment is still required. Image paths resolve relative to the config directory. `-size` is bytes-per-sector, sectors, heads, cylinders, unlike CLI `--geometry`. This parser accepts HDD `-fs none` or `fat`, checks boot references, and does not execute arbitrary DOSBox commands. It does not mount an ISO.

## Browser GUI

In Brickwright Lite, the device dropdown's **Manage machines…** entry opens **Machines**. Paste a `brickwright-media.json`, DOSBox `.conf`, or machine-config JSON into the text area, press **Import**, then **Run** on the saved entry. Screen and keyboard interaction use the machine's widgets.

Import saves configuration and media references, not a package archive. Activation fetches referenced URLs and checks hashes when supplied. Browser-accessible URLs and correct relative URL bases are required; a host path such as `C:\games` does not grant browser filesystem access. The DOSBox GUI importer records `mount` directories as provenance and turns the first `.COM`/`.EXE` command into a program URL. It does not read that directory or reproduce every DOSBox command. Its `cputype` mapping can select an experimental 386 target; that alone does not establish compatibility for an arbitrary executable.

Wired configs require a circuit reference. The `wired`, `functional` and `auto` modes are not interchangeable media loaders. The debugger's firmware file picker accepts `.bin`, `.hex` and `.ihx`; it is not an ISO, disk-image or DOSBox-package picker. Browser imports do not select the Bochs native addon.

## Disk and ISO boundaries

The media-slot router exposes x86 ROM, program, floppy and (386) HDD slots. Raw HDD geometry is explicit; a `.vhd` filename accepted by a slot does not imply decoding a VHD container. No x86 CD-ROM/ISO slot or ISO boot implementation is exposed by the reviewed loaders. A generic DOSBox parser recognizing an `imgmount` declaration does not create a CD-ROM device. Use a supported raw HDD/floppy image or program format rather than renaming an ISO.

The generic `runMediaBundle` helper requires an explicit factory for x86. For 8086 floppy bundles, the specialized `runI8086FloppyBundle` supplies the board/floppy path and requires BIOS bytes. Functional 286 AT boot and native diagnostics have their own acceptance procedures; do not infer them from a generic media manifest.

## Source and bounded evidence

The CLI contracts are in [run-dos.mjs](../scripts/run-dos.mjs), [run-i80386-at-console.mjs](../scripts/run-i80386-at-console.mjs) and [its HDD config parser](../scripts/lib/i80386-at-dosbox-config.mjs). Library slots and bundle behavior are in [machine-media.js](../src/machine-media.js), [machine-media-i8086.js](../src/machine-media-i8086.js) and [dosbox-config.js](../src/dosbox-config.js).

GUI behavior was inspected at Brickwright Lite revision `d7e07b51541397e3fece31d251e2dd47d3d288f0` in a separate checkout: `overlay/scratch-gui/src/components/tw-pseudocode/machine-manager.jsx`, `debug-panel.jsx`, and `overlay/scratch-gui/src/lib/bw-machines/{importers,activate,machine-config}.js`. This guide is a source audit, not a new browser or guest acceptance run.

For actual bounded 386 results, see [experimental architecture](I80386-EXPERIMENTAL.md), [paired performance results](I80386-COLD-PAIRED-RESULTS.md) and [protected stack results](I80386-PROTECTED-STACK-RESULTS.md). Native fixture parity does not establish general OS boot, physical 386 timing or GUI availability.
