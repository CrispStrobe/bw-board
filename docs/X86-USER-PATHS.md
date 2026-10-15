# x86 user paths: programs, disks and debugging

Source checkpoint: [bw-board b4b4c87f](https://github.com/CrispStrobe/bw-board/tree/b4b4c87f70624dfb570a6d21391c5a2d5a40a0e8). This guide describes implemented routes and existing finite evidence. It introduces no new execution, timing or installed-app qualification. Start with the [loading guide](X86-LOADING-GUIDE.md) for media geometry and options.

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

HDD writes remain in emulated memory. Console shutdown does not save a changed disk image; a final report is not a disk export. Installation and persistence need an explicit export/reload workflow.

## Formats are separate capabilities

| Input | Implemented behavior |
|---|---|
| `.COM` / MZ `.EXE` | Direct DOS-service loading; not arbitrary protected-mode executable compatibility. |
| Raw floppy / HDD | Supported board slot and geometry; HDD byte size must match CHS. |
| DOSBox `.conf` | Partial declarative translation. Direct DOS selects the first program and records mounts; the 386 console accepts one supported HDD `imgmount` and boot declaration. No host shell is executed. |
| ZIP / JS-DOS package | These loaders do not unpack the package or reproduce arbitrary autoexec commands. Inspect/unpack separately and supply a supported input. |
| `.vhd` filename | The HDD slot expects raw bytes; the extension does not implement a VHD container decoder. |
| ISO / CD-ROM | The reviewed loaders expose no CD/ATAPI, ISO-filesystem or El Torito boot route. Renaming an ISO cannot add that hardware or loader. |

## App and debugger

Use [Lite's user paths](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/X86-USER-PATHS.md) for the actual Machine Manager forms, Controller screen and debugger controls. The board's [target factory](../src/debug-target-factory.js) composes the 386 adapter with the shared [debug target](../src/i8086-debug.js).

The shared 8086 debug target is also composed with the 386 adapter, but this does **not** make a complete 386 debugger. At this checkpoint, debug-event register capture calls `machine._architecturalRegisters()`, which the 386 AT deliberately rejects. An active debug subscriber can therefore make a step fail before instruction retirement. Its remaining address/register/disassembly assumptions are also 8086-shaped. Treat the following as source limitations, not a qualified protected-mode UI.

| Surface | 8086 contract | Current 386 limitation |
|---|---|---|
| Run/pause/instruction step | Forward instruction execution | Ordinary execution exists, but debug-event subscription can fail at register capture. |
| Step over/out, run to address | Shared target advertises these | 16-bit control-flow assumptions and 20-bit run-to/address masking are not a complete protected-mode/32-bit contract. |
| Breakpoints | Code/write; port/interrupt with hooks | Shared plumbing exists; full 386 addresses/event capture are not qualified. A write breakpoint is not a general read watchpoint. |
| Registers/disassembly/memory | 8086 register projection and instruction inspection | AX-style projection and 8086 disassembly do not provide full EAX/EIP/segment-cache or 32-bit protected-mode inspection. |
| Cycle/phase step | Not advertised | Not advertised. |
| Checkpoint/replay | Capability-gated by the specific machine | Architectural 386 checkpoint/replay remains explicitly refused. |

The next debugger task must fix or explicitly gate unsupported 386 capture, registers, addressing and disassembly while preserving 8086 behavior and the checkpoint refusal. A visible debugger pane is not evidence of successful 386 trace execution.

## What has actually been demonstrated

The current ordinary CPU has bounded MIT xv6 boot/filesystem/process acceptance. Existing [owned DOS32A client](I80386-DOS32A-OWNED-LE-RESULTS.md) and [DPMI high-memory AT results](I80386-DPMI-HIGHMEM-AT-RESULTS.md) record specific protected-client completion and return-to-shell boundaries. The existing [high-memory timer run37776895780](https://github.com/CrispStrobe/bw-board/actions/runs/37776895780) also observed the owned DPMI timer transition and return/verification; it is not a missing basic extender scenario. Their original sources, failures and restrictions remain authoritative. They are not a promise that every extender, application, peripheral or guest works.

[Media Lab](https://github.com/CrispStrobe/brickwright-media-lab) supplies separately licensed manifests, fetch scripts and assets; board loaders supply execution. Its Minix 2 project README records a protected-mode login/shell scenario, not a new independent proof from this guide. Freedoom/FastDoom is packaged but explicitly was not executed in that packaging environment; OpenGEM's full-run proof remains pending. Project availability alone is not installed-GUI qualification.

After the separate debugger correction, installed acceptance should use an existing free client through the exact supplier package: visible marker/input, pause, code breakpoint, single step, register/memory observation and resume. Coordinate Lite's shared supplier-pin owner first. A board-only result cannot certify the installed GUI, and a performance result cannot establish physical RTx or full AT/OS compatibility.
