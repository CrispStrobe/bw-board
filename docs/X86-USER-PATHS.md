# x86 user paths: programs, disks and debugging

Source checkpoint: [bw-board 2fad5879](https://github.com/CrispStrobe/bw-board/tree/2fad58795c3f7b1e574fc684e2c6bcad344f86c9), updated 2026-10-16. This guide describes implemented routes and existing finite evidence. It introduces no new execution, timing or installed-app qualification. Start with the [loading guide](X86-LOADING-GUIDE.md) for media geometry and options.

## Choose the execution path

| Path | What you can run | Boundary |
|---|---|---|
| Functional 8086/80186/80286 DOS services | Direct `.COM` and MZ `.EXE` programs, keyboard input and supplied DOS files | Implements DOS services; it does not boot DOS from a disk. Choosing the 80286 variant does not select an AT BIOS board. |
| Functional 8086 board | BIOS and supported raw floppy bundles through `I8086Machine` / `runI8086FloppyBundle` | Caller supplies BIOS bytes; each guest has its own acceptance. |
| Wired 8086 circuit | Explicit `executionMode: "wired"` and `circuit.ref` | Requires an admitted circuit realization; a functional program/floppy result does not certify the wired path. |
| Wired Harris 80286 | The fixed circuit, compiled connectivity and separately admitted hybrid routes | Follow [Harris connectivity](HARRIS-COMPILED-NETS.md). Functional DOS or 386 results do not qualify a wired guest. |
| Experimental functional 386 AT | Free BIOS, VGA and supported raw floppy/HDD guests; console and shared debug target | No wired 386 loader is selected. Native block execution is optional and separate from fixed native-addon diagnostics. |

## Run a DOS program in the CLI

From a checkout with its documented prerequisites, provide a freely licensed or authored program:

```sh
node scripts/run-dos.mjs examples/hello.com --variant 8086 --preset xt --max 1000000 --screen
node scripts/run-dos.mjs examples/program.exe --variant 80286 --preset at --screen
```

These example filenames are placeholders for your files. `--keys "text"` supplies input; repeated `--file DOSNAME=examples/input.txt` supplies explicit in-memory files. `--out output` exports files created by the DOS service layer. Budget exhaustion returns status 2, rather than successful program termination. This is a command-line program runner, not a standalone interactive debugger.

## Boot and interact with a 386 HDD

Follow the canonical [raw-HDD command and live-terminal recipe](X86-LOADING-GUIDE.md#cli-experimental-386-raw-hdd-boot): provide your raw disk, exact CHS and BIOS/VGA/HDD hashes, then select `--live` with a bounded `--steps` budget. This does not fetch media. A TTY accepts guest typing, **Ctrl-]** quit and **Ctrl-L** redraw; supported terminals can send SGR mouse input after guest initialization. [Live-PTY acceptance](I80386-CLI-PTY-RESULTS.md) records the tested keyboard/redraw/quit/restoration boundary. The screen is in the terminal, not an SDL window.

HDD writes remain in emulated memory unless the console receives explicit `--hdd-output NEW_FILE`. That option creates an exclusive verified raw copy, preserves the original input and requires the ordinary JavaScript path and a safe copy boundary; a final report alone is not a disk export. The [finite persistence result](I80386-HDD-PERSISTENCE-RESULTS.md) qualifies floppy boot with a master data disk, guest write/close, export and fresh-process readback. It does not qualify HDD boot, crash durability or installed GUI download/reload.

## Formats are separate capabilities

| Input | Implemented behavior |
|---|---|
| `.COM` / MZ `.EXE` | Direct DOS-service loading; not arbitrary protected-mode executable compatibility. |
| Raw floppy / HDD | Supported board slot and geometry; HDD byte size must match CHS. |
| DOSBox `.conf` | Partial declarative translation. Direct DOS selects the first program and records mounts; the 386 console accepts one supported HDD `imgmount` and boot declaration. No host shell is executed. |
| ZIP / JS-DOS package | The merged loaders do not unpack these. [Draft PR644](https://github.com/CrispStrobe/bw-board/pull/644) is the current bounded STORED-ZIP/raw-HDD CLI candidate. PR641's workflow completed all four cases, but its frozen reader refused the manifest ordering; that result is not accepted. The canonical producer fix needs fresh qualification. No arbitrary autoexec execution or broad DOSBox compatibility follows. |
| `.vhd` filename | The HDD slot expects raw bytes; the extension does not implement a VHD container decoder. |
| ISO / CD-ROM | The reviewed loaders expose no CD/ATAPI, ISO-filesystem or El Torito boot route. Renaming an ISO cannot add that hardware or loader. |

## App and debugger

Use [Lite's user paths](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/X86-USER-PATHS.md) for the actual Machine Manager forms, Controller screen and debugger controls. The board's [target factory](../src/debug-target-factory.js) composes the 386 adapter with the shared [debug target](../src/i8086-debug.js).

The dedicated [386 target](../src/i80386-debug.js) now supplies full-width
register capture and unsigned addresses while reusing the shared forward-debug
plumbing. The merged [subscribed free-guest result](I80386-DEBUG-GUEST-RESULTS.md)
retains 64 consecutive retirements, including protected 32-bit ring-3 instructions,
and byte-identical control/subscribed guest output. The old legacy-register
subscriber failure is corrected; this finite Board result does not qualify an
installed Lite debugger.

| Surface | Current 386 contract |
|---|---|
| Run/pause/instruction step | Forward execution and positive-count instruction stepping; no cycle/phase step. |
| Run to address | Unsigned 32-bit linear code address, stopping before execution. |
| Breakpoints | Linear code and physical write ranges; a write breakpoint is not a read watchpoint. |
| Registers/memory | Full-width registers and mode/cache scalars; read-only physical bus addresses 0–`0xffffffff`, at most 1 MiB per read. Addressability does not imply mapped RAM. |
| Disassembly, step over/out, symbols | Explicitly unavailable; no 8086 decoder is presented as protected-mode decoding. |
| Checkpoint/replay | Architectural 386 checkpoint, restore and replay remain refused. |

Lite still needs coordinated supplier adoption and affected installed acceptance.
The proposed [adoption handoff PR1006](https://github.com/CrispStrobe/brickwright-lite/pull/1006)
transfers no pin ownership. A visible debugger pane or a successful Board test
cannot establish which API an installed app contains.

## What has actually been demonstrated

The current ordinary CPU has bounded MIT xv6 boot/filesystem/process acceptance. Existing [owned DOS32A client](I80386-DOS32A-OWNED-LE-RESULTS.md) and [DPMI high-memory AT results](I80386-DPMI-HIGHMEM-AT-RESULTS.md) record specific protected-client completion and return-to-shell boundaries. The existing [high-memory timer run37776895780](https://github.com/CrispStrobe/bw-board/actions/runs/37776895780) also observed the owned DPMI timer transition and return/verification; it is not a missing basic extender scenario. The later [keyboard challenge/response](I80386-DOS32A-KEYBOARD-RESULTS.md) and [protected file readback/seek/EOF](I80386-DOS32A-FILE-READBACK-RESULTS.md) results add finite owned-client slices. Their original sources, failures and restrictions remain authoritative. They are not a promise that every extender, application, peripheral or guest works.

[Media Lab](https://github.com/CrispStrobe/brickwright-media-lab) supplies separately licensed manifests, fetch scripts and assets; board loaders supply execution. Its Minix 2 project README records a protected-mode login/shell scenario, not a new independent proof from this guide. Freedoom/FastDoom is packaged but explicitly was not executed in that packaging environment; OpenGEM's full-run proof remains pending. Project availability alone is not installed-GUI qualification.

After coordinated supplier adoption, installed acceptance should use an existing free client through the exact supplier package: visible marker/input, pause, code breakpoint, single step, register/memory observation and resume. Coordinate Lite's shared supplier-pin owner first. A board-only result cannot certify the installed GUI, and a performance result cannot establish physical RTx or full AT/OS compatibility.
