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

## Wired and hybrid Harris paths

The Harris 80286 board has reference and compiled connectivity backends. `netBackend: 'compiled'` changes actual-net representation and scheduling; it is still wired circuit execution. The native-memory hybrid bridge uses JS instruction semantics with native bus/net periods; it remains a separate experimental path with limited peripheral admission. These are not selected by `run-dos.mjs --variant 80286`, which uses the independent functional DOS-service core. There is no wired 80386 target in the current 386 AT loaders.

For the owned Harris circuit demonstration, run:

```sh
node scripts/run-harris-boot-cpu.mjs --experimental
node scripts/run-harris-boot-cpu.mjs --experimental --loop
```

These commands construct the fixed circuit and owned ROM; they are not arbitrary disk-image loaders. The source-pinned wired DOS boot route is documented in [compiled Harris connectivity](HARRIS-COMPILED-NETS.md), using the officially released MIT DOS 2.0 inputs. Native-memory hybrid construction and its admitted scope are in [the hybrid implementation](HARRIS-HYBRID-CPU-IMPLEMENTATION.md). GUI circuit execution requires the corresponding circuit reference; no DOSBox import switches a functional machine into that board.

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
AT_BIOS_ROM=media/bios.bin AT_BIOS_SHA256=BIOS_SHA256 \
VGA_BIOS_ROM=media/vgabios.bin VGA_BIOS_SHA256=VGA_SHA256 \
AT_HDD_SHA256=HDD_SHA256 \
node scripts/run-i80386-at-console.mjs \
  --hdd-image media/freedos.img --geometry 615,4,17 --steps 1000000
```

Replace every hash placeholder with the actual 64-digit hash. The system BIOS must be 64 KiB and the CLI VGA ROM must be 16–64 KiB. The HDD byte length must equal cylinders × heads × sectors × 512. The geometry limits are 1–1024 cylinders, 1–16 heads and 1–63 sectors. `--live` enables the terminal; `--steps` sets the instruction budget.

For interaction, add `--live` to the same command and run it in a terminal with TTY input and output. Typed keys go to the guest; **Ctrl-]** quits and **Ctrl-L** redraws. The display uses ANSI text or supported VGA graphics, scaled to the terminal. Mouse movement/buttons use xterm SGR mouse reporting when the terminal supports it; guest software must also enable its mouse interface. Terminal state is restored on exit. This is terminal interaction, not a separate SDL window.

Disk writes change the emulated disk in memory. This runner does not write them back to the original image or offer a saved-disk export option. `AT_CONSOLE_REPORT=media/new-report.json` saves the final execution report, including the disk hash, but does not save changed disk bytes.

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

### Local FreeDOS floppy/HDD recipe

The current Lite interface has a dedicated **FreeDOS VGA (named 386 profile)** section in **Manage machines…**. This selects the board preset `freedos-vga`; it is separate from pasting a DOSBox program config.

1. Under **Floppy**, choose a freely licensed raw 360 KiB or 1.2 MiB boot image (`.img`, `.ima` or `.dsk`). Alternatively, under **HDD**, choose a raw 306 × 4 × 17-sector image (`.img` or `.ima`, exactly 10,653,696 bytes). These are this named profile's supported sizes, not a general geometry dialog. If both are supplied, the floppy is first in the boot order.
2. Optionally select **AT BIOS** (exactly 64 KiB) and **VGA ROM** (1–40 KiB). If omitted, the runner fetches its bundled LGPL Bochs BIOS and VGA firmware. Supplied files must have appropriate licenses; the browser does not establish licensing from their extensions.
3. Leave **Native blocks (experimental)** unchecked for the plain functional route. That checkbox selects the experimental JS block dispatcher, not a Bochs addon.
4. Click **Boot FreeDOS VGA**. Selected local files are read into this tab's memory and passed directly to the loader; they are not uploaded or converted to public URLs. The frontend creates the named target, calls the board's `applyMedia` for BIOS/VGA/floppy/HDD, calls `machine.reset()`, then starts the runner. There is no separate **Apply** or **Reset** button in this form. Boot/attachment errors remain visible in the manager. Repeating the boot action creates a fresh runner with the selected media.
5. Use the **AT VGA** screen in the **Controller**/Widgets pane. The debugger offers **Run**, **Pause** and **Step** as target capabilities allow; the initial boot action already starts execution. Select **Play** in Controller for interactive widgets; its Play/Edit switch controls widget interaction, not CPU reset.

For another raw HDD geometry, the separate **Boot a local DOSBox HDD** form has a disk picker plus an optional DOSBox `.conf` picker and **Boot disk** button. This form always selects the 386 AT target, including when a config says `cputype=auto` or an older CPU. Its `imgmount -size` geometry must match the image byte length, and the selected filename must match `imgmount`. With no config geometry, it infers cylinders only for images that fit 4 heads × 17 sectors and 1–1024 cylinders. This route also keeps the disk bytes in the current tab. It does not unpack a ZIP or infer CD-ROM hardware from an ISO.

### Referenced media versus local files

Pasted saved configs use URL references: activation fetches media only on Run, verifies provided SHA-256 values, and reports fetch/hash failures. For a named profile, use `machine: "i80386"`, `machineConfig: "freedos-vga"`, `executionMode: "functional"`, and `slots` entries for `floppy` or `hdd`, plus optional `bios` and `vga-rom`. A slot reference uses `url`, optional `sha256`, and explicit `geometry` where appropriate. Give manifests/configs browser-resolvable URLs; filenames pasted without a base are not a local-file selection. The dedicated forms above instead use private `local-media:` references backed by the selected File objects and do not persist those bytes in a reusable exported package.

### Enlarge the screen

Select **Controller** in the stage-header view controls to show interactive widgets. In its toolbar, **Full screen** expands that pane; **Exit full screen** returns it to the normal layout. The standard stage-header full-screen control and Escape also exit full-screen mode. This enlarges the pane, not the emulated VGA resolution. In Controller **Edit** mode, the VGA widget can be resized using the existing widget layout controls; its canvas fills the widget and uses pixelated rendering. The stage-header **Debugger** view enlarges the debugger in the right pane, which is a different surface from the Controller screen.

Wired configs require a circuit reference. The `wired`, `functional` and `auto` modes are not interchangeable media loaders. The debugger's firmware file picker accepts `.bin`, `.hex` and `.ihx`; it is not an ISO, disk-image or DOSBox-package picker. Browser imports do not select the Bochs native addon.

## Disk and ISO boundaries

The media-slot router exposes x86 ROM, program, floppy and (386) HDD slots. Raw HDD geometry is explicit; a `.vhd` filename accepted by a slot does not imply decoding a VHD container. No x86 CD-ROM/ISO slot or ISO boot implementation is exposed by the reviewed loaders. A generic DOSBox parser recognizing an `imgmount` declaration does not create a CD-ROM device. Use a supported raw HDD/floppy image or program format rather than renaming an ISO.

The generic `runMediaBundle` helper requires an explicit factory for x86. For 8086 floppy bundles, the specialized `runI8086FloppyBundle` supplies the board/floppy path and requires BIOS bytes. Functional 286 AT boot and native diagnostics have their own acceptance procedures; do not infer them from a generic media manifest.

## Source and bounded evidence

The CLI contracts are in [run-dos.mjs](../scripts/run-dos.mjs), [run-i80386-at-console.mjs](../scripts/run-i80386-at-console.mjs) and [its HDD config parser](../scripts/lib/i80386-at-dosbox-config.mjs). Library slots and bundle behavior are in [machine-media.js](../src/machine-media.js), [machine-media-i8086.js](../src/machine-media-i8086.js) and [dosbox-config.js](../src/dosbox-config.js).

GUI behavior was initially inspected at historical Brickwright Lite revision `d7e07b51541397e3fece31d251e2dd47d3d288f0`, then checked against remote default HEAD `598febf364969f42483821c87bbdc0317e3cdb61` on 2026-10-04. The current local-file and fullscreen recipes use that newer source: `overlay/scratch-gui/src/components/tw-pseudocode/{machine-manager,debug-panel,controller-panel-view}.jsx`, `components/stage-header/stage-header.jsx`, and `overlay/scratch-gui/src/lib/bw-machines/{importers,activate,machine-config,local-freedos-vga,run-machine}.js`, plus `lib/bw-debug/debug-runner.js`. This guide is a source audit, not a new browser or guest acceptance run.

For actual bounded 386 results, see [experimental architecture](I80386-EXPERIMENTAL.md), [paired performance results](I80386-COLD-PAIRED-RESULTS.md) and [protected stack results](I80386-PROTECTED-STACK-RESULTS.md). Native fixture parity does not establish general OS boot, physical 386 timing or GUI availability.
